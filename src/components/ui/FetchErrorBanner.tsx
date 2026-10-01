'use client';

/**
 * FetchErrorBanner — PRIM-03 presentational fetch-error surface (D-02).
 *
 * The canonical amber error banner: composes {@link Banner} (warning tone on
 * `status-*` tokens — its internal StatusRegion announces the error assertively
 * and its tone Icon supplies the leading glyph), plus a DIRECT {@link Icon} on
 * each action button and a DIRECT, POLITE {@link StatusRegion} for transient
 * "Retrying…" feedback (a sibling of Banner's assertive region, never nested).
 * That composition is the PRIM-04 adoption proof for all three primitives.
 *
 * Pair it with {@link useFetchErrorState}: pass the derived `state`. The FULL branch renders
 * nothing while `state.showError` is false; the `compact` branch renders its `sr-only` polite
 * live region EMPTY and nothing else, so the notice arrives as a CHANGE to a mounted region
 * (plan 88.6-36 — see the DECISION marker at that branch). The "Report this" CTA opens the
 * existing `FeedbackForm` prefilled with `initialType='bug'`, a derived
 * `initialSubject`, and an `initialDescription` carrying the error `code`/message
 * (no token/PII — T-86-10). The message is rendered as auto-escaped React
 * children (T-86-09): no `dangerouslySetInnerHTML`.
 */
import * as React from 'react';

import { Banner } from './Banner';
import { Icon } from './Icon';
import { StatusRegion } from './StatusRegion';
import FeedbackForm from '@/app/components/FeedbackForm';
import type { FetchErrorState } from './useFetchErrorState';

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

export function FetchErrorBanner({
  state,
  title = 'Something went wrong',
  reportSubject,
  reportContext,
  compact = false,
}: FetchErrorBannerProps) {
  const [showReport, setShowReport] = React.useState(false);
  const [retrying, setRetrying] = React.useState(false);

  const handleRetry = async () => {
    setRetrying(true);
    try {
      await state.retry();
    } finally {
      setRetrying(false);
    }
  };

  /* DECISION Phase 88.6-36 (T-88.6-102, W38 class): the compact branch's announcement is a
     SHIPPED `StatusRegion`, mounted ABOVE the `showError` guard and GATED ON `compact`, chosen
     OVER the hand-rolled `<div role="status">` that shipped here.

     WHAT WAS WRONG. The old markup put `role="status"` on the visible wrapper, which was mounted
     in the same commit as the failure text it carried. `StatusRegion.tsx:9-12` records the rule
     this breaks: screen readers announce CHANGES to a mounted live region, not the conditional
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
     supplies NO default visibility (`StatusRegion.tsx:43` is `cn('text-sm', className)`), so an
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
     with one word and zero caller edits. Not taken because `StatusRegion.tsx:9-12` states the
     mount-does-not-announce rule with no politeness carve-out and AT behaviour was not verified.
     Disclosed to the owner in `88.6-36-SUMMARY.md`. */
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
              disabled={retrying}
              className="inline-flex items-center gap-1 text-content-link underline hover:no-underline disabled:opacity-50"
            >
              <Icon name="RefreshCw" size={14} className={retrying ? 'animate-spin' : undefined} />
              {retrying ? 'Retrying…' : 'Retry'}
            </button>
          </div>
        ) : null}
      </>
    );
  }

  if (!state.showError) return null;

  const subject = reportSubject ?? `Couldn't load: ${state.message}`;
  const description =
    `An error occurred (code: ${state.code}).\n\n` +
    `Message shown: ${state.message}\n\n` +
    (reportContext ? `Where: ${reportContext}\n\n` : '') +
    'What I was doing when this happened:\n\n' +
    'Anything else worth noting:\n';

  return (
    <div>
      <Banner tone="warning" title={title}>
        <p>{state.message}</p>
        {/* DECISION Phase 88.6-36 (D-03 / UI-SPEC §4.5): the three link-buttons in this file
            (the compact `Retry` above, and `Try again` / `Report this` here) carry NO weight
            utility. §4.5 names these three sites explicitly as the EMPHASIS case — the emphasis
            is carried by `text-content-link` and `underline`, both of which stay, so the 500
            deleted with no look delta. Chosen OVER 700, which would make a text link louder than
            the banner title beside it. What was NOT measured, stated rather than implied: the
            COMPUTED rendered weight. This suite is jsdom, which performs no layout and loads no
            stylesheet, so `getComputedStyle().fontWeight` reads the UA default identically
            before and after and would prove nothing (the D28 rule). The pins are class-level. */}
        <div className="mt-2 flex flex-wrap items-center gap-4 text-sm">
          <button
            type="button"
            onClick={handleRetry}
            disabled={retrying}
            className="inline-flex items-center gap-1 text-content-link underline hover:no-underline disabled:opacity-50"
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
      </Banner>

      {/* Polite, secondary live region for transient retry feedback — a SIBLING
          of Banner's assertive error region (no nested live regions). */}
      <StatusRegion politeness="polite" className="sr-only">
        {retrying ? 'Retrying…' : ''}
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
