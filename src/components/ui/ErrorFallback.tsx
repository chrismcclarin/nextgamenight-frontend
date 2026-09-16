'use client';

/**
 * ErrorFallback — the ONE error look (Req 3 / D-20).
 *
 * Extracted verbatim from `AppErrorBoundary`'s shipped fallback JSX so the 8 route
 * `error.tsx` files plus the root boundary render the same, already-designed screen
 * (plan 88-09) instead of nine hand-rolled variants.
 *
 * SECURITY (T-88-04-01 / ASVS V7): this component renders **designed copy only**. It
 * takes no `error`, and it must never be given one — no `error.message`, no
 * `error.digest`, no stack trace and no backend message may reach the DOM here. A
 * thrown error's detail goes to Sentry at the boundary (`global-error.tsx` and
 * `AppErrorBoundary` already model that), never to the user.
 *
 * What it deliberately does NOT do:
 * - **It does not own the reset-loop counter.** `AppErrorBoundary` holds
 *   `resetAttempts` ABOVE the boundary on purpose, so the count survives a reset;
 *   the primitive only receives the already-computed `loopGuardTripped`.
 * - **It does not use the `Button` primitive.** See the DECISION marker below.
 * - **It does not replace `global-error.tsx`.** That boundary replaces
 *   `<html>`/`<body>` and renders with no shell, theme or fonts, so it stays
 *   deliberately inline-styled.
 */
import * as React from 'react';

import { Heading } from './Heading';

export interface ErrorFallbackProps {
  /** Retry handler (a boundary's `reset`/`resetError`). Omit to render no retry. */
  onRetry?: () => void;
  /** Reload handler. Defaults to a full page reload. */
  onReload?: () => void;
  /** Caller-computed: the same error keeps re-throwing, so hide retry. */
  loopGuardTripped?: boolean;
  /** Designed heading. NEVER an error message. */
  title?: string;
  /** Designed body. NEVER an error message, digest or stack. */
  body?: React.ReactNode;
}

/* DECISION Phase 88-04 (D-20): the two affordances stay as raw <button>s carrying the SHIPPED
   utility classes, chosen OVER swapping them for the new `Button` primitive (88-02) — which is
   exactly the "consistency cleanup" a later reader will reach for. D-20's contract is "one error
   look, already designed and shipped": this JSX is what production renders today, and 88-09 fans
   it out to 9 boundaries. Converting to `Button` here would fold in `.btn`'s geometry, the phone
   44px floor and a different ring token in the same change that is supposed to be a pure
   extraction, making any visual regression across those 9 surfaces unattributable. Converging
   onto `Button` is a decision for an adoption plan, not a cleanup for this file.

   ONE thing WAS changed during the extraction, deliberately: both `border-strong` classes became
   `border-line-strong`. There is no `--color-strong` token (the bridge
   declares `--color-line-strong`), so `border-strong` emitted nothing and the borders were being
   painted by the base-layer shim, which is not theme-aware — a near-white hairline in dark mode.
   Fixing it at extraction is what stops the defect shipping x8. */

const ErrorFallback = React.forwardRef<HTMLDivElement, ErrorFallbackProps>(
  (
    {
      onRetry,
      onReload,
      loopGuardTripped = false,
      title = 'Something went wrong',
      body,
    },
    ref
  ) => {
    const showRetry = Boolean(onRetry) && !loopGuardTripped;
    const handleReload = onReload ?? (() => window.location.reload());

    return (
      <div
        ref={ref}
        role="alert"
        aria-live="assertive"
        className="flex min-h-screen items-center justify-center bg-surface-page px-4"
      >
        {/* DECISION Phase 88.6-36 (D49-b, owner ruling 2026-09-09 option i): the card's
            elevation is the PROJECT tier (`shadow-theme-lg`), chosen OVER the alias-spelled
            built-in utility this shipped with. It is a VALUE change, not a rename: Tailwind v4
            INLINES its built-in scale's literals into the built-in utilities instead of reading
            the theme property (`DECISION Phase 87.7` in `globals.css`), so the alias painted
            `0 10px 15px -3px rgb(0 0 0 / 0.1), 0 4px 6px -4px rgb(0 0 0 / 0.1)` — a cold black
            drop shadow, identical in both themes. The theme tier resolves `var(--shadow-lg)`:
            a warm single-layer `0 10px 15px rgba(120, 80, 40, 0.10)` in light and a
            `0 0 0 1px var(--purple-600), 0 0 20px rgba(168, 85, 247, 0.05)` hairline-plus-glow
            in dark. The dark value is NOT `none` — only the `sm` rung is — so re-spelling this
            back to `shadow-lg` on the grounds that "the dark shadow disappears" is a decision
            made on a wrong reading. This is a surface, not a `.btn`: there is no hover pin. */}
        <div className="w-full max-w-md rounded-card border border-line-strong bg-surface-card p-8 text-center shadow-theme-lg">
          {/* DECISION Phase 88-29 (DEF-88-19-03, §4.2): `font-bold` (700), chosen OVER
              leaving the shipped `font-semibold` (600). §4.2 scopes 600 to the Button
              primitive and states it appears nowhere else in this phase's work, so a
              20px/600 heading is a stated prohibition — and this is the one place it
              survived, in a primitive THIS phase created and 88-09 then fanned out to
              nine error boundaries. It was never a recorded exemption: the file's
              `DECISION Phase 88-04 (D-20)` marker justifies keeping the two BUTTONS as
              raw `<button>`s and says nothing about the heading's weight. It was an
              unnoticed carry-over from the pre-phase JSX.

              Fixed here, and not deferred to 88-31's residual census, because 88-29 arms
              the phase's drift gates: a type gate that armed green over a §4.2 violation
              inside a phase-created primitive would be exactly the vacuous gate this plan
              exists to stop shipping. `typeScaleTouchedSurfaces.test.ts` now scans this
              file as a fifth surface, so 600 cannot come back here quietly.

              APPENDED — DECISION Phase 88.6-36 (D-05): the element is now
              `<Heading level={1} size="heading">`. `level={1}` and `size="heading"` are the two
              INDEPENDENT facts this file has been the shipped precedent for since 88-04 —
              `<h1>` for the document OUTLINE, 20px for the type ROLE — and the primitive is
              where that split now lives. **`size="display"` is the REJECTED alternative, and it
              is the one a later consistency pass will reach for:** `typeScaleTouchedSurfaces.test.ts`'s
              Display assertion is scoped to `PAGE_SURFACES` precisely so this primitive is
              outside it, and growing this to 30 would demote nine error boundaries' type in
              reverse. `ErrorFallback.test.tsx` pins `text-xl` AND pins the absence of
              `text-3xl`. The weight now comes from `Heading`'s cva base rather than from this
              className; the 600-can't-come-back guarantee above is unaffected, because the
              base is `font-bold`. */}
          <Heading level={1} size="heading" className="text-content-primary">
            {title}
          </Heading>
          <p className="mt-2 text-base text-content-secondary">
            {body ?? (
              <>
                An unexpected error interrupted the page.{' '}
                {loopGuardTripped
                  ? 'The problem is still happening — please reload the page.'
                  : 'You can try again, or reload the page.'}
              </>
            )}
          </p>
          {/* DECISION Phase 88.6-36 (D-03 / UI-SPEC §4.5): both affordances drop `font-medium`
              to 400 and KEEP `text-sm`, chosen OVER 700. §4.5 allows 400 or 700 outside `Button`
              and §4.1 puts the 14px control-label rung here, so the size is already right; the
              weight is the §4.5 EMPHASIS outcome, and each control already carries its own
              colour token (`text-primary-foreground` on a filled ground, `text-content-primary`
              on the card) — the weight was never the only cue on either.
              CORRECTION OF THE ROSTER'S STATED REASON, recorded rather than silently absorbed:
              `typeScaleTouchedSurfaces.test.ts`'s entry for this file led with "dead on a .btn
              (delete)". These are NOT `.btn` elements and never were — the
              `DECISION Phase 88-04 (D-20)` marker above deliberately keeps them raw `<button>`s
              carrying shipped utility classes, so the weight was LIVE, not dead. The outcome is
              the same deletion; the reason is different, and a future reader re-deriving "it was
              dead anyway" from that entry would be re-deriving a false fact. The visible delta
              (500 -> 400 on nine error boundaries) is UI-SPEC §1.2 row V-6, which already covers
              it — no new V-number is minted. Converging these onto `Button` is still D-20's
              rejected cleanup and this change does not reopen it. */}
          <div className="mt-6 flex flex-col gap-3 sm:flex-row sm:justify-center">
            {showRetry && (
              <button
                type="button"
                onClick={onRetry}
                className="inline-flex items-center justify-center rounded-btn bg-primary px-5 py-2.5 text-sm text-primary-foreground transition-colors hover:opacity-90 focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
              >
                Try again
              </button>
            )}
            <button
              type="button"
              onClick={handleReload}
              className="inline-flex items-center justify-center rounded-btn border border-line-strong bg-surface-card px-5 py-2.5 text-sm text-content-primary transition-colors hover:bg-surface-hover focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
            >
              Reload page
            </button>
          </div>
        </div>
      </div>
    );
  }
);

ErrorFallback.displayName = 'ErrorFallback';

export { ErrorFallback };
