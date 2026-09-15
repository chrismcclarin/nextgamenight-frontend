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
 * SOURCE: `src/app/components/Modal.tsx:322` (`const ACTION_CLASS`), emitted by `ModalAction` as
 * `cn('btn', ACTION_CLASS[variant], className)` at `Modal.tsx:346`.
 *
 * Transcription is the ONLY route here: `ACTION_CLASS` is a module-private `const` and this plan
 * declares neither `Modal.tsx` nor `Combobox.tsx`, so it does NOT add exports to them (an edit lands
 * only in a file its plan declares).
 *
 * RE-DERIVE NOTE: a later plan renaming any token inside this literal OWNS re-deriving it from
 * `Modal.tsx:322` at that time and recording both strings in its own summary.
 */
const MODAL_ACTION_CLASS = {
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

  it('Modal: ModalAction emits cn("btn", ACTION_CLASS[variant], className)', () => {
    expect(cn('btn', MODAL_ACTION_CLASS.primary, 'btn-secondary w-full')).toBe(
      'btn btn-primary btn-secondary w-full'
    );
  });

  it('BottomSheet: the surface class list + HEIGHT_CLASS + a caller override', () => {
    expect(
      cn(
        'fixed inset-x-0 bottom-0 z-50 flex w-full flex-col overflow-hidden rounded-t-[12px] border-t border-line bg-surface-card shadow-lg',
        HEIGHT_CLASS.content,
        'max-h-[50dvh] bg-surface-page'
      )
    ).toBe(
      'fixed inset-x-0 bottom-0 z-50 flex w-full flex-col overflow-hidden rounded-t-[12px] border-t border-line shadow-lg max-h-[50dvh] bg-surface-page'
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
