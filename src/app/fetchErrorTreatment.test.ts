/**
 * Req 14 (DES-04/DES-05) guard for the surfaces plan 88-25 adopted the shared
 * fetch-error treatment on: no hand-rolled failure copy, and no raw upstream
 * message interpolated into user-facing text.
 *
 * WHY THIS EXISTS INSTEAD OF THE PLAN'S GREP
 * -----------------------------------------
 * 88-25's own verify gate is
 *
 *     ! grep -rniE "failed to load" <the eight files>
 *
 * and it is defective in BOTH directions — measured this session, not reasoned:
 *
 *   FALSE NEGATIVES. Run against the PRE-88-25 tree it matched 5 real code sites
 *   out of a population of ~34. It cannot see `Failed to X` for any verb other
 *   than "load" (`Failed to cancel event.`, `Failed to update username: …`,
 *   `Failed to remove participant.`), and it cannot see the sharper half at all:
 *   19 sites interpolating a raw `error.message` into a toast or an inline field
 *   error. DEF-88-19-01 predicted exactly this — "not one of these fifteen
 *   contains the phrase 'failed to load', so that gate goes fully green with the
 *   whole list standing" — and the plan's own `read_first` census used a WIDER
 *   pattern than its gate, so the two disagreed inside one task.
 *
 *   FALSE POSITIVES. `grep` cannot tell code from a comment. On the fully
 *   converged tree the gate is still RED, on two DECISION markers that exist to
 *   record this very work: `GroupLibrary.js` ("The library FAILED to load — a
 *   different fact from an empty library") and `userProfile/page.js` ("Deliberately
 *   NOT worded 'failed to load' — plan 88-25 arms a negative gate on that phrase").
 *   A gate that is red before the work and red after it distinguishes nothing —
 *   the same shape DEF-88-24-04 recorded for 88-24's Task 2 gate.
 *
 * That is the SEVENTH defective grep-shaped gate recorded in this phase
 * (DEF-88-16-01, DEF-88-19-01, DEF-88-21-01, DEF-88-24-04 x2, 88-25's Task 1
 * bare-border grep which also matched a comment, and this one). The scanner below
 * strips comments and strings-in-comments before matching, so neither failure mode
 * applies.
 *
 * WHY A SOURCE SCAN AND NOT A RENDER TEST
 * ---------------------------------------
 * Same reasoning as `components/controlSizeFloor.test.tsx` and
 * `cardPaddingIdiom.test.ts`: the property is "no site on these surfaces does X",
 * and the sites live behind role gates, tab conditionals, modal state and fetch
 * states that no single render reaches. A per-node render pin also goes green
 * forever the moment a new handler is added, which is the failure mode 88-19 named.
 * The branch-ORDERING half (error checked before empty) is a behaviour and IS
 * render-tested — see `GroupGamesList.emptyState.test.tsx` and
 * `components/emptyStates.split.test.tsx`.
 */
import fs from 'node:fs';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

import { sourceFiles, withoutComments } from '../test-utils/sourceScan';

const SRC = path.resolve(__dirname, '..');

/**
 * The tree walk, done ONCE at module level and reused by every assertion below.
 *
 * Plan 88.6-13 task 2 replaces the nine-entry `SURFACES` scope with the whole `src/` tree
 * for the raw-message and `Failed to X` assertions — measured 194 files — across roughly
 * five independent walks. Walking per assertion buys nothing: the suite reads a static
 * tree in a single process.
 *
 * `sourceFiles` returns ABSOLUTE paths. `ALL_REL` is the `src/`-relative mapping every
 * assertion and every allow-list keys on; an unmapped set silently matches no allow-list
 * entry, which is a gate that cannot fail.
 */
const ALL_FILES = sourceFiles(SRC);
const ALL_REL = ALL_FILES.map((f) => path.relative(SRC, f));

/** The surfaces plan 88-25 declared. */
const SURFACES = [
  'app/groupPlanning/page.js',
  'app/groupHomePage/page.js',
  'app/gameDetail/page.js',
  'app/userProfile/page.js',
  'app/friends/page.js',
  'app/components/GroupLibrary.js',
  'app/components/OpenPollsList.js',
  'app/components/ScheduleList.js',
  // Adopted by 88-25 as the receiving half of DEF-88-18-01.
  'app/components/GroupGamesList.js',
];

// ONE comment stripper: `withoutComments` from `src/test-utils/sourceScan.ts`.
//
// This block is written with `//` and NOT as a `/* */` docblock ON PURPOSE: it has to quote
// both comment delimiters literally, and plan 88.6-11 measured that a `*/` inside a block
// comment silently truncates the file under vite:oxc — the suite then collects ZERO tests
// and reports green. Making it a docblock is a decision, not a cleanup.
//
// WHY THE LOCAL COPY IS GONE (plan 88.6-13 task 1, MEASURED — not assumed)
// -----------------------------------------------------------------------
// The local `stripComments` that lived here carried this reasoning, which is preserved
// because it is the record of what this file cares about:
//
//   "Strip `//` and block comments, preserving line count so reported line numbers stay
//    usable. String literals are NOT parsed out — a `//` inside a string is rare in this
//    codebase and erring toward stripping would create false negatives, which is the
//    failure mode this file exists to avoid."
//
// That last clause is the whole point, and the shipped implementation did not honour it.
// Both strippers were run over the set task 2 scans — all 194 files of `src/` — and their
// outputs diffed line by line (2026-09-15). Ignoring trailing whitespace (the local one
// DELETED a `//` comment to end-of-line, this one BLANKS it to spaces; neither affects a
// line-based regex) they differ on exactly TWO files and 31 lines, and in BOTH cases the
// LOCAL one blanks REAL CODE:
//
//   - `app/components/FeedbackForm.js:386-403` — the string `accept="image/*"` opens a block
//     comment the local stripper never knew was inside a string, which then runs to the `*/`
//     of the next real comment. 18 lines of live JSX vanish, `className` strings included.
//   - `app/components/Modal.tsx:265-281` — the same, from `src/**` written inside a `//` line
//     comment: the local block-comment pass runs FIRST, so that `/*` is seen before the `//`
//     that contains it, and everything to the next `*/` (line 281) is blanked.
//
// Blanked code is a FALSE NEGATIVE — precisely the failure mode the docblock named. So the
// correct stripper for THIS suite's question ("does a raw `error.message` read reach a
// user-facing sink") is the one that parses string literals. `withoutComments` blanks rather
// than deletes, so line numbers still survive.
//
// The suite's own offender set is UNCHANGED by the swap: over the nine `SURFACES` both
// strippers report the identical 3 raw-message hits, 0 `Failed to X` hits and 0 `alert(`
// hits (measured before and after). Neither divergent file is a `SURFACES` entry — which is
// exactly why nobody noticed, and exactly why task 2's widening had to fix this first.
//
// `src/test-utils/sourceScan.ts` is NOT edited by this plan, so none of its eleven consumer
// suites can shift.

/**
 * Read + strip a file at most ONCE per run, keyed on its `src/`-relative path.
 *
 * Task 2 widens two assertions from 9 files to 194 across ~5 walks; the un-memoized form
 * re-read and re-stripped on every call. File-local and behaviour-preserving — the offender
 * set is identical before and after, which is what this task's gate asserts.
 */
const strippedCache = new Map<string, { lines: string[]; raw: string }>();

function readStripped(rel: string): { lines: string[]; raw: string } {
  const cached = strippedCache.get(rel);
  if (cached) return cached;
  const raw = fs.readFileSync(path.join(SRC, rel), 'utf8');
  const entry = { lines: withoutComments(raw).split('\n'), raw };
  strippedCache.set(rel, entry);
  return entry;
}

/** Sinks that put text in front of a person. */
const USER_FACING_SINK =
  /(toast\.(?:error|success|warning|info|message)\s*\(|\balert\s*\(|set[A-Za-z]*Error\s*\(|message:\s)/;

/** A raw upstream message being read for display. */
const RAW_MESSAGE_READ = /\b(?:err|error|e)\??\.message\b|\berrorMessage\b/;

/** The hand-rolled failure idiom, any verb — not just "load". */
const AD_HOC_FAILURE_COPY = /['"`][^'"`]*\bFailed to \w+/i;

/**
 * A developer log. `console.error('Failed to get game invite token:', err)` is
 * NOT the defect — the defect is that string reaching a person. Excluded only
 * when the line carries no user-facing sink, so a line doing both is still
 * caught. Sending the raw error to the console is the DESIGNED destination for
 * it (88-19's ErrorFallback marker says so explicitly).
 */
const DEVELOPER_LOG = /\bconsole\.\w+\s*\(/;

interface Hit {
  file: string;
  line: number;
  text: string;
}

function scan(match: (line: string) => boolean): Hit[] {
  const hits: Hit[] = [];
  for (const rel of SURFACES) {
    const { lines } = readStripped(rel);
    lines.forEach((line, i) => {
      if (match(line)) hits.push({ file: rel, line: i + 1, text: line.trim() });
    });
  }
  return hits;
}

const fmt = (hits: Hit[]) =>
  hits.map((h) => `${h.file}:${h.line}  ${h.text}`).join('\n');

describe('Req 14 — the shared fetch-error treatment on 88-25 surfaces', () => {
  it('a raw upstream error message is only ever logged or branched on, never displayed (T-88-25-01, ASVS V7)', () => {
    // `ApiError.message` is `body.message ?? body.error ?? \`HTTP error! status: N\``
    // (api.ts extractErrorMessage), so displaying it paints whatever the backend
    // sent — or a raw status line — at the user. Derived copy replaces it; see
    // the DECISION marker on getFetchErrorMessage.
    //
    // ALLOW-LIST, NOT SINK-MATCHING. The obvious formulation — "flag a line that
    // has both a display sink and a `.message` read" — is the DEF-88-21-01 defect
    // in miniature: `grep` and a line-based scan cannot cross a newline, and the
    // idiom is routinely written over four lines:
    //
    //     toast.error(
    //       getFetchErrorMessage(err, {
    //         fallback: err.message,      <- no sink token on this line
    //       })
    //     );
    //
    // That exact reintroduction was PLANTED during this plan's negative check and
    // the sink-matching version passed it. So the property is inverted: every
    // surviving read is enumerated, and anything not on the list fails by default.
    const CONTROL_FLOW_ALLOWED: Array<{ file: string; contains: string; why: string }> = [
      {
        file: 'app/groupHomePage/page.js',
        contains: "const msg = (error?.message || '').toLowerCase();",
        why: 'isRemovedFromGroupError — routes a removal 403 to a redirect. Never displayed.',
      },
      {
        file: 'app/friends/page.js',
        contains: "if (err.message && err.message.includes('404'))",
        why: '"no user found" is a search OUTCOME with no ApiError code. Never displayed.',
      },
      {
        file: 'app/friends/page.js',
        contains: "} else if (err.message && err.message.includes('No user found'))",
        why: 'same search outcome, prose variant. Never displayed.',
      },
      {
        file: 'app/gameDetail/page.js',
        contains: "const message = String(err?.message || '').toLowerCase();",
        why:
          '88-33 Task 2 (Fork F): invite-409 string FALLBACK until 88-34 ships envelope ' +
          'codes — branches already_member/invite_pending to a status, never displayed.',
      },
    ];

    const violations = scan(
      (l) => RAW_MESSAGE_READ.test(l) && !DEVELOPER_LOG.test(l)
    ).filter(
      (h) =>
        !CONTROL_FLOW_ALLOWED.some(
          (a) => a.file === h.file && h.text.includes(a.contains)
        )
    );

    expect(fmt(violations)).toBe('');
  });

  it('the allow-list is not stale — every entry still matches real code (anti-vacuity)', () => {
    // An allow-list entry that no longer matches anything is dead weight that
    // would silently permit a future read of the same shape.
    const allowed = [
      { file: 'app/groupHomePage/page.js', contains: "const msg = (error?.message || '').toLowerCase();" },
      { file: 'app/friends/page.js', contains: "if (err.message && err.message.includes('404'))" },
      { file: 'app/friends/page.js', contains: "} else if (err.message && err.message.includes('No user found'))" },
    ];
    for (const a of allowed) {
      const { lines } = readStripped(a.file);
      expect(
        lines.some((l) => l.trim().includes(a.contains)),
        `stale allow-list entry: ${a.file} no longer contains "${a.contains}"`
      ).toBe(true);
    }
  });

  it('no hand-rolled "Failed to X" copy survives, for ANY verb', () => {
    // Deliberately wider than the plan's `failed to load`: the real population
    // was mostly other verbs (cancel/update/remove/submit/import/create).
    const hits = scan(
      (l) => AD_HOC_FAILURE_COPY.test(l) && !(DEVELOPER_LOG.test(l) && !USER_FACING_SINK.test(l))
    );
    expect(fmt(hits)).toBe('');
  });

  it('no native alert() survives on these surfaces (DEF-88-16-01)', () => {
    // Req 11's shipped gate matches `confirm(` only, so every `alert(` was
    // invisible to it. Two of the six DEF-88-16-01 censused were on files this
    // plan owns; this pins those two closed. The other four are tracked there.
    const hits = scan((l) => /(^|[^.\w$])alert\s*\(/.test(l));
    expect(fmt(hits)).toBe('');
  });

  it('every declared surface is actually scanned (anti-vacuity: the file list resolves)', () => {
    // Without this, a rename turns all three assertions above into no-ops that
    // pass forever. This is the guard 88-21 and 88-24 both found necessary.
    for (const rel of SURFACES) {
      expect(fs.existsSync(path.join(SRC, rel)), `${rel} is missing`).toBe(true);
      // …and it is in the ONE hoisted tree walk, so the memoized reads and the
      // widened assertions below are looking at the same population this list names.
      expect(ALL_REL.includes(rel), `${rel} is not in sourceFiles(SRC)`).toBe(true);
    }
  });

  it('the scanner still SEES the idioms it forbids (anti-vacuity: patterns match)', () => {
    // Proves the three patterns above are live rather than silently non-matching
    // — the exact failure mode DEF-88-21-01 recorded, where a gate printed
    // CENSUS-ZERO against 14 real violations.
    const planted = [
      `      toast.error(err.message || 'Failed to widget.');`,
      `      alert('nope');`,
      `      setThingError(error.message);`,
    ];
    expect(USER_FACING_SINK.test(planted[0]) && RAW_MESSAGE_READ.test(planted[0])).toBe(true);
    expect(AD_HOC_FAILURE_COPY.test(planted[0])).toBe(true);
    expect(/(^|[^.\w$])alert\s*\(/.test(planted[1])).toBe(true);
    expect(USER_FACING_SINK.test(planted[2]) && RAW_MESSAGE_READ.test(planted[2])).toBe(true);

    // …and the developer-log carve-out must be narrow: a console line is exempt,
    // but a line that ALSO shows the string to a person is not.
    const consoleOnly = `      console.error('Failed to widget:', err);`;
    const consoleAndToast = `      console.error('x', err); toast.error('Failed to widget.');`;
    expect(DEVELOPER_LOG.test(consoleOnly) && !USER_FACING_SINK.test(consoleOnly)).toBe(true);
    expect(DEVELOPER_LOG.test(consoleAndToast) && !USER_FACING_SINK.test(consoleAndToast)).toBe(
      false
    );
  });

  it('comment stripping does not blind the scanner to real code', () => {
    // The complement of the false-positive fix: stripping comments must not also
    // strip code. If it did, every assertion above would go vacuously green.
    const stripped = withoutComments(
      [
        `// toast.error(err.message || 'Failed to nothing.');`,
        `/* alert('also a comment') */`,
        `toast.error(err.message || 'Failed to something.');`,
      ].join('\n')
    ).split('\n');

    expect(AD_HOC_FAILURE_COPY.test(stripped[0])).toBe(false);
    expect(/(^|[^.\w$])alert\s*\(/.test(stripped[1])).toBe(false);
    expect(AD_HOC_FAILURE_COPY.test(stripped[2])).toBe(true);
  });

  it('the surfaces are on the shared primitives, not a second error look', () => {
    // The positive half. Without it, all of the above could be satisfied by
    // deleting the error handling entirely.
    const adopters = [
      'app/groupPlanning/page.js',
      'app/groupHomePage/page.js',
      'app/gameDetail/page.js',
      'app/userProfile/page.js',
      'app/friends/page.js',
      'app/components/GroupLibrary.js',
      'app/components/OpenPollsList.js',
      'app/components/GroupGamesList.js',
    ];
    for (const rel of adopters) {
      const { raw } = readStripped(rel);
      expect(
        /useFetchErrorState|FetchErrorBanner/.test(raw),
        `${rel} renders no shared fetch-error treatment`
      ).toBe(true);
    }
  });
});
