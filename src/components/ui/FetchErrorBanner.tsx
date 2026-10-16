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
 * region (plan 88.6-36 — see the DECISION marker at that branch). The "Report this" CTA
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
 */
const COMPACT_NOTICE = 'Some personal controls are unavailable.';

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

export function FetchErrorBanner({
  state,
  title = 'Something went wrong',
  reportSubject,
  reportContext,
  compact = false,
}: FetchErrorBannerProps) {
  const [showReport, setShowReport] = React.useState(false);
  const [retrying, setRetrying] = React.useState(false);
  // A retry in THIS failure episode is KNOWN to have failed (its own result said so and the
  // committed state agreed).
  const [retryFailedAgain, setRetryFailedAgain] = React.useState(false);
  const [retryOutcome, setRetryOutcome] = React.useState<RetryOutcome>('none');

  const retryInFlightRef = React.useRef(false);
  const outcomeTimerRef = React.useRef<ReturnType<typeof setTimeout> | null>(null);
  const mountedRef = React.useRef(true);
  // `state.showError` went false during this flight, so the assertive region empties and
  // refills — and that refill already speaks the title (round-2 review #176).
  const assertiveChangedRef = React.useRef(false);
  const retryRecovery = useFocusRecovery();

  // Resolve a pending outcome against the COMMITTED state, at render — React's documented
  // adjust-state-while-rendering pattern. Each arm is guarded by a state comparison, so it fires
  // once per transition and never loops; a `useEffect` would paint one frame of the old state.
  if (retryOutcome === 'awaitFailed' && state.showError) {
    setRetryFailedAgain(true);
    setRetryOutcome('none');
  } else if (retryOutcome === 'awaitSucceeded' && !state.showError) {
    setRetryFailedAgain(false);
    setRetryOutcome('none');
  } else if (retryOutcome === 'none' && !retrying && !state.showError && retryFailedAgain) {
    // The failure episode ended with no retry in flight (see the B1 marker for its measured limit).
    setRetryFailedAgain(false);
  }
  if (retrying && !state.showError) assertiveChangedRef.current = true;

  // A resolved outcome needs no expiry; an unmounted banner gets no late state update.
  React.useEffect(() => {
    if (retryOutcome !== 'none' || outcomeTimerRef.current === null) return;
    clearTimeout(outcomeTimerRef.current);
    outcomeTimerRef.current = null;
  }, [retryOutcome]);
  React.useEffect(() => {
    const mounted = mountedRef;
    const outcomeTimer = outcomeTimerRef;
    mounted.current = true;
    return () => {
      mounted.current = false;
      if (outcomeTimer.current !== null) clearTimeout(outcomeTimer.current);
      outcomeTimer.current = null;
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
     `.planning/deferred/phase-92.md:84`). The paragraph above is kept as history. */
  if (compact) {
    // D-08: compact degrade notice — one generic line (no identity value) + the
    // retry affordance. The VISIBLE half still renders only on permanent failure;
    // only the announcing node pre-exists it.
    return (
      <>
        <StatusRegion politeness="polite" className="sr-only">
          {state.showError ? COMPACT_NOTICE : ''}
        </StatusRegion>
        {state.showError ? (
          <div className="flex flex-wrap items-center gap-2 text-sm text-content-secondary">
            <span>{COMPACT_NOTICE}</span>
            <button
              type="button"
              onClick={handleRetry}
              aria-disabled={retrying || undefined}
              className="inline-flex items-center gap-1 text-content-link underline hover:no-underline aria-disabled:text-content-muted"
            >
              <Icon name="RefreshCw" size={14} className={retrying ? 'animate-spin' : undefined} />
              {retrying ? 'Retrying…' : 'Retry'}
            </button>
          </div>
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

  return (
    <div className={state.showError ? undefined : 'sr-only'}>
      <Banner
        tone="warning"
        title={state.showError ? title : undefined}
        actions={
          state.showError ? (
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
                className="inline-flex items-center gap-1 text-content-link underline hover:no-underline aria-disabled:text-content-muted"
              >
                <Icon name="RefreshCw" size={14} className={retrying ? 'animate-spin' : undefined} />
                {retrying ? 'Retrying…' : 'Try again'}
              </button>
              <button
                type="button"
                onClick={() => setShowReport(true)}
                className="inline-flex items-center gap-1 text-content-link underline hover:no-underline"
              >
                <Icon name="Flag" size={14} />
                Report this
              </button>
            </div>
          ) : null
        }
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
