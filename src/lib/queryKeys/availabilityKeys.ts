/**
 * availabilityKeys — co-located query-key factory for the availability
 * subsystem (PRIM-07 / D-12). Byte-identical keys are the ONLY dedup mechanism
 * in React Query: two queries with deep-equal keys share one cache entry and
 * fetch once. NEVER inline a key array literal at a call site — always call the
 * factory, or the keys drift and dedup silently breaks.
 *
 * `as const` makes each tuple a readonly literal so the shape is stable.
 */
export const availabilityKeys = {
  all: ['availability'] as const,
  /** A user's editable recurring schedules + specific overrides (userProfile). */
  patterns: (userId: string | null | undefined) =>
    [...availabilityKeys.all, 'patterns', userId ?? ''] as const,
};
