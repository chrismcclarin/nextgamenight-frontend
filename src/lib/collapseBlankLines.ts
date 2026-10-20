// collapseBlankLines — the one render-time rule for typed line breaks at the five
// typed-text sites (session comments and both review paragraphs on the game page, the
// check-in message, the RSVP note).
//
// A run of THREE or more consecutive line breaks comes back as exactly TWO (one blank
// line). Single and double breaks come back as typed. A blank line inside a run may
// carry spaces or tabs (whitespace-pre-line still renders such a line as a break), so
// it counts toward the run. CRLF and lone CR are normalised to LF first. Nothing else
// changes: no trimming, no spaces touched outside a collapsed run, and markup is never
// interpreted — the result is the input's own characters, so the caller keeps it a
// plain React text child. A non-string input (a JS caller can pass null or undefined)
// returns the empty string.
//
// Render-only: call it inside the render expression, never before a save. The stored
// text is untouched.
//
// The two character classes in the run pattern (the break, and spaces or tabs) are
// disjoint, so the match is linear: a value of thousands of breaks cannot backtrack.
//
// DECISION Phase 88.6.1-84 (#115, owner 2026-10-13): CHOSEN — collapse every run of
// three or more line breaks to two at render time, one shared helper for all five
// typed-text sites (plans 88.6.1-29, -38, -52), stored text untouched. REJECTED (a) a
// server-side cap on blank lines: it changes what is stored, needs a backend change
// outside this phase, and every site would still have to agree on the rule. REJECTED
// (b) rendering as typed (whitespace-pre-line alone): a value of thousands of newlines
// pushes the card's content thousands of lines down a phone screen — the owner's words,
// "can't go overboard and mess with the phone version". REJECTED (c) a per-site copy of
// the pattern: three copies drift. Changing the threshold from three is a decision, not
// a cleanup — the owner ruled that one blank line is kept.
export function collapseBlankLines(text: string): string {
  if (typeof text !== 'string') return '';
  return text.replace(/\r\n?/g, '\n').replace(/\n(?:[ \t]*\n){2,}/g, '\n\n');
}
