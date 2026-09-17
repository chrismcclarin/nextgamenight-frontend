'use client';
import { useState, useEffect, useRef } from 'react';
import { usePathname } from 'next/navigation';
import { useUser } from '@auth0/nextjs-auth0/client';
import * as Sentry from '@sentry/nextjs';
import { feedbackAPI } from '../../lib/api';
import { scrubFeedbackPageUrl } from '../../lib/scrubFeedbackPageUrl';
import { useFeedbackModal, CATEGORIES, getCategoryLabel } from './FeedbackModalProvider';
import { Modal } from './Modal';
import { Button } from '../../components/ui/Button';
import { Textarea, SelectControl } from '@/components/ui/Input';
import { getFetchErrorMessage } from '../../components/ui/useFetchErrorState';

/**
 * Feedback entry points + modal (MOB-04, Plan 87.8-05, D-09).
 *
 * Two variants of the SAME component, sharing one FeedbackModalProvider:
 *   - `floating` (default, mounted at layout.js): the desktop FAB trigger AND
 *     the single modal instance. The modal renders here — at the layout root —
 *     at every viewport, even when the FAB itself is hidden below `md`.
 *   - `row` (mounted in Header's mobile dropdown): renders ONLY a full-width
 *     trigger row. No modal, no fixed positioning — a fixed-position overlay
 *     inside the translate-carrying dropdown would resolve `inset: 0` against
 *     the dropdown, not the viewport (RESEARCH Pitfall 1).
 *
 * The open/close transition (isOpen, pathname-derived category, focus
 * restoration) lives in FeedbackModalProvider; `text`/`error`/`submitted`
 * stay LOCAL here so keystrokes never re-render context consumers.
 */
export default function FeedbackButton({ variant = 'floating', label, onOpen, invokerRef = null }) {
  const { user } = useUser();
  const pathname = usePathname();
  const { isOpen, category, open, close, onCloseAutoFocus, setCategory } = useFeedbackModal();

  // Form state stays LOCAL to the modal-owning instance (never in context) so
  // typing in the textarea re-renders only this instance, not Header.
  const [text, setText] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const [error, setError] = useState(null);

  // DECISION Phase 88-17 (Req 9): the hand-rolled document-level Escape listener
  // that used to live here is REMOVED, not kept alongside <Modal>. Radix's
  // dialog owns Esc, and a second listener would call close() twice per press —
  // harmless today only because close() is idempotent. Re-adding a keydown
  // listener for this modal is a decision, not a cleanup.

  // Reset local form state on the provider's open TRANSITION (isOpen becoming
  // true). Both entry points (FAB and nav row) call the same provider open(),
  // so both produce the identical reset — same pathname-derived category (set
  // by the provider in the same transition), empty text, no error, not
  // submitted. Neither entry point performs its own ad hoc reset.
  useEffect(() => {
    if (variant === 'row' || !isOpen) return;
    setText('');
    setError(null);
    setSubmitted(false);
  }, [variant, isOpen]);

  /* R2 #34, fixed Phase 88.6-31: the success panel's 2s timer is HELD IN A REF and cleared on
     unmount — the treatment its sibling `FeedbackForm.js` has carried since round 6 #6, applied
     here for the same reason and one worse one. The timer called the SHARED provider `close()`
     off `useFeedbackModal()`, with no ref and no cleanup, and this component has TWO mount sites
     (`src/app/layout.js` and `src/app/Header.js`), so an uncleared handle fired into an unmounted
     component and shut a dialog the provider already believed closed. Any prior handle is cleared
     BEFORE arming, so a double-submit cannot leave two live timers on one slot. */
  const successTimerRef = useRef(null);
  useEffect(
    () => () => {
      if (successTimerRef.current) clearTimeout(successTimerRef.current);
    },
    []
  );

  // Auth guard: invisible when not logged in. Precedes the variant switch so
  // the row branch is unreachable for a logged-out visitor — Footer.js:11-12
  // records the deliberate auth-only scoping of the sibling entry point, and
  // exposing a "Send feedback" row to anonymous visitors would be an exposure
  // change, not a layout change (T-87.8-16, ASVS V2).
  if (!user) return null;

  // Row variant (D-09): the mobile nav menu trigger. Renders ONLY the row —
  // the modal deliberately does NOT render here (see module comment).
  if (variant === 'row') {
    return (
      <button
        onClick={(e) => {
          // DECISION Phase 88.3-17 (DEF-88.3-12-01, owner ruling 6, 2026-08-27):
          // the row hands the provider an INVOKER OVERRIDE (`invokerRef`, which
          // Header points at its hamburger `triggerRef`) instead of restoring
          // focus to itself — chosen OVER two alternatives that were both
          // defensible, and both rejected on the record.
          //
          // The mechanism, MEASURED not inferred: `onOpen()` below closes the
          // mobile menu in the SAME transition that opens the modal, and plan
          // 07's R3-D put `inert` on the closed panel (`Header.js`). This row
          // lives inside that panel. An element in an `inert` subtree cannot
          // take focus — probed live in this repo's Chromium: `el.focus()` on a
          // button inside a plain <div> leaves `document.activeElement === el`
          // true; the identical button inside `<div inert="">` leaves it false.
          // So by the time the modal closes and the provider restores, the row
          // is unfocusable. `e2e/feedback-stacking.spec.ts` was deterministically
          // red on CI for exactly this, and it blocked the phase's FE merge.
          //
          // REJECTED — re-open the menu on restore: it resurfaces a menu the
          // user deliberately closed, and re-entering the animated panel is the
          // Tab-order problem R3-D was added to fix in the first place.
          // REJECTED — un-inert for the duration of the restore: it makes R3-D
          // conditional on an unrelated modal's lifecycle, which is exactly the
          // kind of coupling that breaks silently two phases later.
          //
          // The hamburger toggle is the conventional landing for focus when a
          // menu-launched dialog closes, and `Header.js`'s own menu-close effect
          // ALREADY sends focus there — so this makes the two paths agree rather
          // than inventing a third. The FAB below passes no override and falls
          // through to `e.currentTarget`, so the desktop path is unchanged by
          // construction. Pointing this back at the row is a decision, not a
          // cleanup: it re-reds the e2e spec.
          open(invokerRef?.current ?? e.currentTarget);
          // Close the mobile dropdown in the SAME transition (Header passes
          // its setMobileMenuOpen(false) here, the same close-on-tap idiom
          // the nav links use at Header.js:185,193).
          if (onOpen) onOpen();
        }}
        // Class string copied from ThemeToggle.js:32 with ONE change:
        // active:opacity-75 (the Plan 87.8-01 press idiom) instead of the
        // old bg-surface-card-hover token-swap press state — plan 08 converged
        // the two remaining token-swap sites; do not reintroduce the old idiom.
        // AMENDED Phase 88.6-02 (D-15): that retired token is now spelled
        // `bg-surface-muted`. The spelling above is left as the history of the
        // idiom that was REMOVED — the prohibition is unchanged either way.
        // DECISION Phase 88.3 (§10.1): the hover moved to `bg-surface-header-hover`,
        // NOT the `bg-surface-hover` the other 38 swept sites took — this row renders on
        // the dark header panel under `text-white` (1.06:1 on warm-50 vs 10.48:1 on
        // warm-700). ThemeToggle.js:32 moved identically, so the "copied from
        // ThemeToggle.js with ONE change" note above still holds. Full reasoning at
        // NotificationBell.js's marker; pinned by name in `surfaceHoverSweep.test.ts`
        // test 4b. Converging it is a decision, not a cleanup.
        // Focus ring matches the FAB this row replaces (same tokens), so
        // keyboard/switch users get the same visible affordance from either
        // entry point; inset (no ring-offset) because the row is a full-bleed
        // menu row where an offset ring would clip against siblings.
        className="w-full text-left flex items-center gap-3 px-4 py-3 text-white text-sm hover:bg-surface-header-hover active:opacity-75 transition-colors focus:outline-hidden focus-visible:ring-2 focus-visible:ring-focus-ring focus-visible:ring-inset"
        aria-label="Send feedback"
      >
        <svg
          xmlns="http://www.w3.org/2000/svg"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth={2}
          strokeLinecap="round"
          strokeLinejoin="round"
          className="w-5 h-5"
          aria-hidden="true"
        >
          <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
        </svg>
        {/* Phase 88.3 (Req 8 / §5.9.2): `text-content-muted` dropped — inherits the row's
            `text-white`. Full DECISION marker at `NotificationBell.js`'s row label. */}
        <span className="flex-1">{label || 'Send feedback'}</span>
      </button>
    );
  }

  const handleSubmit = async (e) => {
    e.preventDefault();

    if (text.trim().length < 10) {
      setError('Feedback must be at least 10 characters.');
      return;
    }

    try {
      setSubmitting(true);
      setError(null);

      await feedbackAPI.submitGitHubFeedback({
        category,
        text: text.trim(),
        // Plan 87.8-05 Task 4 (round-3 security): NEVER the full href — the
        // five token-bearing routes carry a live credential in the PATH
        // segment, and the RSVP query string carries an Auth0 sub. The
        // pathname is scrubbed at the source (and again server-side as
        // defence-in-depth); window.location.search is never appended.
        pageUrl: scrubFeedbackPageUrl(pathname),
        userName: user.name || user.nickname || 'Unknown',
        /* DECISION Phase 88.8 (plan 13 Task 3(c), SPEC R12): the `userEmail`
           field is DROPPED from this body entirely and the server derives it —
           chosen OVER fixing its VALUE. The defect originates in a client
           asserting an identity the server already owns, on a route that is
           already behind the auth gate; `88.8-09-PLAN.md` Task 4 derives
           `user_email` server-side from `Users.email`, which is correct by
           construction and strictly better than any client value.

           REJECTED, all three:
           (i)  adding `useSelfIdentity()` here. CORRECTED round 3 #19: an earlier
                version of this note rejected it as making the hook's 410-redirect
                side effect "fire app-wide" — but it ALREADY does: `layout.js:44`
                mounts `TimezoneProvider`, which calls `useSelfIdentity()`
                unconditionally (`TimezoneProvider.js:54`) around this very button.
                The true ground is the one above: the route is behind the auth
                gate and the SERVER owns the identity; a client must not assert
                an address the server can derive. Rejected on that ground alone.
           (ii) reading the cached row non-reactively with `getQueryData` — no
                fetch and no side effect. Rejected for the SAME ground as (i), not
                the one an earlier version gave ("yields nothing on a page that
                never resolved the row" — false for the same reason: the app-root
                provider resolves it on every page).
           (iii) keeping the session email — the stale value this task exists to
                remove: after an address change it is the address the user just
                moved away from.

           `userName` above is DELIBERATELY KEPT: it is a display name, not a
           contact handle, and nothing downstream tries to reach anyone at it.
           Re-adding an address field here is a decision, not a cleanup. */
        label: getCategoryLabel(category),
        userAgent: navigator.userAgent,
      });

      setSubmitted(true);
      if (successTimerRef.current) clearTimeout(successTimerRef.current);
      successTimerRef.current = setTimeout(() => {
        setSubmitted(false);
        setText('');
        close();
      }, 2000);
    } catch (err) {
      /* REPORTED, not stdout-only (Phase 88.6-31, AC-16 option (a) + AC-2 WIDENED, owner rulings
         2026-09-09). This path had NO Sentry capture while its sibling `FeedbackForm.js` did, so
         a broken GitHub-feedback writer was invisible to the owner — the half-applied round-7 #6
         fix. The `console.error` that stood here is REPLACED by this capture rather than
         respelled to `logger.error`: one escalation per failure path, and `logger.error` takes
         only `(msg, err)` and forwards `extra: { msg }` (`logger.ts:20`, `:28-30`) — it has NO
         tags channel, so it could not carry the `channel` discriminator below, and it forwards
         the error object whose `.message` is the backend's extracted string. This file gains a
         `Sentry` import and NO `logger` import.

         CLASS-ONLY, matching `FeedbackForm.js`'s shape and its stated PII posture — a synthesized
         Error naming the error CLASS and, when present, `err.code`. Never the raw error object,
         never `err.message`, never a request-body field. That matters MORE here, not less: this
         body carries `userName` and `navigator.userAgent`, and a scrubbed `pageUrl`. None of the
         three is in this payload.

         DECISION Phase 88.6-31 (review finding #83): EVERY TAG VALUE IS A COMPILE-TIME SOURCE
         LITERAL — no variable, no interpolation, no error-derived text. `scrubEvent`
         (`sentry.scrub.js`, `function scrubEvent(event)`) walks `event.message`,
         `event.exception`, `event.breadcrumbs`, `event.user`, `event.request`, `event.extra` and
         `event.contexts` and NEVER `event.tags` (`grep -c 'tags' sentry.scrub.js` -> 0, measured
         2026-09-16), while Sentry INDEXES tags — so a dynamic tag value would bypass the entire
         T-84-01 scrub layer. `channel: 'github'` names THIS writer, the auth-gated
         `apiFetch('/feedback/github')`, against `FeedbackForm.js`'s `channel: 'public'`
         (`publicFetch('/feedback')`); identical tags would leave a Sentry issue ambiguous about
         which of the two feedback paths is broken, which is half the point of adding it. */
      const cls = (err && err.name) || 'Error';
      const code = err && typeof err.code === 'string' ? ` ${err.code}` : '';
      Sentry.captureException(new Error(`feedback submit failed: ${cls}${code}`), {
        tags: { feature: 'feedback', op: 'submit', channel: 'github' },
      });
      // SPEC R1: the raw `error.message ||` read is gone. Called with NO `fallback`, so the
      // CLOSED ratified register answers and no copy is authored (P1).
      setError(getFetchErrorMessage(err));
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <>
      {/* DECISION Phase 87.8 DEC-2: the below-`md` visibility toggle lives on
          this bare, unstyled wrapper div — chosen OVER converting `.btn` to
          `@utility` (that changes cascade behaviour across ~210 call sites
          mid-phase; deferred to Phase 88 via DEF-1) and OVER a
          useMediaQuery-gated conditional mount (Next.js hydration-mismatch
          risk on first client render). `.btn` is UNLAYERED in globals.css and
          an unlayered declaration beats any layered Tailwind utility, so
          `hidden`/`md:flex` placed directly on the `btn btn-primary` button
          element would be INERT (the button would keep computing
          display: inline-flex). A wrapper with no `btn` class carries no
          unlayered declaration for the layered `hidden` utility to fight, so
          the toggle behaves as written with no new one-off unlayered rule.
          The wrapper encloses ONLY the button — the modal below stays an
          independently-toggleable sibling, mounted at every viewport, or the
          phone nav row would open a display:none modal. */}
      <div className="hidden md:block">
        {/* Floating feedback button.
            DECISION Phase 87.8 (D-09/D-10): `z-30` chosen OVER raising the
            overlays — the FAB is the element in the wrong tier, and one value
            drops it below BOTH the nav backdrop tier (z-index: 40, Header.js)
            and the z-index: 50 tier (header shell + `.modal-overlay` in
            globals.css) in a single step; all four sit in the root stacking
            context, so the FAB's old z-index of 50 was a tie broken by DOM
            order (FeedbackButton mounts after Footer in layout.js), which is
            why the FAB painted above BOTH the open nav overlay and the Footer
            "Report bug" modal. Below-`md` non-render (the wrapper above)
            chosen OVER a per-surface inset sweep: occlusion becomes
            impossible by construction and there is nothing for Phase 88 to
            re-break when it rewrites surfaces. The FAB-above-Footer-modal
            instance was found by source analysis (z-tier + DOM order); the
            live-browser confirmation attempt is recorded in the plan summary
            (A5).

            AMENDED Phase 88-17 (Req 9), premise re-verified, decision UNCHANGED:
            the legacy overlay class named above is no longer what this file's
            own modal uses — it is now a portalled Radix dialog. The z-30 choice
            still holds because the shared dialog's backdrop is ALSO z-50
            (ui/dialog.tsx DialogOverlay), so the tier the FAB must stay under
            did not move. `z-30` is still a decision, not a leftover. */}
        {/* DECISION Phase 88.6-31 (UI-SPEC §3.2 / §3.3): the FAB is
            `<Button variant="primary" size="icon">`, and FIVE things about this line are
            decisions rather than transcription.

            (1) THE `variant` IS EXPLICIT even though `primary` is also the cva default. The site
            shipped `btn btn-primary`, so `primary` is what PRESERVES the look — and writing it
            down is what stops a later reader assuming the default was inspected rather than
            inherited. `Button.tsx` itself is not modified by this plan.

            (2) `w-14 h-14` IS KEPT. 56px EXCEEDS the 44px floor, and `size="icon"` contributes
            `min-h-11 min-w-11`, which is a FLOOR, not a size. Dropping it on the belief that
            "the primitive supplies the size" would shrink this control by 12px — a visible
            change and a P6 breach. This is the case where that belief is wrong.

            (3) `shadow-lg` -> `shadow-theme-lg`, with the hover PINNED as
            `enabled-hover:shadow-theme-lg` (UI-SPEC §3.4 rule 2, spelled with plan 05's
            `enabled-hover` variant so tailwind-merge dedupes it against the base's
            `enabled-hover:shadow-theme-md` instead of racing it). Compiled `.shadow-lg` is
            Tailwind v4's INLINED cold-black built-in; `.shadow-theme-lg` is `var(--shadow-lg)`,
            the project's warm re-tinted tier. `DECISION Phase 87.7` in globals.css states the
            mechanism: v4 inlines the literal values of its built-in scale into the built-in
            utilities rather than reading the theme property. The two are NOT byte-equal.
            LEAVING `shadow-lg` WOULD HAVE BEEN A REGRESSION, not a no-op: twMerge keeps BOTH it
            and the base's `shadow-theme-sm` (different token families, so neither dedupes the
            other) and the base's resting value wins in sheet order, so the migrated FAB would
            REST with no shadow and lift only to `md`.

            (4) THE PER-SITE FOCUS STRING IS DELETED — it was byte-identical to `Button.tsx`'s
            own ring, so keeping it duplicated the ring rather than protecting it. Read from
            plan 05's fixed token: `A-2-ARM: A` (`88.6-05-SUMMARY.md:186`), i.e. the ring lives
            in the primitive, not in a global `.btn:focus-visible` rule.

            (5) DEAD CLASSES DELETED AND ONLY THOSE: `rounded-full` (`.btn` sets `border-radius`
            UNLAYERED, so it did nothing today — deleting it is not a shape change) and
            `flex items-center justify-center` (`.btn` declares `display: inline-flex`,
            `align-items` and `justify-content` unlayered). `fixed bottom-6 right-6 z-30` are
            ALIVE and stay — `z-30` in particular is the shipped `DECISION Phase 87.8 D-09/D-10`
            above. MEASURED while editing: `:257` carried NO separate `bg-*` utility, so the
            purple fill travels entirely on `btn-primary` and no live fill was deleted. */}
        <Button
          variant="primary"
          size="icon"
          onClick={(e) => open(e.currentTarget)}
          className="fixed bottom-6 right-6 z-30 w-14 h-14 shadow-theme-lg enabled-hover:shadow-theme-lg"
          aria-label="Send feedback"
        >
          <svg
            xmlns="http://www.w3.org/2000/svg"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth={2}
            strokeLinecap="round"
            strokeLinejoin="round"
            className="w-6 h-6"
            aria-hidden="true"
            focusable="false"
          >
            <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
          </svg>
        </Button>
      </div>

      {/* Feedback modal — stays mounted on THIS (layout-root) instance at every
          viewport, including below `md` where the FAB itself is hidden; the
          phone nav row opens this same modal via the shared provider.

          DECISION Phase 88-17 (Req 9): hosted on the shared <Modal>. Three
          things are deliberately NOT ported:
            - the bespoke backdrop div and its target-compare click handler
              (Radix owns outside-dismiss);
            - the second `aria-label="Close"` glyph — <Modal.Header> supplies one,
              and two identically-named buttons make Playwright's role lookup in
              e2e/feedback-stacking.spec.ts ambiguous rather than merely noisy;
            - the layout-root MOUNT POINT, which is ported exactly as it was.
              Radix portals to <body>, so the RESEARCH Pitfall 1 failure (the
              nav dropdown's computed `translate` capturing a position:fixed
              overlay as its containing block) is now structurally impossible —
              but moving this render into the Header would still be wrong,
              because the dropdown unmounts its children and the modal would go
              with it. The e2e guard for this moved with it.

          The header renders in BOTH states so the dialog always has an
          accessible name (a Radix dialog with no DialogTitle has none, and warns).
          `dismissable` is left at its default: this modal has ALWAYS closed on
          backdrop click, and D-09's non-dismissable lever is for the surfaces
          that lose long-form input, not this one. */}
      {isOpen && (
        <Modal open onClose={close} onCloseAutoFocus={onCloseAutoFocus} className="max-w-md">
          <Modal.Header>Send Feedback</Modal.Header>
          <Modal.Body>
            {submitted ? (
              /* Success state */
              <div className="text-center py-4">
                <div className="text-content-status-success text-5xl mb-4">
                  <svg
                    xmlns="http://www.w3.org/2000/svg"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth={2}
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    className="w-12 h-12 mx-auto text-content-status-success"
                  >
                    <path d="M22 11.08V12a10 10 0 1 1-5.93-9.14" />
                    <polyline points="22 4 12 14.01 9 11.01" />
                  </svg>
                </div>
                <p className="text-xl font-bold text-content-primary">
                  Thanks! Your feedback has been submitted.
                </p>
              </div>
            ) : (
              /* Form state */
              <form onSubmit={handleSubmit} className="space-y-4">
                  {/* Category dropdown.
                      Phase 88-17 (Rule 2, SPEC Req 4): `htmlFor`/`id` added. The
                      label was rendered ADJACENT to the control with no
                      association, so the select had NO accessible name at all —
                      a live axe `select-name` violation this plan's composed
                      audit caught (FeedbackModals.test.tsx). A real <label>
                      association is used rather than an `aria-label` so the
                      visible text and the accessible name cannot drift apart. */}
                  <div>
                    <label
                      htmlFor="feedback-category"
                      className="block text-sm text-content-secondary mb-1"
                    >
                      Category
                    </label>
                    <SelectControl
                      id="feedback-category"
                      value={category}
                      onChange={(e) => setCategory(e.target.value)}
                    >
                      {CATEGORIES.map((cat) => (
                        <option key={cat} value={cat}>
                          {cat}
                        </option>
                      ))}
                    </SelectControl>
                  </div>

                  {/* Feedback textarea */}
                  <div>
                    <label
                      htmlFor="feedback-text"
                      className="block text-sm text-content-secondary mb-1"
                    >
                      Feedback
                    </label>
                    <Textarea
                      id="feedback-text"
                      value={text}
                      onChange={(e) => setText(e.target.value)}
                      placeholder="Tell us what's on your mind..."
                      rows={5}
                      className="resize-none"
                    />
                    <p className="text-xs text-content-muted mt-1">
                      {text.trim().length} characters (10 minimum)
                    </p>
                  </div>

                  {/* Error */}
                  {error && (
                    <div className="bg-red-50 border border-red-200 text-red-800 px-4 py-3 rounded-sm text-sm">
                      {error}
                    </div>
                  )}

                  {/* Submit */}
                  <div className="flex justify-end">
                    <Button
                      type="submit"
                      variant="primary"
                      disabled={submitting || text.trim().length < 10}
                    >
                      {submitting ? 'Submitting...' : 'Submit'}
                    </Button>
                  </div>
                </form>
            )}
          </Modal.Body>
        </Modal>
      )}
    </>
  );
}
