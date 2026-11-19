'use client';
import { useState, useEffect, useRef } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { useUser } from '@auth0/nextjs-auth0/client';
import Link from 'next/link';
import { eventsAPI } from '../../../../lib/api';
import { Button } from '@/components/ui/Button';
import { Heading } from '@/components/ui/Heading';
import { getFetchErrorMessage, messageBesideRetry } from '@/components/ui/useFetchErrorState';
import { StatusRegion, REGION_EMPTY_DWELL_MS } from '@/components/ui/StatusRegion';
import { isFocusLost, focusElement, focusPageFloor } from '@/components/ui/focusPageFloor';

// Copy row L1 (D-30, owner-ratified 2026-10-04), byte-equal to this route's own `loading.tsx` label.
const LOADING_LABEL = 'Loading your game night invite...';

// The page region's test handle. NOT EXPORTED, deliberately, for the reason the rsvp page records
// (`rsvp/[token]/page.js`, anchor `NOT EXPORTED, deliberately`): Next's generated route types reject
// a page module's non-route named exports. The test re-declares the literal.
const PAGE_STATUS_TESTID = 'game-invite-page-status';

// Strings this page already rendered before plan 88.6.1-19, hoisted so the branch markup and the
// screen-reader announcement read ONE source and cannot drift apart (no new words, D-31).
const JOINED_HEADLINE = "You're in!";
const ALREADY_JOINED_HEADLINE = "You're already in this game";
const ALREADY_JOINED_DETAIL = 'You joined earlier — see you there!';
const EXPIRED_HEADLINE = 'Game Night Has Passed';
const EXPIRED_DETAIL =
  'This game night has already passed. Ask the organizer for an invite to the next one!';
const TRANSIENT_HEADLINE = "Couldn't join game night";
const PERMANENT_HEADLINE = 'This invite is no longer valid';

// How long the page region stays EMPTY after a Retry press before it may be filled again:
// `REGION_EMPTY_DWELL_MS`, imported with `StatusRegion` above. Source: AT-4,
// planning:.planning/phases/88.6.1-non-look-a11y-and-correctness-residuals-from-88-6/research/APPENDIX-AT.md ("**The same message twice.**") (`emptyRegionSettleDelay { 100_ms }`, failure condition 4).
// AMENDED Phase 88.6.1-82: plan 88.6.1-19 declared a second copy here because this page and
// `FetchErrorBanner.tsx` shared no dependency; the constant now lives on `StatusRegion`, which this
// page already imports, so that reason is gone and the one declaration is imported, not repeated.

/** Join the non-empty parts of an announcement with one space (never a trailing space). */
function joinParts(...parts) {
  return parts.filter(Boolean).join(' ');
}

// POLL-05 status enum (D-INVITE-LANDING-04 zero-flash mandate):
// loading → preview (unauth) | joining → joined | already-joined | expired
//                                                | error-transient | error-permanent
function GameInvitePage() {
  const { token } = useParams();
  const router = useRouter();
  const { user, isLoading: authLoading } = useUser();

  const [status, setStatus] = useState('loading');
  const [eventInfo, setEventInfo] = useState(null);
  const [error, setError] = useState(null);
  // Bumped by handleRetry to re-fire both preview AND join effects when the
  // backend was unreachable on first attempt.
  const [retryKey, setRetryKey] = useState(0);
  /* DECISION Phase 88.9-52 (Q69-3, owner 2026-11-16 "approve all"): a JOIN 401 (the session
     expired) stays on the transient card but swaps Retry for the sign-in round trip, the restore
     page's sign-in recovery (restore/group/[token]/page.tsx, its Sign in to try again link) with
     this page's own returnTo, chosen OVER the shipped Retry: Retry re-sent the join with the same
     dead session and could never work. Keyed on the HTTP status alone, like isPermanent below.
     The connection hint under the line is left out on this arm (the remedy is not the
     connection); the register's session line and the restore page's link words are reused, no
     new string. Putting Retry back on a 401 is a decision, not a cleanup.
     AMENDED Phase 88.9-52 (PIX-5): the connection hint is now left out for every cause but a
     network failure; see the PIX-5 marker below.
     AMENDED Phase 88.9-52 (P3, owner 2026-11-17 "Drop"): the hint is gone for every cause. */
  const [needsSignIn, setNeedsSignIn] = useState(false);
  /* DECISION Phase 88.9-52 (PIX-5, picture pass, the Q69 as-is note): the small line under the
     failure sentence (Check your connection and try again.) shows ONLY when the failure is a
     network failure, read from ApiError.code (network), chosen OVER the shipped form, where it
     sat under every retryable failure: a 5xx card then gave two causes, "our end" in the
     register sentence and "your connection" in the small line. Every other retryable cause (5xx,
     429, the CSRF refusal, an unreadable 2xx, a raw transport error that carries no code) shows
     the register sentence and Retry alone. Keyed on the code, never on the message text (the
     classifier's rule below). No string was added or changed. Showing the line for another cause
     is a decision, not a cleanup.
     AMENDED Phase 88.9-52 (P3, owner 2026-11-17 "Drop"): the small line is REMOVED for a network
     failure too, and with it the connectionHint state this marker sat on and the line's string.
     Chosen OVER PIX-5's network-only form: on a network failure the register sentence above it
     already ends with the same words, so the card said them twice. The transient card is now the
     register sentence and Retry for every cause. Bringing the small line back, for any cause, is
     a decision, not a cleanup. */
  /* DECISION Phase 88.9-52 (R27, owner 2026-11-17 "Yes"): a join answered 410 with the envelope
     code account_deleted lands on the red X permanent card with the register's own sentence for
     that code (getFetchErrorMessage) and WITHOUT the contact-the-group-owner line, chosen OVER
     the grey passed-game-night card the status alone selected (untrue for this person) and OVER
     keeping the contact line (a new invite link cannot help a deleted account). This flag is
     what leaves that line out; it is set in the join catch only (the preview is public and has
     no account). Showing the contact line on this card is a decision, not a cleanup. */
  const [accountDeleted, setAccountDeleted] = useState(false);

  // Classify a thrown error as transient (retryable) or permanent. Used by
  // both the preview fetch catch and the join POST catch so backend-down /
  // network failures consistently land on the retry CTA, not the dead-end
  // "invite no longer valid" copy.
  const classifyError = (err) => {
    const httpStatus = err?.status;
    /* DECISION Phase 88.6-23 (D-45 / D-59): `isPermanent` decides on the HTTP STATUS ALONE —
       chosen OVER the five backend-prose arms it replaced (`expired`, `passed`, `full`,
       `deleted`, `Invalid invite`), which is the shape that ships today and the one a future
       reader is most likely to "restore" when a new copy string appears.

       WHY THE PROSE ARMS HAD TO GO. `ApiError.message` is
       `body.message ?? body.error ?? HTTP error! status: N` (api.ts `extractErrorMessage`).
       Plan 88.6-42 (wave 8) DROPS the `body.error` alias, after which every one of those five
       strings becomes `HTTP error! status: 410` and not one arm matches — on the public QR/SMS
       entry surface, silently. This plan is wave 7, so the re-key lands FIRST.

       WHY STATUS IS EXHAUSTIVE HERE, measured 2026-09-14 against the two routes this page
       calls: `GET /events/invite-preview/:token` and `POST /events/join-game-by-token`.
       `expired`/`passed` is emitted at exactly one place per route and both are 410
       (`routes/events.js`, one on each route); `Invalid invite link` is 404 (one on each route);
       `full` and `deleted` have NO emitter on either route at all. (There is also a second 404 —
       `User not found` on the join route — which lands permanent either way, so the mapping
       is unchanged by it.)

       AMENDED Phase 88.6.1-19 (W048 / WR-410): the paragraph that stood here said the transient
       arms were safe to leave because they matched only text the CLIENT produces. That was
       false. The text they read is the error's message, and for every HTTP error that is the
       backend envelope's own `message` (`extractErrorMessage` in `api.ts`), so a 404 or 410
       whose message happened to mention the network or fetching was classified transient and
       offered Retry on a dead link. Those arms are now DELETED — the status-0 and 5xx tests,
       the TypeError name test, the three message-text tests and the lower-cased message local —
       and the STATUS ALONE decides: 404 or 410 is permanent; everything else (status 0, any
       5xx, a thrown runtime error with no status) is transient. Status 0 and 5xx were never
       404/410, so deleting them changes no answer; the text arms could only ever turn a 404/410
       into "transient", which was the defect.
       REJECTED: the review's gated shape (keep the text arms, run them only when there is no
       HTTP status). Without a status `isPermanent` is already false, so the gated arms could
       never change the answer — dead code defended by a comment.
       Re-adding a message-text test to this classifier is a decision, not a cleanup.

       AMENDED Phase 88.9-52 (R27, owner 2026-11-17): this classifier still decides on the status
       alone, and a 410 account_deleted is permanent by it. What changed is the EXPIRED arm in the
       join catch below: it no longer keys on the 410 status alone, because the measurement above
       missed a second 410 on the join route, the auth layer's tombstone refusal
       (backend:Sonnet/middleware/auth0.js, sendError account_deleted, on every signed-in route).
       That arm now reads the envelope code, the remedy the 88.6-23 and 88.6-58 markers named;
       REJECTED again: matching the backend prose. */
    const isPermanent = httpStatus === 404 || httpStatus === 410;
    // Ambiguous → treat as transient. findOrCreate makes retry idempotent.
    return isPermanent ? 'permanent' : 'transient';
  };

  // POLL-05 race fix (D-INVITE-LANDING-04): single-shot in-flight guard.
  // The previous implementation listed `status` in the autoJoin effect's
  // deps array, so setStatus('joining') re-fired the effect and triggered
  // parallel joinGameByToken POSTs — which 500'd the second-arriving call
  // on the EventParticipations unique constraint and visibly bounced the UI
  // through 'already-joined' for a legitimate first-join. The ref keeps
  // the contract single-shot per page-load regardless of effect re-fires
  // (React 18 strict-mode dev double-render included). Belt-and-suspenders
  // alongside removing `status` from the dep array.
  const joiningRef = useRef(false);

  // Fetch event preview info (public, no auth needed)
  useEffect(() => {
    if (!token) {
      setStatus('error-permanent');
      setError('Invalid invite link');
      return;
    }

    let cancelled = false;

    async function fetchPreview() {
      try {
        const data = await eventsAPI.getEventInvitePreview(token);
        if (cancelled) return;
        setEventInfo(data);
      } catch (err) {
        if (cancelled) return;
        /* DECISION Phase 88.6-23 (D-45 / D-59): the expired branch is selected by the HTTP
           STATUS (410), chosen OVER the shipped
           `err.message.includes('expired') || err.message.includes('passed')` prose match.
           Same reason as the `isPermanent` marker above: plan 88.6-42 drops the `body.error`
           alias in wave 8 and every one of those strings becomes `HTTP error! status: 410`.
           PRECONDITION, verified 2026-09-14: `GET /events/invite-preview/:token` emits 410 at
           exactly ONE place (`routes/events.js`) and it is the has-already-passed gate,
           so 410 on this call means "passed" and nothing else. If a second 410 is ever added
           to that route, this branch needs an envelope `code` — it does not need the prose
           back. Pinned by `page.test.tsx`, whose 410/404 arms are built with the
           POST-alias-drop message shape so a green run proves the branch is alias-independent.
           AMENDED Phase 88.9-52 (R27, owner 2026-11-17): unchanged HERE, and still status-only:
           the preview is public (no auth layer in front of it), so its one 410 is still the
           has-passed gate. The JOIN catch below now reads the envelope code, because its route
           does have a second 410 (account_deleted). */
        if (err?.status === 410) {
          setStatus('expired');
          return;
        }
        // Network failures (backend down, offline, fetch error) classify as
        // transient so the user sees Retry, not a dead-end "invite no longer
        // valid" message. Permanent classification (404 token, etc.) keeps
        // its existing copy.
        const kind = classifyError(err);
        if (kind === 'transient') {
          setStatus('error-transient');
          // X68 (88.9-66, owner ruled 2026-11-14): the transient branch renders Retry, so its line
          // is the register line's beside-retry form.
          setError(messageBesideRetry(getFetchErrorMessage(err)));
        } else {
          setStatus('error-permanent');
          setError('This invite link is no longer valid.');
        }
      }
    }

    fetchPreview();
    return () => {
      cancelled = true;
    };
  }, [token, retryKey]);

  // Handle auth state after preview is loaded
  useEffect(() => {
    if (authLoading) return;
    if (!eventInfo) return;
    if (!user) {
      // Surface the auth gate first; once Auth0 returns to this page the
      // effect re-runs with user truthy and proceeds to autoJoin.
      setStatus('preview');
      return;
    }
    // Terminal states — never re-fire join from any of these.
    if (status === 'expired' || status === 'error-permanent') return;
    if (status === 'joined' || status === 'already-joined') return;

    // POLL-05: single-shot guard. Once we've fired the POST for this
    // page-load, never fire again — even if the effect re-runs because of
    // some unrelated dep change. Retry handler explicitly resets this.
    if (joiningRef.current) return;

    joiningRef.current = true;
    setStatus('joining');

    eventsAPI
      .joinGameByToken(token)
      .then((result) => {
        if (result?.already_joined) {
          setStatus('already-joined');
        } else if (result?.success) {
          setStatus('joined');
        } else {
          // Defensive: backend returned an unexpected shape.
          setStatus('error-transient');
          setError('Unexpected response from server.');
        }
      })
      .catch((err) => {
        // D-INVITE-LANDING-03: branch transient vs permanent via shared
        // classifier (also used by preview fetch). findOrCreate on the
        // backend makes retry idempotent.
        // R1 (SPEC DEF-88-25-01): the ratified register replaces the raw upstream text and
        // the hand-rolled "Failed to join game night." fallback. MUTATION-path failure, but
        // the toast arm of UI-SPEC §6.2 does not apply: this page IS the mutation and has no
        // other content to preserve context for, so the whole-page error branch below is the
        // placement, with the register supplying the words.
        //
        // DECISION Phase 88.6-58 (review MEDLOW-14): a join 410 selects the page's existing
        // `expired` state — the SAME arm as the preview catch above — because the join
        // handler's only 410 is the has-passed gate (Sonnet/routes/events.js, verified
        // 2026-09-28). Chosen OVER rendering the backend `message` (R1: never upstream text)
        // and OVER the register's generic 410 line (wrong copy for a known, authored state).
        // A second 410 on that route would need an envelope `code`, not prose.
        // AMENDED Phase 88.9-52 (R27, owner 2026-11-17): the join route HAS a second 410. The
        // auth layer in front of every signed-in route answers a deleted account 410 with the
        // envelope code account_deleted, so "the join handler's only 410" above is true of the
        // handler and false of the route. Chosen: the expired arm skips that code, which then
        // falls to the permanent card below with the register's account_deleted sentence;
        // superseded: selecting expired on the 410 status alone (88.6-58, and the 88.6-23
        // precondition it copied). Rejected: the passed-game-night card for a deleted account
        // (the owner saw it and ruled it untrue), and matching prose. The has-passed 410 carries
        // no envelope code and still lands on expired.
        if (err?.status === 410 && err?.code !== 'account_deleted') {
          setStatus('expired');
          return;
        }
        // R27 (88.9-52): the permanent card leaves its contact line out for a deleted account.
        setAccountDeleted(err?.code === 'account_deleted');
        // X68 (88.9-66): Retry shows on the transient branch only, so only that branch takes the
        // beside-retry form; the permanent branch keeps the register line.
        const permanent = classifyError(err) === 'permanent';
        // Q69-3 (88.9-52): a 401 renders the sign-in link in place of Retry, so it keeps the full
        // register line too.
        const signIn = err?.status === 401;
        setNeedsSignIn(signIn);
        setError(
          permanent || signIn ? getFetchErrorMessage(err) : messageBesideRetry(getFetchErrorMessage(err))
        );
        setStatus(permanent ? 'error-permanent' : 'error-transient');
      });
    // NOTE: `status` deliberately omitted from deps — its inclusion was the
    // root cause of the parallel-POST flicker bug.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [authLoading, user, eventInfo, token]);

  // Req 5: the settled branch's <h1> (only one renders at a time) and the one-shot Retry arm.
  // See the DECISION Phase 88.6.1-19 (R8 / Req 5) marker at the fragment below.
  const settledHeadingRef = useRef(null);
  // The pending card's line (loading or joining — one <p>, its label swaps). After a Retry it
  // replaces the pressed button, so it takes focus in flight (A-64, 88.6.1 code review).
  const pendingLineRef = useRef(null);
  const retryFocusArmedRef = useRef(false);

  // R8 idempotency: while this flag is on the page region reads '' (the announcement's leading
  // arm below). A Retry turns it on; a REGION_EMPTY_DWELL_MS timer turns it off. It is STATE, not
  // a ref, because the timer's end is what refills the region when the outcome committed first.
  // It gates ONLY the region's text — never the request, the branch, the Retry button or focus.
  const [regionDwell, setRegionDwell] = useState(false);
  const regionDwellTimerRef = useRef(null);
  useEffect(() => () => {
    if (regionDwellTimerRef.current) clearTimeout(regionDwellTimerRef.current);
  }, []);

  // Retry handler for transient errors. Resets the ref AND bumps retryKey
  // so BOTH the preview effect and the join effect re-fire — necessary when
  // the preview itself failed (e.g. backend was down on first attempt).
  const handleRetry = () => {
    retryFocusArmedRef.current = true;
    // A press while a dwell is running restarts it.
    if (regionDwellTimerRef.current) clearTimeout(regionDwellTimerRef.current);
    setRegionDwell(true);
    regionDwellTimerRef.current = setTimeout(() => {
      regionDwellTimerRef.current = null;
      setRegionDwell(false);
    }, REGION_EMPTY_DWELL_MS);
    joiningRef.current = false;
    setNeedsSignIn(false);
    setError(null);
    setStatus('loading');
    setEventInfo(null);
    setRetryKey((k) => k + 1);
  };

  // The focus edge for a Retry. In flight the arm STAYS on and, when focus is lost (the Retry
  // button unmounted under the user), the pending line takes it — never a floor in flight, or
  // focus would not read as lost at settle. On the first settled render the arm is dropped and,
  // only when focus is lost (the pending line has just unmounted), the settled heading takes it.
  useEffect(() => {
    if (!retryFocusArmedRef.current) return;
    if (authLoading || status === 'loading' || status === 'joining') {
      if (isFocusLost()) focusElement(pendingLineRef.current);
      return;
    }
    retryFocusArmedRef.current = false;
    if (!isFocusLost()) return;
    if (!focusElement(settledHeadingRef.current)) focusPageFloor();
  }, [status, authLoading]);

  // Format event date nicely
  const formatEventDate = (dateStr) => {
    if (!dateStr) return '';
    const date = new Date(dateStr);
    return date.toLocaleDateString('en-US', {
      weekday: 'long',
      month: 'long',
      day: 'numeric',
      year: 'numeric',
    });
  };

  // Build the canonical event detail URL. Phase 64-01 confirmed gameDetail
  // accepts ?event_id= for the canonical single-event surface.
  // Phase 71.1-02 Blocker 1 fix: include group_id when available. Without
  // group_id, gameDetail's `if (group_id && user?.sub)` branch never runs —
  // groupMembers is never fetched, userScope stays 'none', and the
  // participants strip + Leave kebab don't render. The /invite-preview
  // endpoint now returns group_id (Plan 71.1-02 Blocker 1 backend fix).
  const goToEventHref = eventInfo?.event_id
    ? (eventInfo.group_id
        ? `/gameDetail?event_id=${eventInfo.event_id}&group_id=${eventInfo.group_id}`
        : `/gameDetail?event_id=${eventInfo.event_id}`)
    : '/';

  // Render values shared by the branch markup AND the announcement below — one source each, with
  // the same fallbacks the markup has always used.
  const gameName = eventInfo?.game_name || 'Game Night';
  const eventDateLabel = formatEventDate(eventInfo?.event_date);

  // Loading / joining state — brief spinner only. D-INVITE-LANDING-04
  // mandates legit first-joins go loading → joining → joined without
  // bouncing through 'already-joined'.
  const isPending = authLoading || status === 'loading' || status === 'joining';

  // The announcement MIRRORS the render dispatch below, in order, so it can never describe a
  // branch other than the one on screen. Loading and joining yield '' — the region must be
  // mounted and empty first, or there is no CHANGE for a screen reader to announce.
  let announcement = '';
  if (regionDwell) {
    announcement = '';
  } else if (isPending) {
    announcement = '';
  } else if (status === 'preview' && eventInfo) {
    announcement = joinParts(gameName, eventDateLabel);
  } else if (status === 'joined') {
    announcement = eventInfo
      ? joinParts(JOINED_HEADLINE, gameName, eventDateLabel)
      : JOINED_HEADLINE;
  } else if (status === 'already-joined') {
    announcement = joinParts(ALREADY_JOINED_HEADLINE, ALREADY_JOINED_DETAIL);
  } else if (status === 'expired') {
    announcement = joinParts(EXPIRED_HEADLINE, EXPIRED_DETAIL);
  } else if (status === 'error-transient') {
    announcement = joinParts(TRANSIENT_HEADLINE, error);
  } else if (status === 'error-permanent') {
    announcement = joinParts(PERMANENT_HEADLINE, error);
  }

  let body;
  if (isPending) {
    const label = status === 'joining' ? 'Joining game night...' : LOADING_LABEL;
    body = (
      <div className="min-h-screen bg-surface-page flex items-center justify-center">
        <div className="bg-surface-card rounded-card shadow-theme-md p-8 max-w-md w-full mx-4 text-center">
          <div className="inline-block w-8 h-8 border-4 border-line border-t-accent rounded-full animate-spin mb-4" />
          <p ref={pendingLineRef} className="text-content-primary">{label}</p>
        </div>
      </div>
    );
  } else {
    body = (
    <div className="min-h-screen bg-surface-page flex items-center justify-center">
      <div className="bg-surface-card rounded-card shadow-theme-md p-8 max-w-md w-full mx-4">

        {/* Preview state (unauthenticated) */}
        {status === 'preview' && eventInfo && (
          <div className="text-center">
            <div className="mx-auto mb-4 w-16 h-16 bg-surface-accent-subtle-strong rounded-full flex items-center justify-center">
              <svg className="w-8 h-8 text-content-accent-strong" aria-hidden="true" focusable="false" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={1.5}>
                {/* DECISION Phase 88.3-18 (owner ruling on Req 12 UAT test 5, 2026-08-28): a
                    hand-authored SIX-SIDED DIE replaces a MANGLED Heroicons puzzle-piece path.
                    Owner, looking at the shipped screen on a phone: "It just looks like squiggles
                    to me." He was right and the cause is a genuine corruption, not a taste call:
                    the old 693-char `d` spliced a real `M14.25 6.087...` puzzle-piece OPENING onto
                    two trailing dot-circles (`M12.75 16.5a.75.75 0 11-1.5 0...`) that belong to a
                    DIFFERENT icon. It has been on prod since Phase 36-03 and was the only
                    occurrence of that string in `src/` (verified 2026-08-28).
                    CHOSEN a die over (REJECTED) a CORRECT Heroicons puzzle-piece path: the owner's
                    product is board games, so a die says what the screen is for in a way a puzzle
                    piece never did. Hand-authored on purpose — NO ICON LIBRARY WAS ADDED to the
                    tree for one glyph. Geometry: a stroked rounded-square body on the existing
                    24x24 viewBox (x/y 3.75-20.25, corner radius 2.5) plus a five-pip face as
                    filled circles at r=1.25.
                    ⚠ THE `<svg>` OPENING TAG ABOVE IS BYTE-UNCHANGED, deliberately:
                    src/app/tintTreatment.test.ts ("Object.entries(EXPECTED_DECORATIVE)") (anchor `<svg className="w-8 h-8 ${STRONG_TEXT}"`) counts `className="w-8 h-8 text-content-accent-strong"`
                    openings and expects exactly 2 in this file, and src/app/accentSweep.test.ts ("Glyphs on amber-100 circles")
                    lists
                    this file in its seven-circle census. Both suites were re-run green after this
                    edit. Restyling the tag, or swapping this glyph back, is a decision. */}
                <path strokeLinecap="round" strokeLinejoin="round" d="M6.25 3.75h11.5a2.5 2.5 0 012.5 2.5v11.5a2.5 2.5 0 01-2.5 2.5H6.25a2.5 2.5 0 01-2.5-2.5V6.25a2.5 2.5 0 012.5-2.5z" />
                <circle cx="8.25" cy="8.25" r="1.25" fill="currentColor" stroke="none" />
                <circle cx="15.75" cy="8.25" r="1.25" fill="currentColor" stroke="none" />
                <circle cx="12" cy="12" r="1.25" fill="currentColor" stroke="none" />
                <circle cx="8.25" cy="15.75" r="1.25" fill="currentColor" stroke="none" />
                <circle cx="15.75" cy="15.75" r="1.25" fill="currentColor" stroke="none" />
              </svg>
            </div>
            <Heading level={1} size="display" className="text-content-primary mb-2" ref={settledHeadingRef}>
              {gameName}
            </Heading>
            <p className="text-content-muted mb-6">
              {eventDateLabel}
            </p>
            {/* UI-SPEC §3.2 `asChild`: the element stays an `<a>` — a client-router
                navigation to the Auth0 handoff route is a behaviour change, not a cleanup —
                and the `href` is byte-identical. Surviving utilities go on `<Button
                className>`, never on the slotted child (Slot concatenates without
                tailwind-merge). `block` is dead under unlayered `.btn`'s
                `display: inline-flex` (globals.css, anchor `.btn {`); `w-full` and `text-center` are not. */}
            <Button asChild variant="primary" size="default" className="w-full text-center">
              <a
                href={`/api/auth/login?returnTo=${encodeURIComponent(`/invite/game/${token}`)}`}
              >
                Join Game Night
              </a>
            </Button>
            <p className="text-xs text-content-muted mt-4">
              Don&apos;t have an account? Signing in will create one automatically.
            </p>
          </div>
        )}

        {/* Joined state — D-INVITE-LANDING-01: welcome card + explicit
            "Go to event" button. NO auto-redirect, ever. */}
        {status === 'joined' && (
          <div className="text-center">
            <div className="mx-auto mb-4 w-16 h-16 bg-status-success-subtle rounded-full flex items-center justify-center">
              <span className="text-3xl" role="img" aria-label="game die">🎲</span>
            </div>
            <Heading level={1} size="display" className="text-content-primary mb-2" ref={settledHeadingRef}>
              {JOINED_HEADLINE}
            </Heading>
            {eventInfo && (
              <div className="mb-6 p-4 bg-surface-elevated rounded-lg">
                <p className="font-bold text-content-primary">{gameName}</p>
                <p className="text-sm text-content-muted mt-1">{eventDateLabel}</p>
              </div>
            )}
            <Button
              variant="primary"
              size="default"
              onClick={() => router.push(goToEventHref)}
              className="w-full text-center"
            >
              Go to event
            </Button>
            <p className="text-xs text-content-muted mt-4">
              We&apos;ve added you to the participant list.
            </p>
          </div>
        )}

        {/* Already-joined state — D-INVITE-LANDING-02: distinct softer copy
            so the user knows the link wasn't broken. */}
        {status === 'already-joined' && (
          <div className="text-center">
            <div className="mx-auto mb-4 w-16 h-16 bg-surface-accent-subtle-strong rounded-full flex items-center justify-center">
              <svg className="w-8 h-8 text-content-accent-strong" aria-hidden="true" focusable="false" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M9 12.75L11.25 15 15 9.75M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
              </svg>
            </div>
            {/* h1 @ 20 STAYS at 20 (D-04's second row): this is a mutually-exclusive STATUS
                branch, not the page title. The `ErrorFallback` precedent
                (src/app/typeScaleTouchedSurfaces.test.ts ("'components/ui/ErrorFallback.tsx': { 1: 1 }")) is why level and size are
                separate facts. Promoting it to Display would be the demotion-in-reverse the
                88-29 amendment describes. */}
            <Heading level={1} size="heading" className="text-content-primary mb-2" ref={settledHeadingRef}>
              {ALREADY_JOINED_HEADLINE}
            </Heading>
            <p className="text-content-secondary mb-4">
              {ALREADY_JOINED_DETAIL}
            </p>
            {eventInfo && (
              <div className="mb-6 p-4 bg-surface-elevated rounded-lg">
                <p className="font-bold text-content-primary">{gameName}</p>
                <p className="text-sm text-content-muted mt-1">{eventDateLabel}</p>
              </div>
            )}
            <Button
              variant="primary"
              size="default"
              onClick={() => router.push(goToEventHref)}
              className="w-full text-center"
            >
              Go to event
            </Button>
          </div>
        )}

        {/* Expired state */}
        {status === 'expired' && (
          <div className="text-center">
            <div className="mx-auto mb-4 w-16 h-16 bg-surface-elevated rounded-full flex items-center justify-center">
              <svg className="w-8 h-8 text-content-muted" aria-hidden="true" focusable="false" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={1.5}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M12 6v6h4.5m4.5 0a9 9 0 11-18 0 9 9 0 0118 0z" />
              </svg>
            </div>
            <Heading level={1} size="heading" className="text-content-primary mb-2" ref={settledHeadingRef}>
              {EXPIRED_HEADLINE}
            </Heading>
            <p className="text-content-muted mb-6">
              {EXPIRED_DETAIL}
            </p>
            <Button asChild variant="primary" size="default" className="w-full text-center">
              <Link href="/">
                Go Home
              </Link>
            </Button>
          </div>
        )}

        {/* Transient error — D-INVITE-LANDING-03 transient branch: inline
            error + Retry button. Network failures, 5xx, ambiguous errors.
            AMENDED Phase 88.9-52 (PIX-5): the small connection line under the error shows for a
            network failure only (the PIX-5 marker above); without it the error
            line carries the 24px gap to Retry, as the sign-in arm's does.
            AMENDED Phase 88.9-52 (P3, owner 2026-11-17 "Drop"): the small line never shows now,
            so the error line always carries the 24px gap to Retry. */}
        {/* DECISION Phase 88.9-52 (Q69-2 / Q69-3, owner 2026-11-16 "approve all"): this card draws
            the X on the amber warning pair (the group invite page's amber arm: warning ink on the
            warning circle, 5.50 light / 4.95 dark), chosen OVER the shipped warning triangle on
            the red pair. Amber X says trying again may work; the red X below says the link is
            dead; the grey clock on the passed game night is untouched (Q69-4). */}
        {status === 'error-transient' && (
          <div className="text-center">
            <div className="mx-auto mb-4 w-16 h-16 bg-status-warning-subtle rounded-full flex items-center justify-center">
              <svg className="w-8 h-8 text-content-status-warning" aria-hidden="true" focusable="false" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
              </svg>
            </div>
            <Heading level={1} size="heading" className="text-content-primary mb-2" ref={settledHeadingRef}>
              {TRANSIENT_HEADLINE}
            </Heading>
            {needsSignIn ? (
              <>
                <p className="text-content-secondary mb-6">{error}</p>
                {/* Stays an <a>: the Auth0 handoff needs a hard navigation, and the href is the
                    preview branch's own returnTo, so signing in lands back here and the join
                    runs again with a live session. */}
                <Button asChild variant="primary" size="default" className="w-full text-center mb-2">
                  <a
                    href={`/api/auth/login?returnTo=${encodeURIComponent(`/invite/game/${token}`)}`}
                  >
                    Sign in to try again
                  </a>
                </Button>
              </>
            ) : (
              <>
                <p className="text-content-secondary mb-6">{error}</p>
                <Button
                  variant="primary"
                  size="default"
                  onClick={handleRetry}
                  className="w-full text-center mb-2"
                >
                  Retry
                </Button>
              </>
            )}
            <Link
              href="/"
              className="block w-full text-center text-sm text-content-muted hover:text-content-secondary mt-2"
            >
              Go Home
            </Link>
          </div>
        )}

        {/* Permanent error — D-INVITE-LANDING-03 permanent branch: inline
            error + manual contact CTA. NO retry button — retrying won't fix
            an expired/full/deleted event. */}
        {status === 'error-permanent' && (
          <div className="text-center">
            <div className="mx-auto mb-4 w-16 h-16 bg-status-error-subtle rounded-full flex items-center justify-center">
              <svg className="w-8 h-8 text-content-status-error" aria-hidden="true" focusable="false" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
              </svg>
            </div>
            <Heading level={1} size="heading" className="text-content-primary mb-2" ref={settledHeadingRef}>
              {PERMANENT_HEADLINE}
            </Heading>
            <p className="text-content-secondary mb-6">{error}</p>
            {/* R27 (88.9-52): left out for a deleted account; see the marker on accountDeleted. */}
            {!accountDeleted && (
              <p className="text-sm text-content-muted mb-6">
                Contact the group owner for a new invite link.
              </p>
            )}
            <Button asChild variant="primary" size="default" className="w-full text-center">
              <Link href="/">
                Go Home
              </Link>
            </Button>
          </div>
        )}

      </div>
    </div>
    );
  }

  /* DECISION Phase 88.6.1-19 (R8 / Req 5): three choices on this page, each with its rejects.

     THE REGION. ONE always-mounted `StatusRegion` at FRAGMENT SLOT 0, rendered from this
     component and never from inside a branch — ported from `DECISION Phase 88.6-24`
     (`rsvp/[token]/page.js`) and `DECISION Phase 88.6-23` (`availability-form/[token]/page.js`).
     React reconciles same-type children by index, so it is the SAME DOM node across every branch
     flip. REJECTED (1) a region inside each branch (mounted with its text, a polite region
     announces nothing; D-42 keeps that premise for polite/status regions); (2) hoisting the
     shared outer wrapper (a fragment adds no box and matches both shipped siblings); (3) a route
     layout (a server-rendered shell cannot read this client page's state). sr-only, because it
     repeats a heading already on screen; D-22's opt-in empty-state prop is NOT adopted (always
     sr-only, ST-2 group A). The region and the focused heading may both speak the heading in the
     same moment; the availability-form SUBMITTED precedent accepts that.

     THE RETRY FOCUS. Pressing Retry swaps in the loading card and removes the button the user
     pressed. CHOSEN: the settled branch's <h1> takes focus ONCE, on the first settled render
     after a Retry, and only when focus is lost (`isFocusLost`, plan 88.6.1-04's one definition);
     a heading that will not take focus falls to the shared `focusPageFloor`, never <body>.
     AMENDED 2026-10-19 (88.6.1 code review A-64): while the retry is IN FLIGHT the pending line
     (the loading / joining <p> that replaced the pressed Retry) takes focus, only when focus is
     lost, and the arm stays on until settle — the restore page's in-flight arm
     (`restore/group/[token]/page.tsx`, `DECISION Phase 88.6.1-36`), so one Retry-removes-the-
     button rule has one treatment. Focus is the ONE channel for that line; the region stays ''
     (the dwell below is unchanged). REJECTED: leaving focus on <body> in flight — a silent wait
     on a slow phone request (WCAG 4.1.3) and a keyboard user parked nowhere; a floor in flight —
     focus would sit on a connected `main` and not read as lost at settle, so the heading move
     would never fire.
     REJECTED (a) keeping Retry mounted with aria-disabled across the request — a success still
     replaces the branch and removes it, so the heading move is needed anyway; it would drop
     today's loading card (a visible change) and need an in-flight label the owner has not
     ratified (D-31). (b) plan 04's `useFocusRecovery` — its check acts on the FIRST commit that
     loses focus, which here is the loading commit, before any heading exists, so it would floor
     to <main> and disarm before the outcome renders. (c) focusing on first load — an unrequested
     jump; no control the user operated was removed. (d) focusing the re-mounted Retry after a
     repeat failure — two targets for one rule; Retry is the next Tab stop after the heading.

     THE REGION DWELL. CHOSEN: the region stays '' from the press until the outcome has committed
     AND `REGION_EMPTY_DWELL_MS` has passed — the value named from its source, AT-4,
     planning:.planning/phases/88.6.1-non-look-a11y-and-correctness-residuals-from-88-6/research/APPENDIX-AT.md ("**The same message twice.**") (`emptyRegionSettleDelay`, WebKit's re-announce condition
     for identical text). REJECTED (e) relying on the round trip for the gap: an offline failure
     rejects in milliseconds (`publicFetch`'s TypeError arm in `api.ts`, anchor
     `if (errName === 'TypeError'`). (f) delaying the request instead
     of the region fill — it slows every retry for a screen-reader-only concern. (g) importing
     plan 88.6.1-21's module-private constant — the two files share no dependency; both cite the
     same appendix line instead, so the values cannot drift silently. [AMENDED Phase 88.6.1-82,
     recorded 2026-10-19 (88.6.1 code review A-63): (g) is SUPERSEDED — the constant now lives on
     `StatusRegion` and this page imports it (see the note above `joinParts` at the top of the
     file); the import is what ships, not a rejected alternative.]
     Changing any of this is a decision, not a cleanup. */
  return (
    <>
      <StatusRegion
        className="sr-only"
        data-testid={PAGE_STATUS_TESTID}
        message={announcement}
      />
      {body}
    </>
  );
}

export default GameInvitePage;
