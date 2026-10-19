// Plan 88.6.1-89 (close ruling P-80, owner 2026-10-17 "reuse"): the calendar's loading card, moved
// byte for byte out of EventCalendar.js (which renders it for its own two loading returns) so the
// group page can render the same card while its events load — in external-events mode the parent
// owns loading. One string, already shipped: copy row P80. No heading renders in it; the group page
// keeps the section's own heading above it.
export const CALENDAR_LOADING_LABEL = 'Loading calendar...';

export function CalendarLoadingCard() {
  return (
    <div className="card p-3 md:p-6">
      <p className="text-content-secondary">{CALENDAR_LOADING_LABEL}</p>
    </div>
  );
}
