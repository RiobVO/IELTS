import { Worker } from "node:worker_threads";

/**
 * Extracts the JS data object literals embedded at the end of a test file
 * (correctAnswers, acceptableAnswers, mcqGroups, questionTypes, explanations,
 * evidence). Deterministic, no LLM. The literals are evaluated in an isolated
 * vm context with no globals + a timeout, so it's pure data extraction, not
 * arbitrary code execution.
 */

// vm's `timeout` bounds execution TIME but NOT heap: a poison literal/function can allocate
// until the process OOMs (`FATAL ERROR: heap out of memory`, exit 134) — a fatal V8 abort the
// caller's try/catch CANNOT catch, taking down the whole import server (#20). Import is admin-
// only (requireAdmin / Telegram whitelist), but any client-supplied HTML reaches it, so a
// single malformed/hostile file could kill the process. Fix: run every evaluation inside a
// worker_threads isolate with `resourceLimits.maxOldGenerationSizeMb`. On a heap bomb the
// WORKER is terminated with ERR_WORKER_OUT_OF_MEMORY (a normal 'error' event on the parent),
// on a CPU bomb the inner vm `timeout` fires, and a wall-clock backstop terminates a wedged
// worker — all three surface as an ordinary rejected promise the caller rejects the import on,
// process intact. Kept: the global-free vm context (same escape posture) and the size gate
// below (cheap pre-filter — rejects absurd input before paying for a worker spawn).
const MAX_VM_INPUT = 4 * 1024 * 1024; // 4 MB

// Isolate resource caps. maxOldGenerationSizeMb is the load-bearing bound: a retained-
// allocation bomb grows old-gen past this and V8 terminates the worker (verified empirically
// at ~100 ms for `while(true) a.push(new Array(1e6))`). WALL_CLOCK_MS is a pure plumbing
// backstop, not a defense layer — it doesn't gate memory (resourceLimits, ~100ms) or CPU
// (the inner vm timeout, 1000ms) any tighter than those already do. It only needs to outlast
// worker spawn + a legit eval's own runtime under cold-start/parallel load, so it's set well
// above VM_TIMEOUT_MS to give slow spawns headroom without delaying the real limits above.
const WORKER_OLD_GEN_MB = 64;
const WORKER_YOUNG_GEN_MB = 16;
const VM_TIMEOUT_MS = 1000;
const WALL_CLOCK_MS = 5000;

/**
 * `new Worker(...)` throwing SYNCHRONOUSLY means worker_threads itself is unavailable
 * in this runtime (e.g. a serverless/sandboxed environment that doesn't support it) —
 * a SYSTEMIC failure that reproduces on every call, unlike an execution failure (bad
 * literal, timeout, OOM), which is input-specific and normal to degrade into `null`.
 * Callers MUST let this propagate rather than swallow it into `null` — silently
 * degrading every extraction turns into a draft persisted with empty answer keys
 * (content corruption, not a parse warning). Exported so import-runner.ts can let it
 * abort the import with an operator-facing message instead of a silent draft.
 */
export class WorkerUnavailableError extends Error {
  constructor(cause: unknown) {
    super(`worker_threads unavailable in this runtime: ${String((cause as Error)?.message ?? cause)}`);
    this.name = "WorkerUnavailableError";
  }
}

// Inline worker source (eval:true) — NO separate on-disk file, so Next/webpack bundling never
// has to resolve or trace it. Runs the untrusted code in a global-free vm context on its own
// thread and posts back a structured-cloneable result (data objects / number tables are plain
// JSON — clone is a faithful deep copy). Any throw (vm timeout, ReferenceError from the empty
// context, DataCloneError on non-data output) comes back as `{ ok:false }`; a heap bomb never
// reaches postMessage — the worker is killed and the parent sees an 'error' event instead.
const WORKER_SRC = `
const { parentPort, workerData } = require('node:worker_threads');
const vm = require('node:vm');
try {
  const value = vm.runInNewContext(workerData.code, Object.create(null), { timeout: workerData.timeout });
  parentPort.postMessage({ ok: true, value });
} catch (err) {
  parentPort.postMessage({ ok: false, error: String((err && err.message) || err) });
}
`;

/**
 * Evaluate `code` in a memory- and time-capped worker isolate. Resolves with the value,
 * rejects on any failure (OOM / timeout / eval error / crash). The worker is always
 * terminated (no leak) — on success, on failure, and on the wall-clock backstop.
 */
function runInWorker<T>(code: string, timeout: number): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    let worker: Worker;
    try {
      worker = new Worker(WORKER_SRC, {
        eval: true,
        workerData: { code, timeout },
        resourceLimits: {
          maxOldGenerationSizeMb: WORKER_OLD_GEN_MB,
          maxYoungGenerationSizeMb: WORKER_YOUNG_GEN_MB,
        },
      });
    } catch (err) {
      // Constructor threw synchronously — worker_threads is unavailable here, not a
      // problem with `code`. Named error so extractData/extractFunctionTable rethrow
      // instead of folding it into their usual "bad input -> null" catch.
      reject(new WorkerUnavailableError(err));
      return;
    }
    let settled = false;
    const finish = (fn: () => void): void => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      // terminate() is idempotent and safe on an already-exited worker — guarantees no leak.
      void worker.terminate();
      fn();
    };
    const timer = setTimeout(
      () => finish(() => reject(new Error(`worker timed out after ${WALL_CLOCK_MS}ms`))),
      WALL_CLOCK_MS,
    );
    worker.on("message", (msg: { ok: boolean; value?: T; error?: string }) => {
      if (msg.ok) finish(() => resolve(msg.value as T));
      else finish(() => reject(new Error(msg.error ?? "worker evaluation failed")));
    });
    // OOM (ERR_WORKER_OUT_OF_MEMORY) and any other worker crash arrive here — catchable.
    worker.on("error", (err) => finish(() => reject(err)));
    worker.on("exit", (exitCode) => {
      if (exitCode !== 0) finish(() => reject(new Error(`worker exited with code ${exitCode}`)));
    });
  });
}

/** Пропускает whitespace + //- и /* *​/-комментарии начиная с i. Нужен и в пре-скане
 * между `=` и `{`, и был бы уязвим без него: комментарий там ронял extractObjectLiteral
 * в null ДО баланс-цикла (adversarial 2026-07-09), а blankObject молча пропускал ключ. */
function skipTrivia(src: string, i: number): number {
  for (;;) {
    const c = src[i];
    if (c === undefined) return i;
    if (/\s/.test(c)) i++;
    else if (c === "/" && src[i + 1] === "/") {
      i += 2;
      while (i < src.length && src[i] !== "\n") i++;
    } else if (c === "/" && src[i + 1] === "*") {
      i += 2;
      while (i < src.length && !(src[i] === "*" && src[i + 1] === "/")) i++;
      i += 2; // проглотить закрывающие */
    } else return i;
  }
}

/** Find `const NAME = { ... }` and return the balanced-brace literal text. */
export function extractObjectLiteral(src: string, name: string): string | null {
  const re = new RegExp(`(?:const|let|var)\\s+${name}\\s*=\\s*`);
  const m = re.exec(src);
  if (!m) return null;

  let i = skipTrivia(src, m.index + m[0].length);
  if (src[i] !== "{") return null;

  const start = i;
  let depth = 0;
  let inStr: string | null = null;
  let esc = false;
  // Комментарии обязаны трекаться наравне со строками: апостроф в `// don't` иначе
  // открыл бы фантомную строку, а `}` в комментарии — сбил бы depth (P2, security:
  // тот же сканер чистит ключи из runner_html через blankObject).
  let inComment: "line" | "block" | null = null;
  for (; i < src.length; i++) {
    const c = src[i]!;
    if (inComment === "line") {
      if (c === "\n") inComment = null;
      continue;
    }
    if (inComment === "block") {
      if (c === "*" && src[i + 1] === "/") {
        inComment = null;
        i++;
      }
      continue;
    }
    if (inStr) {
      if (esc) esc = false;
      else if (c === "\\") esc = true;
      else if (c === inStr) inStr = null;
      continue;
    }
    // Комментарий распознаём только ВНЕ строки: `//` в "http://x" — не комментарий.
    if (c === "/" && src[i + 1] === "/") {
      inComment = "line";
      i++;
    } else if (c === "/" && src[i + 1] === "*") {
      inComment = "block";
      i++;
    } else if (c === "'" || c === '"' || c === "`") inStr = c;
    else if (c === "{") depth++;
    else if (c === "}") {
      depth--;
      if (depth === 0) return src.slice(start, i + 1);
    }
  }
  return null;
}

/**
 * Evaluate an object literal as pure data in an isolated, global-free worker.
 * Not `async`: the size gate throws synchronously (kept byte-for-byte, callers rely on it),
 * then the worker call is returned as a promise the caller awaits.
 */
export function evalDataObject<T = unknown>(literal: string): Promise<T> {
  if (literal.length > MAX_VM_INPUT) {
    throw new RangeError(`data literal too large (${literal.length} > ${MAX_VM_INPUT})`);
  }
  return runInWorker<T>(`(${literal})`, VM_TIMEOUT_MS);
}

export async function extractData<T = unknown>(src: string, name: string): Promise<T | null> {
  const lit = extractObjectLiteral(src, name);
  if (lit == null) return null;
  try {
    return await evalDataObject<T>(lit);
  } catch (err) {
    // Systemic runtime failure — not this literal's fault — must abort the import,
    // not degrade to an empty object (see WorkerUnavailableError doc above).
    if (err instanceof WorkerUnavailableError) throw err;
    return null;
  }
}

/**
 * Some files don't store the per-question type map as a literal, but build it
 * at runtime via a range-builder IIFE:
 *   const QTYPE = {};
 *   (function(){ const set=(a,b,t)=>{ for(let q=a;q<=b;q++) QTYPE[q]=t; };
 *     set(1,6,'Table completion'); set(7,10,'Note completion'); ... })();
 * `extractObjectLiteral` only sees the `{}` at declaration (the IIFE never runs),
 * so the map comes back empty. Reconstruct it deterministically — no eval: find
 * the setter (the function that writes `NAME[...] = ...`), parse its
 * `setter(a, b, 'type')` calls and expand each into {q: type} for q∈[a,b].
 * Tolerant of var|let|const, arrow/function form, quote style and spacing.
 * Returns null when no range-builder shape is found (caller falls back).
 */
export function extractRangeBuilderTable(
  src: string,
  name: string,
): Record<string, string> | null {
  // Setter = a function whose body assigns `name[<idx>] = ...`. Derive its
  // identifier rather than hardcoding `set`, so other call sites can't poison us.
  const setterRe = new RegExp(
    `(?:const|let|var)\\s+(\\w+)\\s*=\\s*(?:function\\s*)?\\([^)]*\\)\\s*(?:=>)?\\s*\\{[^}]*\\b${name}\\s*\\[[^\\]]+\\]\\s*=`,
  );
  const sm = setterRe.exec(src);
  if (!sm) return null;
  const setter = sm[1]!;

  const callRe = new RegExp(
    `\\b${setter}\\s*\\(\\s*(\\d+)\\s*,\\s*(\\d+)\\s*,\\s*(['"\`])([\\s\\S]*?)\\3\\s*\\)`,
    "g",
  );
  const out: Record<string, string> = {};
  let m: RegExpExecArray | null;
  while ((m = callRe.exec(src)) !== null) {
    const a = Number(m[1]);
    const b = Number(m[2]);
    const type = m[4]!;
    if (b < a) continue;
    for (let q = a; q <= b; q++) out[String(q)] = type;
  }
  return Object.keys(out).length > 0 ? out : null;
}

/** Find `function NAME(...) { ... }` and return its full balanced-brace text. */
function extractFunctionText(src: string, name: string): string | null {
  const re = new RegExp(`function\\s+${name}\\s*\\([^)]*\\)\\s*\\{`);
  const m = re.exec(src);
  if (!m) return null;
  const start = m.index;
  let i = m.index + m[0].length - 1; // at the opening "{"
  let depth = 0;
  let inStr: string | null = null;
  let esc = false;
  for (; i < src.length; i++) {
    const c = src[i]!;
    if (inStr) {
      if (esc) esc = false;
      else if (c === "\\") esc = true;
      else if (c === inStr) inStr = null;
      continue;
    }
    if (c === "'" || c === '"' || c === "`") inStr = c;
    else if (c === "{") depth++;
    else if (c === "}") {
      depth--;
      if (depth === 0) return src.slice(start, i + 1);
    }
  }
  return null;
}

/**
 * Some files store the raw->band scale as a THRESHOLD FUNCTION (`band(r)` /
 * `getBand(s)`) instead of a data object. Extract the function and CALL it for
 * every integer in [min,max] inside an isolated, global-free vm (timeout) to
 * materialize the scale as a {raw: band} table. Deterministic — pure evaluation
 * of a self-contained numeric function, no LLM, no external access.
 */
export async function extractFunctionTable(
  src: string,
  name: string,
  min: number,
  max: number,
): Promise<Record<number, number> | null> {
  const fnText = extractFunctionText(src, name);
  if (fnText == null || fnText.length > MAX_VM_INPUT) return null;
  const harness = `${fnText}\n(function(){const t={};for(let r=${min};r<=${max};r++){const v=${name}(r);if(typeof v==='number')t[r]=v;}return t;})()`;
  try {
    const table = await runInWorker<Record<number, number>>(harness, VM_TIMEOUT_MS);
    return table && Object.keys(table).length > 0 ? table : null;
  } catch (err) {
    if (err instanceof WorkerUnavailableError) throw err;
    return null;
  }
}
