/**
 * W33 / D-30 — the `tailwind-merge` 2.6.1 -> 3.6.0 regression check.
 *
 * EVERY expected string in this file is a LITERAL CAPTURED FROM A REAL RUN against the
 * installed `tailwind-merge@2.6.1` (seeded 2026-09-15; anchor
 * `node -e "console.log(require('./node_modules/tailwind-merge/package.json').version)"` -> `2.6.1`).
 * Nothing here was hand-written from intent. That is the whole point: after the bump to 3.6.0,
 * **a diff is the FINDING, not a test to fix.** v3's breaking change #2 restructures theme-scale
 * keys onto Tailwind v4's namespace, and nearly every class in this repo is custom-named
 * (`shadow-theme-md`, `bg-surface-*`, `ring-focus-ring`, `text-content-*`, `rounded-btn`), so it is
 * grouped by inference. Editing an expectation to make the bump pass would change a shipped look
 * with a green suite — RESEARCH Pitfall 4, the exact failure this file exists to prevent.
 *
 * TWO of the five primitives are asserted through IMPORTED symbols, so the test tracks the source:
 * `controlClass` (exported `Input.tsx:125`) and `HEIGHT_CLASS` (exported `BottomSheet.tsx:255`).
 * The other THREE — `Button`, `Modal`, `Combobox` — are asserted against FROZEN class-list literals
 * transcribed here at seeding time, each with its source cite and a re-derive note.
 *
 * DECISION Phase 88.6-01 (W33): `Button` is frozen against a transcribed literal even though it HAS
 * an importable surface (`buttonVariants`, exported `Button.tsx:287`; `:129` at seeding time) — chosen OVER importing the
 * live symbol. Plan 06 (wave 4) rewrites that same cva base (`min-h-11` onto the base, `sm: 'btn-sm'`,
 * the `enabled-hover:` lift, `p-0` deleted from the `icon` rung). Importing it would red this wave-1
 * gate the moment plan 06 lands, inside a plan that declares only `Button.tsx`/`Button.test.tsx` and
 * therefore cannot fix it. Using `buttonVariants` here is a decision, not a cleanup.
 *
 * RE-SEED PASS — Phase 88.6-37, 2026-09-16, under owner ruling R6. This file is declared by no
 * plan in the phase; R6 authorised plan 37 to re-seed it so the frozen literals stop being
 * STALE-BUT-GREEN, and the undeclared-file edit is disclosed in `.planning/WINDOWS.md` and
 * `88.6-37-SUMMARY.md`. Every expectation touched below was produced the way this header
 * requires — by running the suite with placeholder values and pasting the REAL output back in —
 * never hand-written from intent. What the pass found, all four measured at this commit:
 *
 *   - `MODAL_ACTION_CLASS` -> `BUTTON_VARIANT_CLASS`. A stale CITE and a stale NAME, NOT a wrong
 *     expectation: plan 08 retired `ACTION_CLASS` and `Modal.Action` now renders `Button`, whose
 *     variant map is byte-identical. RE-SEEDED; both strings recorded at the assertion.
 *   - The `BottomSheet` surface literal. RE-SEEDED for plan 37's OWN D49-b snap
 *     (`shadow-lg` -> `shadow-theme-lg`); both strings recorded at the assertion. The only delta
 *     is that token's spelling, so the resolver behaviour is unchanged.
 *   - `BUTTON_CVA_BASE`. **MEASURED CURRENT — no change.** R6's premise that plan 06's cva
 *     rewrite had left it stale was already discharged: plan 06 re-seeded it on 2026-09-15 (that
 *     record is below), and re-reading the live `cva` base entries at `Button.tsx:74`, `:81`,
 *     `:113`, `:168` reproduces this literal exactly. Recorded as CONFIRMED rather than assumed —
 *     "I checked and it was already right" is the half of a re-seed that otherwise leaves no
 *     trace.
 *   - `COMBOBOX_OPTION_ROW_ACTIVE`. **MEASURED CURRENT — no change.** Plan 02's re-seed still
 *     matches the live option-row class list, and plan 37's own W38 edit deliberately did not
 *     touch it (the new sr-only region is a sibling node; the option row is byte-unchanged).
 *
 * NO MERGE DIFFERED FROM WHAT SHIPPED, so this pass produced no finding of the kind this header
 * warns about. Both re-seeds are owned re-derives — a diff that follows a same-phase edit to a
 * transcribed source is a RE-SEED by plan 01's pre-classification, not a resolver fork. Plan 01's
 * `DECISION Phase 88.6-01 (W33)` above is UNCHANGED by this pass: the literals stay transcribed,
 * because importing the live symbols would turn this gate into a tautology.
 */
import { HEIGHT_CLASS } from '@/components/ui/BottomSheet';
import { controlClass } from '@/components/ui/Input';
import { cn } from '@/lib/cn';

// ---------------------------------------------------------------------------
// Frozen class-list literals (transcribed at seeding time, 2026-09-15)
// ---------------------------------------------------------------------------

/**
 * SOURCE: `src/components/ui/Button.tsx:71-169` — the `cva` base array, `.join(' ')`ed. (The range
 * is wide because the array now carries three DECISION markers between its four entries; the
 * entries themselves are `:74`, `:81`, `:113`, `:168`.)
 *
 * RE-DERIVE NOTE: a later plan that renames, adds or removes any token inside this literal OWNS
 * re-deriving it from `Button.tsx` at that time and recording both strings (old and new) in its own
 * summary. The named re-seeder in this phase is **plan 06** (wave 4), which rewrites this exact cva
 * base; plan 05 ARM B would trigger the same re-seed one wave earlier. Citing the line makes the
 * drift findable; it does not make the re-derive this file's job.
 *
 * RE-SEEDED Phase 88.6-06 (D-09 / D10), 2026-09-15 — this is the owned re-derive by the named
 * re-seeder, not a finding. Plan 06 added `min-h-11` to the base and moved the hover half of the
 * elevation pair onto the `enabled-hover` custom variant. Both strings, measured by running the
 * live `buttonVariants` and the expectation below:
 *   PRE  base: btn shadow-theme-sm hover:shadow-theme-md focus:outline-hidden focus-visible:ring-2 focus-visible:ring-focus-ring focus-visible:ring-offset-2
 *   POST base: btn shadow-theme-sm enabled-hover:shadow-theme-md focus:outline-hidden focus-visible:ring-2 focus-visible:ring-focus-ring focus-visible:ring-offset-2 min-h-11
 *   PRE  merged: btn hover:shadow-theme-md focus:outline-hidden focus-visible:ring-2 focus-visible:ring-focus-ring focus-visible:ring-offset-2 shadow-theme-lg enabled-hover:shadow-theme-lg
 *   POST merged: btn focus:outline-hidden focus-visible:ring-2 focus-visible:ring-focus-ring focus-visible:ring-offset-2 min-h-11 shadow-theme-lg enabled-hover:shadow-theme-lg
 * THE MERGED DELTA IS THE POINT, and it is a MEASUREMENT, not a prediction: the base's hover token
 * no longer survives the merge, because it is now in the SAME variant scope as the caller's pin and
 * `tailwind-merge` de-dupes the pair. That is exactly the property UI-SPEC §3.4 rule 2 requires
 * (amended 2026-09-09, D10/D42) and the reason a bare `hover:` on the pin side is rejected: before
 * this plan the two tokens were in different scopes and BOTH survived, so a call site pinning
 * `shadow-theme-lg` still shrank to `md` on hover.
 */
const BUTTON_CVA_BASE =
  'btn shadow-theme-sm enabled-hover:shadow-theme-md focus:outline-hidden focus-visible:ring-2 focus-visible:ring-focus-ring focus-visible:ring-offset-2 min-h-11';

/**
 * SOURCE (RE-SEEDED — see below): `src/components/ui/Button.tsx:104-106`, the `cva` VARIANT map.
 *
 * WAS: `src/app/components/Modal.tsx:322` (`const ACTION_CLASS`), emitted by `ModalAction` as
 * `cn('btn', ACTION_CLASS[variant], className)` at `Modal.tsx:346`.
 *
 * RE-SEEDED Phase 88.6-37 (R6, owner ruling 2026-09-16), and this one is a STALE CITE AND A STALE
 * NAME, not a wrong expectation — the distinction matters, so it is spelled out.
 *
 * WHAT HAPPENED. Plan 88.6-08 (D-08) made `Modal.Action` render the `Button` primitive and RETIRED
 * `ACTION_CLASS` outright — the file's own `DECISION Phase 88.6-08` marker at `Modal.tsx:364-383`
 * spells the retired name for exactly this kind of search. Both constructs this literal cited were
 * gone, and because both sides of the comparison were frozen the assertion stayed GREEN while no
 * longer describing any shipped emitter. Plan 08 measured this, could not fix it (its own
 * acceptance criterion forbade a third suite in its diff, and no plan in the phase DECLARED this
 * file), and routed it to the owner; R6 is the ruling that authorised the re-seed here.
 *
 * WHY THE VALUES DID NOT MOVE. Plan 08's marker records that `Button`'s variant names were aligned
 * with `ModalActionVariant` "so the later adoption plans are a mechanical swap": the three entries
 * matched 1:1, byte-identically. Re-read from `Button.tsx:104-106` at this commit — `primary:
 * 'btn-primary'`, `secondary: 'btn-secondary'`, `danger: 'btn-danger'` — the map is unchanged. So
 * there is NO merge finding here; what was wrong was which source the literal claimed to track.
 *
 * TRANSCRIPTION IS STILL THE ROUTE, deliberately. `buttonVariants` IS exported
 * (`Button.tsx:287`), but plan 01's `DECISION Phase 88.6-01 (W33)` in the header above chose a
 * frozen literal over importing it, and that decision is UNCHANGED by this re-seed: importing the
 * live symbol would make this gate assert a tautology (source compared against itself) instead of
 * a transcription that can drift and be caught.
 *
 * RE-DERIVE NOTE: a later plan renaming any token inside this literal OWNS re-deriving it from
 * `Button.tsx:104-106` at that time and recording both strings in its own summary.
 */
const BUTTON_VARIANT_CLASS = {
  primary: 'btn-primary',
  secondary: 'btn-secondary',
  danger: 'btn-danger',
} as const;

/**
 * SOURCE: the option-row class list inside `src/components/ui/Combobox.tsx:276-283` (within the
 * `:276-320` range this plan cites), in its ACTIVE, non-disabled state.
 *
 * Transcription is the only route: `Combobox.tsx:362` exports only `{ Combobox }`.
 *
 * RE-DERIVE NOTE — LIVE INSTANCE: this literal contained `bg-surface-card-hover`
 * (`Combobox.tsx:281`), and **plan 02 (wave 2) renamed `bg-surface-card-hover` ->
 * `bg-surface-muted`** — a set that did NOT include this test file, so plan 02 OWNED re-deriving
 * this literal from `Combobox.tsx`. Do NOT close that coupling by deleting the `Combobox` literal
 * or narrowing the range: transcription is the only route available for this primitive.
 *
 * RE-SEEDED Phase 88.6-02 (D-15), 2026-09-15 — this is the owned re-derive, not a finding. The
 * literal above was re-read from the POST-rename `Combobox.tsx:281` and the expectation at the
 * `Combobox` assertion below moved with it. Both strings, measured by running this suite:
 *   PRE : flex min-h-11 w-full cursor-pointer items-center py-2 text-base bg-surface-card-hover px-4 text-content-secondary
 *   POST: flex min-h-11 w-full cursor-pointer items-center py-2 text-base bg-surface-muted px-4 text-content-secondary
 * The ONLY delta is the token's spelling: every other class, and the merged ORDER, is
 * byte-identical — so `tailwind-merge` resolves the renamed token exactly as it resolved the old
 * one. This was NOT a `tailwind-merge` stop-rule fork (plan 01 pre-classified it: a diff that
 * follows a same-phase edit to a transcribed source is a RE-SEED owned by the plan that made the
 * edit). Red-then-green: with the literal moved and the expectation stale the suite ran
 * 1 failed / 13 passed, exit 1; with the expectation re-derived, 14/14 passed, exit 0.
 */
const COMBOBOX_OPTION_ROW_ACTIVE = cn(
  'flex min-h-11 w-full cursor-pointer items-center px-3 py-2',
  'text-base text-content-primary',
  'bg-surface-muted'
);

// ---------------------------------------------------------------------------
// 1. Primitive merges — cva base vs. a representative caller `className`
// ---------------------------------------------------------------------------

describe('primitive merges are byte-identical across the tailwind-merge bump', () => {
  it('Button: cva base + the UI-SPEC §3.4 rule 2 CTA override', () => {
    // The caller half is the exact shape UI-SPEC §3.4 rule 2 requires at the
    // `groupHomePage/page.js` CTAs, as amended 2026-09-09 by review findings D10/D42:
    // a bare `hover:` on the pin side is REJECTED because it does not de-dupe against
    // the base's `enabled-hover:` token.
    expect(
      cn(BUTTON_CVA_BASE, 'shadow-theme-lg enabled-hover:shadow-theme-lg')
    ).toBe(
      'btn focus:outline-hidden focus-visible:ring-2 focus-visible:ring-focus-ring focus-visible:ring-offset-2 min-h-11 shadow-theme-lg enabled-hover:shadow-theme-lg'
    );
  });

  it('Modal: ModalAction emits Button, i.e. cn(buttonVariants({variant,size}), className)', () => {
    // RE-SEEDED Phase 88.6-37 (R6). The modelled emitter moved with plan 08's swap: it is now
    // `Button.tsx:278`'s `cn(buttonVariants({ variant, size }), className)`, with cva defaults
    // `variant: 'primary'`, `size: 'default'` (`Button.tsx:255`; the `default` size rung is the
    // empty string, `:103`). The caller half is unchanged from the seeded shape.
    //   PRE  (emitter `cn('btn', ACTION_CLASS.primary, className)`, retired by plan 08):
    //     btn btn-primary btn-secondary w-full
    //   POST (emitter `cn(buttonVariants({variant,size}), className)`):
    //     btn shadow-theme-sm enabled-hover:shadow-theme-md focus:outline-hidden focus-visible:ring-2 focus-visible:ring-focus-ring focus-visible:ring-offset-2 min-h-11 btn-primary btn-secondary w-full
    // THE DELTA IS THE POINT AND IT IS A MEASUREMENT, not a prediction: a Modal footer action
    // now carries the WHOLE Button base — the elevation pair, the focus ring, and `min-h-11` —
    // where it used to carry the bare `.btn`. Those are precisely the V-1 / V-2 sanctioned
    // deltas plan 08's `DECISION Phase 88.6-08 (D-08)` marker enumerates for its 14 call sites,
    // so this literal now measures them instead of describing a retired emitter. The two
    // `.btn-*` classes still BOTH survive, in source order: they are project CSS classes
    // `tailwind-merge` does not know, under either major.
    expect(
      cn(BUTTON_CVA_BASE, BUTTON_VARIANT_CLASS.primary, 'btn-secondary w-full')
    ).toBe(
      'btn shadow-theme-sm enabled-hover:shadow-theme-md focus:outline-hidden focus-visible:ring-2 focus-visible:ring-focus-ring focus-visible:ring-offset-2 min-h-11 btn-primary btn-secondary w-full'
    );
  });

  it('BottomSheet: the surface class list + HEIGHT_CLASS + a caller override', () => {
    // RE-SEEDED Phase 88.6-37 (task 3's D49-b snap). The transcribed surface literal's
    // `shadow-lg` is now `shadow-theme-lg` — re-read from `BottomSheet.tsx:238` at this
    // commit, not predicted.
    expect(
      cn(
        'fixed inset-x-0 bottom-0 z-50 flex w-full flex-col overflow-hidden rounded-t-[12px] border-t border-line bg-surface-card shadow-theme-lg',
        HEIGHT_CLASS.content,
        'max-h-[50dvh] bg-surface-page'
      )
    ).toBe(
      //   PRE : … border-t border-line shadow-lg max-h-[50dvh] bg-surface-page
      //   POST: … border-t border-line shadow-theme-lg max-h-[50dvh] bg-surface-page
      // The ONLY delta is the shadow token's spelling. Every other class, and the merged
      // ORDER, is byte-identical — the caller's `bg-surface-page` still beats the surface's
      // `bg-surface-card` and its `max-h-[50dvh]` still beats `HEIGHT_CLASS.content`. So
      // `tailwind-merge` resolves the theme-tier token exactly as it resolved the alias, and
      // this is a RE-SEED owned by the plan that made the edit, not a resolver finding.
      'fixed inset-x-0 bottom-0 z-50 flex w-full flex-col overflow-hidden rounded-t-[12px] border-t border-line shadow-theme-lg max-h-[50dvh] bg-surface-page'
    );
  });

  it('Combobox: the active option row + a caller override', () => {
    expect(cn(COMBOBOX_OPTION_ROW_ACTIVE, 'px-4 text-content-secondary')).toBe(
      'flex min-h-11 w-full cursor-pointer items-center py-2 text-base bg-surface-muted px-4 text-content-secondary'
    );
  });

  it('Input: controlClass + a caller override', () => {
    expect(cn(controlClass, 'pr-11 rounded-card')).toBe(
      'block w-full p-2 max-md:min-h-11 rounded-btn border border-input bg-surface-input text-base text-content-primary focus:outline-hidden focus-visible:border-line-strong focus-visible:ring-2 focus-visible:ring-focus-ring pr-11 rounded-card'
    );
  });
});

// ---------------------------------------------------------------------------
// 2. Pairwise de-dupe on the repo's custom-named token families
//    (v3 breaking change #2's blast radius)
// ---------------------------------------------------------------------------

describe('the custom-named token families de-dupe pairwise, last-wins', () => {
  it('shadow-theme-sm / shadow-theme-md', () => {
    expect(cn('shadow-theme-sm', 'shadow-theme-md')).toBe('shadow-theme-md');
  });

  it('bg-surface-card / bg-surface-page', () => {
    // Deliberately NOT `bg-surface-card-hover`: both spellings in this pair survive the
    // whole phase, so this line carries no cross-wave coupling to plan 02's rename.
    // (That token is spelled `bg-surface-muted` since 88.6-02 (D-15); the old spelling is kept
    // quoted here because it is what the choice recorded above was made against. Still true:
    // neither class in THIS pair is touched by any rename in this phase.)
    expect(cn('bg-surface-card', 'bg-surface-page')).toBe('bg-surface-page');
  });

  it('text-content-secondary / text-content-primary', () => {
    expect(cn('text-content-secondary', 'text-content-primary')).toBe(
      'text-content-primary'
    );
  });

  it('min-h-11 / min-h-0', () => {
    expect(cn('min-h-11', 'min-h-0')).toBe('min-h-0');
  });

  it('min-w-11 / min-w-0 — the WIDTH axis of the two-axis icon floor', () => {
    // At seeding time `Button.tsx:94` read `icon: 'min-h-11 min-w-11 p-0'`; the `min-w` half is
    // what floors `size="icon"` in WIDTH. RE-DERIVED 2026-09-15: plan 06 landed and the rung is
    // now `icon: 'min-h-11 min-w-11'` (`Button.tsx:246`) — the zero-padding utility was dead
    // (`.btn` is unlayered) and was deleted, so the shipped control is a lozenge, not a square;
    // that is the PRESERVED look, per the `DECISION Phase 88.6-06 (C.1 / D-09)` marker.
    // Seeding only the `min-h-*` axis would leave the width axis
    // unmeasured in the one plan whose entire purpose is a measured before/after.
    // No regression is predicted — this is coverage of the measurement.
    expect(cn('min-w-11', 'min-w-0')).toBe('min-w-0');
  });

  it('rounded-btn / rounded-card — the family that does NOT de-dupe', () => {
    // MEASURED, not intended: on 2.6.1 BOTH classes survive and CSS source order decides.
    // The seeded value below is therefore a TWO-CLASS string. Do NOT "correct" it to a
    // single class. Consequence carried into the phase: no later plan may rely on a
    // call-site `rounded-*` beating a cva-base one through `cn()`.
    expect(cn('rounded-btn', 'rounded-card')).toBe('rounded-btn rounded-card');
  });

  it('focus-visible:ring-focus-ring / focus-visible:ring-transparent', () => {
    expect(
      cn('focus-visible:ring-focus-ring', 'focus-visible:ring-transparent')
    ).toBe('focus-visible:ring-transparent');
  });
});

// ---------------------------------------------------------------------------
// 3. Variant-prefix forms a naive prefix stripper cannot see
// ---------------------------------------------------------------------------

describe('bracketed variant prefixes', () => {
  it('data-[state=open]: de-dupes within its own variant scope only', () => {
    // `dialog.tsx:75` ships `data-[state=open]:bg-surface-hover`.
    expect(
      cn(
        'bg-surface-card data-[state=open]:bg-surface-hover',
        'data-[state=open]:bg-surface-page'
      )
    ).toBe('bg-surface-card data-[state=open]:bg-surface-page');
  });

  it('a bare utility does not beat its data-variant counterpart', () => {
    expect(
      cn('data-[state=open]:text-muted-foreground', 'text-content-primary')
    ).toBe('data-[state=open]:text-muted-foreground text-content-primary');
  });
});
