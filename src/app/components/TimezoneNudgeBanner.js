'use client';

/**
 * TimezoneNudgeBanner — Phase 62 Plan 02 / Task 2.
 *
 * Non-blocking banner shown when User.timezone is null. Tells the user that
 * times are being rendered in their browser-detected TZ (which is a
 * footgun — silent fallback while editing means saved UTCs are stamped
 * relative to whatever browser the user happens to be on at submit time)
 * and links to the profile picker so they can lock in a canonical TZ.
 *
 * Reads `isProfileTimezoneSet` and `browserTimezone` from TimezoneProvider
 * (Plan 62-01). Renders nothing when the profile TZ is set — banner is
 * a nudge, not a permanent badge.
 *
 * Mounted on:
 *   - createEvent.js (edit/create form) — most important nudge surface
 *     because that's where the silent fallback will actually corrupt data.
 *   - EventDayModal.js (event detail) — visibility on the read surface so
 *     users notice before they edit.
 *
 * Styling matches PendingMemberBanner.js for visual cohesion. It does NOT render through the
 * shared `Banner` primitive — checked at plan 88.6-26 before adding a size utility here, because
 * a call-site size that duplicates a primitive's own is the dead-class case in a different
 * costume. This is a hand-rolled div, so the utility below is the only thing sizing it.
 *
 * DECISION Phase 88.6-39 (W52 / D-18): this banner's LATE UNMOUNT is held until finger-up, and
 * the hold lives HERE rather than at the `createEvent.js` mount site. It is a second uncontrolled
 * height source above the scheduler grid — it disappears when `isProfileTimezoneSet` resolves,
 * which can land mid-gesture and move every row under the user's finger.
 *
 * WHY INSIDE THE BANNER. It self-gates internally (the `return null` below) and takes NO props,
 * so holding its unmount FROM `createEvent` would mean gating that JSX — which forces
 * `createEvent` to subscribe and therefore to re-render at gesture ENGAGE, reconciling the ~196
 * memoized scheduler cells, because `EventScheduler` is rendered inline and unmemoized there.
 * That is the exact jank the signal exists to avoid causing.
 *
 * IMPORT-SAFE BY CONSTRUCTION. This banner has THREE mount sites and only one has a scheduler
 * (`createEvent.js`; the other two are `EventDayModal.js` and `gameDetail/page.js`). The store is
 * a LEAF MODULE with an INACTIVE default and no imports from the component tree, so those two
 * mounts render exactly as they did and pull no create-event code into their bundles.
 */

import Link from 'next/link';
import { usePaintGestureHold } from './heatmap/paintGestureActiveStore';
import { useTimezone } from './TimezoneProvider';

export default function TimezoneNudgeBanner() {
  const { isProfileTimezoneSet, browserTimezone } = useTimezone();
  // Held only while a paint gesture is ACTIVE; inert everywhere else, which is what keeps the two
  // non-scheduler mounts byte-identical in behaviour.
  const heldIsProfileTimezoneSet = usePaintGestureHold(isProfileTimezoneSet);

  if (heldIsProfileTimezoneSet) return null;

  // Friendly form of the browser TZ identifier ("America/Denver" → "America/Denver";
  // we leave the IANA string verbatim — users seeing it usually recognize it,
  // and abbreviating loses information).
  const displayTz = browserTimezone || 'your browser timezone';

  return (
    <div
      role="status"
      className="bg-amber-50 border border-amber-200 rounded-card p-3 mb-4 flex items-start gap-3"
    >
      <svg
        className="w-5 h-5 text-amber-600 shrink-0 mt-0.5"
        fill="none"
        stroke="currentColor"
        viewBox="0 0 24 24"
        strokeWidth={2}
        aria-hidden="true"
      >
        <path
          strokeLinecap="round"
          strokeLinejoin="round"
          d="M12 9v3.75m9-.75a9 9 0 11-18 0 9 9 0 0118 0zm-9 3.75h.008v.008H12v-.008z"
        />
      </svg>
      {/* DECISION Phase 88.6-26 (UI-SPEC 4.3 vs the shipped Banner family): the body STAYS at 14,
          chosen OVER the 16 a mechanical read of 4.3's "<p> running prose -> Body 16" row gives.
          On the merits 16 is the wrong answer HERE: the shipped Banner primitive's own cva base is
          text-sm (Banner.tsx:41) and three banners render through it, PendingMemberBanner.js:23 —
          the sibling this file's docblock says it matches "for visual cohesion" — is text-sm, and
          two plans in this same phase already answered this exact question the same way (88.6-17
          kept the SMS-disabled banner at 14 "because Banner.tsx's own copy is 14"; 88.6-19 kept a
          two-sentence member notice at 14 on the same ground, recording that R2 reads it as prose).
          Raising this one banner would make it the only 16px banner in the app and, MEASURED in
          Chromium at 375px, would grow it 110px -> 150px inside the create-event modal — a visible
          delta with no V-row, on the phone-primary surface, in exchange for LESS consistency.
          Moving the whole family to 16 is a decision for a plan that owns the primitive. */}
      <div className="flex-1 text-sm text-amber-900">
        <p className="mb-1">
          Your timezone isn&apos;t set. We&apos;re showing times in{' '}
          <span className="font-bold">{displayTz}</span>.
        </p>
        <p className="text-amber-800">
          <Link
            href="/userProfile#timezone"
            className="underline hover:text-amber-950"
          >
            Set your timezone
          </Link>
          {' '}to keep event times consistent across devices.
        </p>
      </div>
    </div>
  );
}
