// src/lib/tzUtils.ts
//
// BACKWARD-COMPAT SHIM. Phase 84 PRIM-05 (D-01/D-02) folded the frontend
// UTC <-> wall-clock TZ math into the consolidated `datetime.ts` module. The
// implementations were MOVED there VERBATIM (byte-identical) so the pinned
// units in `tzUtils.test.ts` stay green by construction.
//
// This file now re-exports those functions so existing importers
// (createEvent.js and others not yet migrated to `datetime.ts`) keep working.
// New code should import from `./datetime` directly.
//
// Output format of `formatWithTzAbbr` is intentionally consistent with the
// backend email helper (`emailService.formatEventTime12h`) so that the same
// UTC instant + IANA TZ produces the same wall-clock string everywhere.
//
// Browser-TZ fallback policy: these helpers FALL BACK TO 'UTC' when the caller
// passes null/empty timeZone. They NEVER reach into
// `Intl.DateTimeFormat().resolvedOptions().timeZone`. That decision belongs to
// the caller (see TimezoneProvider).

export type { WallClock } from './datetime';
export { utcToWallClock, wallClockToUtc, formatWithTzAbbr } from './datetime';

// -----------------------------------------------------------------------------
// Round-trip & cross-TZ invariants (locked round-trip / DST / UTC-fallback
// scenarios) are encoded as executable regression pins in `tzUtils.test.ts`
// and mirrored by the golden-string output pins in `datetime.test.ts`.
//
//   1. wallClockToUtc('2026-06-15T19:30', 'America/Denver').toISOString()
//      → '2026-06-16T01:30:00.000Z' (DST in effect: MDT = UTC-6)
//   2. wallClockToUtc('2026-01-15T19:30', 'America/Denver').toISOString()
//      → '2026-01-16T02:30:00.000Z' (no DST: MST = UTC-7)
//   3. round-trip is lossless for an unambiguous wall-clock.
//   4. Same UTC moment renders one hour apart in Denver vs Los Angeles —
//      viewer-anchor working as designed.
//   5. formatWithTzAbbr DST sanity: MST before / MDT after spring-forward.
//   6. null timeZone falls back to UTC, NOT browser TZ.
// -----------------------------------------------------------------------------
