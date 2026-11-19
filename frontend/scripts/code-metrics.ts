/**
 * Usage: npx tsx scripts/code-metrics.ts <file.ts>
 * Static readability measures used by the code reviews in docs/code-review/. Dependency-free (the
 * installed TypeScript 7 has no JS compiler API): comments and strings are masked, then braces are
 * matched to find block-bodied functions (declarations, arrows, methods).
 *  - longest function (lines) and every function over 60 lines;
 *  - `as unknown as` double casts and non-null assertions (`!`);
 *  - magic numbers: decimal literals inside functions other than 0, 1, 2, -1 and 0.5 (hex colours
 *    are not counted), how many distinct values, and which values are written 3+ times.
 */
import { readFileSync } from 'node:fs';

const file = process.argv[2];
if (!file) throw new Error('usage: code-metrics.ts <file.ts>');
const text = readFileSync(file, 'utf8');

/** Same text with comments and string / template contents blanked (newlines kept). */
function mask(src: string): string {
  let out = '';
  for (let i = 0; i < src.length; i++) {
    const c = src[i]!, d = src[i + 1];
    if (c === '/' && d === '/') { while (i < src.length && src[i] !== '\n') { out += ' '; i++; } out += '\n'; continue; }
    if (c === '/' && d === '*') {
      while (i < src.length && !(src[i] === '*' && src[i + 1] === '/')) { out += src[i] === '\n' ? '\n' : ' '; i++; }
      out += '  '; i++; continue;
    }
    if (c === "'" || c === '"' || c === '`') {
      out += c;
      for (i++; i < src.length && src[i] !== c; i++) { if (src[i] === '\\') { out += ' '; i++; } out += src[i] === '\n' ? '\n' : ' '; }
      out += c; continue;
    }
    out += c;
  }
  return out;
}
const code = mask(text);
const lineAt = (pos: number): number => code.slice(0, pos).split('\n').length;
const matching = (open: number, o: string, c: string): number => {
  let depth = 0;
  for (let i = open; i < code.length; i++) {
    if (code[i] === o) depth++;
    else if (code[i] === c && --depth === 0) return i;
  }
  return -1;
};
/** Index of the `{` that opens the body, given the position just after the parameter list's `)`. */
function bodyOpen(after: number): number {
  let i = after;
  while (/\s/.test(code[i]!)) i++;
  if (code[i] === ':') { // return type: a leading `{ … }` is a type literal, not the body
    i++;
    while (/\s/.test(code[i]!)) i++;
    if (code[i] === '{') i = matching(i, '{', '}') + 1;
  }
  const open = code.indexOf('{', i);
  return open;
}

interface Fn { name: string; start: number; end: number }
const fns: Fn[] = [];
const KEYWORDS = new Set(['if', 'for', 'while', 'switch', 'catch', 'return', 'function']);
for (const m of code.matchAll(/\bfunction\s+([A-Za-z_$][\w$]*)\s*\(/g)) {
  const close = matching(m.index! + m[0].length - 1, '(', ')');
  const open = bodyOpen(close + 1);
  fns.push({ name: m[1]!, start: lineAt(m.index!), end: lineAt(matching(open, '{', '}')) });
}
for (const m of code.matchAll(/=>\s*\{/g)) {
  const open = m.index! + m[0].length - 1;
  const before = code.slice(Math.max(0, m.index! - 400), m.index!);
  const named = /(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*(?::[^=]*)?=\s*(?:async\s*)?[^=]*$/.exec(before.slice(before.lastIndexOf(';') + 1));
  fns.push({ name: named?.[1] ?? `<arrow@${lineAt(m.index!)}>`, start: lineAt(m.index!), end: lineAt(matching(open, '{', '}')) });
}
for (const m of code.matchAll(/^[ \t]+([A-Za-z_$][\w$]*)\s*\(/gm)) {
  if (KEYWORDS.has(m[1]!)) continue;
  const close = matching(m.index! + m[0].length - 1, '(', ')');
  if (close < 0 || !/^\s*(?::[^;{]*)?\{/.test(code.slice(close + 1, close + 200))) continue;
  const open = bodyOpen(close + 1);
  if (open >= 0 && /^[ \t]*[A-Za-z_$][\w$]*\s*\([^)]*\)\s*(?::[^;{]*)?\{/.test(code.slice(m.index!, m.index! + 300))) {
    fns.push({ name: m[1]!, start: lineAt(m.index!), end: lineAt(matching(open, '{', '}')) });
  }
}
const sized = fns.map((f) => ({ ...f, lines: f.end - f.start + 1 })).sort((a, b) => b.lines - a.lines);

// Numbers inside any function body.
const literals = new Map<string, number>();
const inFn = (line: number): boolean => fns.some((f) => line > f.start && line <= f.end);
code.split('\n').forEach((ln, i) => {
  if (!inFn(i + 1)) return;
  for (const m of ln.matchAll(/(?<![\w.$])(-?)(\d+(?:\.\d+)?)(?![\w.]|\s*:\s*\S*=>)/g)) {
    if (m[0].startsWith('0x')) continue;
    const v = `${m[1]}${Number(m[2])}`;
    if (['0', '1', '2', '-1', '0.5'].includes(v)) continue;
    literals.set(v, (literals.get(v) ?? 0) + 1);
  }
});
const total = [...literals.values()].reduce((a, b) => a + b, 0);
const repeated = [...literals].filter(([, c]) => c >= 3).sort((a, b) => b[1] - a[1]);
const doubleCasts = (code.match(/\bas unknown as\b/g) ?? []).length;
const nonNull = (code.match(/(?<=[\w)\]])!(?!=)/g) ?? []).length;

console.log(`file ${file.split('/').pop()}`);
console.log(`total lines ${text.split('\n').length}`);
console.log(`block-bodied functions ${fns.length}; longest ${sized[0]!.name} = ${sized[0]!.lines} lines (L${sized[0]!.start}-${sized[0]!.end})`);
console.log(`three longest: ${sized.slice(0, 3).map((f) => `${f.name}(${f.lines})`).join(', ')}`);
console.log(`functions over 60 lines: ${sized.filter((f) => f.lines > 60).map((f) => `${f.name}(${f.lines})`).join(', ') || 'none'}`);
console.log(`'as unknown as' casts ${doubleCasts}; non-null assertions ${nonNull}`);
console.log(`magic numbers in functions ${total} (${literals.size} distinct)`);
console.log(`values written 3+ times: ${repeated.map(([v, c]) => `${v}×${c}`).join(' ') || 'none'}`);
