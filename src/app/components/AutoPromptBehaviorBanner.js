'use client';

import { useState, useEffect } from 'react';
import { Banner } from '../../components/ui/Banner';

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
    /* DECISION Phase 88-25 (Req 14 / F-761): the storage check starts HIDDEN and reveals, chosen
       OVER the `useState(false)`-for-`dismissed` shape that shipped here (initial render VISIBLE,
       effect hides it) and OVER a `useState` initialiser that reads localStorage.

       WHY THE SHIPPED SHAPE LOSES: it painted the banner for one frame at every load, including
       for people who had already dismissed it — the dismissal only landed after the effect ran.
       That flash IS the defect; a "Got it" that keeps coming back reads as broken.

       WHY A useState INITIALISER LOSES: this is a 'use client' component that still SSRs, so a
       storage read in the initialiser makes the server HTML and the client's first render
       disagree = hydration mismatch. Initial state must be identical on both sides.

       WHY useEffect AND NOT useLayoutEffect: with initial state hidden, NEITHER hook can paint
       the wrong state — the only difference is whether a legitimately-visible banner appears
       before or after the first paint. `useLayoutEffect` in an SSR'd client component logs
       React's "does nothing on the server" warning for no behavioural gain here, and the
       one-frame-late reveal of a legit banner is the accepted trade. Do NOT add a loading
       placeholder: that reintroduces a visible pre-read state, which is the bug.

       Flipping the initial state back to visible is a decision to re-introduce the flash, not a
       simplification. Both halves are pinned in AutoPromptBehaviorBanner.test.tsx. */
    const [visible, setVisible] = useState(false);

    useEffect(() => {
        if (typeof window === 'undefined') return;
        if (localStorage.getItem(STORAGE_KEY) !== '1') {
            setVisible(true);
        }
    }, []);

    const handleDismiss = () => {
        if (typeof window !== 'undefined') {
            localStorage.setItem(STORAGE_KEY, '1');
        }
        setVisible(false);
    };

    if (!visible) return null;

    /* DECISION Phase 88-25 (D-33): this consumes `Banner`'s shipped INFO treatment
       (`border-line` container + `text-content-secondary` glyph) rather than a fifth
       `--color-status-info` / `status-info` token. Four status families is the contract and a
       fifth would have to be designed, tinted and light-moded for one banner.

       Two live defects closed by the swap: the container carried a BARE `border` utility with
       no colour beside it (untinted since it shipped, and one of the 43 bare-border sites
       plan 88-26 sweeps), and the "Got it" button carried `text-status-info` — a token that
       does NOT exist in globals.css, so Tailwind emitted no rule and the label rendered in the
       inherited colour. `text-content-link` is the real token for an actionable label.

       The dismiss button lives INSIDE Banner's children, following the shipped
       `FetchErrorBanner` precedent (its "Try again"/"Report this" sit there too) rather than a
       new `action` slot on the primitive for a single consumer. */
    return (
        <Banner
            tone="info"
            title="Heads up — recurring poll behavior changed."
            className="mb-4"
        >
            <p className="text-content-secondary">
                Recurring schedules now auto-close as soon as everyone has responded,
                and the schedule creator gets a &ldquo;Schedule it?&rdquo; email
                instead of an event being auto-created. Your recurring schedule
                itself is unchanged &mdash; the next cycle will fire normally.
            </p>
            <div className="mt-2">
                <button
                    type="button"
                    onClick={handleDismiss}
                    className="min-h-11 inline-flex items-center rounded-sm px-2 py-1 text-sm font-medium text-content-link underline transition-colors hover:no-underline active:opacity-75 focus:outline-hidden focus-visible:ring-2 focus-visible:ring-focus-ring focus-visible:ring-offset-2"
                    aria-label="Dismiss banner"
                >
                    Got it
                </button>
            </div>
        </Banner>
    );
}
