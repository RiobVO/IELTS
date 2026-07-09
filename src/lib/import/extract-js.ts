import vm from "node:vm";

/**
 * Extracts the JS data object literals embedded at the end of a test file
 * (correctAnswers, acceptableAnswers, mcqGroups, questionTypes, explanations,
 * evidence). Deterministic, no LLM. The literals are evaluated in an isolated
 * vm context with no globals + a timeout, so it's pure data extraction, not
 * arbitrary code execution.
 */

// vm's `timeout` bounds execution TIME but NOT heap: a poison literal/function could
// allocate until the import process OOMs (#20). It's admin-only (import needs requireAdmin /
// Telegram whitelist) with a global-free context, so it's self-DoS, not injection. A size
// gate on the vm input is the proportional bound — it keeps the parse pipeline synchronous
// (a worker with resourceLimits would force the whole parser async for a low-severity vector)
// and needs no new dependency. Real IELTS literals are well under 4 MB; band functions are
// tiny. Combined with the timeout (V8 interrupts an alloc loop at loop backedges) and the
// caller's try/catch (a huge single string throws RangeError > max string length), this
// closes the realistic OOM vectors.
const MAX_VM_INPUT = 4 * 1024 * 1024; // 4 MB

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

/** Evaluate an object literal as pure data in an isolated, global-free context. */
export function evalDataObject<T = unknown>(literal: string): T {
  if (literal.length > MAX_VM_INPUT) {
    throw new RangeError(`data literal too large (${literal.length} > ${MAX_VM_INPUT})`);
  }
  return vm.runInNewContext(`(${literal})`, Object.create(null), {
    timeout: 1000,
  }) as T;
}

export function extractData<T = unknown>(src: string, name: string): T | null {
  const lit = extractObjectLiteral(src, name);
  if (lit == null) return null;
  try {
    return evalDataObject<T>(lit);
  } catch {
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
export function extractFunctionTable(
  src: string,
  name: string,
  min: number,
  max: number,
): Record<number, number> | null {
  const fnText = extractFunctionText(src, name);
  if (fnText == null || fnText.length > MAX_VM_INPUT) return null;
  const harness = `${fnText}\n(function(){const t={};for(let r=${min};r<=${max};r++){const v=${name}(r);if(typeof v==='number')t[r]=v;}return t;})()`;
  try {
    const table = vm.runInNewContext(harness, Object.create(null), {
      timeout: 1000,
    }) as Record<number, number>;
    return table && Object.keys(table).length > 0 ? table : null;
  } catch {
    return null;
  }
}
