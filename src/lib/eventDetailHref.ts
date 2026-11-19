/**
 * eventDetailHref — the ONE rule for where a calendar tap on an event goes.
 *
 * DECISION Phase 88.9 (W59): a live night opens the event page over the game view (owner by chat
 * 2026-11-07 3:15 AM Pacific "W59 event."); ONE helper decides both calendar arms (EventCalendar
 * and the home sheet, 88.9-42), so the mirror is kept by construction, chosen OVER passing
 * happeningNowIds into EventCalendar (only one of its two mounts has the set).
 *
 * Rule: no `game_id`, OR the start is at or after `nowMs`, OR the night is still running
 * (`isStillRunning`: live status, started, inside its run window) -> the EVENT page
 * (`/gameDetail?event_id=…&group_id=…`); otherwise the GAME page (`/gameDetail?game_id=…&group_id=…`).
 * An unparseable or absent start date is "not future", exactly as the inline `>=` it replaces read
 * it. Ids are `encodeURIComponent`-encoded into a fixed same-origin path (T-88.9-130).
 */
import { isStillRunning, type UpcomingEventLike } from './upcomingEvents';

export interface DetailHrefEvent extends UpcomingEventLike {
  id: string | number;
  group_id: string | number;
  game_id?: string | number | null;
}

export function eventDetailHref(event: DetailHrefEvent, nowMs: number): string {
  const startMs = new Date(event.start_date).getTime();
  const isFuture = !Number.isNaN(startMs) && startMs >= nowMs;
  const toEventPage = !event.game_id || isFuture || isStillRunning(event, nowMs);
  const group = encodeURIComponent(String(event.group_id));
  if (toEventPage) {
    return `/gameDetail?event_id=${encodeURIComponent(String(event.id))}&group_id=${group}`;
  }
  return `/gameDetail?game_id=${encodeURIComponent(String(event.game_id))}&group_id=${group}`;
}
