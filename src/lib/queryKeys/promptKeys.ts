/**
 * promptKeys — co-located query-key factory for the PromptSchedule subsystem
 * (PRIM-07 / D-12). Co-located next to where the prompt fetchers live so the
 * trio (PromptScheduleSection + PromptScheduleReadOnly/Manager + OpenPollsList)
 * all derive BYTE-IDENTICAL keys from one source.
 *
 * Byte-identical keys are the ONLY dedup mechanism in React Query: two queries
 * with deep-equal keys share one cache entry and fetch once. NEVER inline a key
 * array literal at a call site — always call the factory, or the keys drift and
 * dedup silently breaks (F-826 getOpenPrompts 2x, F-852 getGroupPromptSettings 3x).
 *
 * `as const` makes each tuple a readonly literal so the shape is stable and the
 * GAP14 dedup test can pin the exact tuple prefixes.
 */
export const promptKeys = {
  all: ['prompts'] as const,
  settings: (groupId: string) => [...promptKeys.all, 'settings', groupId] as const,
  openPolls: (groupId: string) => [...promptKeys.all, 'open', groupId] as const,
};
