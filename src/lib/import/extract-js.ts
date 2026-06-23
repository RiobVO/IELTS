import vm from "node:vm";

/**
 * Extracts the JS data object literals embedded at the end of a test file
 * (correctAnswers, acceptableAnswers, mcqGroups, questionTypes, explanations,
 * evidence). Deterministic, no LLM. The literals are evaluated in an isolated
 * vm context with no globals + a timeout, so it's pure data extraction, not
 * arbitrary code execution.
 */

/** Find `const NAME = { ... }` and return the balanced-brace literal text. */
export function extractObjectLiteral(src: string, name: string): string | null {
  const re = new RegExp(`(?:const|let|var)\\s+${name}\\s*=\\s*`);
  const m = re.exec(src);
  if (!m) return null;

  let i = m.index + m[0].length;
  while (i < src.length && /\s/.test(src[i]!)) i++;
  if (src[i] !== "{") return null;

  const start = i;
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

/** Evaluate an object literal as pure data in an isolated, global-free context. */
export function evalDataObject<T = unknown>(literal: string): T {
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
  if (fnText == null) return null;
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
