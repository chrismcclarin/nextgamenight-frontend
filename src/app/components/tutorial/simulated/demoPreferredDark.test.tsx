// Phase 88.9-52 (N1b, owner pick Mid, 2026-11-17): the tutorial demos that paint the availability
// Preferred state follow the real grid in dark. The real grid paints a Preferred cell with the
// shared light colour plus one dark class (src/app/components/AvailabilityGrid.js ("const CELL_PREFERRED_CLASS =")),
// and a demo that kept the bare light colour showed bright mint in dark, a state the product no
// longer has.
//
// Rendered, never read from source: the demos are mounted and the class each painted cell carries
// is read from the DOM. The two heatmap demos paint the green COUNT ramp (how many members are
// free), which is not the Preferred state, so they carry no Preferred class: that is pinned too.
//
// Comments in this file are line comments only (FE-TESTING-CONVENTIONS CF-9).

import { render } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { AVAILABILITY_DRAG_PATH } from '../mockData';
import AvailabilityPromptDemo from './AvailabilityPromptDemo';
import CheckInDemo from './CheckInDemo';
import HeatmapDemo from './HeatmapDemo';
import ScheduleDemo from './ScheduleDemo';

const LIGHT = 'bg-green-300';
const DARK = 'dark:bg-surface-avail-preferred';

const tokens = (el: Element) => el.className.split(/\s+/);
const withToken = (root: HTMLElement, token: string) =>
  Array.from(root.querySelectorAll('div')).filter((el) => tokens(el).includes(token));

describe('tutorial demos: dark Preferred cells follow the real grid (88.9-52 N1b)', () => {
  it('N1b: every painted cell of the availability prompt demo keeps the light colour and takes the dark Preferred fill', () => {
    const { container } = render(<AvailabilityPromptDemo stage={AVAILABILITY_DRAG_PATH.length + 1} />);
    const painted = withToken(container, LIGHT);
    expect(painted).toHaveLength(AVAILABILITY_DRAG_PATH.length);
    for (const cell of painted) expect(tokens(cell)).toContain(DARK);
    // No cell takes the dark fill without being a painted one.
    expect(withToken(container, DARK)).toHaveLength(AVAILABILITY_DRAG_PATH.length);
  });

  it('N1b: an unpainted prompt grid carries no Preferred fill in either theme', () => {
    const { container } = render(<AvailabilityPromptDemo stage={0} />);
    expect(withToken(container, LIGHT)).toHaveLength(0);
    expect(withToken(container, DARK)).toHaveLength(0);
  });

  it("N1b: the check-in demo's three painted hint cells take the dark Preferred fill", () => {
    const { container } = render(<CheckInDemo stage={3} />);
    const painted = withToken(container, LIGHT);
    expect(painted).toHaveLength(3);
    for (const cell of painted) expect(tokens(cell)).toContain(DARK);
    expect(withToken(container, DARK)).toHaveLength(3);
  });

  it('N1b: the two heatmap demos paint the count ramp, not Preferred, and take no Preferred fill', () => {
    const heat = render(<HeatmapDemo stage={2} />);
    expect(withToken(heat.container, LIGHT).length).toBeGreaterThan(0);
    expect(withToken(heat.container, DARK)).toHaveLength(0);
    heat.unmount();
    const schedule = render(<ScheduleDemo stage={0} />);
    expect(withToken(schedule.container, LIGHT).length).toBeGreaterThan(0);
    expect(withToken(schedule.container, DARK)).toHaveLength(0);
  });
});
