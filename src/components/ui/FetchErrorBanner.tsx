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
 * Pair it with {@link useFetchErrorState}: pass the derived `state`. Renders
 * nothing while `state.showError` is false. The "Report this" CTA opens the
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
}

export function FetchErrorBanner({
  state,
  title = 'Something went wrong',
  reportSubject,
  reportContext,
}: FetchErrorBannerProps) {
  const [showReport, setShowReport] = React.useState(false);
  const [retrying, setRetrying] = React.useState(false);

  if (!state.showError) return null;

  const handleRetry = async () => {
    setRetrying(true);
    try {
      await state.retry();
    } finally {
      setRetrying(false);
    }
  };

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
        <div className="mt-2 flex flex-wrap items-center gap-4 text-sm">
          <button
            type="button"
            onClick={handleRetry}
            disabled={retrying}
            className="inline-flex items-center gap-1 font-medium text-content-link underline hover:no-underline disabled:opacity-50"
          >
            <Icon name="RefreshCw" size={14} className={retrying ? 'animate-spin' : undefined} />
            {retrying ? 'Retrying…' : 'Try again'}
          </button>
          <button
            type="button"
            onClick={() => setShowReport(true)}
            className="inline-flex items-center gap-1 font-medium text-content-link underline hover:no-underline"
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
