/**
 * GAP14 (unit) — the byte-identical-key invariant that makes dedup possible.
 * If the factory ever returns non-deep-equal tuples for the same input, two
 * consumers would NOT share a cache entry and the F-826/F-852 duplicate fetches
 * would silently return. Pinning the exact tuple prefixes also fails CI if the
 * key shape is accidentally changed.
 */
import { describe, it, expect } from 'vitest';
import { promptKeys } from './promptKeys';

const g = 'group-123';

describe('promptKeys factory (GAP14 — stable, byte-identical keys)', () => {
  it('settings(g) deep-equals settings(g) across separate calls', () => {
    expect(promptKeys.settings(g)).toEqual(promptKeys.settings(g));
  });

  it('openPolls(g) deep-equals openPolls(g) across separate calls', () => {
    expect(promptKeys.openPolls(g)).toEqual(promptKeys.openPolls(g));
  });

  it('pins the exact tuple prefixes (shape drift fails CI)', () => {
    expect(promptKeys.all).toEqual(['prompts']);
    expect(promptKeys.settings(g)).toEqual(['prompts', 'settings', g]);
    expect(promptKeys.openPolls(g)).toEqual(['prompts', 'open', g]);
  });

  it('different groupIds yield different keys (no cross-group cache bleed)', () => {
    expect(promptKeys.settings('a')).not.toEqual(promptKeys.settings('b'));
    expect(promptKeys.openPolls('a')).not.toEqual(promptKeys.openPolls('b'));
  });

  it('settings and openPolls never collide for the same group', () => {
    expect(promptKeys.settings(g)).not.toEqual(promptKeys.openPolls(g));
  });
});
