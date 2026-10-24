// sourceScan lexer parity with the TypeScript parser (W068).
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
import { sourceFiles, stringChunks, withoutComments } from './sourceScan';

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
});
