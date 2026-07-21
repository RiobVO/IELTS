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
// has to resolve or trace it. Two modes, both memory-/time-capped on their own thread and
// posting back a structured-cloneable result (data objects / number tables are plain JSON):
//   - 'data'  — evaluate a single data literal in a global-free context (extractData path).
//   - 'table' — load the source scripts the way a browser loads classic <script> blocks and
//               materialize a threshold function into a {raw: band} table (see buildTable).
// Any throw (vm timeout, ReferenceError from the empty context, DataCloneError on non-data
// output) comes back as `{ ok:false }`; a heap bomb never reaches postMessage — the worker is
// killed and the parent sees an 'error' event instead.
const WORKER_SRC = `
const { parentPort, workerData } = require('node:worker_threads');
const vm = require('node:vm');
try {
  const value = workerData.mode === 'table'
    ? buildTable(vm, workerData)
    : vm.runInNewContext(workerData.code, Object.create(null), { timeout: workerData.timeout });
  parentPort.postMessage({ ok: true, value });
} catch (err) {
  parentPort.postMessage({ ok: false, error: String((err && err.message) || err) });
}

// Browser-faithful classic-script load of source <script> blocks, then materialize
// workerData.name(r) over [min,max] into a {raw: band} table. Mirrors how a browser runs
// classic scripts: one shared global, blocks compiled and executed independently, function
// declarations (even under "use strict") bound on the global before the body runs.
function buildTable(vm, wd) {
  const { blocks, name, min, max, timeout } = wd;
  // window/self alias the context global so a source that publishes the scale via
  // 'window.band = ...' (not a bare declaration) is reachable, exactly as in a browser.
  const sandbox = {};
  sandbox.window = sandbox;
  sandbox.self = sandbox;
  vm.createContext(sandbox);
  // Each block is an independent classic script: compiled + run on its own, so a SyntaxError
  // (e.g. a <script type="application/json"> body that slipped through) or a runtime throw
  // (document.* in a headless context) in one block never suppresses declarations from the
  // others. A vm timeout, though, means the script hung — a browser's single thread would
  // freeze and nothing after it would run, so no meaningful table exists: fail closed to null.
  for (let i = 0; i < blocks.length; i++) {
    try {
      new vm.Script(blocks[i]).runInContext(sandbox, { timeout });
    } catch (e) {
      if (e && /timed out/i.test(String(e.message))) return null;
    }
  }
  // Read the function as an own/global property of the context — capturing the REAL
  // declaration, so a script that reassigns globalThis to fake the lookup cannot redirect us.
  const fn = sandbox[name];
  if (typeof fn !== 'function') return null;
  // Build the table in THIS (worker) realm as a null-proto object. Reads land in a host object
  // with no prototype, so numeric setters a block may have planted on the context's
  // Object.prototype — or an overridden Object.create — cannot intercept or corrupt it. fn(r)
  // runs INSIDE the context under the same timeout (a per-call CPU bomb stays bounded to ~1s,
  // not the wall-clock backstop); the host sink accumulates only numeric results.
  const table = Object.create(null);
  sandbox.__fn = fn;
  sandbox.__sink = function (r, v) { if (typeof v === 'number') table[r] = v; };
  try {
    new vm.Script('for (var r=' + min + '; r<=' + max + '; r++){ try { __sink(r, __fn(r)); } catch(e){} }')
      .runInContext(sandbox, { timeout });
  } catch (e) { /* CPU bomb / mass-throw — whatever landed in the table stands */ }
  // Flatten to a plain object (worker realm, pristine Object.prototype) for structured clone.
  const out = {};
  for (const k in table) out[k] = table[k];
  return out;
}
`;

/**
 * Run one worker job (mode 'data' or 'table') in a memory- and time-capped isolate. Resolves
 * with the value, rejects on any failure (OOM / timeout / eval error / crash). The worker is
 * always terminated (no leak) — on success, on failure, and on the wall-clock backstop.
 */
function runInWorker<T>(workerData: Record<string, unknown>): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    let worker: Worker;
    try {
      worker = new Worker(WORKER_SRC, {
        eval: true,
        workerData,
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

/**
 * A browser runs a `<script>` as code only when its `type` is absent/empty, a JavaScript
 * MIME, or `module`; anything else (`application/json`, `text/template`, …) is inert data.
 * Callers filter their `<script>` blocks through this before `extractFunctionTable` so a
 * non-JS block can't inject a SyntaxError — in the browser model it's a separate, ignored tag.
 */
const EXECUTABLE_JS_TYPE_RE = /^(?:text|application)\/(?:x-)?(?:java|ecma)script$/;
export function isExecutableScriptType(type: string | null | undefined): boolean {
  if (type == null) return true;
  const t = type.trim().toLowerCase();
  return t === "" || t === "module" || EXECUTABLE_JS_TYPE_RE.test(t);
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
  return runInWorker<T>({ mode: "data", code: `(${literal})`, timeout: VM_TIMEOUT_MS });
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

/**
 * Some files store the raw->band scale as a THRESHOLD FUNCTION (`band(r)` /
 * `getBandFor40(s)`) instead of a data object. We used to text-slice the function
 * body out with a hand-rolled lexer, but distinguishing a regex literal from
 * division — and a block `}` from an object `}` — needs a grammar, not a lexer
 * (three review rounds kept finding holes). So instead we LOAD the source scripts
 * the way a browser loads classic `<script>` blocks and read the function back:
 *
 *  - `scriptBlocks` is the array of `<script>` bodies verbatim — NOT concatenated.
 *    Each block is compiled and executed on its own `vm.Script` in ONE shared,
 *    browser-like context (window/self alias the global). Independent compilation
 *    isolates a block whose body is a SyntaxError (e.g. a `type="application/json"`
 *    block) or throws at runtime (`document.*` in a headless context) — the other
 *    blocks' declarations survive, exactly as separate `<script>` tags do. A block
 *    that HANGS (vm timeout) is fatal (a browser thread would freeze), yielding null.
 *  - Function declarations bind on the context global during GlobalDeclarationInstantiation
 *    — BEFORE the body runs and REGARDLESS of `"use strict"` (Script mode, not eval
 *    scope) — so the scale survives a block that throws right after declaring it. A
 *    commented-out or regex-embedded "declaration" is never bound: no heuristic to fool.
 *  - The function is read as an own/global property of the context (covers `function`,
 *    `var`, and `window.name =`/`self.name =` forms) and CALLED for every integer in
 *    [min,max] INSIDE the context (per-call timeout) to materialize the {raw: band}
 *    table. Results are accumulated in a host-realm null-proto object, immune to a block
 *    poisoning the context's Object.prototype or Object.create. A per-r try skips a
 *    throwing r (a delegator to a helper that was never declared → empty table → null).
 *
 * Delegation (`getBandFor40` → `getBandFor13`) works natively: both declarations
 * share the context, so no dependency list is needed. Deterministic, worker-isolated
 * (timeout + heap cap), no LLM, no external access.
 */
export async function extractFunctionTable(
  scriptBlocks: string[],
  name: string,
  min: number,
  max: number,
): Promise<Record<number, number> | null> {
  // Cheap substring gate: the name isn't mentioned in any block → nothing to run, skip
  // the worker spawn (matches the old "function not found → null" fast path).
  if (!scriptBlocks.some((b) => b.includes(name))) return null;
  // Size gate (#20): reject an oversized script set before paying for a worker spawn.
  if (scriptBlocks.reduce((n, b) => n + b.length, 0) > MAX_VM_INPUT) return null;
  try {
    const table = await runInWorker<Record<number, number> | null>({
      mode: "table",
      blocks: scriptBlocks,
      name,
      min,
      max,
      timeout: VM_TIMEOUT_MS,
    });
    return table && Object.keys(table).length > 0 ? table : null;
  } catch (err) {
    if (err instanceof WorkerUnavailableError) throw err;
    return null;
  }
}
