// W068: the house lexer in ./sourceScan, checked against the TypeScript parser.
//
// The house lexer in ./sourceScan (stringChunks, withoutComments) is what every Phase 88
// drift guard reads. It is a hand-written scanner, and the 88.6 review found source shapes
// it mis-reads (IN-501). No gate compared it with a real parser, so a mis-lex was invisible:
// the gate that consumed it simply saw less. This suite is that comparison.
//
// The TypeScript parser is only the REFERENCE here. The house lexer is not replaced, and
// nothing outside this file imports the parser for scanning.
//
// Two tree-wide arms run over sourceFiles(SRC), the same population the gate suites scan:
//  - the comment arm compares withoutComments with the comment ranges TypeScript reports;
//  - the token arm (below) checks every backslash-free literal token TypeScript reads is
//    also emitted by stringChunks.
// Each known mis-lex shape is pinned by a fixture whose title says so. Teaching the lexer one
// of those shapes turns its fixture RED, which forces the KNOWN LIMITATIONS docblock in
// ./sourceScan to be updated in the same commit.
import path from 'node:path';
import fs from 'node:fs';

import ts from 'typescript';
import { describe, expect, it } from 'vitest';

import { assertExactCounts, assertRosterShape, type ExemptionRoster } from './exemption';
import { STRIP_VARIANTS, inkGroundPairs, sourceFiles, stringChunks, withoutComments } from './sourceScan';

const SRC = path.resolve(__dirname, '..');

// One parse per (name, text) pair. Keyed on the text as well as the name, never on the name
// alone: a fixture and its control, or two fixtures, may share a synthetic name with
// different text.
const PARSE_CACHE = new Map<string, { sf: ts.SourceFile; leaves: ts.Node[] }>();

function scriptKind(fileName: string): ts.ScriptKind {
  if (fileName.endsWith('.tsx')) return ts.ScriptKind.TSX;
  if (fileName.endsWith('.ts')) return ts.ScriptKind.TS;
  return ts.ScriptKind.JSX;
}

// Leaf tokens exactly as the D-21 probe walks them: every node with no children, JSDoc
// children excluded (JSDoc is comment trivia to the scanner, not code).
function parsed(text: string, fileName: string): { sf: ts.SourceFile; leaves: ts.Node[] } {
  const key = fileName + '\0' + text;
  const hit = PARSE_CACHE.get(key);
  if (hit) return hit;
  const sf = ts.createSourceFile(fileName, text, ts.ScriptTarget.Latest, true, scriptKind(fileName));
  const leaves: ts.Node[] = [];
  const walk = (n: ts.Node): void => {
    const kids = n
      .getChildren(sf)
      .filter((c) => !(c.kind >= ts.SyntaxKind.FirstJSDocNode && c.kind <= ts.SyntaxKind.LastJSDocNode));
    if (kids.length === 0) leaves.push(n);
    else kids.forEach(walk);
  };
  walk(sf);
  const entry = { sf, leaves };
  PARSE_CACHE.set(key, entry);
  return entry;
}

const GAP_COMMENT = /\/\*[\s\S]*?\*\/|\/\/[^\n]*/g;

// The source with every comment TypeScript sees blanked: each character except a newline
// becomes a space, so offsets and line numbers match withoutComments.
function tsCommentBlanked(text: string, fileName: string): string {
  const { sf, leaves } = parsed(text, fileName);
  const out = text.split('');
  const blankGap = (from: number, to: number): void => {
    const gap = text.slice(from, to);
    for (const m of gap.matchAll(GAP_COMMENT)) {
      const at = from + (m.index ?? 0);
      for (let i = at; i < at + m[0].length; i += 1) {
        if (out[i] !== '\n') out[i] = ' ';
      }
    }
  };
  let prevEnd = 0;
  for (const leaf of leaves) {
    const start = leaf.getStart(sf);
    blankGap(prevEnd, start);
    prevEnd = Math.max(prevEnd, leaf.end);
  }
  blankGap(prevEnd, text.length);
  return out.join('');
}

// 1-based numbers of the lines where withoutComments and the parser's comment ranges differ.
function commentDivergenceLines(text: string, fileName: string): number[] {
  const ours = withoutComments(text).split('\n');
  const theirs = tsCommentBlanked(text, fileName).split('\n');
  const out: number[] = [];
  const n = Math.max(ours.length, theirs.length);
  for (let i = 0; i < n; i += 1) {
    if (ours[i] !== theirs[i]) out.push(i + 1);
  }
  return out;
}

const LITERAL_KINDS = new Set<ts.SyntaxKind>([
  ts.SyntaxKind.StringLiteral,
  ts.SyntaxKind.NoSubstitutionTemplateLiteral,
  ts.SyntaxKind.TemplateHead,
  ts.SyntaxKind.TemplateMiddle,
  ts.SyntaxKind.TemplateTail,
]);

// Every whitespace-split token of the RAW source between the delimiters of each string or
// template literal the parser reads. A template head or middle ends in the two characters that
// open an interpolation; every other literal ends in one closing delimiter.
function tsLiteralTokens(text: string, fileName: string): string[] {
  const { sf, leaves } = parsed(text, fileName);
  const out: string[] = [];
  for (const leaf of leaves) {
    if (!LITERAL_KINDS.has(leaf.kind)) continue;
    const opensInterpolation =
      leaf.kind === ts.SyntaxKind.TemplateHead || leaf.kind === ts.SyntaxKind.TemplateMiddle;
    const raw = text.slice(leaf.getStart(sf) + 1, leaf.end - (opensInterpolation ? 2 : 1));
    for (const token of raw.split(/\s+/)) if (token) out.push(token);
  }
  return out;
}

// The parser tokens with no backslash that stringChunks does not also emit, as a multiset:
// a token the parser reads twice must be emitted twice.
function tokenMisses(text: string, fileName: string): string[] {
  const have = new Map<string, number>();
  for (const chunk of stringChunks(text)) {
    for (const token of chunk.text.split(/\s+/)) {
      if (token) have.set(token, (have.get(token) ?? 0) + 1);
    }
  }
  const misses: string[] = [];
  for (const token of tsLiteralTokens(text, fileName)) {
    if (token.includes('\\')) continue;
    const left = have.get(token) ?? 0;
    if (left > 0) have.set(token, left - 1);
    else misses.push(token);
  }
  return misses;
}

const INK_ON_MUTED = { ink: /text-content-muted/, ground: /bg-surface-muted/ };

function relKey(file: string): string {
  return path.relative(SRC, file).split(path.sep).join('/');
}

// DECISION Phase 88.6.2-08 (W068): the one live divergence, src/lib/wcag.ts (".replace(/\//g, ' ')"), is ROSTERED as limitation 8, chosen OVER teaching the lexer regex literals.
// Why: telling a regex literal from a division needs a guess, and that guess is itself a new
// mis-lex source. It would also change what every importer of ./sourceScan reads, to fix one
// line in a file with no className. Teaching it later needs this suite and every importer green
// with no floor or roster change, measured before and after. Changing this roster is a
// decision, not a cleanup.
const KNOWN_LEXER_DIVERGENCES: ExemptionRoster = {
  'lib/wcag.ts': {
    sites: 1,
    why: 'withoutComments reads the regex literal on that line as the start of a line comment and blanks the rest of that one line; the file sets no ink or ground, so no gate loses a site (limitation 8)',
    owner: { kind: 'decision', marker: 'DECISION Phase 88.6.2-08 (W068)' },
  },
};

describe('sourceScan lexer parity with the TypeScript parser', () => {
  it('W068 limitation 8, regex literal: fixture pins the known mis-lex and the comparator sees it', () => {
    // The lexer reads the two slashes of the regex literal as a line comment and drops the rest
    // of the line: both string literals after it vanish. TypeScript blanks nothing, so the
    // comparator reports line 1.
    const fixture = "s.replace(/\\//g, ' ').split(',');";
    expect(commentDivergenceLines(fixture, 'fixture-l8.ts')).toEqual([1]);
    expect(withoutComments(fixture)).toBe('s.replace(/\\' + ' '.repeat(21));
    expect(stringChunks(fixture)).toEqual([]);
  });

  it('tree-wide comment parity: every withoutComments divergence from the TypeScript parser is owned and exactly counted', () => {
    const files = sourceFiles(SRC);
    const measured: Record<string, number> = {};
    for (const file of files) {
      const count = commentDivergenceLines(fs.readFileSync(file, 'utf8'), file).length;
      if (count > 0) measured[relKey(file)] = count;
    }
    expect(files.length).toBeGreaterThanOrEqual(150);
    expect(assertRosterShape(KNOWN_LEXER_DIVERGENCES)).toEqual([]);
    expect(assertExactCounts(KNOWN_LEXER_DIVERGENCES, measured), JSON.stringify(measured)).toEqual([]);
  });

  it('tree-wide token parity: stringChunks misses no backslash-free literal token the TypeScript parser reads', () => {
    const files = sourceFiles(SRC);
    const misses: Record<string, string[]> = {};
    let checked = 0;
    for (const file of files) {
      const text = fs.readFileSync(file, 'utf8');
      checked += tsLiteralTokens(text, file).filter((token) => !token.includes('\\')).length;
      const missed = tokenMisses(text, file);
      if (missed.length > 0) misses[relKey(file)] = missed;
    }
    expect(misses, JSON.stringify(misses)).toEqual({});
    expect(files.length).toBeGreaterThanOrEqual(150);
    expect(checked, `only ${checked} literal tokens checked`).toBeGreaterThanOrEqual(10000);
  });

  it('W068 limitation 9, URL in JSX text: fixture pins the known mis-lex', () => {
    // JSX text is not code, but the lexer reads the two slashes of the URL as a line comment.
    // The rest of the line vanishes, the muted ink with it, so the walk sees no pairing at all:
    // a D-16 violation hidden from every gate built on inkGroundPairs.
    const url = '<div className="bg-surface-muted">see https://x.test <span className="text-content-muted">x</span></div>;';
    const control = '<div className="bg-surface-muted">see x.test <span className="text-content-muted">x</span></div>;';
    expect(commentDivergenceLines(url, 'fixture-l9-url.tsx')).toEqual([1]);
    expect(tokenMisses(url, 'fixture-l9-url.tsx')).toEqual(['text-content-muted']);
    expect(inkGroundPairs(url, INK_ON_MUTED)).toHaveLength(0);
    expect(commentDivergenceLines(control, 'fixture-l9-url-control.tsx')).toEqual([]);
    expect(tokenMisses(control, 'fixture-l9-url-control.tsx')).toEqual([]);
    expect(inkGroundPairs(control, INK_ON_MUTED)).toHaveLength(1);
  });

  it('W068 limitation 9, apostrophe in JSX text: fixture pins the known mis-lex', () => {
    // The apostrophe opens a single-quoted string that runs to the end of the line, so the
    // className after it is read as one prose chunk and its class is never a token. No comment
    // is involved, so the comment arm agrees with the parser.
    const apos = '<p>Don\'t <b className="text-content-muted">x</b></p>;';
    expect(commentDivergenceLines(apos, 'fixture-l9-apos.tsx')).toEqual([]);
    expect(tokenMisses(apos, 'fixture-l9-apos.tsx')).toEqual(['text-content-muted']);
    expect(stringChunks(apos).map((chunk) => chunk.text)).toEqual(['t <b className="text-content-muted">x</b></p>;']);
  });

  it('W068 limitation 10, a quote inside a comment inside an interpolation: fixture pins the known mis-lex', () => {
    // The interpolation scanner does not skip comments, so the apostrophe in the comment opens
    // a string. String parity is flipped for the rest of the line: the template tail and the
    // class in the next statement are both lost. withoutComments copies the template verbatim,
    // comment included, where the parser blanks it.
    const quoted = "const t = `a${b /* it's */}c`; const k = 'text-content-muted';";
    expect(commentDivergenceLines(quoted, 'fixture-l10.ts')).toEqual([1]);
    expect(tokenMisses(quoted, 'fixture-l10.ts')).toEqual(['c', 'text-content-muted']);
  });

  it('W068 limitation 11, template-literal escapes: fixture pins the known mis-lex', () => {
    // The template branch of stringChunks skips an escape and appends nothing, so the
    // characters either side of it merge into one token. The parser's token holds a backslash,
    // so the token arm (backslash-free tokens only) does not count it.
    const escaped = 'const t = `a\\nb px-2`;';
    expect(stringChunks(escaped).map((chunk) => chunk.text)).toEqual(['ab px-2']);
    expect(tokenMisses(escaped, 'fixture-l11.ts')).toEqual([]);
    expect(commentDivergenceLines(escaped, 'fixture-l11.ts')).toEqual([]);
  });

  it('W069: a TypeScript generic opens a phantom frame that sets no ground and does not stop resolution', () => {
    const jsx = '<div className="bg-surface-muted"><span className="text-content-muted">x</span></div>;';
    const withGeneric = 'const r = useRef<HTMLDivElement>(null);\n' + jsx;
    const rows = inkGroundPairs(withGeneric, INK_ON_MUTED);
    const control = inkGroundPairs(jsx, INK_ON_MUTED);
    expect(rows).toHaveLength(1);
    expect(control).toHaveLength(1);
    expect(rows[0].grounds.map((g) => g.token)).toEqual(control[0].grounds.map((g) => g.token));
    expect(rows[0].grounds.map((g) => g.token)).toEqual(['bg-surface-muted']);
    // Both texts are valid TSX with no comment, so neither is a lexer divergence.
    expect(commentDivergenceLines(withGeneric, 'fixture-w069.tsx')).toEqual([]);
    expect(commentDivergenceLines(jsx, 'fixture-w069-control.tsx')).toEqual([]);
  });

  it('STRIP_VARIANTS: the one exported copy keeps the old literal and strips every variant form', () => {
    // The seven test-local copies converged onto this export (PC-4). Pinned by value so a
    // drift in the shared copy reds here, not silently in every suite that imports it.
    expect(STRIP_VARIANTS.source).toBe(String.raw`^(?:[a-z][a-z0-9-]*(?:\[[^\]]*\])?:)*!?`);
    expect(STRIP_VARIANTS.flags).toBe('');
    const strip = (token: string): string => token.replace(STRIP_VARIANTS, '');
    expect(strip('hover:bg-surface-muted')).toBe('bg-surface-muted');
    expect(strip('data-[state=open]:bg-surface-muted')).toBe('bg-surface-muted');
    expect(strip('md:hover:!bg-surface-muted')).toBe('bg-surface-muted');
    expect(strip('!bg-surface-muted')).toBe('bg-surface-muted');
    expect(strip('bg-surface-muted')).toBe('bg-surface-muted');
  });
});
