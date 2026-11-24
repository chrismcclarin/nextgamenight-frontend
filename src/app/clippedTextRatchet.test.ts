// @vitest-environment node
// Reason: file reads only; it renders nothing and needs no DOM.
//
// Phase 89.6-08 (SPEC R4, prohibition P1): the clipped-text ratchet.
//
// WHY. P1 says no text is capped, shrunk or cut to make a layout fit at large text. The rendered
// proof is the sweep, which reads a surface only once its row is turned on and runs late, in the
// e2e job: e2e/large-text-sweep.spec.ts ("DECISION Phase 89.6-08 (sweep)"). This file is the fast
// lane for the classes that clip: it reds the quality job in seconds when a NEW truncate,
// line-clamp, text-ellipsis or whitespace-nowrap class appears anywhere in the app source.
//
// DECISION Phase 89.6-08 (clip-ratchet): a one-way ceiling per token, chosen OVER an exact count
// (every sweep plan would edit this file in one wave) and OVER a per-file list (renames churn it).
// Changing this is a decision, not a cleanup.
//
// THE RATCHET IS ONE-WAY. A count may fall in any plan, and the tests stay green when it does.
// Only plan 89.6-34 lowers a ceiling, at the phase close, so a sweep plan that removes a clipped
// text never edits this file. A count that rises above its ceiling is a new clipped text: fix it,
// do not raise the number.
//
// WHAT IS COUNTED. Class tokens in comment-stripped, non-test source under src (the shared
// sourceFiles walk): a token with any variant prefix (md:truncate) on a token boundary. Left out,
// and only these: the tutorial folder and the month grid file (surfaces another phase owns, SPEC
// A3 (2) and (4)), and the exception literals below (SPEC A3 (1), A3 (3) and A10), each of which
// must occur exactly once in its file and be named by the sweep's exceptions list. NOT read: CSS
// files (a text-overflow declaration in globals.css is not a class token).
import fs from 'node:fs';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

import { sourceFiles, withoutComments } from '../test-utils/sourceScan';

const SRC = path.resolve(__dirname, '..');
const FE_ROOT = path.resolve(SRC, '..');
const rel = (file: string) => path.relative(FE_ROOT, file).split(path.sep).join('/');

/** Surfaces another phase owns: whole files, left out of every count. */
const OWNED_ELSEWHERE = [/^src\/app\/components\/tutorial\//, /^src\/app\/components\/CalendarMonthView\.js$/];

/** The exception literals: the class text at each excepted site. Each occurs exactly once in its file. */
const EXCEPTION_LITERALS: ReadonlyArray<{ file: string; literal: string }> = [
  { file: 'src/app/Header.js', literal: 'leading-7 whitespace-nowrap @max-[calc(186px_+_3.375rem)]:sr-only' },
  { file: 'src/app/components/CalendarListView.js', literal: "'font-bold text-base min-w-0 line-clamp-2'" },
  { file: 'src/app/components/CalendarListView.js', literal: "'font-bold text-base truncate'" },
  { file: 'src/app/components/CalendarListView.js', literal: "'block text-base line-clamp-2 mt-0.5'" },
  { file: 'src/app/components/CalendarListView.js', literal: "'hidden sm:block text-sm truncate mt-0.5'" },
  { file: 'src/app/gameDetail/page.js', literal: 'line-clamp-3 md:line-clamp-none' },
];

/** The clipping class tokens. A variant prefix ends in a colon, so the left boundary lets it through. */
const TOKENS = {
  truncate: /(?<![\w-])truncate(?![\w-])/g,
  // line-clamp-none takes a clamp away, so it is not counted.
  'line-clamp-*': /(?<![\w-])line-clamp-(?!none(?![\w-]))[\w[]/g,
  'text-ellipsis': /(?<![\w-])text-ellipsis(?![\w-])/g,
  'whitespace-nowrap': /(?<![\w-])whitespace-nowrap(?![\w-])/g,
} as const;
type Token = keyof typeof TOKENS;

// The one-way ceilings, measured at this commit. Only plan 89.6-34 lowers one.
const CEILINGS: Record<Token, number> = {
  truncate: 5,
  'line-clamp-*': 0,
  'text-ellipsis': 0,
  'whitespace-nowrap': 36,
};

/** A file's text as it is counted: comments blanked, then every exception literal of that file blanked. */
function countedText(file: string, source: string): string {
  let text = withoutComments(source);
  for (const entry of EXCEPTION_LITERALS) {
    if (entry.file === file) text = text.split(entry.literal).join(' '.repeat(entry.literal.length));
  }
  return text;
}

/** Every counted file with its hits for one token, largest first. */
function hitsOf(token: Token): Array<{ file: string; count: number }> {
  const hits: Array<{ file: string; count: number }> = [];
  for (const full of sourceFiles(SRC)) {
    const file = rel(full);
    if (OWNED_ELSEWHERE.some((pattern) => pattern.test(file))) continue;
    const count = (countedText(file, fs.readFileSync(full, 'utf8')).match(TOKENS[token]) ?? []).length;
    if (count > 0) hits.push({ file, count });
  }
  return hits.sort((a, b) => b.count - a.count || a.file.localeCompare(b.file));
}

function expectAtMostCeiling(token: Token): void {
  const hits = hitsOf(token);
  const total = hits.reduce((sum, hit) => sum + hit.count, 0);
  const listing = hits.map((hit) => `${hit.count} ${hit.file}`).join('\n');
  expect(
    total,
    `${token}: ${total} in the app source, and the ceiling is ${CEILINGS[token]}. A new clipped text: let it wrap instead (SPEC P1). The ceiling never rises.\n${listing}`,
  ).toBeLessThanOrEqual(CEILINGS[token]);
}

describe('Phase 89.6-08: clipped text never grows outside the five exceptions (one-way ceilings)', () => {
  it('the comment stripper does real work: a token that stands only in a comment is not counted', () => {
    const sample = ['// a truncate in a line comment', '/* whitespace-nowrap in a block comment */', 'const cls = "truncate md:line-clamp-2 line-clamp-none";'].join('\n');
    const text = countedText('sample.js', sample);
    expect((text.match(TOKENS.truncate) ?? []).length, 'one truncate in code, none from the comment').toBe(1);
    expect((text.match(TOKENS['whitespace-nowrap']) ?? []).length, 'the block comment is blanked').toBe(0);
    expect((text.match(TOKENS['line-clamp-*']) ?? []).length, 'md:line-clamp-2 counts, line-clamp-none does not').toBe(1);
    expect((sample.match(TOKENS.truncate) ?? []).length, 'the raw text holds two: the control would pass on a stripper that did nothing').toBe(2);
    // The walk reads real files, and they do hold these tokens.
    expect(sourceFiles(SRC).length, 'the source walk found too few files').toBeGreaterThan(150);
  });

  it('each exception literal occurs exactly once in its file, and the sweep exceptions list names it', () => {
    const exceptions = fs.readFileSync(path.join(FE_ROOT, 'e2e/support/largeTextExceptions.ts'), 'utf8');
    for (const entry of EXCEPTION_LITERALS) {
      const source = fs.readFileSync(path.join(FE_ROOT, entry.file), 'utf8');
      expect(source.split(entry.literal).length - 1, `${entry.file}: the exception literal must occur exactly once: ${entry.literal}`).toBe(1);
      expect(exceptions.includes(entry.literal), `the sweep's exceptions list does not name this literal: ${entry.literal}`).toBe(true);
      expect((entry.literal.match(/truncate|line-clamp-\d|whitespace-nowrap/) ?? []).length, `the literal holds no clipping token: ${entry.literal}`).toBe(1);
    }
    for (const pattern of OWNED_ELSEWHERE) {
      expect(sourceFiles(SRC).some((full) => pattern.test(rel(full))), `no source file matches ${pattern}: a surface left out of the count no longer exists`).toBe(true);
    }
  });

  it('truncate: at most its ceiling', () => {
    expectAtMostCeiling('truncate');
  });

  it('line-clamp-*: at most its ceiling', () => {
    expectAtMostCeiling('line-clamp-*');
  });

  it('text-ellipsis: at most its ceiling', () => {
    expectAtMostCeiling('text-ellipsis');
  });

  it('whitespace-nowrap: at most its ceiling', () => {
    expectAtMostCeiling('whitespace-nowrap');
  });
});
