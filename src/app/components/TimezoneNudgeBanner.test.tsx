// Phase 88.6-39 (W52 / D-18) — the banner's finger-up hold, and the two mounts it must not touch.
//
// WHY THIS FILE EXISTS AT ALL (declared as in-scope collateral, not silently added): the plan
// requires that `EventDayModal.js` and `gameDetail/page.js` — the two `TimezoneNudgeBanner` mounts
// with NO scheduler in the tree — render exactly as they did. All three suites covering those
// surfaces `vi.mock` this banner to `null`, so their green runs prove nothing about it. The
// assertion had nowhere to live.
//
// The mechanism it pins is the INACTIVE DEFAULT: with no gesture source in the tree the store's
// flag is `false` forever, so `usePaintGestureHold` is a pass-through and the banner's mount and
// unmount conditions are byte-for-byte what they were.
import * as React from 'react';
import { render, screen, cleanup, act } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const tz = vi.hoisted(() => ({
  isProfileTimezoneSet: false as boolean | undefined,
  browserTimezone: 'America/Denver' as string | null,
}));

vi.mock('@/app/components/TimezoneProvider', () => ({
  useTimezone: () => ({
    isProfileTimezoneSet: tz.isProfileTimezoneSet,
    browserTimezone: tz.browserTimezone,
  }),
}));

import {
  __resetPaintGestureActiveStore,
  setPaintGestureActive,
} from './heatmap/paintGestureActiveStore';
import TimezoneNudgeBanner from './TimezoneNudgeBanner';

beforeEach(() => {
  __resetPaintGestureActiveStore();
  tz.isProfileTimezoneSet = false;
  tz.browserTimezone = 'America/Denver';
});

afterEach(() => {
  cleanup();
  __resetPaintGestureActiveStore();
});

describe('TimezoneNudgeBanner — the two NON-scheduler mounts are unaffected', () => {
  it('renders the nudge when the profile TZ is unset, with no gesture source in the tree', () => {
    render(<TimezoneNudgeBanner />);
    expect(screen.getByRole('status')).toBeInTheDocument();
    expect(screen.getByText('America/Denver')).toBeInTheDocument();
  });

  it('renders NOTHING when the profile TZ is set — the self-gate is unchanged', () => {
    tz.isProfileTimezoneSet = true;
    const { container } = render(<TimezoneNudgeBanner />);
    expect(container).toBeEmptyDOMElement();
  });

  it('a LATE resolve unmounts it immediately when no gesture is running', () => {
    // The two non-scheduler mounts' entire behaviour: resolve arrives, banner goes, no hold.
    const { container, rerender } = render(<TimezoneNudgeBanner />);
    expect(screen.getByRole('status')).toBeInTheDocument();

    tz.isProfileTimezoneSet = true;
    rerender(<TimezoneNudgeBanner />);

    expect(container).toBeEmptyDOMElement();
  });
});

describe('TimezoneNudgeBanner — the late unmount is HELD under an active finger', () => {
  it('stays mounted while a paint gesture is active and goes on finger-up', () => {
    /* THE DEFECT: this banner disappears when `isProfileTimezoneSet` resolves, which can land
       mid-gesture. It sits ABOVE the scheduler grid, so its unmount moves every row under the
       user's finger and they paint an hour they did not choose. */
    const { container, rerender } = render(<TimezoneNudgeBanner />);
    act(() => setPaintGestureActive(true));

    tz.isProfileTimezoneSet = true;
    rerender(<TimezoneNudgeBanner />);

    expect(screen.getByRole('status')).toBeInTheDocument(); // HELD

    act(() => setPaintGestureActive(false));
    expect(container).toBeEmptyDOMElement(); // applied on finger-up
  });

  it('gesture ENGAGE alone changes nothing that is rendered', () => {
    const { container } = render(<TimezoneNudgeBanner />);
    const before = container.innerHTML;

    act(() => setPaintGestureActive(true));

    expect(container.innerHTML).toBe(before);
  });
});

describe('paintGestureActiveStore — IMPORT SAFETY (the leaf-module requirement)', () => {
  it('imports nothing from the component tree, so a scheduler-free mount pulls in no create-event code', async () => {
    /* SOURCE-LEVEL, and deliberately so: a runtime check cannot distinguish "not imported" from
       "imported and unused". The banner has three mount sites and only ONE has a scheduler; the
       other two must not drag `createEvent.js` into their bundles. A store resident in
       `createEvent.js` could not satisfy this at all, which is the second (independent) reason
       that shape was rejected — the first being the import cycle. */
    const fs = await import('node:fs/promises');
    const path = await import('node:path');
    const src = await fs.readFile(
      path.resolve(
        process.cwd(),
        'src/app/components/heatmap/paintGestureActiveStore.ts'
      ),
      'utf8'
    );
    const imports = [...src.matchAll(/^import[^;]*?from\s+'([^']+)'/gm)].map((m) => m[1]);

    expect(imports).toEqual(['react']);
    expect(src).not.toMatch(/from\s+'\.\.?\//); // no relative import anywhere
  });
});
