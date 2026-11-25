#!/usr/bin/env node
/**
 * THIN-EDGES CODEMOD — Phase 89.6, plan 15 (owner pick O-M1 = D, 2026-11-22: 'Edges stay thin
 * (16px page edge, 12px card edge)'; HR-9 as amended by SPEC A9: thin edges on every card and bar).
 *
 * WHAT IT REWRITES. The rem edge idioms in class strings under src, each to the px edge tokens of
 * the same size at a 16px root, so normal text is pixel-identical and the edge stops doubling at
 * 200% text:
 *   p-3 md:p-6                     -> p-edge-card md:p-edge-wide        (a card)
 *   p-4 md:p-6                     -> p-edge-page md:p-edge-wide        (a page root)
 *   p-3 md:p-4, p-3 sm:p-4         -> p-edge-card md:p-edge-page, ...   (a bar)
 *   px-4 md:px-6                   -> px-edge-page md:px-edge-wide      (a page gutter)
 *   max-w-3xl mx-auto px-4 py-16   -> max-w-3xl mx-auto px-edge-page py-16   (the static prose column)
 *   and, only on a class string holding rounded-card or given to a Card as its className:
 *   p-6 sm:p-8 -> p-edge-wide sm:p-edge-roomy, then p-8 -> p-edge-roomy (the link-page cards)
 *
 * WHY ONLY CLASS-STRING TEXT. Comments are blanked (offsets kept) before anything is matched, so
 * a marker or a cite that quotes an old idiom is never rewritten: those are history, and a cite
 * is re-quoted by hand against its target. A match needs a token boundary on both sides (start,
 * end, whitespace or a quote), so gap-4 md:p-6 or xp-3 md:p-6 is never touched.
 *
 * MODES. No flag: rewrite, print one line per rewrite and per file, and a total. --check: print
 * every remaining site and exit 1 when any remain. --self-test: run planted strings and print
 * SELF-TEST PASS (exit 1 on any failure). It is a one-off kept for plan 89.6-39 and the phase
 * close; no CI step runs it (the gate is src/app/thinEdges.test.ts).
 */
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

/** Always applied, in this order. Each pair is equal in px at a 16px root. */
const MAP = [
  ['max-w-3xl mx-auto px-4 py-16', 'max-w-3xl mx-auto px-edge-page py-16'],
  ['p-3 md:p-6', 'p-edge-card md:p-edge-wide'],
  ['p-4 md:p-6', 'p-edge-page md:p-edge-wide'],
  ['p-3 md:p-4', 'p-edge-card md:p-edge-page'],
  ['p-3 sm:p-4', 'p-edge-card sm:p-edge-page'],
  ['px-4 md:px-6', 'px-edge-page md:px-edge-wide'],
];
/** Applied only on a link card: a class string with rounded-card, or a Card's className. */
const LINK_CARD_MAP = [
  ['p-6 sm:p-8', 'p-edge-wide sm:p-edge-roomy'],
  ['p-8', 'p-edge-roomy'],
];

const EDGE_PX = { 'edge-card': 12, 'edge-page': 16, 'edge-wide': 24, 'edge-roomy': 32 };

/** The px of one padding or other spacing token at a 16px root (numeric scale is 4px a step). */
function tokenPx(token) {
  const m = /^(?:[a-z]+:)?(?:p|px|py|pl|pr|mx|max-w|py)-(.+)$/.exec(token);
  if (!m) return token;
  const v = m[1];
  if (v in EDGE_PX) return `${token.split('-')[0]}:${EDGE_PX[v]}`;
  if (/^\d+$/.test(v)) return `${token.split('-')[0]}:${Number(v) * 4}`;
  return token;
}

/** Same text with comments blanked, every offset kept (the shape of withoutComments in src/test-utils). */
function blankComments(src) {
  const n = src.length;
  const out = [];
  let i = 0;
  while (i < n) {
    const c = src[i];
    if (c === '"' || c === "'" || c === '`') {
      out.push(c);
      let j = i + 1;
      while (j < n) {
        if (src[j] === '\\') {
          out.push(src.slice(j, j + 2));
          j += 2;
          continue;
        }
        if (src[j] === c) break;
        if (c !== '`' && src[j] === '\n') break;
        out.push(src[j]);
        j += 1;
      }
      if (j < n) out.push(src[j]);
      i = j + 1;
    } else if (c === '/' && src[i + 1] === '/') {
      const k = src.indexOf('\n', i);
      const end = k < 0 ? n : k;
      out.push(' '.repeat(end - i));
      i = end;
    } else if (c === '/' && src[i + 1] === '*') {
      const k = src.indexOf('*/', i);
      const end = k < 0 ? n : k + 2;
      out.push(src.slice(i, end).replace(/[^\n]/g, ' '));
      i = end;
    } else {
      out.push(c);
      i += 1;
    }
  }
  return out.join('');
}

/** Every string-literal text range [start, end) in comment-blanked code, template statics split at ${. */
function stringRanges(code) {
  const out = [];
  const n = code.length;
  let i = 0;
  while (i < n) {
    const c = code[i];
    if (c === '"' || c === "'") {
      let j = i + 1;
      while (j < n && code[j] !== c && code[j] !== '\n') j += code[j] === '\\' ? 2 : 1;
      out.push([i + 1, Math.min(j, n)]);
      i = j + 1;
    } else if (c === '`') {
      let j = i + 1;
      let start = j;
      while (j < n && code[j] !== '`') {
        if (code[j] === '\\') {
          j += 2;
          continue;
        }
        if (code[j] === '$' && code[j + 1] === '{') {
          out.push([start, j]);
          let depth = 1;
          let k = j + 2;
          const innerStart = k;
          while (k < n && depth > 0) {
            const ch = code[k];
            if (ch === '{') depth += 1;
            else if (ch === '}') depth -= 1;
            else if (ch === '"' || ch === "'" || ch === '`') {
              k += 1;
              while (k < n && code[k] !== ch) k += code[k] === '\\' ? 2 : 1;
            }
            k += 1;
          }
          for (const [s, e] of stringRanges(code.slice(innerStart, k - 1))) out.push([innerStart + s, innerStart + e]);
          j = k;
          start = j;
          continue;
        }
        j += 1;
      }
      out.push([start, Math.min(j, n)]);
      i = j + 1;
    } else {
      i += 1;
    }
  }
  return out;
}

function escapeRe(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function boundaryRe(from) {
  return new RegExp(`(^|\\s)${escapeRe(from)}(?=\\s|$)`, 'g');
}

function isLinkCard(code, start, text) {
  if (text.split(/\s+/).includes('rounded-card')) return true;
  const before = code.slice(Math.max(0, start - 300), start);
  return /<Card\b[^<>]*\bclassName=\s*\{?\s*["'`]$/.test(before);
}

/** Rewrite one file's text. Returns { text, sites: [{ line, from, to, classes }] }. */
export function rewrite(src) {
  const code = blankComments(src);
  const edits = [];
  for (const [start, end] of stringRanges(code)) {
    const original = code.slice(start, end);
    let text = original;
    const sites = [];
    const maps = isLinkCard(code, start, original) ? [...MAP, ...LINK_CARD_MAP] : MAP;
    for (const [from, to] of maps) {
      text = text.replace(boundaryRe(from), (_m, lead) => {
        sites.push({ from, to });
        return `${lead}${to}`;
      });
    }
    if (text !== original) edits.push({ start, end, text, sites, original });
  }
  let out = src;
  for (const e of [...edits].sort((a, b) => b.start - a.start)) out = out.slice(0, e.start) + e.text + out.slice(e.end);
  const sites = edits.flatMap((e) =>
    e.sites.map((s) => ({ line: src.slice(0, e.start).split('\n').length, ...s, classes: e.original.trim() })),
  );
  return { text: out, sites };
}

function targetFiles() {
  return execFileSync('git', ['ls-files', '--', 'src'], { cwd: ROOT, encoding: 'utf8' })
    .split('\n')
    .filter(Boolean)
    .filter((f) => /\.(js|jsx|ts|tsx|mjs)$/.test(f))
    .filter((f) => !/\.(test|spec)\./.test(f))
    .filter((f) => !f.startsWith('src/app/components/tutorial/'))
    .filter((f) => !f.startsWith('src/test-utils/'))
    .filter((f) => f !== 'src/app/globals.css');
}

function selfTest() {
  const failures = [];
  const eq = (label, got, want) => {
    if (got !== want) failures.push(`${label}: got ${JSON.stringify(got)}, want ${JSON.stringify(want)}`);
  };
  eq('card idiom', rewrite('<div className="card p-3 md:p-6 mb-6">').text, '<div className="card p-edge-card md:p-edge-wide mb-6">');
  eq('gap-4 md:p-6 untouched', rewrite('<div className="gap-4 md:p-6">').text, '<div className="gap-4 md:p-6">');
  eq('xp-3 boundary', rewrite("const a = 'xp-3 md:p-6';").text, "const a = 'xp-3 md:p-6';");
  eq('comment untouched', rewrite('// quotes p-3 md:p-6\n/* and p-4 md:p-6 */\n{/* jsx p-3 md:p-6 */}').text, '// quotes p-3 md:p-6\n/* and p-4 md:p-6 */\n{/* jsx p-3 md:p-6 */}');
  eq('page root', rewrite('className="p-4 md:p-6 max-w-7xl mx-auto"').text, 'className="p-edge-page md:p-edge-wide max-w-7xl mx-auto"');
  eq('bar sm', rewrite('className="p-3 sm:p-4"').text, 'className="p-edge-card sm:p-edge-page"');
  eq('gutter', rewrite('className="min-h-screen py-8 px-4 md:px-6"').text, 'className="min-h-screen py-8 px-edge-page md:px-edge-wide"');
  eq('static column', rewrite('className="max-w-3xl mx-auto px-4 py-16"').text, 'className="max-w-3xl mx-auto px-edge-page py-16"');
  eq('template static', rewrite('className={`card p-3 md:p-6 ${x ? \'a\' : \'b\'}`}').text, 'className={`card p-edge-card md:p-edge-wide ${x ? \'a\' : \'b\'}`}');
  eq('link card p-8', rewrite('className="bg-surface-card rounded-card p-8 text-center"').text, 'className="bg-surface-card rounded-card p-edge-roomy text-center"');
  eq('p-8 off a card untouched', rewrite('className="flex p-8 text-center"').text, 'className="flex p-8 text-center"');
  eq('Card className p-8', rewrite('<Card className="p-8 max-w-md w-full mx-4">').text, '<Card className="p-edge-roomy max-w-md w-full mx-4">');
  eq('restore pair', rewrite('className="rounded-card p-6 sm:p-8 max-w-md"').text, 'className="rounded-card p-edge-wide sm:p-edge-roomy max-w-md"');
  const once = rewrite('<div className="card p-3 md:p-6"><Card className="p-8"/><p className="max-w-3xl mx-auto px-4 py-16"/></div>').text;
  eq('idempotent', rewrite(once).text, once);
  for (const [from, to] of [...MAP, ...LINK_CARD_MAP]) {
    const a = from.split(' ').map(tokenPx).join(' ');
    const b = to.split(' ').map(tokenPx).join(' ');
    eq(`px-equal ${from} -> ${to}`, b, a);
  }
  if (failures.length > 0) {
    console.log(failures.join('\n'));
    console.log('SELF-TEST FAIL');
    process.exit(1);
  }
  console.log('SELF-TEST PASS');
}

function main() {
  const args = new Set(process.argv.slice(2));
  if (args.has('--self-test')) return selfTest();
  const check = args.has('--check');
  let total = 0;
  for (const file of targetFiles()) {
    const abs = path.join(ROOT, file);
    const src = fs.readFileSync(abs, 'utf8');
    const { text, sites } = rewrite(src);
    if (sites.length === 0) continue;
    total += sites.length;
    for (const s of sites) console.log(`${check ? 'REMAINS' : 'REWRITE'} ${file}:${s.line} ${s.from} -> ${s.to} :: "${s.classes}"`);
    if (!check) {
      fs.writeFileSync(abs, text);
      console.log(`${file}: ${sites.length} rewrites`);
    }
  }
  if (check) {
    console.log(`thin-edges --check: ${total} sites remain`);
    process.exit(total > 0 ? 1 : 0);
  }
  console.log(`thin-edges: ${total} rewrites`);
}

main();
