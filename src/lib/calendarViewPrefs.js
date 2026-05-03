/**
 * Calendar view preferences (CAL-03 / CAL-07).
 *
 * Persists the user's calendar viewMode (month/list) and last-viewed
 * currentDate to localStorage so the surface remembers state across
 * page reloads and across the create-event modal open/close cycle.
 *
 * Per-surface scope: the home calendar and each group calendar each
 * remember their own state independently. Scope strings:
 *   - 'home'              — UserHomePage calendar
 *   - 'group:<group_id>'  — groupHomePage calendar
 *
 * TTL policy (per Phase 64 CONTEXT):
 *   - viewMode: NO TTL — persists indefinitely (user's chosen mode is
 *     part of their preference, not session state).
 *   - currentDate: 1-hour TTL — restored on reload within the hour
 *     (protects active planning while scrolling future months);
 *     after the hour it is dropped so callers fall back to today.
 *
 * Storage shape:
 *   localStorage[`nextgamenight.calendarPrefs.${scope}`] = JSON.stringify({
 *     viewMode: 'month' | 'list',
 *     currentDateISO: string | null,
 *     savedAtMs: number,
 *   })
 *
 * SSR + private-browsing safety: every localStorage access is wrapped
 * in try/catch. On any failure we return null (load) or no-op (save).
 */

const STORAGE_PREFIX = 'nextgamenight.calendarPrefs.';
const MONTH_TTL_MS = 60 * 60 * 1000; // 1 hour

function storageKey(scope) {
  return `${STORAGE_PREFIX}${scope || 'home'}`;
}

/**
 * Load persisted calendar prefs for the given scope.
 *
 * @param {string} scope - 'home' or 'group:<group_id>'
 * @returns {{ viewMode: string|null, currentDate: Date|null } | null}
 *   Returns null on storage error. Otherwise returns an object whose
 *   `viewMode` reflects the saved value (or null if never saved) and
 *   whose `currentDate` is a Date if within TTL, else null.
 */
export function loadCalendarPrefs(scope) {
  if (typeof window === 'undefined') return null;
  try {
    const raw = window.localStorage.getItem(storageKey(scope));
    if (!raw) return { viewMode: null, currentDate: null };
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object') {
      return { viewMode: null, currentDate: null };
    }
    const viewMode = parsed.viewMode === 'list' || parsed.viewMode === 'month'
      ? parsed.viewMode
      : null;
    const savedAtMs = typeof parsed.savedAtMs === 'number' ? parsed.savedAtMs : 0;
    const withinTtl = savedAtMs > 0 && (Date.now() - savedAtMs) < MONTH_TTL_MS;
    let currentDate = null;
    if (withinTtl && typeof parsed.currentDateISO === 'string') {
      const d = new Date(parsed.currentDateISO);
      if (!isNaN(d.getTime())) currentDate = d;
    }
    return { viewMode, currentDate };
  } catch (err) {
    return null;
  }
}

/**
 * Save calendar prefs for the given scope. No-ops on storage error.
 *
 * @param {string} scope - 'home' or 'group:<group_id>'
 * @param {{ viewMode: string, currentDate: Date }} prefs
 */
export function saveCalendarPrefs(scope, prefs) {
  if (typeof window === 'undefined') return;
  if (!prefs || typeof prefs !== 'object') return;
  try {
    const payload = {
      viewMode: prefs.viewMode === 'list' ? 'list' : 'month',
      currentDateISO: prefs.currentDate instanceof Date && !isNaN(prefs.currentDate.getTime())
        ? prefs.currentDate.toISOString()
        : null,
      savedAtMs: Date.now(),
    };
    window.localStorage.setItem(storageKey(scope), JSON.stringify(payload));
  } catch (err) {
    // Swallow — private-browsing / quota errors are non-fatal.
  }
}
