'use client';
import { useState, useRef } from 'react';
import { useUser as Auth } from '@auth0/nextjs-auth0/client';
import { feedbackAPI } from '../../lib/api';
import { DialogTitle } from '../../components/ui/dialog';
import { Modal } from './Modal';
import { Input, Textarea, SelectControl } from '@/components/ui/Input';

const MAX_FILE_SIZE_MB = 2;
const MAX_FILE_SIZE_BYTES = MAX_FILE_SIZE_MB * 1024 * 1024;

export default function FeedbackForm({ onClose, initialType = 'bug', initialSubject = '', initialDescription = '' }) {
  const { user } = Auth();
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
      const feedbackBody = {
        type,
        subject: subject.trim(),
        description: description.trim(),
        user_email: user?.email || null,
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
            <div className="text-status-success text-5xl mb-4">✓</div>
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
                  className="text-content-muted hover:text-status-error transition-colors shrink-0"
                  aria-label="Remove screenshot"
                >
                  ×
                </button>
              </div>
            ) : (
              <label className="flex flex-col items-center justify-center w-full p-4 border-2 border-dashed border-line rounded-md cursor-pointer hover:border-accent hover:bg-surface-card-hover transition-colors">
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
