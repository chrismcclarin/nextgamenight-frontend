// Behaviour pins for collapseBlankLines (owner ruling #115, 2026-10-13; Req 10 / AC-31;
// SPEC amendment row 49; plan 88.6.1-84).
//
// The rule: at the five typed-text sites a run of THREE or more consecutive line breaks
// renders as TWO (one blank line); single and double breaks render as typed; nothing
// else changes. Render-only: the stored text is never touched.
//
// This file pins the helper alone. The rendered half (each site wraps its value in
// collapseBlankLines and keeps whitespace-pre-line) is pinned by the consumers, plans
// 88.6.1-29 (check-in message), 88.6.1-38 (RSVP note) and 88.6.1-52 (session comments
// and both review paragraphs), one R10 flood arm each.
//
// Line comments only in this file (FE testing conventions CF-9: a block comment holding
// a backtick or a star-slash makes vitest collect zero tests).
//
// globals: true — describe/it/expect are ambient (no import needed).
import { collapseBlankLines } from './collapseBlankLines';

describe('collapseBlankLines (owner ruling #115, 88.6.1-84)', () => {
  it('CB-1 a run of three or more breaks collapses to two (one blank line)', () => {
    expect(collapseBlankLines('a\n\n\nb')).toBe('a\n\nb');
    // two separate runs, each collapsed on its own
    expect(collapseBlankLines('a\n\n\n\nb\n\n\nc')).toBe('a\n\nb\n\nc');
    // a value that is only a run
    expect(collapseBlankLines('\n\n\n')).toBe('\n\n');
  });

  it('CB-2 a double break (one blank line) is kept as typed', () => {
    expect(collapseBlankLines('a\n\nb')).toBe('a\n\nb');
  });

  it('CB-3 a single break is kept as typed', () => {
    expect(collapseBlankLines('a\nb')).toBe('a\nb');
  });

  it('CB-4 blank lines carrying only spaces or tabs inside a run still collapse', () => {
    // whitespace-pre-line renders a spaces-only line as a break, so it counts toward the run
    expect(collapseBlankLines('a\n  \n\t\n \t \nb')).toBe('a\n\nb');
    // a double break whose blank line carries spaces is NOT a run of three: unchanged
    expect(collapseBlankLines('a\n  \nb')).toBe('a\n  \nb');
  });

  it('CB-5 CRLF and lone CR are normalised to LF before collapsing', () => {
    expect(collapseBlankLines('a\r\n\r\n\r\nb')).toBe('a\n\nb');
    expect(collapseBlankLines('a\r\nb')).toBe('a\nb');
    expect(collapseBlankLines('a\r\r\rb')).toBe('a\n\nb');
  });

  it('CB-6 the flood the owner named: 5000 newlines render as one blank line', () => {
    const flood = 'Top' + '\n'.repeat(5000) + 'Bottom';
    expect(collapseBlankLines(flood)).toBe('Top\n\nBottom');
  });

  it('CB-7 the empty string comes back empty', () => {
    expect(collapseBlankLines('')).toBe('');
  });

  it('CB-8 a value with no line break comes back byte-equal, spaces and markup included', () => {
    const typed = 'Close finish  on the last round <b>x</b>';
    expect(collapseBlankLines(typed)).toBe(typed);
  });

  it('CB-9 a non-string input (a JS caller can pass null or undefined) returns the empty string', () => {
    expect(collapseBlankLines(null as unknown as string)).toBe('');
    expect(collapseBlankLines(undefined as unknown as string)).toBe('');
    expect(collapseBlankLines(42 as unknown as string)).toBe('');
  });
});
