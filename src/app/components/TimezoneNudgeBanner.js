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
 * Styling matches PendingMemberBanner.js for visual cohesion.
 */

import Link from 'next/link';
import { useTimezone } from './TimezoneProvider';

export default function TimezoneNudgeBanner() {
  const { isProfileTimezoneSet, browserTimezone } = useTimezone();

  if (isProfileTimezoneSet) return null;

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
        className="w-5 h-5 text-amber-600 flex-shrink-0 mt-0.5"
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
      <div className="flex-1 text-sm text-amber-900">
        <p className="mb-1">
          Your timezone isn&apos;t set. We&apos;re showing times in{' '}
          <span className="font-medium">{displayTz}</span>.
        </p>
        <p className="text-amber-800">
          <Link
            href="/userProfile#timezone"
            className="underline hover:text-amber-950 font-medium"
          >
            Set your timezone
          </Link>
          {' '}to keep event times consistent across devices.
        </p>
      </div>
    </div>
  );
}
