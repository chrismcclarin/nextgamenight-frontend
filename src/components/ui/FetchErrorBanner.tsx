'use client';

/**
 * FetchErrorBanner — PRIM-03 presentational fetch-error surface (D-02).
 *
 * The canonical amber error banner: composes {@link Banner} (warning tone on
 * `status-*` tokens — its internal StatusRegion is the ASSERTIVE region that carries the
 * title and message, and its tone Icon supplies the leading glyph), plus a DIRECT
 * {@link Icon} on each action button and a DIRECT, POLITE {@link StatusRegion} for
 * transient "Retrying…" feedback and a failed retry's outcome (a sibling of Banner's
 * assertive region, never nested). The action buttons render in Banner's `actions`
 * slot: inside the box, OUTSIDE the atomic alert (Phase 88.6.1-21, D-42).
 *
 * Pair it with {@link useFetchErrorState}: pass the derived `state`. The FULL branch keeps
 * its Banner mounted in both states — visually hidden (`sr-only`) and EMPTY while
 * `state.showError` is false — so the failure arrives as text injected into a mounted
 * assertive region (Phase 88.6.1-21, AC-11). The `compact` branch renders its `sr-only`
 * polite live region EMPTY and nothing else, so the notice arrives as a CHANGE to a mounted
 * region (plan 88.6-36 — see the DECISION marker at that branch); after a retry KNOWN to have
 * failed, the notice reads copy row B1 (`COMPACT_NOTICE_AFTER_FAILED_RETRY`; Phase 88.6.1-21,
 * D-47). The "Report this" CTA appears only after a retry has failed (owner ruling 2026-10-05,
 * `state.retryFailed`, Phase 88.6.1-69) and opens the app-level report form
 * (`FeedbackModalProvider`'s `openReport`) prefilled with `initialType='bug'`, a derived
 * `initialSubject`, and an `initialDescription` carrying the error `code`/message
 * (no token/PII — T-86-10). The message is rendered as auto-escaped React
 * children (T-86-09): no `dangerouslySetInnerHTML`.
 *
 * Corrected in place, Phase 88.6.1-70: the module now exports `FetchErrorBanner` (full and
 * compact, with an optional host `focusTarget`), `RefreshFailedNotice` (copy row RF1 over content
 * a failed refresh kept on screen; its CONSUMER CONTRACT C1-C12 is the docblock above it),
 * `SectionLoadFailedNotice` (a section whose read failed and never loaded, owner ruling D8-r2),
 * `useRetainedContent` and `isAccessOrGoneError` (C10: an access or gone answer is never a
 * refresh failure) and `RetainedContentFocusGuard` (C12 a: focus when withdrawn content leaves).
 * The three components share ONE retry mechanism (`useRetryEpisode`) and the small notices ONE
 * row (`NoticeRow`); every retry control watches its own focus (C12 b), so a refresh nobody
 * pressed never drops a focused control to the page body.
 */
import * as React from 'react';
import { QueryClientContext, hashKey, type QueryKey } from '@tanstack/react-query';

import { Banner } from './Banner';
import { Icon } from './Icon';
import { StatusRegion, REGION_EMPTY_DWELL_MS } from './StatusRegion';
import { useFeedbackReport } from '@/app/components/FeedbackModalProvider';
import { logger, errCtx } from '@/lib/logger';
import { RETRY_OUTCOME_WINDOW_MS, type FetchErrorCode, type FetchErrorState } from './useFetchErrorState';
import { useFocusRecovery } from './useFocusRecovery';
import { DIALOG_ROLE_SELECTOR, focusElement, focusPageFloor, isFocusLost, isOpenDialog } from './focusPageFloor';

export interface FetchErrorBannerProps {
  /** Derived state from {@link useFetchErrorState}. */
  state: FetchErrorState;
  /** Bold heading above the message. */
  title?: string;
  /** Subject prefilled into the bug-report form. */
  reportSubject?: string;
  /** Human context (surface/action) folded into the report description. */
  reportContext?: string;
  /**
   * Compact one-line non-blocking degrade notice (D-08). When true, on a
   * PERMANENT failure (`state.showError` — retries exhausted) render a single
   * line plus the retry button, skipping the full Banner and its report link.
   * Used by identity-resolution consumers so a failed `useSelfIdentity` degrades
   * loudly-but-small instead of silently (D-11). The notice carries NO identity
   * value (Security: PII-in-notice mitigation, T-873-02-01).
   */
  compact?: boolean;
  /* DECISION Phase 88.6.1-70 (Req 5, focusTarget): an OPTIONAL host target, wired to plan 04's
     `fallback` slot (the section-heading role D-05 gives it), on both branches and on
     `RefreshFailedNotice`, through the one `useRetryEpisode` call. REJECTED: (a) the floor alone
     for the RF1 notices — they sit mid-page, and on a phone `main h1` is a screen or more above
     the section the user was reading; (b) a required prop — the existing mounts and the
     dialog-hosted notices need none; (c) inline focus code in this file (D-04). It also serves the
     bell's banner mount (`planning-briefs/revision-lap-3-manifest.md` row 44, the owner's options
     R2 and R3). Changing this is a decision, not a cleanup. */
  /**
   * The heading of the section this banner belongs to: where focus goes after a successful retry
   * removes the control (D-05). Omit it inside a `Modal` (the floor finds the dialog's title) or
   * when the page's `main h1` IS that heading; absent, the floor is unchanged (plan 21's
   * behaviour).
   */
  focusTarget?: React.RefObject<HTMLElement | null>;
}

/**
 * The compact degrade notice, declared ONCE so the visible line and the live region carry the
 * byte-identical string. P1: this is the shipped copy hoisted into a constant, not new copy —
 * no character of it changed in plan 88.6-36.
 *
 * Extended in place, Phase 88.6.1-21: there are now TWO constants, each carried byte-identically
 * by the visible line AND the live region. `COMPACT_NOTICE` is the shipped copy above;
 * `COMPACT_NOTICE_AFTER_FAILED_RETRY` is NEW copy, ratified by the owner on 2026-10-05 (D-47,
 * copy row B1), shown once a retry is KNOWN to have failed.
 *
 * Extended in place, Phase 88.6.1-70: there are now THREE constants under the same both-carriers
 * rule. `REFRESH_FAILED_NOTICE` is NEW copy, ratified by the owner on 2026-10-05 (copy row RF1,
 * D-47), carried byte-identically by `RefreshFailedNotice`'s visible line and its one polite
 * region. It is the only line in this file that holds that sentence: docblocks and markers name
 * the constant and never quote it (D-30).
 */
const COMPACT_NOTICE = 'Some personal controls are unavailable.';
const COMPACT_NOTICE_AFTER_FAILED_RETRY = 'Some personal controls are still unavailable.';
const REFRESH_FAILED_NOTICE = "Couldn't refresh. Showing what loaded earlier.";

// REGION_EMPTY_DWELL_MS (the compact region's empty dwell, AT-4) is imported from `./StatusRegion` (moved there by plan 88.6.1-82); RETRY_OUTCOME_WINDOW_MS below is at least that value.

// RETRY_OUTCOME_WINDOW_MS (how long a retry's outcome may wait for the committed state to agree,
// Phase 88.6.1-21, round-2 review #23) is declared in `./useFetchErrorState`, which also expires
// its own settled attempts with it (88.6.1 code review A-78), and re-exported here unchanged.
export { RETRY_OUTCOME_WINDOW_MS } from './useFetchErrorState';

/** An outcome read from the retry's own result, waiting for the committed state to agree. */
type RetryOutcome = 'none' | 'awaitFailed' | 'awaitSucceeded';

/**
 * Reads a retry's OWN result: an object whose `isError` is `true` failed, `false` succeeded;
 * anything else (an adapter that resolves no outcome, a rejection) is unknown. TanStack's
 * `refetch()` resolves a result carrying `isError`.
 */
function classifyRetryResult(result: unknown): 'failed' | 'succeeded' | 'unknown' {
  if (typeof result !== 'object' || result === null) return 'unknown';
  const { isError } = result as { isError?: unknown };
  if (isError === true) return 'failed';
  if (isError === false) return 'succeeded';
  return 'unknown';
}

/** Options for {@link useRetryEpisode}, the one retry mechanism every retry in this file uses. */
type RetryEpisodeOptions = {
  /** The derived fetch-error state; a press runs its `retry`. */
  state: FetchErrorState;
  /**
   * Whether THIS component shows the failure right now: `state.showError` for the banner, and
   * `state.showError && retained` (never an access or gone answer) for the RF1 notice.
   */
  failureShown: boolean;
  /** Empty the polite region from a press for at least `REGION_EMPTY_DWELL_MS`. */
  dwellOnPress: boolean;
  /** Mounted while the failure already shows: keep the region empty on the first commit. */
  quietOnMount: boolean;
  /** The host's section heading: plan 04's `fallback`, where focus goes when a control leaves. */
  focusTarget?: React.RefObject<HTMLElement | null>;
};

/* DECISION Phase 88.6.1-70 (one mechanism): plan 21's retry machinery lives in this ONE
   module-private hook, used by `FetchErrorBanner` (both branches), `RefreshFailedNotice` and
   `SectionLoadFailedNotice`. It moved UNCHANGED in behaviour, with two substitutions only: the
   committed-state reads that were `state.showError` read `failureShown` (the RF1 notice shows a
   failure only while content is retained), and the press dwell that was keyed on `compact` is
   keyed on `dwellOnPress`. REJECTED: a second copy of the machinery for the new notices — two
   copies of a latch, a dwell and an outcome rule drift apart (tenet: one mechanism). Changing
   this is a decision, not a cleanup. */
function useRetryEpisode(options: RetryEpisodeOptions) {
  const { state, failureShown, dwellOnPress, quietOnMount, focusTarget } = options;
  const [retrying, setRetrying] = React.useState(false);
  // A retry in THIS failure episode is KNOWN to have failed (its own result said so and the
  // committed state agreed).
  const [retryFailedAgain, setRetryFailedAgain] = React.useState(false);
  const [retryOutcome, setRetryOutcome] = React.useState<RetryOutcome>('none');
  // False from a compact press until REGION_EMPTY_DWELL_MS has passed (the B1 marker).
  // AMENDED Phase 88.6.1-70 (quietOnMount): also false from a MOUNT while the failure already
  // shows, read on the first render only, so that notice fills its region after the dwell.
  const [regionDwellDone, setRegionDwellDone] = React.useState(() => !(quietOnMount && failureShown));
  const quietAtMountRef = React.useRef(!regionDwellDone);

  const retryInFlightRef = React.useRef(false);
  const outcomeTimerRef = React.useRef<ReturnType<typeof setTimeout> | null>(null);
  const dwellTimerRef = React.useRef<ReturnType<typeof setTimeout> | null>(null);
  const mountedRef = React.useRef(true);
  // `state.showError` went false during this flight, so the assertive region empties and
  // refills — and that refill already speaks the title (round-2 review #176).
  const assertiveChangedRef = React.useRef(false);
  const retryRecovery = useFocusRecovery({ fallback: focusTarget });

  // Resolve a pending outcome against the COMMITTED state, at render — React's documented
  // adjust-state-while-rendering pattern. Each arm is guarded by a state comparison, so it fires
  // once per transition and never loops; a `useEffect` would paint one frame of the old state.
  if (retryOutcome === 'awaitFailed' && failureShown) {
    setRetryFailedAgain(true);
    setRetryOutcome('none');
  } else if (retryOutcome === 'awaitSucceeded' && !failureShown) {
    setRetryFailedAgain(false);
    setRetryOutcome('none');
  } else if (retryOutcome === 'none' && !retrying && !failureShown && retryFailedAgain) {
    // The failure episode ended with no retry in flight (see the B1 marker for its measured limit).
    setRetryFailedAgain(false);
  }
  if (retrying && !failureShown) assertiveChangedRef.current = true;

  // A resolved outcome needs no expiry; an unmounted banner gets no late state update.
  React.useEffect(() => {
    if (retryOutcome !== 'none' || outcomeTimerRef.current === null) return;
    clearTimeout(outcomeTimerRef.current);
    outcomeTimerRef.current = null;
  }, [retryOutcome]);
  React.useEffect(() => {
    const mounted = mountedRef;
    const outcomeTimer = outcomeTimerRef;
    const dwellTimer = dwellTimerRef;
    mounted.current = true;
    return () => {
      mounted.current = false;
      if (outcomeTimer.current !== null) clearTimeout(outcomeTimer.current);
      outcomeTimer.current = null;
      if (dwellTimer.current !== null) clearTimeout(dwellTimer.current);
      dwellTimer.current = null;
    };
  }, []);
  // A notice MOUNTED while its failure already shows (a remount, a key switch back to an errored
  // cache) renders its polite region EMPTY on the first commit and fills it after the dwell: an
  // inserted polite region carrying text is not announced (StatusRegion's EMPTY-FIRST bullet,
  // D-42). The timer goes through `dwellTimerRef`, so the unmount cleanup above clears it.
  React.useEffect(() => {
    if (!quietAtMountRef.current) return;
    dwellTimerRef.current = setTimeout(() => {
      dwellTimerRef.current = null;
      setRegionDwellDone(true);
    }, REGION_EMPTY_DWELL_MS);
  }, []);

  /* DECISION Phase 88.6.1-21 (R123 / W064 / Req 5): both retries (the compact `Retry` and the
     full `Try again`) are gated in flight by `aria-disabled` plus a synchronous first-line REF
     latch (`retryInFlightRef`) — D52's idiom, `R123-RULING: extend-d52`, house template
     `RsvpSection.js:65` (`const statusLatch = useRef(false);`). The gated look is COLOUR
     (`aria-disabled:text-content-muted`, the ghost variant's gated ink, `Button.tsx:209`). The
     shared recovery hook is armed at the press with `from: event.currentTarget` (Safari does not
     focus a clicked button) and NO fallback: this primitive owns no section heading, and
     `focusPageFloor` resolves the open dialog's title, else `main h1`, else `main` (D-05, D-07).

     REJECTED, each so it is not re-proposed as a tidy-up:
     (a) the native disabled attribute — it drops focus from the control the user pressed (the
         rule of POSITION, `DECISION Phase 88.6-22`, `FriendInvitePanel.js:59`);
     (b) an opacity utility under ANY variant prefix (the 88.8 colour rule; `tokenContrast.test.ts`
         53(b2)'s regex is blind to a prefixed form — a blind spot, not a permission);
     (c) a state-only guard: two activations in one tick both read the stale `retrying`;
     (d) a caller-supplied focus-target prop (33 mounts, none edited here; the floor already
         reaches the dialog title or the page heading; plan 88.6.1-70 is scheduled to amend this
         item in place with an OPTIONAL `focusTarget` tried before the floor);
         AMENDED Phase 88.6.1-70 (Req 5, focusTarget): that OPTIONAL `focusTarget` now exists on
         `FetchErrorBanner` and `RefreshFailedNotice`, passed to this hook as its `fallback`.
         (d)'s reasoning still holds for every existing mount, none of which passes it; it was
         added for the RF1 consumers, which sit mid-page, and for the bell's banner mount.
     (e) inline focus code in this file (D-04: one shared hook, never per-host copies).

     DISCLOSED DELTA: while retrying, the link ink turns muted instead of the former half-opacity
     wash. LIMIT, named honestly: where the CALLER swaps the banner out for the retry (a never-loaded
     TanStack query reports `pending`, so `showError` is false from the press to the outcome), the
     in-flight look is never seen and the hook's floor is what catches focus — at the press. That
     derivation is outside this file (Phase 92, `.planning/deferred/phase-92.md`).

     AMENDED Phase 88.6.1-70 (C12 b): every retry control in this file (the shared row's `Retry`,
     `Try again`, `Report this`) also arms the SAME hook instance when it takes FOCUS and settles
     at once (`watchFocus`, plan 04 contract (8)), skipped while a press is in flight, so the press
     arm above is untouched. A refresh nobody pressed (`useFetchErrorState`'s tab-return
     re-attempt on `visibilitychange`) that removes a focused control then still lands focus on
     the host target or the floor, never `<body>`; a user who moved to another live control has
     already disarmed it. REJECTED: an arm tied to the tab-return effect (it lives in
     `useFetchErrorState`, which owns no target), and extending plan 04 with a press-free arm (its
     published arm plus settle already express a watch). */
  const handleRetry = async (event: React.MouseEvent<HTMLButtonElement>) => {
    if (retryInFlightRef.current) return;
    retryInFlightRef.current = true;
    const settle = retryRecovery.arm({ from: event.currentTarget });
    if (outcomeTimerRef.current !== null) {
      clearTimeout(outcomeTimerRef.current);
      outcomeTimerRef.current = null;
    }
    assertiveChangedRef.current = false;
    if (dwellOnPress) {
      if (dwellTimerRef.current !== null) clearTimeout(dwellTimerRef.current);
      setRegionDwellDone(false);
      dwellTimerRef.current = setTimeout(() => {
        dwellTimerRef.current = null;
        setRegionDwellDone(true);
      }, REGION_EMPTY_DWELL_MS);
    }
    setRetrying(true);
    setRetryOutcome('none');
    let outcome: 'failed' | 'succeeded' | 'unknown' = 'unknown';
    try {
      outcome = classifyRetryResult(await state.retry());
    } catch (err) {
      // A retry that REJECTS is an adapter bug: report it (name and message only, T-84-01) and
      // treat the outcome as unknown — never an unhandled rejection, never a failure claim.
      logger.warn('FetchErrorBanner: a retry rejected instead of resolving', errCtx(err));
    } finally {
      // Never read `state.showError` here: TanStack commits the outcome one macrotask later.
      retryInFlightRef.current = false;
      setRetrying(false);
      const next: RetryOutcome =
        outcome === 'failed' ? 'awaitFailed' : outcome === 'succeeded' ? 'awaitSucceeded' : 'none';
      setRetryOutcome(next);
      if (next !== 'none' && mountedRef.current) {
        outcomeTimerRef.current = setTimeout(() => {
          outcomeTimerRef.current = null;
          setRetryOutcome('none');
        }, RETRY_OUTCOME_WINDOW_MS);
      }
      settle();
    }
  };
  const regionQuiet = retrying || retryOutcome !== 'none' || !regionDwellDone;

  // C12 (b): arm the ONE recovery hook from the focused control and settle at once, so the
  // post-settle rules make it a watch. A press in flight owns the episode; the watch stands aside.
  const { arm } = retryRecovery;
  const watchFocus = React.useCallback(() => {
    if (retryInFlightRef.current) return;
    const settle = arm();
    settle();
  }, [arm]);
  // The same watch with plan 04's `preferred` target (Phase 88.6.1-69, review #235): the full
  // branch's `Report this` prefers the adjacent `Try again`, so a link withdrawn beside a live
  // `Try again` lands there; a disconnected `preferred` falls through to `focusTarget`, else the
  // floor (plan 04's order).
  const watchFocusPreferring = React.useCallback(
    (preferred: () => HTMLElement | null | undefined) => {
      if (retryInFlightRef.current) return;
      const settle = arm({ preferred });
      settle();
    },
    [arm]
  );

  return {
    retrying,
    retryOutcome,
    retryFailedAgain,
    regionQuiet,
    handleRetry,
    assertiveChangedRef,
    watchFocus,
    watchFocusPreferring,
  };
}

/** Props of {@link NoticeRow}, the one visible row every small notice in this file renders. */
interface NoticeRowProps {
  /** The ratified sentence the row shows (and the one polite region beside it carries). */
  text: string;
  /** A retry is in flight: `Retrying…` and `aria-disabled`, never the native attribute. */
  retrying: boolean;
  /** The shared press handler; it arms focus recovery from the pressed button. */
  handleRetry: (event: React.MouseEvent<HTMLButtonElement>) => void | Promise<void>;
  /** C12 (b): arms the same recovery hook when the `Retry` takes focus. */
  watchFocus: () => void;
  /** Screen-reader-only text said before `text` (an `sr-only` child of the described line), so the
   *  `Retry`'s description and a swipe through the page carry it; absent, the line is `text` alone.
   *  Only `RefreshFailedNotice` passes it (its `sectionName`, close ruling P-78). */
  spokenPrefix?: string;
}

/* DECISION Phase 88.6.1-70 (one row): ONE row element for the small notices — the compact
   identity notice and `RefreshFailedNotice`, and a third, `SectionLoadFailedNotice`, under owner
   ruling D8-r2 — so they have one look by construction and one floor pin. CHOSEN, too, the one
   added attribute pair (the sentence's `React.useId` id, and the `Retry`'s `aria-describedby`
   pointing at it; finding #339): every small-notice `Retry` is described by its own ratified
   sentence, so a `Retry` beside the identity notice is told apart from RF1's with no new words.
   Two RF1 notices on ONE page still read alike; naming the list needs words, which stays the
   owner's wording question (D-31; plan 88.6.1-70 Routed finding 2).
   AMENDED Phase 88.6.1-88: a `spokenPrefix` now tells them apart for a screen reader; the row's class strings are unchanged.
   REJECTED: (a) a second row markup for RF1 — two class strings that drift apart, and a third
   opening tag carrying the retry handler, which reds the floor suite's `bannerRetries` count, or,
   renamed, an RF1 `Retry` the floor suite never sees; (b) merging a caller `className` into this
   row through `cn` — the row's class strings stay byte-identical (the description tie above is a
   deliberate addition, not a style change), so a consumer's spacing lives on the RF1 wrapper
   instead. The prop is named `handleRetry` ON PURPOSE: the floor suite anchors on the button's
   handler attribute. Changing this is a decision, not a cleanup. */
function NoticeRow({ text, retrying, handleRetry, watchFocus, spokenPrefix }: NoticeRowProps) {
  const textId = React.useId();
  return (
    <div className="flex flex-wrap items-center gap-2 text-sm text-content-secondary">
      {/* DECISION Phase 88.6.1-88 (close ruling P-78): with a `spokenPrefix` the described line is
          an `sr-only` prefix span then an INNER span holding `text` alone. CHOSEN over one text
          node of prefix plus sentence (the prefix would show) and over an `aria-label` on the line
          (a plain span's label is not reliably read, and reading in place would miss it); the inner
          span keeps one element whose text is exactly the sentence, which the e2e visible-line
          locators match. With no prefix the line renders `text` directly, as before (RN-22).
          The separating space is a text node BETWEEN the two spans, not the prefix's trailing
          space: an accessible name trims each element's own text, so a space left inside the
          `sr-only` span is dropped and the Retry's description runs the words together (measured,
          RN-20 / SN-1); the space is the GOV.UK visually-hidden-prefix shape, and at the start of
          the visible line it collapses, so nothing moves.
          Changing this is a decision, not a cleanup. */}
      <span id={textId}>
        {spokenPrefix ? (
          <>
            <span className="sr-only">{spokenPrefix.trimEnd()}</span>{' '}
            <span>{text}</span>
          </>
        ) : (
          text
        )}
      </span>
      {/* DECISION Phase 88.6.1-21 (WR-503 / AC-10): all three link-buttons in this file
          (this `Retry`, and `Try again` / `Report this` in the full branch) declare the
          house PHONE-SCOPED link-button floor `min-h-11 md:min-h-0`
          (`UpcomingEventsCard.js:263`, `DECISION Phase 88-01 (D-36)`; the `.btn` floor is
          phone-only too). VISIBLE DELTA: on a phone each button row grows to 44px.
          REJECTED: (a) the register's negative-vertical-margin compensation
          (`.planning/deferred/phase-88.6.1.md:85`) — the 44px target would overlap the
          message line above it and unknown caller content around this row, so a tap on text
          would activate a retry; (b) an all-widths floor — AC-10 is a 375px criterion, and
          desktop rhythm is not this phase's look call.
          AMENDED Phase 88.6.1-70 (one row): this row is now shared by the compact notice,
          `RefreshFailedNotice` and `SectionLoadFailedNotice`, so the floor covers all three small
          notices, and the floor suite counts this ONE element (`bannerRetries`, expectedCount 2).

          DECISION Phase 88.6.1-21 (Req 7 ring): the same three carry the byte-identical
          house ring (`Button.tsx:113`; 54 non-test lines in 28 files carried it before this
          plan, measured 2026-10-15), keyboard-only by `focus-visible`. It is a box-shadow
          outside the box, clear of the message above (`mt-2`) and the neighbours (`gap-2` /
          `gap-4`). The orchestrator decision of 2026-10-05; it supersedes the earlier plan to
          route this look item to Phase 88.9. REJECTED: leaving the browser's default outline
          (one surface off the house standard on 33 mounts); a rounded or inset variant (the
          ringed link-buttons in the app mostly carry no rounding — the plan's census, not
          re-run here). The NO-weight marker in the full branch is honoured: the ring is not a
          weight utility.
          AMENDED Phase 88.6.1-70 (one row): the same ring now covers every small notice's `Retry`
          through this one shared row. */}
      <button
        type="button"
        onClick={handleRetry}
        onFocus={watchFocus}
        aria-disabled={retrying || undefined}
        aria-describedby={textId}
        className="inline-flex min-h-11 md:min-h-0 items-center gap-1 text-content-link underline hover:no-underline aria-disabled:text-content-muted focus:outline-hidden focus-visible:ring-2 focus-visible:ring-focus-ring focus-visible:ring-offset-2"
      >
        <Icon name="RefreshCw" size={14} className={retrying ? 'animate-spin' : undefined} />
        {retrying ? 'Retrying…' : 'Retry'}
      </button>
    </div>
  );
}

export function FetchErrorBanner({
  state,
  title = 'Something went wrong',
  reportSubject,
  reportContext,
  compact = false,
  focusTarget,
}: FetchErrorBannerProps) {
  // Never the feedback context: its value changes on every feedback-button open / close and route
  // change, and this banner would re-render on each (review #150). Null outside the host.
  const openReport = useFeedbackReport();
  const tryAgainRef = React.useRef<HTMLButtonElement>(null);
  const {
    retrying,
    retryOutcome,
    retryFailedAgain,
    regionQuiet,
    handleRetry,
    assertiveChangedRef,
    watchFocus,
    watchFocusPreferring,
  } = useRetryEpisode({
    state,
    failureShown: state.showError,
    dwellOnPress: compact,
    quietOnMount: false,
    focusTarget,
  });

  /* DECISION Phase 88.6-36 (T-88.6-102, W38 class): the compact branch's announcement is a
     SHIPPED `StatusRegion`, mounted ABOVE the `showError` guard and GATED ON `compact`, chosen
     OVER the hand-rolled `<div role="status">` that shipped here.

     WHAT WAS WRONG. The old markup put `role="status"` on the visible wrapper, which was mounted
     in the same commit as the failure text it carried. `StatusRegion.tsx:9-17` (the EMPTY-FIRST
     bullet; re-anchored Phase 88.6.1-21 after plan 06's rewrite) records the rule this breaks: screen readers announce CHANGES to a mounted live region, not the conditional
     mount of a new one. On 14 non-test importers that is a real gap, not a cosmetic one. It is
     the same defect class plan 37 fixes in `Combobox` (W38).

     WHY THE GATE ON `compact` IS LOAD-BEARING. The `showError` guard below covers BOTH branches.
     An UNGATED hoist would render this polite region in the FULL branch too, alongside the polite
     `StatusRegion` already composed there — two polite regions in one branch, which is exactly
     what plan 13's already-armed single-live-region assertion goes red on
     (`useFetchErrorState.test.tsx`, "mounts exactly ONE assertive and ONE polite live region").

     CHOSEN: `className="sr-only"`, matching this component's OWN shipped sibling region a few
     lines below — the retry region passes `sr-only` explicitly for the same reason.
     REJECTED: the visible-when-set treatment the owner ruled on 2026-09-14 for the three NEW
     polite regions in plans 28/30/31 (UI-SPEC §1.2 rows V-18/V-20). That ruling is deliberately
     NOT followed here, and the reason is narrow: those three are new regions on surfaces with one
     region each, while this component would end up shipping TWO regions of OPPOSITE visibility.
     Two standards inside one component is worse than either standard applied consistently. A
     future phase reading the 28/30/31 ruling and "converging" this region to visible would print
     the degrade notice twice, ten pixels apart, and re-open nothing this fixed. `StatusRegion`
     supplies NO default visibility (`StatusRegion.tsx:102-106`, anchor `className={cn(`: `'text-sm'`,
     then `className`, then only the opt-in `srOnlyWhenEmpty`, default false), so an
     unstated className here would ship a VISIBLE empty node above the guard on every compact
     consumer. This arm takes NO UI-SPEC §1.2 V-row — an `sr-only` region has no visible delta,
     which is the point.

     THE FRAGMENT SHAPE, and an honest account of what it does. Both states return a fragment
     whose FIRST child is this region and whose second is the visible wrapper or `null`, so the
     region holds the same tree position in both states and React reuses the same DOM node.
     MEASURED, not assumed, and it corrects the claim this marker was first drafted with: the
     alternative `if (!showError) return <StatusRegion/>;` early-return shape was planted and run
     against this file's suite, and React preserved node identity there TOO — it reconciles a
     single-element child against the first child of an array by position, so the root-type change
     does not force a remount. The fragment is therefore chosen for LEGIBILITY — one shape, one
     obvious invariant, nothing depending on a reconciler subtlety — not because the other shape
     was measured to break. What the suite's NODE IDENTITY assertion (`toBe`) does guard is a real
     remount: a planted `key` that changes with `showError` reds it, which is the proof it is not
     a vacuous pin. Keep it: a presence-only check stays green while React tears the region down
     and rebuilds it, and that is the failure mode that turns this fix into a silent no-op.

     WHAT THIS DOES AND DOES NOT CLOSE: 6 of the 12 `compact` call sites — the ones whose CONSUMER
     keeps the component mounted through the healthy state. The other 6 gate the banner on
     `showError` at the CALLER, so the whole component is created by the failure and nothing
     inside it can help; they are named in `.planning/deferred/phase-88.6.md`.

     REPORT-ONLY, not taken here: making this region ASSERTIVE (`role="alert"`) would close all 12
     with one word and zero caller edits. Not taken because `StatusRegion.tsx:9-12` [now `:9-17`,
     which carries the carve-out the amendment below records] states the mount-does-not-announce
     rule with no politeness carve-out and AT behaviour was not verified.
     Disclosed to the owner in `88.6-36-SUMMARY.md`.

     AMENDED Phase 88.6.1-21 (D-42): AT behaviour is now verified. An inserted `role="alert"` that
     arrives with its text IS announced; an inserted POLITE region is not (`StatusRegion.tsx:9-17`
     now carries that carve-out). So ASSERTIVE would close the six caller-gated compact sites. It
     is still NOT taken: a non-blocking degrade notice should not interrupt speech, and the six are
     owned by Phase 92 (`.planning/deferred/phase-88.6.md:1811`, routed at `:1821`;
     `.planning/deferred/phase-92.md:84`). The paragraph above is kept as history.

     AMENDED Phase 88.6.1-21 (B1): this region now carries one of TWO ratified sentences — the
     first-failure notice, or copy row B1 after a retry known to have failed — still through this
     ONE region (the "two polite regions" rejection above holds). See
     `DECISION Phase 88.6.1-21 (B1 / D-47)` below; the honesty clause above still bounds what it
     reaches. */
  /* DECISION Phase 88.6.1-21 (B1 / D-47): after a retry KNOWN to have failed (its own result says
     `isError: true` AND the committed state agrees), the compact notice becomes copy row B1,
     `COMPACT_NOTICE_AFTER_FAILED_RETRY` — the SAME constant in the visible line and in the ONE
     polite region. The region is EMPTIED from the press until the outcome has committed, and for
     at least `REGION_EMPTY_DWELL_MS` (100) after the press, then refilled: every failed retry is a
     fresh addition after a long-enough empty spell, the second and third identical ones included.
     The owner's principle (2026-10-05): "If a sighted person can tell, we should make something
     for the non sighted to tell too."

     REJECTED:
     (a) a second polite region (the 88.6-36 marker's "two polite regions in one branch");
     (b) reading `state.showError` at settle — stale by one macrotask (`@tanstack/query-core`
         `notifyManager.js:3`), and a never-loaded query reports `pending` through the retry
         (`query.js:416-419`), so it would call a success a failure;
     (c) a keyed remount — identical text is not announced under WebKit's atomic rule (AT-4);
     (d) a synchronous clear-then-set — dropped by WebKit (AT-4);
     (e) speaking `Retrying…` in this region during the flight: a text-to-text update is a
         `nodeValue` write in React (`react-dom.development.js:2472-2483`,
         `var setTextContent = function (node, text) {`), not the node addition AT-4 measured as
         WebKit's announce path; and in the never-loaded case the visible row is gone, so it would
         speak a word the screen does not show;
     (f) new words for the in-flight state (D-31): the button's `Retrying…` is the cue.

     UNKNOWN outcomes (a retry resolving no boolean `isError`, or rejecting — caught and reported
     at `handleRetry`) refill the region with the sentence already on screen, never B1. A retry
     that resolves BEFORE its own state updates must resolve `{ isError }`, or its banner speaks
     the old sentence a moment early.

     STATED EDGES, both halves of an outcome the state contradicts (round-2 review #23; the expiry
     is `RETRY_OUTCOME_WINDOW_MS`):
     - A retry that SUCCEEDED while the state keeps showing a different failure (plan 88.6.1-16's
       identity-first state, when identity recovers and the role read has failed) leaves the region
       empty until the window expires, the next press or the state clears, whichever comes first;
       on expiry it refills with the sentence already on screen. The screen does not change either
       (same sentence, button back to `Retry`).
     - A retry whose result says it FAILED while the state goes healthy expires without B1. If the
       failure shows again with no press, the region and the line read the first-failure sentence:
       a confirm that arrives after the window loses B1, which is benign and never a false `still`.
     MEASURED LIMIT (round-2 review #306): a BACKGROUND refetch of a never-loaded query also reads
     as healthy at this seam (`pending`, so `showError` is false), so it ends the episode and
     resets B1; the next failure re-speaks the first-failure sentence — never a false `still`.
     Routed to Phase 92 (`.planning/deferred/phase-92.md:116`).

     HONESTY: the six caller-gated compact sites — `UserHomePage.js:543`, `:647`,
     `userProfile/page.js:2094`, `:3065`, `friends/page.js:827`, `grouplist.js:160` (re-measured
     2026-10-15, anchor `<FetchErrorBanner state={…} compact />`; `grouplist.js:160` sits inside the
     early return at `:141`) — destroy this component at the press for a never-loaded identity query
     (friends: its retry clears the error first) and re-create it on failure, so they get neither
     B1 nor an announcement. Owned by Phase 92 (`.planning/deferred/phase-92.md:84`). */
  if (compact) {
    // D-08: compact degrade notice — one generic line (no identity value) + the
    // retry affordance. The VISIBLE half still renders only on permanent failure;
    // only the announcing node pre-exists it.
    const noticeText = retryFailedAgain ? COMPACT_NOTICE_AFTER_FAILED_RETRY : COMPACT_NOTICE;
    return (
      <>
        <StatusRegion politeness="polite" className="sr-only">
          {regionQuiet ? '' : state.showError ? noticeText : ''}
        </StatusRegion>
        {state.showError ? (
          <NoticeRow text={noticeText} retrying={retrying} handleRetry={handleRetry} watchFocus={watchFocus} />
        ) : null}
      </>
    );
  }

  const subject = reportSubject ?? `Couldn't load: ${state.message}`;
  const description =
    `An error occurred (code: ${state.code}).\n\n` +
    `Message shown: ${state.message}\n\n` +
    (reportContext ? `Where: ${reportContext}\n\n` : '') +
    'What I was doing when this happened:\n\n' +
    'Anything else worth noting:\n';
  // The explicit invoker is the provider's own precedent: Safari does not focus a clicked button.
  const handleReportPress = (event: React.MouseEvent<HTMLButtonElement>) => {
    openReport?.({ subject, description, invoker: event.currentTarget, fallback: focusTarget });
  };
  const watchReportFocus = () => watchFocusPreferring(() => tryAgainRef.current);

  /* DECISION Phase 88.6.1-21 (AC-11 / D-42): the full branch keeps its Banner MOUNTED in both
     states, inside a wrapper that is `sr-only` while `state.showError` is false — chosen over the
     full branch's early `return null` guard it replaces, which inserted the whole banner, its
     assertive region included, together with its text. Banner's assertive `StatusRegion` is
     therefore present and EMPTY before the failure, and the SAME node carries the title and the
     message after it. The buttons render in Banner's `actions` slot: inside the box, OUTSIDE the
     atomic alert, so the `Try again` -> `Retrying…` flip is no longer a mutation inside it. A
     failed retry is told: the polite region says the site's existing `title` once a retry's OWN
     result reports `isError: true` AND the committed state still shows the failure.

     ALSO CHOSEN (round-2 review), each a decision:
     - The polite message is a child KEYED on its own text (#175). `Retrying…` -> title and, on the
       next failure, title -> `Retrying…` each REPLACE the node — a node addition with new text,
       AT-4's announce shape — where an unkeyed text would be a `nodeValue` rewrite (React's
       `setTextContent`). Consecutive messages never repeat identical text, so the rejection below
       of a keyed remount of IDENTICAL text (and the B1 marker's (c)) does not apply here. The B1
       marker's (e) rejects a text-to-text `nodeValue` write, which this keyed child removes; the
       compact branch still stays silent in flight for (e)'s other reason (its visible row can be
       gone).
     - The outcome WINDOW (#23): an outcome the committed state never confirms expires after
       `RETRY_OUTCOME_WINDOW_MS` = 1000 ms without recording a failure. Longer than one TanStack
       commit (a zero-delay macrotask) plus a render on a throttled phone; at least the compact
       dwell (`REGION_EMPTY_DWELL_MS`); short enough to hold the compact region quiet for one
       second at most. REJECTED beside it: expiring on the first commit that contradicts the
       result — a never-loaded query reports `pending` (so `showError` is false) through the
       retry and for one macrotask after it settles (`@tanstack/query-core` `query.js:416-419`),
       so a commit-bound rule would throw away a real failure on the settle render.
     - No double title (#176): when `state.showError` goes false during the flight, the assertive
       region empties and refills with the title and message, which already speaks them, so the
       polite title is skipped for that outcome. This guards future IN-COMPONENT callers: there
       are 0 today (the HONESTY NOTE below).
     - A rejected retry is caught (#25), reported through the house logger (`errCtx`: name and
       message only), and classified unknown.

     HONESTY NOTE: every full mount is caller-gated — 22 after wave 4 (CT-2a's 21 plus plan
     88.6.1-25's event-view banner) — so in production the region is still INSERTED with its
     text, and an inserted `role="alert"` IS announced (D-42). No caller was restructured; this is
     what every future in-component caller gets, and it does not newly announce any failure.

     REJECTED: clearing the visible message during a retry (a visible flash, a look change); a
     keyed remount of IDENTICAL text (WebKit's managed path drops it, AT-4); a new "still
     couldn't load" sentence (unratified, D-31); a failure announcement on an UNKNOWN result (two
     adapters resolve before they fetch, `UserHomePage.js:151-154`, `EventCalendar.js:63-66`, so
     their state at settle says nothing — SPEC Prohibition 2); reading `state.showError` at
     settle (stale by one macrotask, `notifyManager.js:3`). */
  const politeTitle =
    retryOutcome === 'none' && retryFailedAgain && state.showError && !assertiveChangedRef.current;
  const politeText = retrying ? 'Retrying…' : politeTitle ? title : '';

  // The full branch's controls, rendered in Banner's `actions` slot (outside the live region).
  // Hoisted so the Banner's own opening tag carries no handler of its own.
  const actionRow = state.showError ? (
    <div className="mt-2 flex flex-wrap items-center gap-4 text-sm">
      {/* DECISION Phase 88.6-36 (D-03 / UI-SPEC §4.5): the three link-buttons in this file
          (the compact `Retry` above, and `Try again` / `Report this` here) carry NO weight
          utility. §4.5 names these three sites explicitly as the EMPHASIS case — the emphasis
          is carried by `text-content-link` and `underline`, both of which stay, so the 500
          deleted with no look delta. Chosen OVER 700, which would make a text link louder than
          the banner title beside it. What was NOT measured, stated rather than implied: the
          COMPUTED rendered weight. This suite is jsdom, which performs no layout and loads no
          stylesheet, so `getComputedStyle().fontWeight` reads the UA default identically
          before and after and would prove nothing (the D28 rule). The pins are class-level. */}
      <button
        ref={tryAgainRef}
        type="button"
        onClick={handleRetry}
        onFocus={watchFocus}
        aria-disabled={retrying || undefined}
        className="inline-flex min-h-11 md:min-h-0 items-center gap-1 text-content-link underline hover:no-underline aria-disabled:text-content-muted focus:outline-hidden focus-visible:ring-2 focus-visible:ring-focus-ring focus-visible:ring-offset-2"
      >
        <Icon name="RefreshCw" size={14} className={retrying ? 'animate-spin' : undefined} />
        {retrying ? 'Retrying…' : 'Try again'}
      </button>
      {/* DECISION Phase 88.6.1-69 (owner ruling 2026-10-05, Report this after a failed retry):
          option C of the owner's three (375px mockup
          https://claude.ai/artifact/So2zG4F5qpHWzRaibS2V4N) — `Try again` always; `Report this`
          only after a retry has failed, then for as long as that failure persists. Read from
          `state.retryFailed`, which the HOST's `useFetchErrorState` keeps, because a caller-gated
          banner is destroyed at the press and re-created on failure (that hook's marker). The
          owner's reasons, in substance: no reports for a temporary issue ("Backend is down for a
          couple of minutes, you just retry and it works"), but when it keeps failing for other
          reasons he wants to know, and "a call to action at the spot of the action is more likely
          to happen". REJECTED: A, no report link at all (he wants to hear about persistent
          failures); B, both links from the start (the earlier behaviour; reports for two-minute
          outages). Also rejected: announcing the link's appearance or moving focus to it (plan 21
          already speaks a failed retry; a second message would be new words, D-31). The report
          button's opening tag, plan 70's focus watch, its classes and label are unchanged inside
          the condition. AMENDS Phase 86 D-02's CTA (`86-CONTEXT.md:35`). Showing it from the
          start again is a decision, not a cleanup.
          AMENDED Phase 88.6.1-69 (Task 3): the link opens the app-level report host
          (`FeedbackModalProvider`'s `openReport`, read through its own report context) and is
          not rendered without one (no host, no dead link). Its focus watch (plan 70's C12 b)
          stays and now prefers the adjacent `Try again` (plan 04's `preferred`, review #235), so
          a link withdrawn beside a live `Try again` lands there, never a heading a screen away. */}
      {state.retryFailed && openReport ? (
        <button
          type="button"
          onClick={handleReportPress}
          onFocus={watchReportFocus}
          className="inline-flex min-h-11 md:min-h-0 items-center gap-1 text-content-link underline hover:no-underline focus:outline-hidden focus-visible:ring-2 focus-visible:ring-focus-ring focus-visible:ring-offset-2"
        >
          <Icon name="Flag" size={14} />
          Report this
        </button>
      ) : null}
    </div>
  ) : null;

  return (
    <div className={state.showError ? undefined : 'sr-only'}>
      <Banner
        tone="warning"
        title={state.showError ? title : undefined}
        actions={actionRow}
      >
        {state.showError ? <p>{state.message}</p> : null}
      </Banner>

      {/* Polite, secondary live region for transient retry feedback and a failed retry's
          outcome — a SIBLING of Banner's assertive error region (no nested live regions). */}
      <StatusRegion politeness="polite" className="sr-only">
        {politeText ? <span key={politeText}>{politeText}</span> : null}
      </StatusRegion>
    </div>
  );
}

/* DECISION Phase 88.6.1-70 (C10, access or gone), orchestrator decision F1 (2026-10-05): an answer
   that says the user may no longer see the content, or that it is gone, is NEVER a refresh
   failure: the content is withdrawn and the site's full banner tells the truth.
   CHOSEN: ONE exhaustive code map and ONE predicate, read by `useRetainedContent` and by
   `RefreshFailedNotice` itself. The ten codes, and why each is in:
   - `unauthorized` (401) and `forbidden` (403): this user may no longer see it;
   - `not_found` and `not_provisioned` (404): on a list refetch, a 404 means the list's PARENT
     (the group, the event, the account) is gone or hidden from this user, so keeping its rows
     under "showing what loaded earlier" would present a vanished thing as merely stale;
   - `gone` (a code-less 410), `account_deleted`, `invalid_token`, `already_used`,
     `window_expired` (each 410): gone;
   - `token_invalid`: IN by meaning ("this link no longer grants access"), although its wire
     status is 400 — the backend registry records that 400 as legacy (`utils/errors.js`, anchor
     `magic-token reject is 400 today`); no RF1 site reads a token today.
   Statuses read from the backend registry (`periodictabletopbackend_v2/Sonnet/utils/errors.js`,
   `ERROR_REGISTRY`) and the FE status map (`api.ts`, anchor `function statusToCode(`). The
   other fifteen codes are refresh failures. `csrf_rejected` is not a code: the proxy's CSRF gate
   answers unsafe methods only (`src/app/api/[...path]/route.ts`, anchor
   `UNSAFE_METHODS.has(method)`), so a refetch (a GET) never carries it; a stray one keeps the
   code `forbidden` (plan 88.6.1-07, D-24) and lands on the full banner, whose message plan 07
   routes to the `unknown` line — no role claim, no stale content. The set is a superset of plan
   88.6.1-25's terminal rule (`unauthorized`, `forbidden`, `not_found`, `account_deleted`).
   FAIL CLOSED (finding #122): the map is exhaustive at compile time only — `mapErrorToCode` passes
   an envelope code through verbatim (`api.ts`, anchor
   `if (body && typeof body.code === 'string') return body.code as ApiErrorCode;`) — so a runtime
   code this map does not hold withdraws the content rather than keeping it under RF1. A state
   with NO code (the wholesale `useFetchErrorState` mocks) stays false.
   STATED LIMIT: a 401 / 403 / 404 / 410 whose unregistered code the backend's global handler
   rewrites to `internal` while keeping the status (`utils/errors.js`, anchor
   `ERROR_REGISTRY[codeOrErr.code]) ? codeOrErr.code : 'internal';`) reads as a refresh failure,
   because this reads `code` only; measured unreachable today, the producer-side fix is routed
   to Phase 93 (`.planning/deferred/phase-93.md`, anchor
   `Global error handler keeps a 4xx status but rewrites an unregistered code`).
   THE MEMORY: `useRetainedContent` remembers an access or gone answer until the next success
   (`state.showError` false). The orchestrator's bare formula, `hasData && !predicate(state)`,
   was considered: after a 403 the full banner's Try again can fail with a 500, the predicate is
   false again, and the pre-403 rows would come back under RF1 — content the screen had already
   withdrawn. For a TanStack source the memory is kept with the cached query entry (finding #309),
   because the cached error and data survive an unmount for `gcTime` and a remount would
   otherwise re-show them; REJECTED there: comparing `dataUpdatedAt` with `errorUpdatedAt` (the
   finding's own remedy) — after a 403 then a 500 the cache holds only the 500, so it cannot tell
   "403 then 500" from "500 alone".
   REJECTED: (a) a per-site list of codes (thirteen consumer plans, thirteen lists that drift);
   (b) keying on the HTTP status (the house reads `code` only, `DECISION Phase 88-25`); (c) the
   notice rendering nothing for such an answer — a consumer that forgot the hook would then show
   stale rows with no failure state at all, the AC-29 defect; (d) a wrapper component that owns
   the whole content slot — the consumer layouts differ and are already planned.
   Changing any of these is a decision, not a cleanup. */
const ACCESS_OR_GONE_BY_CODE: Record<FetchErrorCode, boolean> = {
  unauthorized: true,
  forbidden: true,
  not_found: true,
  not_provisioned: true,
  gone: true,
  account_deleted: true,
  invalid_token: true,
  already_used: true,
  window_expired: true,
  token_invalid: true,
  unknown: false,
  validation: false,
  rate_limited: false,
  prompt_closed: false,
  prompt_deadline_expired: false,
  reminder_cooldown: false,
  owner_of_active_groups: false,
  already_restored: false,
  conflict: false,
  already_member: false,
  invite_pending: false,
  unsupported_address: false,
  internal: false,
  network: false,
  config: false,
};

/**
 * C10: true while `state` shows an error whose code says the user may no longer see the content
 * (401 / 403) or that it is gone (404 / 410), or a code the map does not hold at all (fail
 * closed, #122). A state with no code is false. The ONE place an access or gone answer is
 * classified; a load function that must classify a thrown `ApiError` itself calls
 * `isAccessOrGoneError({ showError: true, code: err.code })`.
 */
export function isAccessOrGoneError(state: Pick<FetchErrorState, 'showError' | 'code'>): boolean {
  if (state.showError !== true) return false;
  const code: unknown = state.code;
  if (typeof code !== 'string') return false;
  if (!Object.prototype.hasOwnProperty.call(ACCESS_OR_GONE_BY_CODE, code)) return true;
  return ACCESS_OR_GONE_BY_CODE[code as FetchErrorCode];
}

/** C10's optional third argument: the TanStack query whose cache entry keeps the memory. */
export interface RetainedContentSource {
  /** The query's key. `undefined` counts as NO source: the instance memory serves (AG-14). */
  queryKey: QueryKey | undefined;
}

/** A TanStack source's access memory, kept with its cached `Query` and dying with it (#309). */
const accessEndedByQuery = new WeakMap<object, boolean>();

/**
 * C10: the consumer's `retained` — `hasData && !isAccessOrGoneError(state)`, AND false after an
 * access or gone answer until the next success. Call it at the top level, before any early
 * return. `hasData` is C3's has-loaded flag for the CURRENT key (never a row count). A TanStack
 * consumer passes `{ queryKey }` so the memory lives with the cached query and survives a
 * remount; a consumer whose data lives in its own state passes nothing (instance memory).
 */
export function useRetainedContent(
  hasData: boolean,
  state: Pick<FetchErrorState, 'showError' | 'code'>,
  source?: RetainedContentSource
): boolean {
  // Read through the context, never the throwing client hook: a call without `source` must work
  // with no provider mounted (the hand-rolled consumers mount none).
  const client = React.useContext(QueryClientContext);
  const [instanceEnded, setInstanceEnded] = React.useState(false);
  const accessNow = isAccessOrGoneError(state);
  // Adjust-state-while-rendering, each arm guarded by a comparison, so it never loops.
  if (accessNow && !instanceEnded) setInstanceEnded(true);
  else if (!state.showError && instanceEnded) setInstanceEnded(false);

  let ended = accessNow || (state.showError && instanceEnded);
  const queryKey = source?.queryKey;
  // An undefined key is never looked up: query-core skips the key test for it, so the lookup
  // would answer with the first cached query, an unrelated entry (AG-14).
  // DECISION 88.6.1 code review A-29 / A-79: the cache's own O(1) hash lookup over
  // `getQueryCache().find({ queryKey, exact: true })`, which copies the whole cache and re-hashes
  // the key once per cached query on EVERY host render. Equivalent only while no
  // `queryKeyHashFn` is configured (`grep -rn queryKeyHashFn src` = 0 on 2026-10-19), because a
  // query's cache hash is then `hashKey(queryKey)`; configuring one means returning to `find`.
  const query =
    client && queryKey !== undefined ? client.getQueryCache().get(hashKey(queryKey)) : undefined;
  if (query) {
    // Idempotent writes: a StrictMode double render or a discarded render leaves the same memory.
    if (accessNow) accessEndedByQuery.set(query, true);
    else if (!state.showError) accessEndedByQuery.delete(query);
    ended = accessNow || (state.showError && accessEndedByQuery.get(query) === true);
  }
  return hasData && !ended;
}

/** Props of {@link RefreshFailedNotice} (plan 88.6.1-70; the contract is in its docblock). */
export interface RefreshFailedNoticeProps {
  /** From `useFetchErrorState(...)`: the SAME state the site's first-load banner reads. */
  state: FetchErrorState;
  /** True while content from an earlier SUCCESSFUL load of this data, for the current key, may stay on screen. */
  retained: boolean;
  /** The heading of the section the notice qualifies: where focus goes when the notice leaves. */
  focusTarget?: React.RefObject<HTMLElement | null>;
  /** Outer spacing only (e.g. `mb-4`), on a wrapper rendered ONLY while the notice shows. */
  className?: string;
  /** Spoken only: the section this notice qualifies, said before the sentence (close ruling P-78). Absent = unchanged. */
  sectionName?: string;
}

/* DECISION Phase 88.6.1-70 (AC-29 / RF1, owner ruling 2026-10-05): a failed REFRESH over content
   that is still on screen is told by ONE shared notice, `RefreshFailedNotice` — the sentence
   `REFRESH_FAILED_NOTICE` (copy row RF1, D-47) plus a `Retry` — and the content stays.
   CHOSEN:
   - a sibling export in this module, sharing `useRetryEpisode` and `NoticeRow` with the banner;
   - one always-`sr-only` polite region as the fragment's FIRST child, the visible wrapper second
     (the 88.6-36 compact shape: one polite region, never two);
   - the SAME sentence re-announced on every failed Retry, through plan 21's empty-then-refill
     dwell — no new words, never B1 (D-31);
   - `retained` decided by the consumer (D-09a's has-loaded flag for the current key, never a row
     count), so a refresh nobody loaded for shows nothing here and the site's full banner owns it;
   - `quietOnMount`: a notice mounted while a failure already shows (a remount of the retained
     branch, a key switch back to an errored cache) renders its region EMPTY on the first commit
     and fills it after `REGION_EMPTY_DWELL_MS`, because an inserted polite region carrying text is
     not announced (StatusRegion's EMPTY-FIRST bullet, D-42);
   - the `Retry` arms the ONE recovery hook when it takes focus (`watchFocus`, C12 b), so a
     refresh nobody pressed (the tab-return re-attempt) that succeeds while `Retry` holds focus
     lands focus on `focusTarget`, else the floor — and a user who moved on is never moved.
     REJECTED beside it: an arm tied to the tab-return effect in `useFetchErrorState` (not this
     module, and it owns no target); a press-free arm added to plan 04 (arm plus settle is one).
   REJECTED:
   (a) a mode prop on `FetchErrorBanner` — `title`, `reportSubject`, `reportContext` and `compact`
       would be meaningless in that mode, a `.js` caller could write `compact` with it unchecked,
       and the five suites that replace this module wholesale with `vi.mock` (three of them —
       `EventCalendar.identity`, `grouplist.identity`, `userProfile.identity-error` — render their
       stub on `showError` alone) would render an RF1 mount as the stubbed banner, so a suite could pass
       on the wrong element; a sibling export a factory lacks makes vitest throw instead;
   (b) a second copy of the retry machinery (tenet: one mechanism);
   (c) a separate module — the hook and the row would have to be exported;
   (d) `srOnlyWhenEmpty` (D-22) — the region must go quiet during a Retry while the visible line
       keeps the sentence, and a visible-when-set region would blank the line on every press;
   (e) the primitive owning an outer margin — placement differs per site, so spacing is the
       consumer's `className`, rendered only while shown (a healthy page gains no box at 375px);
   (f) naming the list in the spoken sentence — new words (D-31; Routed finding 2).
       AMENDED Phase 88.6.1-88 (close ruling P-78, owner 2026-10-17): the words are ratified; a
       caller that passes `sectionName` gets it said first, in the region and in the Retry's
       description, never visibly. CHOSEN over the region alone (the three Retry buttons would
       still be described alike, Routed finding 2) and over per-site wrappers (a second region and
       retry machinery).
   Changing any of these is a decision, not a cleanup. */
/**
 * RefreshFailedNotice — the shared "failed refresh over retained content" notice (copy row RF1,
 * owner ruling 2026-10-05, D-47 / D-51): when a REFRESH fails, the site keeps what it was showing
 * and this notice says so, visibly and to a screen reader, with a `Retry` that behaves like the
 * house recovery controls. Its sentence is `REFRESH_FAILED_NOTICE`; a consumer never writes it.
 *
 * What a consumer renders, by situation: healthy — the content plus this notice (its empty
 * `sr-only` region only, no box, no margin); a FIRST load failed, nothing loaded for this key
 * yet — the full `FetchErrorBanner` with the site's ratified `title`, in the content's place,
 * checked before the empty state; a refresh failed with a transient answer (5xx, `network`, 429,
 * a code-less side read), content retained — the content with this notice above it; a refresh
 * failed with an ACCESS or GONE answer (`isAccessOrGoneError` true — 401 / 403 / 404 / 410 and
 * their coded forms), and every failure after it until the next success — the full banner in the
 * content's place, the content NOT rendered; a refresh failed with nothing retained (the key
 * changed, the data was dropped) — the full banner, as for a first load.
 *
 * Healthy, or with `retained` false, it renders ONE element: an empty `sr-only` polite region.
 * A failure arrives as text in that SAME node; a failed Retry empties it from the press for at
 * least `REGION_EMPTY_DWELL_MS` and until the outcome commits, then refills it with the same
 * sentence; a notice mounted while a failure already shows fills it after the dwell. A successful
 * Retry removes the notice and focus goes to `focusTarget`, else the open dialog's title, else
 * `main h1`, else `main` — never `<body>`.
 *
 * CONSUMER CONTRACT (a site plan cites these items as 88.6.1-70 contract C1-C12):
 *
 * C1 — keep the retained data. A failed load NEVER writes the data: no empty-array write, no
 * reset. The error is set beside it.
 *
 * C2 — keep the error until the NEWEST run succeeds. Never clear it at the start of a run:
 * clearing it hides the notice at the press, so focus leaves `Retry` and the in-flight state is
 * never seen.
 *
 * C3 — know whether THIS key has loaded (`hasData`, C10's input). Hand-rolled: a state set on
 * success to the key that was requested (`loadedFor === key`, D-09a's has-loaded flag), never a
 * row count — a list that loaded EMPTY is retained content (D-50): this notice sits above the
 * empty-state sentence. TanStack: `query.data !== undefined` (TanStack keeps data through a
 * failed refetch, `isRefetchError: isError && hasData`); a query that ever uses
 * `placeholderData` also requires `!query.isPlaceholderData`.
 *
 * C4 — `refetch` resolves `{ isError: boolean }` for the retry it ran: `true` failed, `false`
 * succeeded; a call superseded by a newer one resolves the newest run's outcome or `undefined`.
 * It never rejects, and it never resolves BEFORE its fetch settles — a key bump that returns
 * `Promise.resolve()` at once (as `EventCalendar.js`'s `retryFetch` did at `2f3d4c4`) is
 * forbidden here: the notice would re-speak the failure a moment before a success lands.
 * TanStack's `query.refetch` already satisfies C4.
 *
 * C5 — the adapter. Hand-rolled: a STABLE `refetch` — the ref-held shape of `DECISION Phase
 * 88-14` (`friends/page.js`, anchor `const retryFriends = useCallback(`) — then
 * `useFetchErrorState({ isError: Boolean(error), error, refetch: retry })`. TanStack:
 * `useFetchErrorState(query)`. The hook's tab-return re-attempt (its `visibilitychange` listener)
 * calls the same `refetch`, so C1-C4 hold for it too. The hook's parameter is typed as a query
 * result: a `.ts` / `.tsx` consumer passing a hand-rolled object casts it; `.js` is unaffected.
 *
 * C6 — placement. Mount the notice UNCONDITIONALLY inside the branch that renders the retained
 * content, ABOVE that content — never inside a `showError` guard, never as the last child of a
 * `space-y-*` stack (Tailwind v4 puts the gap on every non-last child). Render the full banner
 * only while `!retained` — never both for one state. Remounting the branch mid-failure is safe:
 * the notice announces after its dwell.
 *
 * C7 — words. The consumer writes no RF1 literal (the notice owns `REFRESH_FAILED_NOTICE`, D-30)
 * and passes no `title` and no `reportContext`. A consumer TEST writes the sentence once,
 * commented as copy row RF1 / D-47, and expects it TWICE while the notice shows and its region is
 * not quiet (visible line plus region): query with `getAllByText`, or scope to the
 * `role="status"` node. AMENDED Phase 88.6.1-88 (close ruling P-78): with `sectionName` the region
 * holds the prefixed sentence and the visible line the sentence alone, so a consumer test expects
 * the sentence ONCE by exact text and the region's text equal to the prefixed sentence.
 *
 * C8 — the tests every consumer carries: (a) a failed refresh keeps the retained content, shows
 * RF1, and the full banner's title is absent; (b) the RF1 region is one of the `role="status"`
 * nodes present BEFORE the failure (`toBe`); (c) `Retry` recovers; (d) a phone e2e at 375px —
 * `Retry` inside the viewport and at least 44x44, no sideways scroll, the notice beside the
 * content it qualifies; a failed layout assertion is a STOP for the owner's mockup, never an
 * ad-hoc restyle; (e) a 401 and a 403 refresh over kept content: no RF1, the content not
 * rendered, the full banner's register line shown (read through `getFetchErrorMessage`, never
 * typed), and a 500 and a `network` failure: RF1 over the kept content; (f) C12, focus never
 * falls to `<body>`: (f1) a control INSIDE the retained content holds focus while RF1 shows and a
 * refresh nobody pressed (define `document.visibilityState` as `'visible'`, then dispatch
 * `visibilitychange`) answers 401 or 403 — the content is withdrawn and focus lands on the
 * `focusTarget` the site hands its `RetainedContentFocusGuard` (or, with none, the floor), with a
 * plant that deletes the guard element ending on `<body>`; (f2) RF1's `Retry` holds focus and a
 * refresh nobody pressed SUCCEEDS — the notice leaves and focus lands on its `focusTarget` (or the
 * floor). Wait for a POSITIVE `document.activeElement`.
 *
 * C9 — wholesale mocks. A suite that replaces this module with `vi.mock` keeps the real module
 * and overrides only what it stubs — `vi.mock(<this module>, async (importOriginal) => ({
 * ...(await importOriginal()), FetchErrorBanner: …, RefreshFailedNotice: … }))` — so
 * `useRetainedContent`, `isAccessOrGoneError` and `RetainedContentFocusGuard` stay real (a
 * stubbed predicate changes which branch the suite renders). A factory missing an export throws,
 * by design. `useRetainedContent` reads TanStack's `QueryClientContext`, so a suite that mocks
 * `@tanstack/react-query` wholesale keeps that export too (spread `importOriginal`) once the
 * component under test calls the hook.
 *
 * C10 — an access or gone answer is never a refresh failure. Compute
 * `const retained = useRetainedContent(hasData, errorState);` (`hasData` per C3) — a hook, so
 * at the top level, before any early return. A TanStack site also passes its query's key —
 * `useRetainedContent(query.data !== undefined, errorState, { queryKey })` — so the memory below
 * is kept with the cached query and a remount over a cached error cannot bring withdrawn rows
 * back; a site whose data lives in its own state passes nothing; a `queryKey` that is
 * `undefined` counts as no source. Every site goes through this one hook and the one predicate
 * inside it, `isAccessOrGoneError`; no site writes a list of codes. The predicate is true while
 * the state shows an error whose code is `unauthorized`, `forbidden`, `not_found`,
 * `not_provisioned`, `gone`, `account_deleted`, `invalid_token`, `already_used`,
 * `window_expired` or `token_invalid`, or a code it does not know at all (fail closed). While it
 * is true — and until the next success, so a later transient failure cannot bring back content
 * the screen had already withdrawn — `retained` is false: the site renders the FULL banner in
 * the content's place and does NOT render the content. A site's own removal redirect or sign-in
 * hold still runs FIRST. Store the thrown `ApiError` itself as the error: wrapping it in a new
 * `Error` turns a 401 / 403 into `unknown`, which reads as a transient failure (the one
 * sanctioned exception is a SIDE read, C11). A load function that must classify a thrown error
 * itself calls `isAccessOrGoneError({ showError: true, code: err.code })`. Handed `retained`
 * true over such an answer anyway, this notice renders the house full banner in its own place
 * instead of RF1 — never silence — but the stale content stays, which is why C8 (e) is mandatory.
 *
 * C11 — side reads never decide access. A site that folds SECONDARY reads (a roster, an RSVP
 * list, brings, reviews, sessions) into the SAME error state as its primary read stores a
 * side-read failure as a code-less `Error` with a fixed message, never the thrown `ApiError`, so
 * its code is `unknown`: a side read's 403 / 404 / 410 never produces the no-access screen and
 * never withdraws the primary content, and it shows RF1 over that content like any other side
 * failure. Only the PRIMARY read's thrown `ApiError` reaches `useRetainedContent`. A side-read
 * failure on a FIRST load is the site's own record (RF1's "earlier" would be false there).
 * Scoped exception — a view whose primary read does NOT gate the side reads' content (the game
 * page: its catalog read is group-agnostic, so the group-scoped side reads ARE the access gate
 * for that group's content): there a group-scoped side read's 403 / 404 / 410 answer, classified
 * on the thrown `ApiError` with `isAccessOrGoneError` before any refresh-failure rule, withdraws
 * that group content and nothing else — the catalog game stays, never RF1 and never the full
 * banner (D-51) — and the withdrawal renders one more `RetainedContentFocusGuard` for that
 * content. Carve-out: its 401 is NOT withdrawn that way; it takes the primary-401 path (the full
 * banner with the register line for `unauthorized`, the game cleared), because a 401 says the
 * session ended, not that this user may not see the group. On the event page the roster's OWN
 * 403 / 404 / 410 answer resets the roster-derived member state only and keeps the event, with no
 * error stored and no RF1; a roster 401 is an ordinary code-less side failure (RF1 over the event,
 * an error kept so the tab-return re-attempt arms).
 *
 * C12 — focus never falls to `<body>` when the notice or the content leaves. ONE target rule:
 * the site's `focusTarget` (the section heading, rendered OUTSIDE the arm a withdrawal unmounts),
 * else plan 04's page floor (the open dialog's title, `main h1`, `main`). (b) The NOTICE owns its
 * own controls: its `Retry` (and the banner's `Try again` and `Report this`) arms the one
 * recovery hook on FOCUS and settles at once (`watchFocus`), so a refresh nobody pressed that
 * succeeds while the control holds focus lands it on `focusTarget` or the floor, and a user who
 * moved on to another control is never moved; consumers write nothing for (b). (a) The CONSUMER
 * owns its content: render `<RetainedContentFocusGuard retained={retained} focusTarget={headingRef} />`
 * once per `retained` value, in the component that computes it, OUTSIDE the `retained ? … : …`
 * arm (it renders nothing; pass the notice's `focusTarget` ref, or none inside a `Modal`). When a
 * commit flips `retained` from true to false and removed the element that held focus, the guard
 * moves focus to `focusTarget`, else the floor; it never moves a user whose focus was elsewhere
 * or on `<body>`, and never acts for a dialog that closed in that commit. A site's own press arm
 * may stay; it targets the same heading. No site writes focus code of its own (D-04). Position
 * rule: the guard must be ONE instance across the commit that flips `retained`, because React
 * runs `getSnapshotBeforeUpdate` and `componentDidUpdate` only on an instance it UPDATES
 * (`react-dom`, anchor `var snapshot = instance.getSnapshotBeforeUpdate(`), and keeps an
 * instance only where the render before and after put the same element type at the same
 * position: the same chain of parent element types, the same child index (each conditional or
 * ternary is ONE slot whether it renders or not, and unkeyed children match by index, anchor
 * `var key = oldFiber !== null ? oldFiber.key : null;`), and the same `key`. So: (1) never inside
 * the arm or any conditional the withdrawal removes; (2) where a withdrawal switches the component
 * between RETURN statements, EVERY such return renders the guard at the same position — the
 * FIRST child of a root element of the SAME type in each (unkeyed); or the SECOND child of a
 * top-level fragment in each (React reconciles a top-level unkeyed fragment as its children,
 * anchor `var isUnkeyedTopLevelFragment`, so the root before it may change type); or the LAST
 * child of a root of the SAME type in each under ONE stable `key` identical in every return — the
 * keyed form, required where the guard's `focusTarget` is a later sibling that mounts in the
 * flip's own commit, because layout effects run sibling after sibling and a guard ahead of the
 * new target reads its ref while still null; never a different root type, a key on an unkeyed
 * form, a key that differs or is missing in one return, or one return a fragment and another a
 * single element, and a return of `null` the flip can reach unmounts the guard; (3) one guard
 * element per `retained` value — a component-local constant rendered in every return is one
 * instance.
 *
 * A site plan cites these items as 88.6.1-70 contract C1-C12.
 */
export function RefreshFailedNotice({ state, retained, focusTarget, className, sectionName }: RefreshFailedNoticeProps) {
  // C10, enforced here and never silently: an access or gone answer is not a refresh failure.
  const blocked = isAccessOrGoneError(state);
  const shown = state.showError && retained && !blocked;
  const { retrying, regionQuiet, handleRetry, watchFocus } = useRetryEpisode({
    state,
    failureShown: shown,
    dwellOnPress: true,
    quietOnMount: true,
    focusTarget,
  });
  // Handed `retained` over such an answer anyway (a consumer that skipped `useRetainedContent`):
  // the house full banner INSTEAD of the fragment — its shipped default title and the register's
  // line for the code — never RF1 over stale rows, and never an empty, silent notice.
  if (state.showError && retained && blocked) {
    return <FetchErrorBanner state={state} focusTarget={focusTarget} />;
  }
  // Close ruling P-78: the section name, said first and only to a screen reader (copy row P78).
  const spokenPrefix = sectionName ? `${sectionName}: ` : '';
  return (
    <>
      <StatusRegion politeness="polite" className="sr-only">
        {shown && !regionQuiet ? `${spokenPrefix}${REFRESH_FAILED_NOTICE}` : ''}
      </StatusRegion>
      {shown ? (
        <div className={className}>
          <NoticeRow
            text={REFRESH_FAILED_NOTICE}
            retrying={retrying}
            handleRetry={handleRetry}
            watchFocus={watchFocus}
            spokenPrefix={spokenPrefix}
          />
        </div>
      ) : null}
    </>
  );
}

/** Props of {@link SectionLoadFailedNotice} (owner ruling D8-r2). */
export interface SectionLoadFailedNoticeProps {
  /** From `useFetchErrorState(…, { fallbackMessage: <the section's ratified line> })`. */
  state: FetchErrorState;
  /** Outer spacing only, on a wrapper rendered ONLY while the notice shows. */
  className?: string;
}

/* DECISION Phase 88.6.1-70 (D8-r2, section notice; owner 2026-10-13, orchestrator 2026-10-15): a
   section whose read failed and NEVER loaded gets the small notice `SectionLoadFailedNotice`,
   showing `state.message`. CHOSEN: a third sibling export sharing `useRetryEpisode` and
   `NoticeRow` (one row, one latch, one floor, one ring), so the consumer's `fallbackMessage`
   gives the owner's ratified line for a code-less failure and a coded failure shows the register
   sentence for its code, by construction. `state.message` is the code-keyed register's sentence
   or the caller's `fallbackMessage` (`useFetchErrorState.ts`, anchor
   `export function getFetchErrorMessage`), so the notice never renders a backend string
   (T-88.6.1-1404). No `retained` and no access check: its one consumer (plan 88.6.1-74's
   never-loaded side reads) stores only non-access failures, its access answers handled first.
   REJECTED: (a) an optional `text` prop on the compact branch — it touches all 12 compact mounts
   and B1's sentence swap; (b) the compact notice as it ships — its sentence is the identity line,
   false under a reviews heading; (c) B1 after a failed Retry — identity copy; the same sentence
   is re-announced instead (D-31); (d) `RefreshFailedNotice` — "showing what loaded earlier" is
   false for a section that never loaded. Changing any of these is a decision, not a cleanup. */
export function SectionLoadFailedNotice({ state, className }: SectionLoadFailedNoticeProps) {
  const shown = state.showError;
  const { retrying, regionQuiet, handleRetry, watchFocus } = useRetryEpisode({
    state,
    failureShown: shown,
    dwellOnPress: true,
    quietOnMount: true,
  });
  return (
    <>
      <StatusRegion politeness="polite" className="sr-only">
        {shown && !regionQuiet ? state.message : ''}
      </StatusRegion>
      {shown ? (
        <div className={className}>
          <NoticeRow text={state.message} retrying={retrying} handleRetry={handleRetry} watchFocus={watchFocus} />
        </div>
      ) : null}
    </>
  );
}

/** Props of {@link RetainedContentFocusGuard} (contract C12 a). */
export interface RetainedContentFocusGuardProps {
  /** The consumer's `retained` (from `useRetainedContent`); the guard acts when it flips true to false. */
  retained: boolean;
  /** The heading the withdrawal keeps (the same ref the site's notice gets); omit it inside a `Modal`. */
  focusTarget?: React.RefObject<HTMLElement | null>;
}

/* DECISION Phase 88.6.1-70 (C12, focus when content leaves): ONE shared guard reads the focused
   element in `getSnapshotBeforeUpdate` — React's only read taken BEFORE a commit changes the DOM;
   it has no hook equivalent, which is why this is the module's one class component, and converting
   it to a hook cannot express it — and, after the commit that withdrew the content, hands focus to
   the site's `focusTarget`, else plan 04's page floor (the open dialog's title, else `main h1`,
   else `main`), through plan 04's exported primitives. It acts only at the commit that withdrew
   the content, only when that commit removed the element that held focus and focus is lost, and
   never for a dialog that closed in that commit (the dialog's own restore owns that moment).
   REJECTED: (i) arming plan 04's hook on focus inside the content — two armed instances run their
   observers in creation order, so a content watch would beat a row host's own press arm and land
   on the heading instead of the next row (Edge R5 adjacency), and ONE shared instance would let
   KebabMenu's synchronous restore re-arm over a pending press; (ii) arming at each load's catch —
   a TanStack site's shared queryFn is out of reach, and every site would carry a copy (D-04);
   (iii) reading the focused element during render (an impure render); (iv) a passive mode added
   to plan 04 (a contract change in a wave-3 plan, still per-site); (v) recovering on MOUNT (a
   fresh guard, born `false`, moving focus off the page body) — by then the DOM has changed, and a
   mount cannot tell a withdrawal from a page load, so it would move people who lost nothing; the
   Position rule below (one instance across the flip) is the fix instead.
   THE RECORD: D-04 reads "one shared hook" for Requirement 5. The guard does not use the hook; it
   calls plan 04's exported primitives with the hook's own target chain, as plan 88.6.1-20's dialog
   floor does — one shared primitive, written once, so D-04's purpose (no per-host inline copies)
   holds. Changing this is a decision, not a cleanup. */
/**
 * RetainedContentFocusGuard — contract C12 (a). Renders nothing. When a commit flips `retained`
 * from true to false (an access or gone answer to an automatic refetch or to a Retry, or a key
 * change) and that commit removed the element that held focus, it moves focus to `focusTarget`,
 * else to the page floor. A user whose focus was elsewhere, or already on `<body>`, is never moved.
 *
 * Position rule: render it at ONE tree position in every render of the component that computes
 * `retained` — outside the `retained ? … : …` arm and any conditional the withdrawal removes; and,
 * across returns a withdrawal can switch between, the FIRST child of a root element of the same
 * type in each (unkeyed), the SECOND child of a top-level fragment in each, or the LAST child of
 * a root of the same type in each under ONE stable key identical in every return. React calls
 * `getSnapshotBeforeUpdate` only on an instance it UPDATES; a guard React remounts in that commit
 * is born with `retained` false, takes no snapshot, and focus falls to the page body (AG-11).
 * The SECOND-child form is one case of a wider rule (88.6.1-89): a
 * fixed index N of a top-level fragment in each — the same index in every return, with no
 * conditional sibling before it, because React matches unkeyed fragment children by index.
 * Example: `groupHomePage/page.js` renders its members guard as the second child and its group
 * guard as the third child of every top-level fragment.
 */
export class RetainedContentFocusGuard extends React.Component<RetainedContentFocusGuardProps> {
  getSnapshotBeforeUpdate(prevProps: RetainedContentFocusGuardProps): Element | null {
    return prevProps.retained && !this.props.retained ? document.activeElement : null;
  }

  componentDidUpdate(
    prevProps: RetainedContentFocusGuardProps,
    prevState: unknown,
    snapshot: Element | null
  ): void {
    if (!(snapshot instanceof Element) || snapshot.isConnected || !isFocusLost()) return;
    const dialog = snapshot.closest(DIALOG_ROLE_SELECTOR);
    if (dialog && !isOpenDialog(dialog)) return;
    const origin = document.activeElement;
    if (focusElement(this.props.focusTarget?.current)) return;
    focusPageFloor(origin);
  }

  render() {
    return null;
  }
}
