'use client';
import { useState, useEffect } from 'react';
import { usePathname } from 'next/navigation';
import { useUser } from '@auth0/nextjs-auth0/client';
import { feedbackAPI } from '../../lib/api';
import { scrubFeedbackPageUrl } from '../../lib/scrubFeedbackPageUrl';
import { useFeedbackModal, CATEGORIES, getCategoryLabel } from './FeedbackModalProvider';
import { Modal } from './Modal';

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
export default function FeedbackButton({ variant = 'floating', label, onOpen }) {
  const { user } = useUser();
  const pathname = usePathname();
  const { isOpen, category, open, close, setCategory } = useFeedbackModal();

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
          open(e.currentTarget);
          // Close the mobile dropdown in the SAME transition (Header passes
          // its setMobileMenuOpen(false) here, the same close-on-tap idiom
          // the nav links use at Header.js:185,193).
          if (onOpen) onOpen();
        }}
        // Class string copied from ThemeToggle.js:32 with ONE change:
        // active:opacity-75 (the Plan 87.8-01 press idiom) instead of the
        // old bg-surface-card-hover token-swap press state — plan 08 converged
        // the two remaining token-swap sites; do not reintroduce the old idiom.
        // Focus ring matches the FAB this row replaces (same tokens), so
        // keyboard/switch users get the same visible affordance from either
        // entry point; inset (no ring-offset) because the row is a full-bleed
        // menu row where an offset ring would clip against siblings.
        className="w-full text-left flex items-center gap-3 px-4 py-3 text-white text-sm hover:bg-surface-card-hover active:opacity-75 transition-colors focus:ring-2 focus:ring-focus-ring focus:ring-inset"
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
        <span className="text-content-muted flex-1">{label || 'Send feedback'}</span>
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
        userEmail: user.email || '',
        label: getCategoryLabel(category),
        userAgent: navigator.userAgent,
      });

      setSubmitted(true);
      setTimeout(() => {
        setSubmitted(false);
        setText('');
        close();
      }, 2000);
    } catch (err) {
      console.error('Error submitting feedback:', err);
      setError(err.message || 'Failed to submit feedback. Please try again.');
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
        <button
          onClick={(e) => open(e.currentTarget)}
          className="fixed bottom-6 right-6 z-30 w-14 h-14 btn btn-primary rounded-full shadow-lg flex items-center justify-center focus:ring-2 focus:ring-focus-ring focus:ring-offset-2"
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
          >
            <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
          </svg>
        </button>
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
        <Modal open onClose={close} className="max-w-md">
          <Modal.Header>Send Feedback</Modal.Header>
          <Modal.Body>
            {submitted ? (
              /* Success state */
              <div className="text-center py-4">
                <div className="text-status-success text-5xl mb-4">
                  <svg
                    xmlns="http://www.w3.org/2000/svg"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth={2}
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    className="w-12 h-12 mx-auto text-status-success"
                  >
                    <path d="M22 11.08V12a10 10 0 1 1-5.93-9.14" />
                    <polyline points="22 4 12 14.01 9 11.01" />
                  </svg>
                </div>
                <p className="text-lg font-medium text-content-primary">
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
                      className="block text-sm font-medium text-content-secondary mb-1"
                    >
                      Category
                    </label>
                    <select
                      id="feedback-category"
                      value={category}
                      onChange={(e) => setCategory(e.target.value)}
                      className="w-full p-2 border border-line rounded-md text-content-primary bg-surface-input focus:outline-hidden focus:ring-2 focus:ring-focus-ring"
                    >
                      {CATEGORIES.map((cat) => (
                        <option key={cat} value={cat}>
                          {cat}
                        </option>
                      ))}
                    </select>
                  </div>

                  {/* Feedback textarea */}
                  <div>
                    <label
                      htmlFor="feedback-text"
                      className="block text-sm font-medium text-content-secondary mb-1"
                    >
                      Feedback
                    </label>
                    <textarea
                      id="feedback-text"
                      value={text}
                      onChange={(e) => setText(e.target.value)}
                      placeholder="Tell us what's on your mind..."
                      rows={5}
                      className="w-full p-2 border border-line rounded-md text-content-primary bg-surface-input focus:outline-hidden focus:ring-2 focus:ring-focus-ring resize-none"
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
                    <button
                      type="submit"
                      disabled={submitting || text.trim().length < 10}
                      className="btn btn-primary"
                    >
                      {submitting ? 'Submitting...' : 'Submit'}
                    </button>
                  </div>
                </form>
            )}
          </Modal.Body>
        </Modal>
      )}
    </>
  );
}
