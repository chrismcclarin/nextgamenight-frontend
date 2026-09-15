/**
 * Shared source-scanning primitives for Phase 88's drift-guard suites.
 *
 * WHY THIS FILE EXISTS
 * --------------------
 * `tintTreatment.test.ts:47-50` records the reason verbatim:
 *
 *   "NOTE ON DUPLICATION: the chunk lexer below is a second copy of the one in
 *    `borderExplicitness.test.ts`. Importing it would re-register that file's suites in
 *    this file's context. Extracting both into a shared test helper is a candidate for
 *    88-29's gate-hygiene pass; it is deliberately not done here, mid-sweep."
 *
 * This is that pass. By the time 88-29 ran there were THREE byte-identical copies of
 * `stringChunks` (`borderExplicitness.test.ts:111`, `focusAndMotionTreatment.test.ts:77`,
 * `tintTreatment.test.ts:129`) and 88-29 needed a fourth and fifth. Verified identical
 * before the move (brace-balanced extraction of all three, pairwise diff: no differences
 * inside the function body).
 *
 * The lexer could not simply be imported from one suite into another — a test file's
 * module body registers its `describe` blocks, so importing `tintTreatment.test.ts` from
 * `borderExplicitness.test.ts` would run the tint suite inside the border file's context.
 * A non-test module is the only way to share it. That is why this lives under
 * `src/test-utils/` rather than beside the suites.
 *
 * DECISION Phase 88-29: a non-test shared module under `src/` — chosen OVER (a) a fourth
 * hand copy, and (b) exporting the lexer from one of the test files. (a) is the drift the
 * whole Phase 88 gate ledger is about: five copies of a scanner is five places a
 * correctness fix has to land, and four places it can be forgotten. (b) re-registers
 * suites, as the note above says. Nothing in the app imports this module, so it is not
 * bundled; it exists to be imported by `*.test.ts` only. Deleting it to "clean up an
 * unused file" breaks every drift guard at once — that is a decision, not a cleanup.
 *
 * NOT MOVED HERE, deliberately: the six `sourceFiles` copies. Their signatures genuinely
 * differ (`(dir)` vs `(dir, out = [])`, and `controlSizeFloor.test.tsx` walks a different
 * root), so converging them is a behaviour change to six shipped, negative-checked suites
 * rather than a verbatim move. `sourceFiles` below is the canonical shape for NEW suites;
 * the existing copies are logged for 88-31's residual pass.
 */
import fs from 'node:fs';
import path from 'node:path';

/**
 * Every string-literal / template-static chunk at ANY nesting depth, comments removed.
 *
 * This is the load-bearing piece of every Phase 88 guard, and it is what a `grep` cannot
 * do. Three properties matter, each of which killed a shipped grep gate:
 *
 *  - It crosses NEWLINES. `DEF-88-21-01`'s control gate matched ZERO of 14 real controls
 *    because every className in this repo sits on a different line from its opening tag,
 *    and grep is line-based.
 *  - It recurses into `${...}` interpolations, so a class inside a ternary branch of a
 *    template literal is seen (`DEF-88-27-01`).
 *  - It DROPS comments — both `//` and block. Comment blindness red-lined gates in
 *    `DEF-88-25-02` (twice), `DEF-88-27-01` and `DEF-88-28-01`, because this phase's own
 *    DECISION markers necessarily quote the tokens they forbid.
 */
export function stringChunks(src: string): { offset: number; text: string }[] {
  const out: { offset: number; text: string }[] = [];
  const n = src.length;
  let i = 0;
  while (i < n) {
    const c = src[i];
    if (c === '"' || c === "'") {
      let j = i + 1;
      let buf = '';
      while (j < n) {
        if (src[j] === '\\') {
          buf += src.slice(j, j + 2);
          j += 2;
          continue;
        }
        if (src[j] === c || src[j] === '\n') break;
        buf += src[j];
        j += 1;
      }
      out.push({ offset: i, text: buf });
      i = j + 1;
    } else if (c === '`') {
      let j = i + 1;
      let buf = '';
      let bufStart = j;
      while (j < n) {
        if (src[j] === '\\') {
          j += 2;
          continue;
        }
        if (src[j] === '`') break;
        if (src[j] === '$' && src[j + 1] === '{') {
          let depth = 1;
          let k = j + 2;
          const start = k;
          while (k < n && depth > 0) {
            const ch = src[k];
            if (ch === '{') depth += 1;
            else if (ch === '}') depth -= 1;
            else if (ch === '"' || ch === "'" || ch === '`') {
              const q = ch;
              k += 1;
              while (k < n && src[k] !== q) {
                if (src[k] === '\\') k += 1;
                k += 1;
              }
            }
            k += 1;
          }
          out.push({ offset: bufStart, text: buf });
          buf = '';
          for (const inner of stringChunks(src.slice(start, k - 1))) {
            out.push({ offset: start + inner.offset, text: inner.text });
          }
          j = k;
          bufStart = j;
          continue;
        }
        buf += src[j];
        j += 1;
      }
      out.push({ offset: bufStart, text: buf });
      i = j + 1;
    } else if (c === '/' && src[i + 1] === '/') {
      const k = src.indexOf('\n', i);
      i = k < 0 ? n : k;
    } else if (c === '/' && src[i + 1] === '*') {
      const k = src.indexOf('*/', i);
      i = k < 0 ? n : k + 2;
    } else {
      i += 1;
    }
  }
  return out;
}

/**
 * The same source text with comments blanked but every other byte and offset preserved,
 * so `slice(0, offset).split('\n').length` still reports the real line number.
 *
 * `stringChunks` is the right tool when the property lives inside a STRING (a className, a
 * copy string). This is the right tool when the property is CODE — a call expression like
 * `alert(...)`, or an object property like `boxShadow:` — which `stringChunks` cannot see
 * because code is exactly what it throws away.
 *
 * Blanking rather than deleting is deliberate: a comment-stripping pass that shortens the
 * text makes every reported line number wrong, and a guard that points at the wrong line
 * is a guard people stop trusting.
 */
export function withoutComments(src: string): string {
  const n = src.length;
  const out: string[] = [];
  let i = 0;
  while (i < n) {
    const c = src[i];
    if (c === '"' || c === "'" || c === '`') {
      // Copy the whole literal verbatim; a `//` inside a string is not a comment.
      const q = c;
      out.push(c);
      let j = i + 1;
      while (j < n) {
        if (src[j] === '\\') {
          out.push(src.slice(j, j + 2));
          j += 2;
          continue;
        }
        if (src[j] === q) break;
        // An unterminated single/double quote (an apostrophe in prose) must not swallow
        // the rest of the file: stop at the newline, exactly as `stringChunks` does.
        if (q !== '`' && src[j] === '\n') break;
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
      // Preserve newlines so line numbers survive a multi-line block comment.
      out.push(src.slice(i, end).replace(/[^\n]/g, ' '));
      i = end;
    } else {
      out.push(c);
      i += 1;
    }
  }
  return out.join('');
}

/** 1-based line number of a character offset. */
export function lineAt(src: string, offset: number): number {
  return src.slice(0, offset).split('\n').length;
}

/**
 * Every app source file under `dir`, recursively, excluding test and spec files.
 *
 * The extension list includes `.ts` on purpose. `DEF-88-28-01` PROBE C found 88-28's focus
 * gate blind to `.ts` because its `--include` list omitted it — and `src/components/ui/`,
 * where this phase's primitives live, is largely `.ts`/`.tsx`.
 */
export function sourceFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      out.push(...sourceFiles(full));
    } else if (/\.(js|jsx|ts|tsx)$/.test(entry.name) && !/\.(test|spec)\./.test(entry.name)) {
      out.push(full);
    }
  }
  return out;
}

/**
 * Read a full JSX opening tag from `start`, balancing {} () [] and strings.
 *
 * RELOCATED Phase 88.6-09 from `src/app/components/controlSizeFloor.test.tsx:89-110`, where it
 * was a private function with no exports in the file. It is a MOVE, not a copy and not a lift:
 * before this plan `grep -rn readOpeningTag src` returned exactly two lines (that file's
 * definition and its one call site), so leaving the original in place would have created the
 * second copy this module exists to prevent. Importing it from the test file was never
 * available either — see the module docblock at the head of this file: a test file's module
 * body registers its `describe` blocks, and `DECISION Phase 88-29` already names "exporting the
 * lexer from one of the test files" as a REJECTED arm.
 *
 * ADDED in the same move: `maxLength`. The original was unbounded (`while (i < text.length)`),
 * and `withoutComments` copies string literals verbatim, so a `<` inside a className string can
 * start a false tag scan that runs to the end of the file — 182 KB in the largest file here
 * (`src/app/gameDetail/page.js`). Bounded, a false start costs `maxLength` bytes and returns
 * null, which the ancestor walk below degrades into "no ancestor ground resolved" and the
 * consuming suite's anti-vacuity floor is what catches a walk that degrades everywhere.
 *
 * THE DEFAULT IS MEASURED, NOT GUESSED, and the first value chosen was WRONG. Measured
 * 2026-09-15 over all 194 non-test files: the longest REAL opening tag in this tree is 6845
 * bytes — `CalendarMonthView.js:555`, a `<div>` whose `onKeyDown`, long `className` template and
 * `style` object with an embedded DECISION block run to 90 source lines. An initial 6000 left
 * exactly that one tag unreadable, and the cost was NOT confined to it: a skipped open means the
 * element is never pushed, so its later `</div>` pops the nearest same-named frame instead — the
 * day-cell ground silently stopped resolving for a descendant 250 lines further down. The
 * default is 16000, which measures 0 unreadable opens tree-wide (0 from 8000 upward) while still
 * bounding a false start to a cheap scan. If a suite ever sees an ink site inexplicably resolve
 * no ground, re-run that census before anything else.
 */
export function readOpeningTag(text: string, start: number, maxLength = 16000): string | null {
  let i = start;
  const limit = Math.min(text.length, start + maxLength);
  let depth = 0;
  while (i < limit) {
    const c = text[i];
    if (c === '"' || c === "'" || c === '`') {
      i += 1;
      while (i < limit && text[i] !== c) {
        if (text[i] === '\\') i += 1;
        i += 1;
      }
      i += 1;
      continue;
    }
    if (c === '{' || c === '(' || c === '[') depth += 1;
    else if (c === '}' || c === ')' || c === ']') depth -= 1;
    else if (c === '>' && depth === 0) return text.slice(start, i + 1);
    i += 1;
  }
  return null;
}

/**
 * Strip Tailwind variant prefixes and the `!` important marker.
 *
 * This is `surfaceHoverSweep.test.ts:82`'s richer form, NOT the simpler `/^[a-z-]+:/` some
 * suites carry: the simple one cannot strip a bracketed variant such as `data-[state=open]:`.
 *
 * DELIBERATELY NOT EXPORTED, and the shipped copy in `surfaceHoverSweep.test.ts` is
 * DELIBERATELY left byte-unchanged: 88.6-09 edits this shared module under an addition-only
 * rule with one declared deletion (`readOpeningTag`), and converging a second helper out of a
 * suite this plan does not declare would break that constraint. The convergence is recorded as
 * a carry-forward in `88.6-09-SUMMARY.md` rather than taken here.
 */
const VARIANT_PREFIX = /^(?:[a-z][a-z0-9-]*(?:\[[^\]]*\])?:)*!?/;

/** Options for {@link inkGroundPairs}. Both patterns are supplied by the CALLER. */
export interface InkGroundOptions {
  /**
   * Matches an INK class after variant prefixes are stripped. Tested as a WHOLE-token match
   * (the implementation re-anchors it), so `text-content-(muted|link)` cannot match
   * `text-content-muted-foo`.
   */
  ink: RegExp;
  /** Matches a GROUND class after variant prefixes are stripped. Whole-token, as above. */
  ground: RegExp;
  /** Byte bound handed to {@link readOpeningTag}. Default 16000 — see that function. */
  maxTagLength?: number;
}

/** One ground candidate resolved for an ink site. */
export interface GroundCandidate {
  /** The ground class, variant prefixes already stripped (`bg-surface-muted`). */
  token: string;
  /** Chunk identity: the absolute offset `stringChunks` emitted for the chunk it came from. */
  chunk: number;
  /** 1-based line of the frame chunk that sets this ground. */
  frameLine: number;
  /**
   * DERIVED co-presence with the ink, never inferred. `certain` when the two come from the
   * SAME chunk, or when BOTH sit on a plain string-literal `className` (neither can be absent).
   * `possible` otherwise. No branch-liveness analysis is attempted — see limitation 4.
   */
  copresence: 'certain' | 'possible';
  /** True when this ground sits in an UNCONDITIONAL chunk of its element's `className`. */
  unconditional: boolean;
}

/** One RESTING ink site and every ground candidate the ancestor walk resolved for it. */
export interface InkGroundRow {
  /** 1-based line of the ink chunk. */
  line: number;
  /** The ink class, variant prefixes already stripped. */
  inkToken: string;
  /** Chunk identity of the ink, comparable with {@link GroundCandidate.chunk}. */
  inkChunk: number;
  /**
   * EVERY candidate from the nearest ancestor frames that set any ground — an ARRAY, never a
   * scalar. One `className` template can carry several mutually exclusive ground arms
   * (`CalendarMonthView.js:245-253` carries five), and picking one of them would make every
   * downstream by-name assertion a coin flip. Consumers must not index into this array.
   */
  grounds: GroundCandidate[];
}

/** Anchor a caller-supplied pattern to the WHOLE token, ignoring any `g`/`y` state. */
function wholeToken(re: RegExp): RegExp {
  return new RegExp(`^(?:${re.source})$`, re.flags.replace(/[gy]/g, ''));
}

interface ClassSite {
  token: string;
  chunk: number;
  line: number;
  /** In an unconditional chunk of its element's `className`. */
  unconditional: boolean;
  /** Its `className` is a plain string literal, so it is unconditionally present. */
  literal: boolean;
}

interface Frame {
  name: string;
  grounds: ClassSite[];
  /** At least one ground sits in an unconditional chunk — this frame TERMINATES the walk. */
  terminal: boolean;
}

const OPEN_TAG = /<[A-Za-z][\w.-]*(?=[\s>/])/g;
const CLOSE_TAG = /<\/([A-Za-z][\w.-]*)\s*>/g;

/**
 * Opening-tag spans of elements NESTED inside another opening tag — the `icon={<Icon …/>}`
 * shape. Their classNames belong to the nested element, not to the tag that carries the prop.
 */
function nestedElementSpans(tag: string, bound: number): [number, number][] {
  const spans: [number, number][] = [];
  const re = new RegExp(OPEN_TAG.source, 'g');
  let m: RegExpExecArray | null;
  while ((m = re.exec(tag)) !== null) {
    const at = m.index;
    if (at === 0) continue;
    if (spans.some(([s, e]) => at >= s && at < e)) continue;
    const inner = readOpeningTag(tag, at, bound);
    if (!inner) continue;
    spans.push([at, at + inner.length]);
  }
  return spans;
}

/** The extent and shape of one `className=` value inside an opening tag. */
function classNameValue(
  tag: string,
  eq: number,
): { start: number; end: number; kind: 'literal' | 'template' | 'expression' } | null {
  let i = eq + 1;
  while (i < tag.length && /\s/.test(tag[i])) i += 1;
  const c = tag[i];
  if (c === '"' || c === "'") {
    let j = i + 1;
    while (j < tag.length && tag[j] !== c) {
      if (tag[j] === '\\') j += 1;
      j += 1;
    }
    return { start: i, end: Math.min(j + 1, tag.length), kind: 'literal' };
  }
  if (c !== '{') return null;
  let depth = 0;
  let j = i;
  while (j < tag.length) {
    const ch = tag[j];
    if (ch === '"' || ch === "'" || ch === '`') {
      const q = ch;
      j += 1;
      while (j < tag.length && tag[j] !== q) {
        if (tag[j] === '\\') j += 1;
        j += 1;
      }
    } else if (ch === '{') {
      depth += 1;
    } else if (ch === '}') {
      depth -= 1;
      if (depth === 0) break;
    }
    j += 1;
  }
  const innerStart = i + 1;
  const innerEnd = Math.min(j, tag.length);
  let k = innerStart;
  while (k < innerEnd && /\s/.test(tag[k])) k += 1;
  return { start: innerStart, end: innerEnd, kind: tag[k] === '`' ? 'template' : 'expression' };
}

/** `${...}` spans of a template-literal className value, relative to `value`. */
function interpolationSpans(value: string): [number, number][] {
  const spans: [number, number][] = [];
  const open = value.indexOf('`');
  if (open < 0) return spans;
  let i = open + 1;
  while (i < value.length) {
    const c = value[i];
    if (c === '\\') {
      i += 2;
      continue;
    }
    if (c === '`') break;
    if (c === '$' && value[i + 1] === '{') {
      let depth = 1;
      let k = i + 2;
      while (k < value.length && depth > 0) {
        const ch = value[k];
        if (ch === '{') depth += 1;
        else if (ch === '}') depth -= 1;
        else if (ch === '"' || ch === "'" || ch === '`') {
          const q = ch;
          k += 1;
          while (k < value.length && value[k] !== q) {
            if (value[k] === '\\') k += 1;
            k += 1;
          }
        }
        k += 1;
      }
      spans.push([i, k]);
      i = k;
      continue;
    }
    i += 1;
  }
  return spans;
}

/** Every class token an opening tag's `className` attributes contribute, with its provenance. */
function classSites(
  stripped: string,
  tag: string,
  tagOffset: number,
  bound: number,
): ClassSite[] {
  const out: ClassSite[] = [];
  const nested = nestedElementSpans(tag, bound);
  const attr = /\bclassName\s*=/g;
  let m: RegExpExecArray | null;
  while ((m = attr.exec(tag)) !== null) {
    const at = m.index;
    if (nested.some(([s, e]) => at >= s && at < e)) continue;
    const v = classNameValue(tag, at + m[0].length - 1);
    if (!v) continue;
    const value = tag.slice(v.start, v.end);
    const spans = v.kind === 'template' ? interpolationSpans(value) : [];
    for (const { offset, text } of stringChunks(value)) {
      const unconditional =
        v.kind === 'literal' ||
        (v.kind === 'template' && !spans.some(([s, e]) => offset >= s && offset < e));
      const abs = tagOffset + v.start + offset;
      const line = lineAt(stripped, abs);
      for (const raw of text.split(/\s+/)) {
        if (!raw) continue;
        const base = raw.replace(VARIANT_PREFIX, '');
        if (!base) continue;
        // A variant-prefixed class is NOT resting — neither as ground (mechanism step 3) nor
        // as ink (step 4). Both sides are dropped here, symmetrically and by the same rule.
        if (raw.length !== base.length && raw.slice(0, raw.length - base.length).includes(':')) {
          continue;
        }
        out.push({ token: base, chunk: abs, line, unconditional, literal: v.kind === 'literal' });
      }
    }
  }
  return out;
}

/**
 * Resolve every RESTING ink class in `src` against the ground its nearest ancestors set.
 *
 * WHY A WALK AND NOT A GREP, OR EVEN A PER-LINE SCAN
 * --------------------------------------------------
 * D-16's rule — no `text-content-muted` / `text-content-link` on a `bg-surface-muted` ground —
 * is a rule about TWO ELEMENTS. The ink is on a child, the ground on an ancestor, and no
 * line-based read can see the pair. That is exactly why the rule lived as prose inside a test
 * comment (`tokenContrast.test.ts` test 49) instead of as a gate. This is the missing
 * mechanism: an ancestor-stack walk over the comment-stripped source that resolves each ink
 * class against the nearest frames that set a ground.
 *
 * DECISION Phase 88.6-09 (D-16 / RESEARCH Q3): the ancestor walk is a NEW EXPORT on this
 * shared lexer, chosen OVER (a) a private copy inside `groundInk.test.ts` and OVER
 * (b) extending `surfaceHoverSweep.test.ts`'s scanner. (a) is the shape this module exists to
 * end — the docblock at the head of this file records FIVE copies of `stringChunks` converging
 * into it and four grep gates that died of line-based matching; a sixth private copy is the
 * same drift one layer up. (b) cannot be made to work at all: that scanner reads one element
 * at a time and has no notion of a parent, so "extending" it means writing this walk inside a
 * test file, which is (a) wearing a different hat. Moving this back into a suite is a
 * decision, not a cleanup.
 *
 * MECHANISM
 * ---------
 *  1. `withoutComments` first. Marker prose in this tree quotes both ink and ground class
 *     names by necessity, and an unfiltered walk reports phantom pairings from comments.
 *  2. Opening tags are anchored on a NAMED-tag regex with a lookahead, never a bare `<`, so a
 *     TypeScript generic or a `a < b` comparison cannot start a tag scan; each is read with
 *     the length-bounded `readOpeningTag` above, never a `[^>]*` regex (measured in 88-21:
 *     that form matched 0 of 14 real controls here, because every className in this repo sits
 *     on a different line from its opening tag).
 *  3. Each non-self-closing tag pushes a stack frame recording EVERY ground candidate it sets
 *     — token, chunk identity and line — not just the first.
 *  4. Each RESTING ink class emits a row carrying the candidates from the nearest ancestor
 *     frames that set any, starting with the element's own. The walk TERMINATES at the first
 *     frame that sets a ground in an UNCONDITIONAL chunk; a frame whose grounds are ALL
 *     conditional contributes its candidates and CONTINUES to the parent, so a ground that may
 *     not be present can never mask a real ancestor ground.
 *  5. Co-presence is DERIVED: `certain` when ink and ground share a chunk or both sit on plain
 *     string-literal classNames, `possible` otherwise. No branch-liveness analysis is
 *     attempted — whether two arms of a ternary can be live together is not knowable from
 *     source, and pretending otherwise is how a scan starts lying.
 *
 * KNOWN LIMITATIONS — SEVEN, and this list is the gate's honesty
 * --------------------------------------------------------------
 *  1. COMPONENT-SET GROUND is invisible. A ground applied by a component (`<Card>`,
 *     `<Modal.Body>`) is not a class in any opening tag this walk reads.
 *  2. FUNCTION-RETURNED / CLASS-CONSTANT GROUND is invisible. The live instance is
 *     `SuggestionCard.js`'s `getScoreColor()` — declared `:66`, returning
 *     `'bg-surface-muted border-line'` at `:67`, applied at `:75` — whose three forbidden-ink
 *     descendants the walk therefore cannot see.
 *  3. RAW-PALETTE INK is invisible. Only ink expressed as a semantic token is resolved; ink
 *     written `text-<hue>-<n>` is not (87 occurrences in non-test `src/`, concentrated in
 *     `gameDetail/page.js`, `userProfile/page.js` and `ManageMembers.js`). That population is
 *     `rawColorValues.test.ts` territory.
 *  4. CONDITIONAL / MULTI-BRANCH GROUND fans out. Every candidate in a multi-arm `className`
 *     is recorded and none is preferred, because branch liveness is not knowable from source.
 *     Consumers must expect fan-out, and a pairing that is structurally impossible (the ink
 *     arm and the ground arm are mutually exclusive) must be excluded BY NAME by the consumer,
 *     never reasoned away here.
 *  5. A CONDITIONALLY-PRESENT GROUND DOES NOT TERMINATE the walk. It contributes candidates
 *     and the walk continues to the parent. The live shapes are `EventScheduler.tsx:1091` and
 *     `Combobox.tsx:281`, where one arm sets a ground and the other sets none.
 *  6. ALPHA IS INVISIBLE. This resolves TOKENS. An `opacity-*` utility, or a `text-*` / `bg-*`
 *     alpha modifier written with a slash, on the ink element OR ON ANY ANCESTOR composites
 *     the rendered colour — so a pairing that PASSES here can still fail WCAG 1.4.3 at render.
 *     Live specimen: `CalendarMonthView.js:246` (`isAdjacent ? 'opacity-60 ' : ''`) over the
 *     ink at `:259` (`isAdjacent ? 'text-content-muted' :`) — the SAME condition, so the two
 *     are genuinely co-live.
 *  7. VARIANT-PREFIXED INK IS OUT OF SCOPE, as a declared exclusion and not a silent filter.
 *     `hover:` / `focus:` / `disabled:` / `aria-disabled:` ink emits NO row, exactly as a
 *     variant-prefixed ground is not a resting ground: D-16 is a rule about the RESTING state.
 *     Measured 2026-09-15: 30 variant-prefixed occurrences of D-16's forbidden set across
 *     non-test `src/`, of 72 variant-prefixed `text-content-*` overall. Whether any of them
 *     resolves onto a muted ground is UNKNOWN and out of this walk's scope.
 *
 * Because of 1, 2 and 4, a consumer must pair the class rule with a by-name roster so that the
 * two fail INDEPENDENTLY — a class rule alone goes green by seeing nothing.
 */
export function inkGroundPairs(src: string, opts: InkGroundOptions): InkGroundRow[] {
  const stripped = withoutComments(src);
  const bound = opts.maxTagLength ?? 16000;
  const isInk = wholeToken(opts.ink);
  const isGround = wholeToken(opts.ground);

  type Event = { at: number; kind: 'open' | 'close'; name: string };
  const events: Event[] = [];
  for (const m of stripped.matchAll(new RegExp(OPEN_TAG.source, 'g'))) {
    events.push({ at: m.index ?? 0, kind: 'open', name: m[0].slice(1) });
  }
  for (const m of stripped.matchAll(new RegExp(CLOSE_TAG.source, 'g'))) {
    events.push({ at: m.index ?? 0, kind: 'close', name: m[1] });
  }
  events.sort((a, b) => a.at - b.at || (a.kind === 'close' ? -1 : 1));

  const stack: Frame[] = [];
  const rows: InkGroundRow[] = [];

  for (const ev of events) {
    if (ev.kind === 'close') {
      // Pop to the nearest frame with this name. An unmatched close is IGNORED rather than
      // popping blindly: a fragment shorthand or an early return must degrade, never corrupt.
      for (let i = stack.length - 1; i >= 0; i -= 1) {
        if (stack[i].name === ev.name) {
          stack.length = i;
          break;
        }
      }
      continue;
    }

    const tag = readOpeningTag(stripped, ev.at, bound);
    if (!tag) continue;
    const sites = classSites(stripped, tag, ev.at, bound);
    const grounds = sites.filter((s) => isGround.test(s.token));
    const own: Frame = {
      name: ev.name,
      grounds,
      terminal: grounds.some((g) => g.unconditional),
    };

    const chain: ClassSite[] = [];
    for (const frame of [own, ...stack.slice().reverse()]) {
      chain.push(...frame.grounds);
      if (frame.terminal) break;
    }

    for (const ink of sites) {
      if (!isInk.test(ink.token)) continue;
      rows.push({
        line: ink.line,
        inkToken: ink.token,
        inkChunk: ink.chunk,
        grounds: chain.map((g) => ({
          token: g.token,
          chunk: g.chunk,
          frameLine: g.line,
          copresence:
            g.chunk === ink.chunk || (g.literal && ink.literal) ? 'certain' : 'possible',
          unconditional: g.unconditional,
        })),
      });
    }

    if (!/\/>$/.test(tag)) stack.push(own);
  }

  return rows;
}
