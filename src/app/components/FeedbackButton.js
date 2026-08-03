'use client';
import { useState, useEffect } from 'react';
import { usePathname } from 'next/navigation';
import { useUser } from '@auth0/nextjs-auth0/client';
import { feedbackAPI } from '../../lib/api';
import { useFeedbackModal, CATEGORIES, getCategoryLabel } from './FeedbackModalProvider';

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

  // Close modal on Escape key — only the modal-owning (floating) instance
  // listens; the row instance renders no modal, so a second listener would
  // just double-fire close().
  useEffect(() => {
    if (variant === 'row' || !isOpen) return;
    const handleKeyDown = (e) => {
      if (e.key === 'Escape') {
        close();
      }
    };
    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [variant, isOpen, close]);

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
        // active:opacity-75 (the Plan 87.8-01 press idiom) instead of
        // active:bg-surface-card-hover — plan 08 converges the two remaining
        // token-swap sites; do not ship a third instance of the old idiom.
        className="w-full text-left flex items-center gap-3 px-4 py-3 text-white text-sm hover:bg-surface-card-hover active:opacity-75 transition-colors"
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

  const handleOverlayClick = (e) => {
    if (e.target === e.currentTarget) {
      close();
    }
  };

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
        pageUrl: window.location.href,
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
      {/* Floating feedback button */}
      <button
        onClick={(e) => open(e.currentTarget)}
        className="fixed bottom-6 right-6 z-50 w-14 h-14 btn btn-primary rounded-full shadow-lg flex items-center justify-center focus:ring-2 focus:ring-focus-ring focus:ring-offset-2"
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

      {/* Modal overlay — stays mounted on THIS (layout-root) instance at every
          viewport, including below `md` where the FAB itself is hidden; the
          phone nav row opens this same modal via the shared provider. */}
      {isOpen && (
        <div
          className="modal-overlay"
          onClick={handleOverlayClick}
        >
          <div className="modal-content max-w-md w-full mx-4 p-6">
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
              <>
                <div className="flex justify-between items-center mb-4">
                  <h2 className="text-xl font-bold text-content-primary">Send Feedback</h2>
                  <button
                    onClick={close}
                    className="text-content-muted hover:text-content-primary text-2xl leading-none"
                    aria-label="Close"
                  >
                    &times;
                  </button>
                </div>

                <form onSubmit={handleSubmit} className="space-y-4">
                  {/* Category dropdown */}
                  <div>
                    <label className="block text-sm font-medium text-content-secondary mb-1">
                      Category
                    </label>
                    <select
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
                    <label className="block text-sm font-medium text-content-secondary mb-1">
                      Feedback
                    </label>
                    <textarea
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
              </>
            )}
          </div>
        </div>
      )}
    </>
  );
}
