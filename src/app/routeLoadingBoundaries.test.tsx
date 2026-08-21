// Fleet render pins for the route `loading.tsx` boundaries (Req 3 / D-19, plan 88-09).
//
// REPLACES the e2e loading-boundary probe deleted from route-fallbacks.spec.ts on
// PR #22: `/friends` (like the rest of the fleet) is STATICALLY PRERENDERED, so
// Next prefetches the full route payload and a prod client-navigation resolves
// entirely from that cache — there is no in-flight segment fetch to hold, and
// `loading.tsx` can never be forced visible in a prod build. Two CI rounds proved
// the mechanism unforceable (round 1 held the prefetch and starved the router of
// the boundary; round 2 passed the prefetch through and the click never fetched).
// What that e2e uniquely proved — that each route's `loading.tsx` actually ADOPTS
// the shared RouteFallback rather than rendering something bespoke or silent — is
// pinned here per-file instead. The primitive's own contract (announced status
// role, 16px secondary label, reduced-motion-exempt spinner, page ground) stays
// pinned in RouteFallback.test.tsx; this file only proves the fleet wires it.
import * as React from 'react';
import { render, screen, cleanup } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';

// Vite resolves the glob at transform time from the real tree — the population
// is source-derived, never a hand-list that drifts (the 17-defective-gates
// lesson). `./**/loading.tsx` matches the root `./loading.tsx` too (`**` spans
// zero segments).
const boundaries = import.meta.glob<{ default: React.ComponentType }>(
  './**/loading.tsx',
  { eager: true },
);

describe('route loading.tsx fleet — every boundary renders the shared RouteFallback', () => {
  afterEach(cleanup);

  it('the glob found the whole fleet (anti-vacuity: 11 files as of 88-09 + wave 12)', () => {
    // A shrinking count means a route boundary was deleted or moved out of the
    // glob's reach — either way this file's coverage silently narrowed, which
    // must be a red test, not a quiet pass. Update the floor when ADDING routes.
    expect(Object.keys(boundaries).length).toBeGreaterThanOrEqual(11);
  });

  for (const [path, mod] of Object.entries(boundaries)) {
    it(`${path} renders an announced RouteFallback (AR R1-M18 — never silent)`, () => {
      render(React.createElement(mod.default));
      // Announced live region with a real, human accessible name…
      const region = screen.getByRole('status');
      const name = region.getAttribute('aria-label') ?? '';
      expect(
        name.length,
        `${path}'s status region has no accessible name — a silent boundary reads as a hang to a screen reader`,
      ).toBeGreaterThan(3);
      // …and the shared primitive's spinner, not bespoke markup: the arc is the
      // aria-hidden animate-spin element RouteFallback renders beside the label.
      const spinner = region.querySelector('[aria-hidden="true"]');
      expect(spinner, `${path} rendered no spinner element — is it still on RouteFallback?`).not.toBeNull();
      expect(spinner!).toHaveClass('animate-spin');
    });
  }
});
