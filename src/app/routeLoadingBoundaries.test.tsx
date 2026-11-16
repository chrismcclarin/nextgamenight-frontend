/// <reference types="vite/client" />
// ^ import.meta.glob is a Vite transform: vitest resolves it at run time, but the
//   repo's HARD tsc gate (npm run typecheck, main tsconfig) knows nothing of Vite
//   unless this file pulls the types in itself — round 3 of PR #22 went red on
//   exactly that (TS2339 on `glob`). Per-file reference, not a tsconfig `types`
//   addition: the app source has no business seeing Vite's ambient API.
//
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
import { render, screen, cleanup, act } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { REGION_EMPTY_DWELL_MS } from '@/components/ui/StatusRegion';

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
      // AMENDED Phase 88.9-69 (X35): the boundary is announced by a region that mounts EMPTY and
      // takes a real, human label after the dwell (a status that arrives already holding its
      // words is not spoken), so the label is read as the region's text after the dwell and no
      // longer as an attribute of the root.
      vi.useFakeTimers();
      try {
        const { container } = render(React.createElement(mod.default));
        const region = screen.getByRole('status');
        expect(region.textContent, `${path}'s status region mounted already holding its words`).toBe('');
        act(() => {
          vi.advanceTimersByTime(REGION_EMPTY_DWELL_MS);
        });
        expect(
          (region.textContent ?? '').length,
          `${path}'s status region says nothing after the dwell — a silent boundary reads as a hang to a screen reader`,
        ).toBeGreaterThan(3);
        // …and the shared primitive's spinner, not bespoke markup: the arc is the
        // aria-hidden animate-spin element RouteFallback renders under its root, beside the label.
        const root = container.firstElementChild;
        const spinner = root?.querySelector('[aria-hidden="true"]') ?? null;
        expect(spinner, `${path} rendered no spinner element — is it still on RouteFallback?`).not.toBeNull();
        expect(spinner!).toHaveClass('animate-spin');
      } finally {
        vi.useRealTimers();
      }
    });
  }
});
