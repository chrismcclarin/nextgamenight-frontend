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
 * D-47). The "Report this" CTA
 * opens the existing `FeedbackForm` prefilled with `initialType='bug'`, a derived
 * `initialSubject`, and an `initialDescription` carrying the error `code`/message
 * (no token/PII — T-86-10). The message is rendered as auto-escaped React
 * children (T-86-09): no `dangerouslySetInnerHTML`.
 */
import * as React from 'react';

import { Banner } from './Banner';
import { Icon } from './Icon';
import { StatusRegion } from './StatusRegion';
import FeedbackForm from '@/app/components/FeedbackForm';
import { logger, errCtx } from '@/lib/logger';
import type { FetchErrorState } from './useFetchErrorState';
import { useFocusRecovery } from './useFocusRecovery';

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
   * line plus the retry button, skipping the full Banner/FeedbackForm scaffold.
   * Used by identity-resolution consumers so a failed `useSelfIdentity` degrades
   * loudly-but-small instead of silently (D-11). The notice carries NO identity
   * value (Security: PII-in-notice mitigation, T-873-02-01).
   */
  compact?: boolean;
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

/**
 * How long the compact region stays EMPTY after a press before it may refill. AT-4
 * (`research/APPENDIX-AT.md:316-326`, failure condition 4, "The same message twice"): WebKit's
 * live-region manager re-announces text identical to the last announcement only after the region
 * has stayed empty for `emptyRegionSettleDelay { 100_ms }`, and a synchronous clear-then-set is
 * dropped. The value is the engine's constant, not a guess. `RETRY_OUTCOME_WINDOW_MS` (1000) is
 * at least this value, so an outcome never expires inside the dwell.
 */
export const REGION_EMPTY_DWELL_MS = 100;

/**
 * How long a retry's outcome may wait for the COMMITTED state to agree with it before it is
 * dropped (Phase 88.6.1-21, round-2 review #23). Explicitly longer than one TanStack commit (a
 * single zero-delay macrotask, `@tanstack/query-core` `notifyManager.js:3`,
 * `var defaultScheduler = systemSetTimeoutZero;`) plus a React render on a throttled phone, and
 * short enough that a contradicted outcome holds the compact region quiet for one second at most.
 * See the `DECISION Phase 88.6.1-21 (AC-11 / D-42)` marker at the full branch.
 */
export const RETRY_OUTCOME_WINDOW_MS = 1000;

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
  const { state, failureShown, dwellOnPress, focusTarget } = options;
  const [retrying, setRetrying] = React.useState(false);
  // A retry in THIS failure episode is KNOWN to have failed (its own result said so and the
  // committed state agreed).
  const [retryFailedAgain, setRetryFailedAgain] = React.useState(false);
  const [retryOutcome, setRetryOutcome] = React.useState<RetryOutcome>('none');
  // False from a compact press until REGION_EMPTY_DWELL_MS has passed (the B1 marker).
  const [regionDwellDone, setRegionDwellDone] = React.useState(true);

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
     (e) inline focus code in this file (D-04: one shared hook, never per-host copies).

     DISCLOSED DELTA: while retrying, the link ink turns muted instead of the former half-opacity
     wash. LIMIT, named honestly: where the CALLER swaps the banner out for the retry (a never-loaded
     TanStack query reports `pending`, so `showError` is false from the press to the outcome), the
     in-flight look is never seen and the hook's floor is what catches focus — at the press. That
     derivation is outside this file (Phase 92, `.planning/deferred/phase-92.md`). */
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

  return { retrying, retryOutcome, retryFailedAgain, regionQuiet, handleRetry, assertiveChangedRef };
}

/** Props of {@link NoticeRow}, the one visible row every small notice in this file renders. */
interface NoticeRowProps {
  /** The ratified sentence the row shows (and the one polite region beside it carries). */
  text: string;
  /** A retry is in flight: `Retrying…` and `aria-disabled`, never the native attribute. */
  retrying: boolean;
  /** The shared press handler; it arms focus recovery from the pressed button. */
  handleRetry: (event: React.MouseEvent<HTMLButtonElement>) => void | Promise<void>;
}

/* DECISION Phase 88.6.1-70 (one row): ONE row element for the small notices — the compact
   identity notice and `RefreshFailedNotice`, and a third, `SectionLoadFailedNotice`, under owner
   ruling D8-r2 — so they have one look by construction and one floor pin. CHOSEN, too, the one
   added attribute pair (the sentence's `React.useId` id, and the `Retry`'s `aria-describedby`
   pointing at it; finding #339): every small-notice `Retry` is described by its own ratified
   sentence, so a `Retry` beside the identity notice is told apart from RF1's with no new words.
   Two RF1 notices on ONE page still read alike; naming the list needs words, which stays the
   owner's wording question (D-31; plan 88.6.1-70 Routed finding 2).
   REJECTED: (a) a second row markup for RF1 — two class strings that drift apart, and a third
   opening tag carrying the retry handler, which reds the floor suite's `bannerRetries` count, or,
   renamed, an RF1 `Retry` the floor suite never sees; (b) merging a caller `className` into this
   row through `cn` — the row's class strings stay byte-identical (the description tie above is a
   deliberate addition, not a style change), so a consumer's spacing lives on the RF1 wrapper
   instead. The prop is named `handleRetry` ON PURPOSE: the floor suite anchors on the button's
   handler attribute. Changing this is a decision, not a cleanup. */
function NoticeRow({ text, retrying, handleRetry }: NoticeRowProps) {
  const textId = React.useId();
  return (
    <div className="flex flex-wrap items-center gap-2 text-sm text-content-secondary">
      <span id={textId}>{text}</span>
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
}: FetchErrorBannerProps) {
  const [showReport, setShowReport] = React.useState(false);
  const { retrying, retryOutcome, retryFailedAgain, regionQuiet, handleRetry, assertiveChangedRef } =
    useRetryEpisode({ state, failureShown: state.showError, dwellOnPress: compact, quietOnMount: false });

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
          <NoticeRow text={noticeText} retrying={retrying} handleRetry={handleRetry} />
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
        type="button"
        onClick={handleRetry}
        aria-disabled={retrying || undefined}
        className="inline-flex min-h-11 md:min-h-0 items-center gap-1 text-content-link underline hover:no-underline aria-disabled:text-content-muted focus:outline-hidden focus-visible:ring-2 focus-visible:ring-focus-ring focus-visible:ring-offset-2"
      >
        <Icon name="RefreshCw" size={14} className={retrying ? 'animate-spin' : undefined} />
        {retrying ? 'Retrying…' : 'Try again'}
      </button>
      <button
        type="button"
        onClick={() => setShowReport(true)}
        className="inline-flex min-h-11 md:min-h-0 items-center gap-1 text-content-link underline hover:no-underline focus:outline-hidden focus-visible:ring-2 focus-visible:ring-focus-ring focus-visible:ring-offset-2"
      >
        <Icon name="Flag" size={14} />
        Report this
      </button>
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

      {showReport && (
        <FeedbackForm
          onClose={() => setShowReport(false)}
          initialType="bug"
          initialSubject={subject}
          initialDescription={description}
        />
      )}
    </div>
  );
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
     count), so a refresh nobody loaded for shows nothing here and the site's full banner owns it.
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
   Changing any of these is a decision, not a cleanup. */
export function RefreshFailedNotice({ state, retained, focusTarget, className }: RefreshFailedNoticeProps) {
  const shown = state.showError && retained;
  const { retrying, regionQuiet, handleRetry } = useRetryEpisode({
    state,
    failureShown: shown,
    dwellOnPress: true,
    quietOnMount: true,
    focusTarget,
  });
  return (
    <>
      <StatusRegion politeness="polite" className="sr-only">
        {shown && !regionQuiet ? REFRESH_FAILED_NOTICE : ''}
      </StatusRegion>
      {shown ? (
        <div className={className}>
          <NoticeRow text={REFRESH_FAILED_NOTICE} retrying={retrying} handleRetry={handleRetry} />
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
  const { retrying, regionQuiet, handleRetry } = useRetryEpisode({
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
          <NoticeRow text={state.message} retrying={retrying} handleRetry={handleRetry} />
        </div>
      ) : null}
    </>
  );
}
