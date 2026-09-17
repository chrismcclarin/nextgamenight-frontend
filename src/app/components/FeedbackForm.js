'use client';
import { useState, useRef, useEffect, useId } from 'react';
import * as Sentry from '@sentry/nextjs';
import { feedbackAPI } from '../../lib/api';
import { useSelfIdentity } from '../../lib/hooks/useSelfIdentity';
import { isSyntheticAddress } from '../../lib/syntheticAddress';
import { DialogTitle } from '../../components/ui/dialog';
import { Modal } from './Modal';
import { Button } from '../../components/ui/Button';
import { Input, Textarea, SelectControl } from '@/components/ui/Input';
import { StatusRegion } from '@/components/ui/StatusRegion';
import { getFetchErrorMessage } from '../../components/ui/useFetchErrorState';

const MAX_FILE_SIZE_MB = 2;
const MAX_FILE_SIZE_BYTES = MAX_FILE_SIZE_MB * 1024 * 1024;

// Round 5 #41: the two status sentences are module-level constants like every other
// fixed string in this phase, because they are now set from an effect rather than
// computed inline in the JSX and two spellings would be one edit away.
const LOADING_DETAILS_COPY = 'Loading your details — one moment';
const REPLY_TO_UNAVAILABLE_COPY =
  "We couldn't load your email address, so we won't be able to reply to this.";

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
     the SELF-ROW gate is `aria-disabled` (a natively-disabled Submit left the tab order
     with no label change and no announcement — the keyboard dead end DR-C rejects one
     file over), the press blocked in the handler, and a fixed status line while the row
     loads. STATED PRECISELY (round 4 #26/#30): the PRE-EXISTING empty-field gate stays
     natively `disabled` — a validity gate on a pre-88.8 form, consistent with every other
     form in the app; DR-C's no-native-disabled rule is scoped to the Email section, and
     converting it is a decision for the Button migration, not this fix. And the ERROR case is disclosed: a signed-in reporter whose
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
  /* Round 6 #6: the success panel's 2-second timer, held so unmounting can clear it. It
     calls FIVE state setters and `onClose`, and the modal can close under it — the close
     button, Escape, an outside click, or a route change — so an uncleared timer fires
     into an unmounted component and calls the parent's `onClose` a second time, after the
     parent believes the dialog is already shut. */
  const successTimerRef = useRef(null);
  useEffect(
    () => () => {
      if (successTimerRef.current) clearTimeout(successTimerRef.current);
    },
    []
  );
  /* Round 5 #8/#40: DOCUMENT-UNIQUE ids, not module-level literals. This component has
     two independent mount sites — `Footer.js` (root layout, every page) and
     `FetchErrorBanner.tsx`, which can itself appear more than once — so the hard-coded
     `feedback-submit-status` produced duplicate ids and an `aria-describedby` that
     resolved to whichever node the browser found first, reading another form's status.
     `useId()` is the idiom the sibling EmailAddressSection uses throughout. */
  const reactId = useId();
  const statusId = `${reactId}-submit-status`;
  const errorId = `${reactId}-submit-error`;
  const fileInputId = `${reactId}-screenshot`;
  const screenshotErrorId = `${reactId}-screenshot-error`;
  /* DECISION Phase 88.6-31 (D-21, review finding D53): the attach success gets its OWN
     always-mounted polite region — chosen OVER reusing either region this file already has.
     `screenshotErrorId` (`aria-describedby`-linked only while `screenshotError` is truthy) would
     programmatically describe a VALID file input as errored; `statusId`'s text is recomputed
     UNCONDITIONALLY by the effect keyed on `[selfNotReady, replyToUnavailable]`, so any re-run
     stomps the message. That effect owns `statusLine` exclusively — do not route anything else
     through it. A routine attach is a background update, so this region is POLITE, never
     assertive. Reusing one of the two is a decision, not a cleanup. */
  const attachStatusId = `${reactId}-screenshot-attached`;
  /* Round 5 #41: EMPTY-FIRST, THEN POPULATED — the StatusRegion contract, applied for
     real. The round-4 comment claimed the reply-to line's "asynchronous appearance is a
     change in an existing region and is announced", which holds only when `selfNotReady`
     was true FIRST. It is `selfQuery.isFetching`, which is false on a warm cache and
     false for a settled errored query, so for a signed-in user opening the modal with a
     cached synthetic address (or a cached error) the region rendered WITH the sentence
     already in it on the very first commit — and a live region that mounts with its
     content announces nothing. Setting the text from an effect makes the first
     appearance a CHANGE, exactly as EmailAddressSection does for its unavailable copy. */
  const [statusLine, setStatusLine] = useState('');
  /* Round-7 residual (refuted-HIGH): a SUCCESSFUL attach announced nothing while a REJECTED one
     did. EMPTY-FIRST, exactly as `StatusRegion.tsx:9-12` states and as this file's own `:99-107`
     (round-5 #41) and `:404-409` (round-6 #31) comments record — a region that mounts WITH its
     content announces nothing, and a conditionally-mounted third region here would be the THIRD
     recurrence of that same bug in this one file. The value is the attached FILENAME, not a fixed
     sentence: a fixed string makes every repeat attach text -> identical text -> SILENCE, and the
     remove-then-reattach case is the real one (the input is not rendered at all while a screenshot
     is attached, `:346`'s `{screenshot ? (`). */
  const [attachStatus, setAttachStatus] = useState('');
  useEffect(() => {
    setStatusLine(
      selfNotReady ? LOADING_DETAILS_COPY : replyToUnavailable ? REPLY_TO_UNAVAILABLE_COPY : ''
    );
  }, [selfNotReady, replyToUnavailable]);

  const handleFileChange = (e) => {
    const file = e.target.files?.[0];
    setScreenshotError(null);
    /* Cleared at the START of the handler and set only on the SUCCESS path below — plan 28's
       W45(a) precedent. EVENT-DRIVEN, never derived from `screenshot` being present: a derived
       region stays silent on a remove-then-reattach of the SAME file, which is precisely the
       defect this exists to close. The clear here is also what makes a REJECTED file (wrong type
       or over the size limit) leave this region EMPTY while `screenshotError` populates.
       NOT TIME-BASED: nothing on this path arms a `setTimeout` or assigns `successTimerRef`. */
    setAttachStatus('');
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
    setAttachStatus(file.name);
  };

  const removeScreenshot = () => {
    setScreenshot(null);
    setScreenshotError(null);
    // CLEAR PATH 1 of 2 (the other is the post-success timer body). A region still asserting a
    // screenshot is attached after the user pressed Remove is wrong, not merely stale.
    setAttachStatus('');
    /* INERT AT RUNTIME, and left in place deliberately (Phase 88.6-31): `:346` is
       `{screenshot ? (`, so the `sr-only peer` input is CONDITIONALLY RENDERED and
       `fileInputRef.current` is null exactly while a screenshot is attached. React mounts a
       BRAND-NEW empty input when `screenshot` returns to null, so there is no retained value to
       clear and no silent-screenshot-drop defect here. Removing this line is a behaviour-neutral
       cleanup inside a WCAG-protected block; it is routed, not taken. */
    if (fileInputRef.current) fileInputRef.current.value = '';
  };

  /* R2 #195 / WCAG 2.4.3 (Focus Order). Activating Remove sets `screenshot` to null, which
     UNMOUNTS the very button the user pressed (it lives inside the `{screenshot ? (` arm), so
     focus fell to `<body>` mid-form. The landing target already exists and is already focusable
     with a VISIBLE ring: the else arm's `sr-only peer` input is paired with a label whose
     `peer-focus-visible:ring-2 peer-focus-visible:ring-focus-ring` paints the ring on the
     drop-zone box the user is actually looking at.

     DECISION Phase 88.6-31 (R2 #195): the handoff is SCOPED TO THE BUTTON'S OWN HANDLER —
     chosen OVER putting it inside `removeScreenshot`, whose state clear ALSO runs from the
     post-success timer body where the modal is closing and a focus move would fight the close.
     Reconciles with the inert-ref note above rather than contradicting it: the ref is null at
     clear time and POPULATED after the re-mount, which is why the move belongs here, after the
     state commit, and not beside that clear. The screenshot block's ternary and its `sr-only peer`
     SIBLING structure (round 6 #30, WCAG 2.1.1 / 2.4.7) are NOT restructured to make this easier —
     the else arm mounts the input on the same commit as the removal.

     THE LATCH IS A REF READ IN AN EFFECT, not a microtask or a `flushSync`: the input does not
     exist yet when the handler runs, so the focus call has to happen AFTER the commit that mounts
     it. An effect keyed on `screenshot` is the only spelling that is deterministic about that
     ordering. The latch is what keeps the post-success reset path (which also drives `screenshot`
     to null) from stealing focus while the modal is closing. */
  const focusInputAfterRemoveRef = useRef(false);
  useEffect(() => {
    if (screenshot || !focusInputAfterRemoveRef.current) return;
    focusInputAfterRemoveRef.current = false;
    if (fileInputRef.current) fileInputRef.current.focus();
  }, [screenshot]);

  const handleRemoveClick = () => {
    focusInputAfterRemoveRef.current = true;
    removeScreenshot();
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
      // is no longer needed.
      //
      // AMENDED Phase 88.6-31 (SPEC R1) — the message-preserving half above is SUPERSEDED and
      // is kept only as history. It used to read that "the catch below surfaces
      // ApiError.message (the backend's extracted error string) ... preserving its text", which
      // is exactly the behaviour the catch no longer has: the user-facing value now comes from
      // the CLOSED ratified register via `getFetchErrorMessage(err)`, and no upstream string is
      // rendered. The transport half of this note (publicFetch, ApiError, no `!response.ok`
      // block) is unchanged and still true. A stale DECISION marker is worse than none — the
      // next reader treats it as intent.
      await feedbackAPI.submitFeedback(feedbackBody);

      setSubmitted(true);
      successTimerRef.current = setTimeout(() => {
        setSubject('');
        setDescription('');
        setType('bug');
        setScreenshot(null);
        /* Round-7 residual #4, closed Phase 88.6-31: this reset cleared NEITHER error state, so a
           reporter who hit a failure and then succeeded reopened the form with the old red box (and
           the old screenshot-rejection line) still on it. Added to the EXISTING timer body rather
           than rewriting it, and beside `setScreenshot(null)` above, which was already here.
           CLEAR PATH 2 of 2 for the attach region (the other is `removeScreenshot`). NOT in the
           `:82-87` unmount-cleanup effect — that effect's whole body is a `clearTimeout`; it resets
           no state and can carry no clear. */
        setError(null);
        setScreenshotError(null);
        setAttachStatus('');
        setSubmitted(false);
        if (onClose) onClose();
      }, 2000);
    } catch (err) {
      /* Phase 88.6-31 (AC-2 WIDENED, owner ruling 2026-09-09): the `console.error` that stood
         here is REMOVED rather than respelled, and NO `logger.error` replaces it. The tagged
         class-only capture below is already the ONE escalation on this failure path; a
         `logger.error` beside it would be a SECOND Sentry event for one failure, and it forwards
         the error OBJECT whose `.message` is the backend's extracted string — precisely what the
         PII posture below rules out on the app's own bug channel. `logger.error` also takes only
         `(msg, err)` and forwards `extra: { msg }` (`logger.ts:20`, `:28-30`): it has no tags
         channel, so it could not carry the `channel` discriminator that separates the two feedback
         writers. This file therefore gains NO `logger` import. */
      /* Round 6 #3/#28: REPORTED, not stdout-only. This is the app's own bug channel, so a
         failure here is the one failure that cannot be reported through the app — the
         user's report is simply lost, and nobody learns it happened. The self-read and
         account-deletion catches got a Sentry capture in the same fix set; this one is
         strictly more consequential.
         CLASS-ONLY, per the deliberate PII posture (round 5 #23): a wrapped Error naming
         the CLASS and, when present, the envelope code — never `err.message` (which is
         the backend's extracted string), never the body, which on this path carries the
         reporter's address, their prose and possibly a screenshot. */
      const cls = (err && err.name) || 'Error';
      const code = err && typeof err.code === 'string' ? ` ${err.code}` : '';
      /* DECISION Phase 88.6-31 (review finding #83): EVERY TAG VALUE HERE IS A COMPILE-TIME
         SOURCE LITERAL — never a variable, never an interpolation, never error-derived text.
         `scrubEvent` (`sentry.scrub.js`, `function scrubEvent(event)`) walks `event.message`,
         `event.exception`, `event.breadcrumbs`, `event.user`, `event.request`, `event.extra` and
         `event.contexts` and NEVER `event.tags` (`grep -c 'tags' sentry.scrub.js` -> 0, measured
         2026-09-16), while Sentry INDEXES tags — so a dynamic tag value bypasses the whole
         T-84-01 scrub layer on the one channel whose body carries the reporter's address and
         their prose. `channel: 'public'` is NEW here and distinguishes this writer, the
         unauthenticated `publicFetch('/feedback')`, from `FeedbackButton.js`'s auth-gated
         `apiFetch('/feedback/github')` (`channel: 'github'`); identical tags would leave a
         Sentry issue ambiguous about WHICH feedback path is broken. */
      Sentry.captureException(new Error(`feedback submit failed: ${cls}${code}`), {
        tags: { feature: 'feedback', op: 'submit', channel: 'public' },
      });
      /* SPEC R1 (Phase 88.6-31): the raw `err.message ||` read is gone — the user-facing value
         comes from the CLOSED ratified register, called with NO `fallback` so the register's own
         `unknown` line answers and no copy is authored (P1).

         NAMED UI-SPEC §6.2 MUTATION-ROW EXCEPTION, dated 2026-09-16. §6.2's mutation row
         prescribes `toast.error(...)` and adds "Do not add a second region"; this site keeps
         `setError` as the sink and the ASSERTIVE `errorId` region below (`role="alert"`) as the
         announcement, and only the VALUE changes. Merits and record, both stated: on the MERITS
         the region is right here, because this is the one surface whose failing payload is the
         user's OWN WRITTEN REPORT and a 4-second toast loses it — which is the exact harm the
         round-5 #37 comment on that region records (the POST failed, the red box painted,
         assistive tech was told nothing, and the report was silently lost). The RECORD says
         toast; amending it costs one sentence (BOOKKEEPING) while the other direction costs a
         silently-lost bug report (CONSEQUENCE). The mechanism is the sanctioned one, not a
         transgression: `88.6-UI-SPEC.md` §14 A-30 / D52 is a written §6.2 exception of exactly
         this shape. A-30's OWN exception is NOT inherited — it rests on facts specific to
         `createGroup.js` and says so. No `sonner` import is added to this file. */
      setError(getFetchErrorMessage(err));
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
            <label htmlFor="feedback-form-type" className="block text-sm text-content-secondary mb-2">Type</label>
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
            <label htmlFor="feedback-form-subject" className="block text-sm text-content-secondary mb-2">
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
            <label htmlFor="feedback-form-description" className="block text-sm text-content-secondary mb-2">
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
            <label className="block text-sm text-content-secondary mb-2">
              Screenshot <span className="text-content-muted font-normal">(optional)</span>
            </label>
            {screenshot ? (
              <div className="flex items-center gap-3 p-3 bg-surface-page border border-line rounded-md">
                {/* Round-7 residual #29, closed Phase 88.6-31: STANDALONE decoration, a SIBLING of
                    the named Remove control below rather than a child of it, so `aria-hidden`
                    here is about not announcing an unlabelled graphic beside the filename. Its
                    twin at the drop-zone label already carried the attribute. */}
                <svg aria-hidden="true" focusable="false" className="w-5 h-5 text-content-muted shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z" />
                </svg>
                <span className="text-sm text-content-secondary flex-1 truncate">{screenshot.name}</span>
                <span className="text-xs text-content-muted shrink-0">
                  {(screenshot.size / 1024 / 1024).toFixed(1)} MB
                </span>
                {/* DECISION Phase 88.6-31 (D48 / UI-SPEC §3.2's bare-button row): this Remove
                    control is a `<Button variant="ghost" size="icon">` with the mark in a CHILD —
                    the shipped `BottomSheet.tsx` / `PendingMemberBanner.js` glyph idiom.

                    THE `variant` IS EXPLICIT AND IT IS `ghost`. `Button.tsx`'s `defaultVariants`
                    is `{ variant: 'primary', size: 'default' }`, so a `<Button size="icon">` with
                    no variant would paint `btn-primary` — a PURPLE close button, the exact
                    mapping UI-SPEC §3.2 forbids ("A bare `.btn` NEVER maps to variant=primary").

                    WHY IT MIGRATES AT ALL: it was a bare `<button>` with no `.btn` and no size,
                    so it had NO touch floor at any width — on the phone-primary surface.
                    `size="icon"` supplies `min-h-11 min-w-11`.

                    THE GLYPH IS A CHILD, never a `text-*` on the button: `.btn`'s UNLAYERED
                    `font-size` beats any `text-*` utility placed on the button element, so a size
                    authored there silently does not size. No unlayered CSS rule is added to
                    re-assert it — UI-SPEC §3.2 rejects call-site unlayered overrides and plan 06
                    already rejected a `.btn-icon` for this.

                    THE `.btn` LOOK IS ACCEPTED, DELIBERATELY AND VISIBLY: migrating hands this
                    control 14px/600 type, the lozenge padding, and a hover wash plus elevation it
                    does not have today. Already disclosed — UI-SPEC §1.2's EXISTING **V-15** row
                    names `FeedbackForm.js:355` (remove-screenshot) by file and line. NO new
                    V-number is minted and no second V-15 row is written; minting one would put a
                    second row in a CLOSED list for a delta already rowed.

                    CLASS DISPOSITION, exhaustive: `transition-colors` is DEAD (`.btn` declares
                    `transition` unlayered) and is deleted; `text-content-muted` and its
                    `hover:text-content-status-error` are ALIVE (`.btn` declares no `color`) and
                    stay, so the ink behaviour is byte-identical; `shrink-0` is ALIVE (`.btn`
                    declares no `flex-shrink`) and stays — it is live layout inside the
                    `flex items-center gap-3` row. */}
                <Button
                  variant="ghost"
                  size="icon"
                  onClick={handleRemoveClick}
                  className="text-content-muted hover:text-content-status-error shrink-0"
                  aria-label="Remove screenshot"
                >
                  <span aria-hidden="true" className="text-lg leading-none">
                    ×
                  </span>
                </Button>
              </div>
            ) : (
              /* KEYBOARD-REACHABLE SINCE 2026-09-07 (round 6 #30, WCAG 2.1.1). The input
                 carried `className="hidden"` — `display: none`, which removes it from the
                 focus order entirely — inside a <label> that is not focusable either, so
                 attaching a screenshot was a mouse-only affordance from the day it
                 shipped (2026-02). `sr-only` clips the control instead of removing it, so
                 it keeps its native keyboard behaviour: Tab lands on it, Space or Enter
                 opens the picker.
                 THE INPUT IS NOW A SIBLING of the label rather than its child, associated
                 by htmlFor/id, for one reason: Tailwind's `peer-*` variants only reach
                 SIBLINGS, and the focus ring has to be painted on the visible box because
                 the focused element itself is invisible. A focusable control with no
                 visible focus indicator is WCAG 2.4.7 — trading one failure for another.
                 Chosen OVER a Button that forwards a click to the input: that adds a
                 second control to the tab order for one action, and loses the native
                 file-input semantics assistive tech announces. */
              <>
                <input
                  ref={fileInputRef}
                  id={fileInputId}
                  name="screenshot"
                  type="file"
                  accept="image/*"
                  onChange={handleFileChange}
                  aria-describedby={screenshotError ? screenshotErrorId : undefined}
                  className="sr-only peer"
                />
                <label
                  htmlFor={fileInputId}
                  className="flex flex-col items-center justify-center w-full p-4 border-2 border-dashed border-line rounded-md cursor-pointer hover:border-accent hover:bg-surface-hover transition-colors peer-focus-visible:ring-2 peer-focus-visible:ring-focus-ring peer-focus-visible:ring-offset-2 peer-focus-visible:border-accent"
                >
                  <svg aria-hidden="true" className="w-6 h-6 text-content-muted mb-1" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z" />
                  </svg>
                  <span className="text-sm text-content-muted">Click to attach a screenshot</span>
                  <span className="text-xs text-content-muted mt-1">PNG, JPG, GIF up to {MAX_FILE_SIZE_MB} MB</span>
                </label>
              </>
            )}
            {/* Round 6 #31: ANNOUNCED AND ASSOCIATED. A rejected file (wrong type, over
                2 MB) was a red <p> with no role and nothing referencing it, so a
                screen-reader user pressed Submit believing their screenshot was attached.
                Same shape as the submit error above: the house StatusRegion, always
                mounted so the message is a change rather than a mount, `text-xs` kept so
                the visual is unchanged, and pointed at by the input's aria-describedby
                only while it has something to say. */}
            <StatusRegion
              id={screenshotErrorId}
              politeness="assertive"
              className={screenshotError ? 'text-xs text-red-600 mt-1' : undefined}
            >
              {screenshotError}
            </StatusRegion>
            {/* THE ATTACH SUCCESS (round-7 refuted-HIGH, closed Phase 88.6-31). A rejected file
                announced and a SUCCESSFUL one did not.

                RENDERED HERE ON PURPOSE — a SIBLING of the screenshotError region above, OUTSIDE
                the `{screenshot ? … : …}` ternary. Inside the ternary is where it would naturally
                land and is exactly where it would be CONDITIONALLY MOUNTED, and a region created
                by the event it announces announces NOTHING (`StatusRegion.tsx:9-12`). This file
                has already been fixed for that same bug TWICE — the round-5 #41 comment on
                `statusLine` and the round-6 #31 comment on the region above — so a third
                conditionally-mounted region would be the third recurrence. Always mounted, EMPTY
                first, selected BY ID everywhere in the suite (React 18 `useId` ids contain
                COLONS, so `querySelector('#' + id)` is a SyntaxError; and there are TWO polite
                regions in this form now, so a bare `getByRole('status')` is ambiguous and an
                index into `getAllByRole` silently targets THIS one, which sits first in DOM
                order).

                VISIBLE WHEN SET, WITH NO IDLE DELTA (owner ruling 2026-09-14, ACCEPT §5, option
                2; UI-SPEC §1.2 **V-18**). No `sr-only` is passed — `StatusRegion.tsx:43` is
                `cn('text-sm', className)` and the primitive hides nothing, so the text renders on
                screen. `sr-only` is the RECORDED REJECTED ARM for this region and the other two
                new polite regions in this phase; do not "tidy" it back. While idle the className
                is `undefined`, so the empty div carries no margin and no min-height and the idle
                layout is byte-identical.

                THE VISIBLE ARM IS BOUNDED, THE ANNOUNCED STRING IS NOT: `truncate` is the same
                single-line idiom already applied to this very string at the filename `<span>`
                above. It is visual only — the region's textContent keeps the FULL name, which is
                what makes a second attach a real text CHANGE rather than silence.

                COPY: UI-SPEC §6.3's ratified register holds NO attach-success entry (measured
                2026-09-16), so this region carries the FILENAME ALONE and no prose is authored —
                an executor never mints. Under the 2026-09-14 visible arm the owed string is an
                UNRATIFIED VISIBLE STRING, not merely an unratified announcement; it is recorded
                as owed in `88.6-31-SUMMARY.md`. */}
            <StatusRegion
              id={attachStatusId}
              className={attachStatus ? 'text-sm text-content-secondary mt-1 truncate' : undefined}
            >
              {attachStatus}
            </StatusRegion>
          </div>

          {/* Error — ANNOUNCED, AND ATTACHED TO THE CONTROL THAT PRODUCED IT (round 5
              #37). This was a bare styled <div>, conditionally mounted with its content:
              no role, no aria-live, no id, nothing pointing at it. A keyboard or
              screen-reader user pressed Submit, the POST to the public feedback writer
              failed, the red box painted, and assistive tech was told nothing — the
              report was silently lost. It is now the house StatusRegion, ASSERTIVE
              (a failed submit is not a background update) and always mounted so the
              message is a change rather than a mount, carrying its visual tone only when
              it has something to say. `text-base` is passed deliberately: StatusRegion
              defaults to `text-sm` and this box keeps the size it shipped with. */}
          <StatusRegion
            id={errorId}
            politeness="assertive"
            className={
              error
                ? 'text-base bg-red-50 border border-red-200 text-red-800 px-4 py-3 rounded-sm'
                : undefined
            }
          >
            {error}
          </StatusRegion>

          {/* Round 3 DR3: one always-mounted polite region for the loading state, so a
              gated Submit is explained and announced instead of silently unavailable. */}
          {/* Round 4 #31 / round 5 #41: the reply-to disclosure rides the SAME live
              region, and the text is now set from an effect so its FIRST appearance is a
              change to a mounted-empty region rather than a mount that carries it. */}
          <StatusRegion id={statusId} className="text-xs text-content-muted min-h-4">
            {statusLine}
          </StatusRegion>

          {/* Buttons */}
          <div className="flex gap-3 justify-end">
            <Button
              variant="secondary"
              onClick={onClose}
              disabled={submitting}
            >
              Cancel
            </Button>
            <Button
              type="submit"
              variant="primary"
              disabled={submitting || !subject.trim() || !description.trim()}
              aria-disabled={selfNotReady ? 'true' : undefined}
              /* Round 5 #37: the failure joins the gate line, so a user returning to
                 Submit hears WHY it failed and not only whether it is available. */
              aria-describedby={[error ? errorId : null, statusId].filter(Boolean).join(' ')}
            >
              {submitting ? 'Submitting...' : 'Submit'}
            </Button>
          </div>
        </form>
      </Modal.Body>
    </Modal>
  );
}
