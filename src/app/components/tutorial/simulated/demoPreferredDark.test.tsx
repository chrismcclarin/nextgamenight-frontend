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

import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { AVAILABILITY_DRAG_PATH } from '../mockData';
import AvailabilityPromptDemo from './AvailabilityPromptDemo';
import CheckInDemo from './CheckInDemo';
import HeatmapDemo from './HeatmapDemo';
import ScheduleDemo from './ScheduleDemo';
import TutorialGrid from './TutorialGrid';
import { TUTORIAL_DAYS, TUTORIAL_TIME_SLOTS } from '../mockData';

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

  // 88.9-52 R4 S4 (the round-3 capture, dark): the painted demo cells had the right mid green but
  // kept a bright mint 1px edge (#4ade80), and the Adding: Preferred chip above the demo grid was
  // still the light mint pill. The real grid has neither in dark: its legend swatch for Preferred
  // is the same fill inside the plain line
  // (src/app/components/AvailabilityGrid.js ("bg-green-300 dark:bg-surface-avail-preferred border border-line rounded-xs")),
  // and its Adding: Preferred toggle wears the dark pill tokens
  // (src/app/components/AvailabilityGrid.js ("dark:bg-surface-pill-green dark:enabled-hover:bg-surface-pill-green dark:border-status-success dark:text-content-pill-green")).
  // The demos now carry the same dark tokens; light is unchanged.
  it('R4 S4: in dark a painted demo cell has the plain line for its edge, not the mint one, in both demos', () => {
    const prompt = render(<AvailabilityPromptDemo stage={AVAILABILITY_DRAG_PATH.length + 1} />);
    const painted = withToken(prompt.container, LIGHT);
    expect(painted).toHaveLength(AVAILABILITY_DRAG_PATH.length);
    for (const cell of painted) {
      // Light keeps its mint edge; dark takes the line every unpainted cell has.
      expect(tokens(cell)).toEqual(expect.arrayContaining(['border', 'border-green-400', 'dark:border-line']));
    }
    prompt.unmount();
    const checkin = render(<CheckInDemo stage={3} />);
    const hints = withToken(checkin.container, LIGHT);
    expect(hints).toHaveLength(3);
    for (const cell of hints) {
      expect(tokens(cell)).toEqual(expect.arrayContaining(['border', 'border-green-400', 'dark:border-line']));
    }
  });

  it('R4 S4: in dark the Adding: Preferred chip of the prompt demo wears the real toggle\'s dark pill tokens', () => {
    render(<AvailabilityPromptDemo stage={0} />);
    const chip = screen.getByText('Adding: Preferred');
    // Light, unchanged.
    expect(tokens(chip)).toEqual(expect.arrayContaining(['bg-green-100', 'border', 'border-green-400', 'text-green-800']));
    // Dark, the three the real toggle carries (it is not a button here, so no hover token).
    expect(tokens(chip).filter((t) => t.startsWith('dark:')).sort()).toEqual(
      ['dark:bg-surface-pill-green', 'dark:border-status-success', 'dark:text-content-pill-green'].sort(),
    );
  });

  // 88.9-52 R4 S4, the CHECK FIRST half: at 375 the demo grid (446px) was wider than the scene it
  // sits in (293px), so the Friday column, the one every demo paints, was cut and Sat and Sun were
  // out of sight. Not a cropped illustration: nothing records one, and the cut column is the
  // subject of three steps. Not round 3 either: the fixed 48px columns date from the grid's first
  // build. The columns now give way down to 24px, which fits 375; under that the grid scrolls
  // inside its own card. jsdom lays nothing out, so this pins the tokens and works the sum.
  it('R4 S4: the demo grid gives way to fit a 375px phone, its day names stay over their columns, and it never forces its full width', () => {
    const { container } = render(<TutorialGrid renderCell={() => ({ className: '', content: '' })} />);
    const card = container.firstElementChild as HTMLElement;
    // The card may not be wider than the scene, and scrolls inside itself when even 24px columns do not fit.
    expect(tokens(card)).toEqual(expect.arrayContaining(['inline-block', 'max-w-full', 'overflow-x-auto']));
    // Nothing forces the grid to its full width any more.
    expect(container.querySelectorAll('.min-w-max')).toHaveLength(0);
    const rows = Array.from(container.querySelectorAll('div')).filter((el) => tokens(el).includes('flex') && el.children.length === TUTORIAL_DAYS.length + 1);
    expect(rows).toHaveLength(TUTORIAL_TIME_SLOTS.length + 1);
    for (const [index, row] of rows.entries()) {
      const [gutter, ...columns] = Array.from(row.children);
      // The time gutter keeps its width; the seven columns share what is left.
      expect(tokens(gutter)).toEqual(expect.arrayContaining(['w-14', 'shrink-0']));
      expect(columns).toHaveLength(TUTORIAL_DAYS.length);
      for (const column of columns) {
        const cls = tokens(column);
        expect(cls).toEqual(expect.arrayContaining(['w-12', 'min-w-6']));
        expect(cls).not.toContain('shrink-0');
        // A day name has the same side margin as a cell, so it sits over its column at any width
        // (it had none: the names drifted 4px a column to the left of the cells under them).
        expect(cls).toContain(index === 0 ? 'mx-0.5' : 'm-0.5');
      }
    }
    // The sum, in px at ordinary text. Card chrome: 1px border and 12px padding each side.
    const chrome = 2 * (1 + 12);
    const gutter = 56;
    const full = gutter + TUTORIAL_DAYS.length * (48 + 4) + chrome;
    const least = gutter + TUTORIAL_DAYS.length * (24 + 4) + chrome;
    // The scene inside the tutorial card at 375: the overlay's 16px, the card's 1px border and its 24px padding, each side.
    const scene = (viewport: number) => viewport - 2 * (16 + 1 + 24);
    expect(full).toBe(446);
    expect(least).toBe(278);
    expect(scene(375)).toBe(293);
    // 375 (and the owner's 430): it fits with columns over their 24px floor. Desktop: full size, as before.
    expect(least).toBeLessThanOrEqual(scene(375));
    expect((scene(375) - chrome - gutter) / TUTORIAL_DAYS.length - 4).toBeGreaterThanOrEqual(24);
    expect(full).toBeLessThanOrEqual(scene(768));
    // 320: 24px columns do not fit (238px of scene), so there the card scrolls inside itself.
    expect(least).toBeGreaterThan(scene(320));
  });
});
