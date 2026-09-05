'use client';
import { useState, useRef } from 'react';
import { feedbackAPI } from '../../lib/api';
import { useSelfIdentity } from '../../lib/hooks/useSelfIdentity';
import { isSyntheticAddress } from '../../lib/syntheticAddress';
import { DialogTitle } from '../../components/ui/dialog';
import { Modal } from './Modal';
import { Input, Textarea, SelectControl } from '@/components/ui/Input';

const MAX_FILE_SIZE_MB = 2;
const MAX_FILE_SIZE_BYTES = MAX_FILE_SIZE_MB * 1024 * 1024;

export default function FeedbackForm({ onClose, initialType = 'bug', initialSubject = '', initialDescription = '' }) {
  // Phase 88.8 plan 13 Task 3(b): the contact handle is the APP address off the
  // shared self row, never the Auth0 SESSION claim. The Auth0 hook that used to
  // live here had exactly ONE consumer (the `user_email` line below) and was
  // removed with it — re-verified by grep before deleting, not taken on trust.
  // This component is mounted only while the modal is open (Footer.js:173-175),
  // so the hook costs one already-deduplicated query at most; logged out it does
  // not fire at all (`enabled: Boolean(user?.sub)`).
  const { self, query: selfQuery } = useSelfIdentity();
  /* HOLD SUBMIT UNTIL THE SELF ROW LANDS (code review #7/#17, 2026-09-05). The
     contact handle moved from the immediately-available Auth0 session claim to an
     ASYNC react-query fetch, so a fast submit filed the row with `user_email:
     null` — a signed-in reporter silently losing their reply-to, with no signal
     anywhere. It matters most at the SECOND mount site the original change did not
     enumerate: `FetchErrorBanner.tsx` opens this form on a failed fetch, and on
     that path the self row is by definition not resolved.
     THE PREDICATE IS `isFetching`, NOT `isPending`, and that distinction is the
     whole correctness of this guard: in react-query v5 a DISABLED query still
     reports `isPending: true` (pending means "no data", not "working"), so keying
     on it disabled the submit button forever for every logged-OUT reporter — the
     hook is `enabled: Boolean(user?.sub)`. Caught by three existing
     FeedbackForm tests. `isFetching` is true only while a request is actually in
     flight, which is exactly the window this guard exists for; disabled and
     settled both read false, so the logged-out path files with a null handle as
     it always has. */
  const selfNotReady = selfQuery.isFetching;
  /* Round 3 DR3 (three lenses converged here). The guard above is KEPT — this form posts
     to the PUBLIC feedback writer, which ACCEPTS the client `user_email`, so the value
     really is the reply-to on this path (the server-derived address is the /github
     route, which this form never calls) — but it is now PERCEIVABLE and REACHABLE:
     `aria-disabled` instead of native `disabled` (a natively-disabled Submit left the
     tab order with no label change and no announcement — the keyboard dead end DR-C
     rejects one file over), the press blocked in the handler, and a fixed status line
     while the row loads. And the ERROR case is disclosed: a signed-in reporter whose
     address could not be loaded (the self query errored, or the row carries no usable
     address) is told the reply-to is missing — never given the stale session address,
     never blocked from filing. */
  const replyToUnavailable =
    selfQuery.isError === true ||
    (self !== undefined && !(self?.email && !isSyntheticAddress(self.email)));
  const [type, setType] = useState(initialType);
  const [subject, setSubject] = useState(initialSubject);
  const [description, setDescription] = useState(initialDescription);
  const [screenshot, setScreenshot] = useState(null);
  const [screenshotError, setScreenshotError] = useState(null);
  const [submitting, setSubmitting] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  // 88-33 Task 4 (UAT row 291): initial-focus target — see the note at the Modal below.
  const subjectInputRef = useRef(null);
  const [error, setError] = useState(null);
  const fileInputRef = useRef(null);

  const handleFileChange = (e) => {
    const file = e.target.files?.[0];
    setScreenshotError(null);
    if (!file) {
      setScreenshot(null);
      return;
    }
    if (!file.type.startsWith('image/')) {
      setScreenshotError('Only image files are allowed.');
      setScreenshot(null);
      e.target.value = '';
      return;
    }
    if (file.size > MAX_FILE_SIZE_BYTES) {
      setScreenshotError(`File is too large (${(file.size / 1024 / 1024).toFixed(1)} MB). Maximum is ${MAX_FILE_SIZE_MB} MB.`);
      setScreenshot(null);
      e.target.value = '';
      return;
    }
    setScreenshot(file);
  };

  const removeScreenshot = () => {
    setScreenshot(null);
    setScreenshotError(null);
    if (fileInputRef.current) fileInputRef.current.value = '';
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    // DR3: the press is blocked HERE while the self row loads (aria-disabled, not native).
    if (selfNotReady) return;

    if (!subject.trim() || !description.trim()) {
      setError('Please fill in all required fields');
      return;
    }

    try {
      setSubmitting(true);
      setError(null);

      // Convert screenshot to base64 if provided
      let screenshot_base64 = null;
      let screenshot_filename = null;
      if (screenshot) {
        screenshot_base64 = await new Promise((resolve, reject) => {
          const reader = new FileReader();
          reader.onload = () => {
            // Strip the data URL prefix (e.g. "data:image/png;base64,")
            const base64 = reader.result.split(',')[1];
            resolve(base64);
          };
          reader.onerror = reject;
          reader.readAsDataURL(screenshot);
        });
        screenshot_filename = screenshot.name;
      }

      // Feedback carries no user attribution (owner decision 2026-07-24): this
      // form rides the public transport, so any user_id would be client-asserted
      // and unverifiable — the backend ignores it. user_email is the contact
      // handle for follow-up.
      //
      // Phase 88.8 plan 13 (SPEC R12): that handle is `Users.email` — the address
      // this app actually uses — and there is NO session-email fallback left. A
      // wrong address here is worse than none: it is precisely the value D-42's
      // move and the account-deletion scrub will not match.
      //
      // WHY A SYNTHETIC ADDRESS SENDS NULL, AND WHAT THAT COSTS. `user_email` is a
      // CONTACT HANDLE: `routes/feedback.js` puts it in the admin mail's From line
      // (`:162`, `:183`) and, when truthy, in `replyTo` (`:204`). Putting the
      // provisioning sentinel there publishes a non-address as if someone could be
      // reached at it. Sending null instead means the From line falls back to its
      // existing 'Anonymous' literal and the options object carries NO `replyTo`
      // key at all — because `:204` is a conditional spread, not an assignment.
      // That is the CORRECT outcome: there is no inbox behind
      // `<sub>@auth0.local`. The test is the BROAD `@auth0` substring per
      // DECISION Phase 88.2 NIX-AUTH0, never `@auth0.local` alone.
      //
      // CROSS-REPO PAIRING: `88.8-09-PLAN.md` Task 4 adds the SAME broad guard
      // server-side to BOTH feedback writers, so this client fix is defence in
      // depth on an unauthenticated endpoint rather than the only control.
      // Neither repo's CI can see the other.
      const appAddress = self?.email;
      const feedbackBody = {
        type,
        subject: subject.trim(),
        description: description.trim(),
        user_email: appAddress && !isSyntheticAddress(appAddress) ? appAddress : null,
        screenshot_base64,
        screenshot_filename,
      };

      // Routed through the centralized client (87.6 R7). feedbackAPI.submitFeedback
      // rides publicFetch (direct PUBLIC_API_BASE_URL, logged-out-capable) and
      // throws ApiError on a non-ok response, so the manual `!response.ok` block
      // is no longer needed — the catch below surfaces ApiError.message (the
      // backend's extracted error string) into the toast, preserving its text.
      await feedbackAPI.submitFeedback(feedbackBody);

      setSubmitted(true);
      setTimeout(() => {
        setSubject('');
        setDescription('');
        setType('bug');
        setScreenshot(null);
        setSubmitted(false);
        if (onClose) onClose();
      }, 2000);
    } catch (err) {
      console.error('Error submitting feedback:', err);
      setError(err.message || 'Failed to submit feedback. Please try again.');
    } finally {
      setSubmitting(false);
    }
  };

  /* DECISION Phase 88-17 (Req 9): BOTH states are hosted on the shared <Modal>,
     and they stay TWO distinct returns rather than being collapsed into one
     modal with a conditional body. The success panel is a different surface: it
     is header-less and self-dismissing (the submit handler's 2s timer calls
     onClose), so giving it the form's header would put a close affordance on a
     panel that is already closing itself, and merging the returns would tie the
     two together for a future edit. Collapsing them is a decision, not a cleanup.

     The success panel's "Thank You!" h2 is rendered as the DialogTitle — the
     QRCodeModal.js idiom — so the header-less dialog still has an accessible
     name (a Radix dialog without a DialogTitle has none, and warns). The form
     state's title moves to <Modal.Header>, which drops it from 24px to the
     20px/700 dialog-title contract (UI-SPEC §4.2); the STRING is unchanged
     because e2e/feedback-stacking.spec.ts looks it up by exact text. */
  if (submitted) {
    return (
      <Modal open onClose={onClose} className="max-w-md">
        <Modal.Body>
          <div className="text-center">
            <div className="text-content-status-success text-5xl mb-4">✓</div>
            <DialogTitle className="text-xl font-bold text-content-primary mb-2">Thank You!</DialogTitle>
            <p className="text-content-secondary">Your feedback has been submitted successfully.</p>
          </div>
        </Modal.Body>
      </Modal>
    );
  }

  return (
    /* 88-33 Task 4 (UAT row 291, fleet initial-focus policy): form-bearing modal — focus
       opens on the SUBJECT input, not the Type select above it: the select ships
       pre-defaulted ("Bug Report") and describing the issue is the form's task, so the
       typing surface is the first MEANINGFUL input here. */
    <Modal open onClose={onClose} className="max-w-md" initialFocusRef={subjectInputRef}>
      <Modal.Header>Report Bug or Suggest Feature</Modal.Header>
      <Modal.Body>
        <form onSubmit={handleSubmit} className="space-y-4">
          {/* Type.
              Phase 88-17 (Rule 2, SPEC Req 4): `htmlFor`/`id` added throughout
              this form. The labels were rendered ADJACENT to their controls with
              no association, so the select had NO accessible name at all — a
              live axe `select-name` violation this plan's composed audit caught
              (FeedbackModals.test.tsx). Real <label> associations are used
              rather than `aria-label` so the visible text and the accessible
              name cannot drift apart. */}
          <div>
            <label htmlFor="feedback-form-type" className="block text-sm font-medium text-content-secondary mb-2">Type</label>
            <SelectControl
              id="feedback-form-type"
              value={type}
              onChange={(e) => setType(e.target.value)}
              required
            >
              <option value="bug">Bug Report</option>
              <option value="suggestion">Suggestion</option>
              <option value="feature">Feature Request</option>
            </SelectControl>
          </div>

          {/* Subject */}
          <div>
            <label htmlFor="feedback-form-subject" className="block text-sm font-medium text-content-secondary mb-2">
              Subject <span className="text-red-500">*</span>
            </label>
            <Input
              ref={subjectInputRef}
              id="feedback-form-subject"
              type="text"
              value={subject}
              onChange={(e) => setSubject(e.target.value)}
              placeholder="Brief description of the issue or suggestion"
              required
              maxLength={200}
            />
          </div>

          {/* Description */}
          <div>
            <label htmlFor="feedback-form-description" className="block text-sm font-medium text-content-secondary mb-2">
              Description <span className="text-red-500">*</span>
            </label>
            <Textarea
              id="feedback-form-description"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="Please provide as much detail as possible..."
              rows={6}
              className="resize-none"
              required
              maxLength={2000}
            />
            <p className="text-xs text-content-muted mt-1">{description.length}/2000 characters</p>
          </div>

          {/* Screenshot */}
          <div>
            <label className="block text-sm font-medium text-content-secondary mb-2">
              Screenshot <span className="text-content-muted font-normal">(optional)</span>
            </label>
            {screenshot ? (
              <div className="flex items-center gap-3 p-3 bg-surface-page border border-line rounded-md">
                <svg className="w-5 h-5 text-content-muted shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z" />
                </svg>
                <span className="text-sm text-content-secondary flex-1 truncate">{screenshot.name}</span>
                <span className="text-xs text-content-muted shrink-0">
                  {(screenshot.size / 1024 / 1024).toFixed(1)} MB
                </span>
                <button
                  type="button"
                  onClick={removeScreenshot}
                  className="text-content-muted hover:text-content-status-error transition-colors shrink-0"
                  aria-label="Remove screenshot"
                >
                  ×
                </button>
              </div>
            ) : (
              <label className="flex flex-col items-center justify-center w-full p-4 border-2 border-dashed border-line rounded-md cursor-pointer hover:border-accent hover:bg-surface-hover transition-colors">
                <svg className="w-6 h-6 text-content-muted mb-1" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z" />
                </svg>
                <span className="text-sm text-content-muted">Click to attach a screenshot</span>
                <span className="text-xs text-content-muted mt-1">PNG, JPG, GIF up to {MAX_FILE_SIZE_MB} MB</span>
                <input
                  ref={fileInputRef}
                  type="file"
                  accept="image/*"
                  onChange={handleFileChange}
                  className="hidden"
                />
              </label>
            )}
            {screenshotError && (
              <p className="text-xs text-red-600 mt-1">{screenshotError}</p>
            )}
          </div>

          {/* Error */}
          {error && (
            <div className="bg-red-50 border border-red-200 text-red-800 px-4 py-3 rounded-sm">
              {error}
            </div>
          )}

          {/* Round 3 DR3: one always-mounted polite region for the loading state, so a
              gated Submit is explained and announced instead of silently unavailable. */}
          <p role="status" className="text-xs text-content-muted min-h-4">
            {selfNotReady ? 'Loading your details — one moment' : ''}
          </p>
          {replyToUnavailable && !selfNotReady && (
            <p className="text-xs text-content-muted">
              We couldn&apos;t load your email address, so we won&apos;t be able to reply to this.
            </p>
          )}

          {/* Buttons */}
          <div className="flex gap-3 justify-end">
            <button
              type="button"
              onClick={onClose}
              className="btn btn-secondary"
              disabled={submitting}
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={submitting || !subject.trim() || !description.trim()}
              aria-disabled={selfNotReady ? 'true' : undefined}
              className="btn btn-primary"
            >
              {submitting ? 'Submitting...' : 'Submit'}
            </button>
          </div>
        </form>
      </Modal.Body>
    </Modal>
  );
}
