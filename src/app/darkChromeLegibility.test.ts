/**
 * Phase 88.3 plan 07 — the dark-chrome corrections (Req 7 / Req 8) and the mobile-panel
 * `inert` guard.
 *
 * WHY THIS GATE EXISTS
 * --------------------
 * The header is `warm-800` and the nav is `purple-900` IN LIGHT MODE — dark chrome in a light
 * app, deliberately (`DESIGN-SYSTEM-REFERENCE-2026.md:59-60` records it as "intentional,
 * keep"). Nothing upstream of this phase measured a light-mode token against that ground, so
 * two of this phase's own token moves regressed it:
 *
 *   - Req 7's purple-700 focus ring measures 1.93:1 on warm-800, 1.78:1 on purple-900 and
 *     1.38:1 on warm-700 header-hover — all below WCAG 2.4.11's 3:1 floor. amber-400, the
 *     value dark mode already uses, reads 9.00 / 8.30 / 6.27.
 *   - Req 8's warm-550 muted takes the three `variant="row"` menu labels from 3.66:1 (already
 *     failing) to 2.79:1 on warm-800.
 *
 * Both fixes are one-token edits, which is exactly why they need a gate: a future "consistency"
 * pass that converges the header onto the global ring value, or restores a muted label, would
 * look like a tidy-up and would silently re-ship both failures.
 *
 * These are SOURCE SCANS, not greps, and they use the shared `stringChunks` lexer for the same
 * three reasons the rest of the Phase 88 gate ledger does: it crosses newlines (every className
 * in this repo sits on a different line from its opening tag), it recurses into `${...}`
 * interpolations, and it DROPS COMMENTS. The last one is not theoretical here — this plan's own
 * DECISION markers necessarily quote every token these tests forbid, and a grep census of
 * `text-content-muted` in these three files reads 10 / 1 / 2 where the real code count is
 * 7 / 0 / 1. Plan 88.3-06 hit the identical trap on a 42-line grep census, one line of which
 * was a marker comment.
 */
import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { stringChunks, withoutComments, lineAt, sourceFiles } from '../test-utils/sourceScan';

const SRC = path.resolve(__dirname, '..');

const HEADER = 'app/Header.js';
const ROW_COMPONENTS = [
  'app/components/NotificationBell.js',
  'app/components/ThemeToggle.js',
  'app/components/FeedbackButton.js',
];

const RING_OVERRIDE = '[--ring:var(--amber-400)]';
const INERT_SHAPE = '[--color-focus-ring:';

function read(rel: string): string {
  return fs.readFileSync(path.join(SRC, rel), 'utf8');
}

/** Class-string chunks (comments already dropped by the lexer) carrying the ring override. */
function ringOverrideChunks(src: string) {
  return stringChunks(src).filter((c) => c.text.includes(RING_OVERRIDE));
}

/**
 * Every JSX `<div ...>` opening tag, comments removed.
 *
 * A `[^>]*` tag matcher is safe for the two tags this file asserts on: neither the header
 * container's plain className nor the panel's template-literal className contains a `>`
 * character (verified 2026-08-26 — the interpolation is a `?:` over two string literals). If a
 * future edit puts a `>` inside one of these tags (an arrow function in a handler, say) this
 * matcher stops finding the tag and test 6 goes red rather than silently passing, which is the
 * correct failure direction.
 */
function divOpeningTags(src: string): string[] {
  return withoutComments(src).match(/<div\b[^>]*>/g) ?? [];
}

describe('Phase 88.3 Req 7/8 — dark-chrome ring, muted labels, and the closed mobile panel', () => {
  it('0. the scan sees a representative app, and the detector is not dead', () => {
    // Anti-vacuity, half one: a scanner pointed at an empty tree passes every negative below.
    expect(sourceFiles(SRC).length).toBeGreaterThan(100);

    // Anti-vacuity, half two: the detector really matches the override token in code...
    expect(ringOverrideChunks(`const c = "bg-surface-header ${RING_OVERRIDE}";`)).toHaveLength(1);
    expect(
      ringOverrideChunks(`const c = \`bg-surface-header ${RING_OVERRIDE} \${open ? 'a' : 'b'}\`;`),
    ).toHaveLength(1);
    // ...and does NOT match a comment mentioning it. This is the assertion a future author
    // will break: every marker this plan wrote quotes the token it pins.
    expect(ringOverrideChunks(`// the override is ${RING_OVERRIDE}, do not remove`)).toEqual([]);
    expect(ringOverrideChunks(`/* scoped via ${RING_OVERRIDE}\n   on the header */\nconst x = 1;`)).toEqual([]);
  });

  it('1. the ring override exists at BOTH header containers, on a bg-surface-header element', () => {
    // BASIS — the subtree blast radius, recorded here so it stays in lockstep with the
    // marker at `Header.js`'s container. `--ring` has 72 repo-wide consumers (66
    // `ring-focus-ring` + 6 `ring-ring`), but this override is scoped to the header
    // container and the mobile panel. INSIDE that subtree the consumers are exactly 9
    // `ring-focus-ring` sites and 0 `ring-ring` sites:
    //   Header.js               x3  (mobile menu trigger + the two nav row links)
    //   NotificationBell.js     x2  (row variant + the icon-only desktop trigger)
    //   ThemeToggle.js          x2  (row variant + the icon-only desktop trigger)
    //   FeedbackButton.js       x2  (row variant; its Modal portals to document.body and
    //                                is OUTSIDE this subtree, so it is unaffected)
    // It was 7 before this plan: `NotificationBell.js`'s and `ThemeToggle.js`'s icon-only
    // desktop triggers carried NO focus-visible ring at all and fell to the UA outline on
    // warm-800. They gained one here, which is what raised 7 -> 9.
    const src = read(HEADER);
    const chunks = ringOverrideChunks(src);
    expect(
      chunks.map((c) => lineAt(src, c.offset)),
      'expected the ring override on exactly the header container and the mobile panel',
    ).toHaveLength(2);
    // Asserted via the LEXER, so a comment quoting the token cannot satisfy this — and on
    // the same chunk as `bg-surface-header`, so the override cannot drift onto some other
    // element and still pass.
    for (const c of chunks) {
      expect(
        c.text,
        `ring override at Header.js:${lineAt(src, c.offset)} is not on a bg-surface-header element`,
      ).toContain('bg-surface-header');
    }
  });

  it('2. the override does NOT use the known-inert `--color-focus-ring` shape', () => {
    // This is the whole reason the gate names a property rather than "a ring override".
    //
    // `globals.css` declares `--color-focus-ring: var(--ring)` inside `@theme inline` and
    // `--ring: var(--color-focus-ring)` on `:root`. Because `--ring` is declared on `:root`,
    // its `var()` is substituted at COMPUTED-VALUE TIME there and every descendant inherits
    // an already-resolved hex. Compiled against this project's own tailwindcss@4.3.3 with
    // this project's own globals.css, the consumer utility emits:
    //
    //     .focus-visible\:ring-focus-ring:focus-visible { --tw-ring-color: var(--ring); }
    //
    // It reads `--ring`. A descendant override of `--color-focus-ring` compiles cleanly,
    // satisfies any gate that only checks "an override is present", and changes NOTHING on
    // screen — the ring would stay purple-700 at 1.93:1 while the class string looked right.
    //
    // DO NOT "fix" this back to `[--color-focus-ring:...]` on the strength of the
    // `EventScheduler.tsx:228-236` precedent. That precedent is superficially similar and
    // materially different: it overrides a ONE-hop alias (a `surface-*` theme key resolving
    // straight to one runtime property, which Tailwind v4 resolves at emit time). This chain
    // is TWO hops. Same idiom, different property.
    const src = read(HEADER);
    const offenders = stringChunks(src)
      .filter((c) => c.text.includes(INERT_SHAPE))
      .map((c) => `Header.js:${lineAt(src, c.offset)}`);
    expect(offenders).toEqual([]);
  });

  it('3. no header-row label carries the `text-content-muted flex-1` shape', () => {
    // NARROW ON PURPOSE. The three header-row labels had exactly this shape:
    //   <span className="text-content-muted flex-1">{label || '...'}</span>
    // A gate that simply forbade `text-content-muted` in these files would demand deleting
    // the SEVEN remaining muted labels, all of which are correct — they sit on the
    // `bg-surface-card` dropdown panel (NotificationBell) and inside the feedback Modal
    // (FeedbackButton), not on the dark header row. Confirmed site by site, 2026-08-26.
    const offenders: string[] = [];
    for (const rel of ROW_COMPONENTS) {
      const src = read(rel);
      for (const c of stringChunks(src)) {
        if (c.text.includes('text-content-muted') && c.text.includes('flex-1')) {
          offenders.push(`${rel}:${lineAt(src, c.offset)} ${c.text}`);
        }
      }
    }
    expect(offenders).toEqual([]);
  });

  it('4. the rows themselves still exist — test 3 is not zero-by-emptiness', () => {
    // Without this, deleting all three menu rows would make test 3 pass. The label inherits
    // its colour from the row button's `text-white` (15.03:1 on warm-800), so the row's
    // `text-white` is not incidental — it IS the fix, and losing it un-ships test 3 silently.
    for (const rel of ROW_COMPONENTS) {
      const rowChunks = stringChunks(read(rel)).filter(
        // `hover:bg-surface-header-hover` is plan 88.3-06's correction on these same three
        // rows (warm-700, white-on-it 10.48:1, against `bg-surface-hover`'s 1.06:1). Pinned
        // together because they describe one row: its ground and the text on that ground.
        (c) => c.text.includes('text-white') && c.text.includes('hover:bg-surface-header-hover'),
      );
      expect(rowChunks.length, `${rel} lost its dark-chrome row button`).toBeGreaterThanOrEqual(1);
    }
    // And the labels kept `flex-1` — the layout token was not collateral damage.
    for (const rel of ROW_COMPONENTS) {
      expect(stringChunks(read(rel)).some((c) => c.text.trim() === 'flex-1'), `${rel} lost flex-1`).toBe(true);
    }
  });

  it('5. the markers live at PRODUCTION sites, not only in this test file', () => {
    // A decision recorded only inside a test file is invisible to the next person editing the
    // code it governs — that is how a deliberate choice gets "restored" as an oversight two
    // phases later. Same shape as `tintTreatment.test.ts` test 4b.
    const header = read(HEADER);
    expect(header).toMatch(/DECISION Phase 88\.3/);
    // The load-bearing half is the REJECTED alternative. "Uses amber-400" warns nobody;
    // "amber-400 OVER a `dark:` variant, because the ground is dark in BOTH themes" stops a
    // future revert — so the rejection, not the choice, is what is pinned.
    expect(header).toMatch(/Rejected/);
    expect(header, 'the `dark:`-variant rejection is missing from Header.js').toMatch(/`dark:` variant/);
    expect(header, 'the measured header ratio is missing from Header.js').toMatch(/1\.93/);
    expect(header).toMatch(/is a decision, not a cleanup/);

    const bell = read('app/components/NotificationBell.js');
    expect(bell).toMatch(/DECISION Phase 88\.3/);
  });

  it('6. the CLOSED mobile panel is out of the Tab order (`inert`)', () => {
    // Owner ruling R3-D, 2026-08-25. The panel renders UNCONDITIONALLY and is hidden purely
    // via `-translate-y-full opacity-0 pointer-events-none` — none of which removes anything
    // from the Tab order. So its three rows, each carrying `focus:outline-hidden`, stayed
    // keyboard-reachable while invisible: a keyboard user tabbing past the closed hamburger
    // landed on rows they could not see.
    //
    // `inert` was chosen OVER a conditional mount. `Header.js`'s own comment directly above
    // this panel already establishes why it stays mounted — "mount/unmount strips the element
    // before CSS transition can run, killing the exit animation" — so unmounting it to fix the
    // Tab order would fix one defect by re-introducing the one that comment protects against.
    // `inert` removes the subtree from the a11y tree and the Tab order without touching the
    // mount at all.
    //
    // Both attribute forms are accepted here: the project is on React 18.2.0, where the
    // empty-string form is required, but React 19 accepts a boolean `inert` prop natively and
    // an upgrade should not red this gate for a shape that is equally correct there.
    const src = read(HEADER);
    const panelTags = divOpeningTags(src).filter(
      (t) => t.includes('bg-surface-header') && t.includes('md:hidden'),
    );
    expect(panelTags, 'could not locate the mobile menu panel opening tag').toHaveLength(1);
    expect(
      panelTags[0],
      'the closed mobile panel is keyboard-reachable — add `inert` guarded by `mobileMenuOpen`',
    ).toMatch(/inert=\{(mobileMenuOpen \? undefined : ''|!mobileMenuOpen)\}/);
  });

  it('7. the two desktop icon-only triggers carry a focus-visible ring', () => {
    // These are ADDITIONS, not regressions spared: both shipped with no `focus-visible:*`
    // class at all and fell to the UA outline on warm-800, unlike their row-variant siblings.
    // They sit inside the `Header.js` container subtree, so they inherit its amber-400
    // `--ring` override and need no override of their own — only the utility classes.
    for (const rel of ['app/components/NotificationBell.js', 'app/components/ThemeToggle.js']) {
      const src = read(rel);
      const ringed = stringChunks(src).filter((c) => c.text.includes('focus-visible:ring-focus-ring'));
      expect(
        ringed.map((c) => `${rel}:${lineAt(src, c.offset)}`),
        `${rel} should ring BOTH its row variant and its icon variant`,
      ).toHaveLength(2);
      // The full treatment, not just the colour — an inset ring that suppresses the UA outline.
      for (const c of ringed) {
        expect(c.text).toContain('focus:outline-hidden');
        expect(c.text).toContain('focus-visible:ring-inset');
      }
    }
  });
});
