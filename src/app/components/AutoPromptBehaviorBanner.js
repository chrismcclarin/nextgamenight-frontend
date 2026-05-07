'use client';

import { useState, useEffect } from 'react';

/**
 * AutoPromptBehaviorBanner — Phase 71.2 (D-ADAPT-03 / D-ADAPT-04)
 *
 * In-app banner explaining the auto-prompt consensus-close + email-CTA
 * behavior shift to existing recurring-schedule owners. Dismissable;
 * dismissal persists across reloads via localStorage.
 *
 * Why this exists (per CONTEXT "Claude's Discretion" + Plan 02 INVESTIGATION):
 *   - Before v1.10: deadline-expiry on a recurring auto-prompt auto-created
 *     an event from the highest-scoring suggestion (no human in the loop).
 *   - After v1.10: deadline-expiry (and consensus-close) instead emails the
 *     schedule creator a "Schedule it?" CTA per top slot. The recurring
 *     schedule itself is untouched — the next cycle still fires.
 *
 * Storage key includes a `-v1` suffix so future copy revisions can ship
 * a `-v2` key and re-prompt every user once without burning the dismissal.
 */
const STORAGE_KEY = 'auto-prompt-behavior-banner-dismissed-v1';

export default function AutoPromptBehaviorBanner() {
  const [dismissed, setDismissed] = useState(false);

  useEffect(() => {
    if (typeof window !== 'undefined' && localStorage.getItem(STORAGE_KEY) === '1') {
      setDismissed(true);
    }
  }, []);

  const handleDismiss = () => {
    if (typeof window !== 'undefined') {
      localStorage.setItem(STORAGE_KEY, '1');
    }
    setDismissed(true);
  };

  if (dismissed) return null;

  return (
    <div className="bg-status-info/10 border border-status-info/30 rounded-card p-3 mb-4 flex justify-between gap-3">
      <div className="text-sm text-content-secondary">
        <p className="font-semibold text-content-primary mb-1">
          Heads up &mdash; recurring poll behavior changed.
        </p>
        <p>
          Recurring schedules now auto-close as soon as everyone has responded,
          and the schedule creator gets a &ldquo;Schedule it?&rdquo; email
          instead of an event being auto-created. Your recurring schedule
          itself is unchanged &mdash; the next cycle will fire normally.
        </p>
      </div>
      <button
        type="button"
        onClick={handleDismiss}
        className="text-status-info hover:text-content-primary text-xs font-semibold flex-shrink-0 self-start px-2 py-1 rounded hover:bg-surface-card-hover transition-colors"
        aria-label="Dismiss banner"
      >
        Got it
      </button>
    </div>
  );
}
