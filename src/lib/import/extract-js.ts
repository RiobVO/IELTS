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
