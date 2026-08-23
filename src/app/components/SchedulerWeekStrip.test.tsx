// Semantics + keyboard pins for the phone week strip (Phase 88.1 plan 12).
//
// WHY THESE ARE ROLE+NAME ASSERTIONS AND NOT ATTRIBUTE GREPS: `useHeatmapCell` decides no
// `role`/`aria-*` by design (`useHeatmapCell.ts:13-16`) and this strip composes it with no
// wrapper cell, so the failure mode being guarded is a tabindex-carrying role-less element that
// announces "M 22 4" with no name and no selected state. An attribute count passes happily on an
// element nobody can reach; `getByRole(..., { name })` does not.
//
// The COMPOSED phone arm (strip mounted above the single-day column) and its axe run live in
// EventScheduler.test.tsx — this file pins the component's own contract.

import * as React from 'react';
import { render, screen, cleanup, fireEvent } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { addDays, format, startOfWeek } from 'date-fns';
import SchedulerWeekStrip, { stripTabId } from './SchedulerWeekStrip';

afterEach(cleanup);

// Monday 2026-07-20 .. Sunday 2026-07-26.
const MONDAY = startOfWeek(new Date(2026, 6, 22, 12, 0, 0), { weekStartsOn: 1 });
const WEEK = Array.from({ length: 7 }, (_, i) => addDays(MONDAY, i));

// Peaks chosen so several distinct ramp steps are exercised and one day is empty.
const AGGREGATES = [1, 0, 4, 2, 4, 0, 3];
const TOTAL_MEMBERS = 4;

function renderStrip(overrides: Partial<React.ComponentProps<typeof SchedulerWeekStrip>> = {}) {
  const onSelectDay = vi.fn();
  const utils = render(
    <SchedulerWeekStrip
      dates={WEEK}
      aggregates={AGGREGATES}
      totalMembers={TOTAL_MEMBERS}
      selectedIndex={2}
      onSelectDay={onSelectDay}
      idPrefix="strip-test"
      {...overrides}
    />
  );
  return { ...utils, onSelectDay };
}

describe('SchedulerWeekStrip — the strip is a reachable, named day picker', () => {
  it('exposes a labelled tablist of seven tabs', () => {
    renderStrip();
    const list = screen.getByRole('tablist', { name: /choose a day/i });
    expect(list).toBeInTheDocument();
    expect(screen.getAllByRole('tab')).toHaveLength(7);
  });

  it('gives every cell a FULL accessible name — weekday, date and the availability count', () => {
    renderStrip();
    // "Wednesday 22, 4 of 4 available" — the three rendered fragments ("W", "22", "4") assembled
    // into one name, so the aggregate is never colour-plus-bare-number to a screen reader.
    for (let i = 0; i < 7; i += 1) {
      const expected = new RegExp(
        `${format(WEEK[i], 'EEEE d')}, ${AGGREGATES[i]} of ${TOTAL_MEMBERS} available`,
        'i'
      );
      expect(screen.getByRole('tab', { name: expected })).toBeInTheDocument();
    }
  });

  it('names the count honestly when the group has shared no availability at all', () => {
    renderStrip({ aggregates: [0, 0, 0, 0, 0, 0, 0], totalMembers: 0 });
    expect(
      screen.getByRole('tab', { name: /monday 20, availability not shared yet/i })
    ).toBeInTheDocument();
  });
});

describe('SchedulerWeekStrip — selected and today are exposed to assistive tech, not by tint alone', () => {
  it('marks exactly the selected day with aria-selected', () => {
    renderStrip({ selectedIndex: 4 });
    const tabs = screen.getAllByRole('tab');
    expect(tabs.map((t) => t.getAttribute('aria-selected'))).toEqual([
      'false',
      'false',
      'false',
      'false',
      'true',
      'false',
      'false',
    ]);
  });

  it('marks today with aria-current="date" and nothing else', () => {
    const todayMonday = startOfWeek(new Date(), { weekStartsOn: 1 });
    const thisWeek = Array.from({ length: 7 }, (_, i) => addDays(todayMonday, i));
    renderStrip({ dates: thisWeek });

    const current = screen.getAllByRole('tab').filter((t) => t.getAttribute('aria-current'));
    expect(current).toHaveLength(1);
    expect(current[0]).toHaveAttribute('aria-current', 'date');
    expect(current[0].getAttribute('aria-label')).toContain(format(new Date(), 'EEEE d'));
  });

  it('renders no aria-current at all for a week that does not contain today', () => {
    renderStrip();
    expect(
      screen.getAllByRole('tab').filter((t) => t.getAttribute('aria-current'))
    ).toHaveLength(0);
  });

  it('gives each cell the id the day column points aria-labelledby at', () => {
    renderStrip();
    screen.getAllByRole('tab').forEach((tab, i) => {
      expect(tab).toHaveAttribute('id', stripTabId('strip-test', i));
    });
  });
});

describe('SchedulerWeekStrip — selection and roving keyboard navigation', () => {
  it('reports the tapped day upward by INDEX and holds no date state of its own', () => {
    const { onSelectDay } = renderStrip();
    fireEvent.click(screen.getAllByRole('tab')[5]);
    expect(onSelectDay).toHaveBeenCalledWith(5);

    // The strip does not move its own selection — the parent owns the displayed date, so the
    // rendered aria-selected is still on the prop's day until the parent re-renders it.
    expect(screen.getAllByRole('tab')[2]).toHaveAttribute('aria-selected', 'true');
  });

  it('makes exactly ONE cell tabbable, on the selected day', () => {
    renderStrip({ selectedIndex: 3 });
    const tabs = screen.getAllByRole('tab');
    expect(tabs.filter((t) => t.tabIndex === 0)).toHaveLength(1);
    expect(tabs[3].tabIndex).toBe(0);
  });

  it('ArrowRight / ArrowLeft move REAL DOM focus without changing the selection', () => {
    const { onSelectDay } = renderStrip({ selectedIndex: 2 });
    const tabs = screen.getAllByRole('tab');
    tabs[2].focus();

    fireEvent.keyDown(document.activeElement!, { key: 'ArrowRight' });
    expect(document.activeElement).toBe(tabs[3]);

    fireEvent.keyDown(document.activeElement!, { key: 'ArrowLeft' });
    expect(document.activeElement).toBe(tabs[2]);

    // Manual activation: moving focus is not choosing a day.
    expect(onSelectDay).not.toHaveBeenCalled();
  });

  it('Home and End jump to the first and last day', () => {
    renderStrip({ selectedIndex: 3 });
    const tabs = screen.getAllByRole('tab');
    tabs[3].focus();

    fireEvent.keyDown(document.activeElement!, { key: 'End' });
    expect(document.activeElement).toBe(tabs[6]);

    fireEvent.keyDown(document.activeElement!, { key: 'Home' });
    expect(document.activeElement).toBe(tabs[0]);
  });

  it('clamps at both edges instead of wrapping or escaping the strip', () => {
    renderStrip({ selectedIndex: 0 });
    const tabs = screen.getAllByRole('tab');
    tabs[0].focus();

    fireEvent.keyDown(document.activeElement!, { key: 'ArrowLeft' });
    expect(document.activeElement).toBe(tabs[0]);

    fireEvent.keyDown(tabs[6], { key: 'ArrowRight' });
    // Focus never left the strip for the body — the failure mode a clamp bug produces.
    expect(document.body.contains(document.activeElement)).toBe(true);
    expect(document.activeElement).not.toBe(document.body);
  });

  it('Enter selects the focused day', () => {
    const { onSelectDay } = renderStrip({ selectedIndex: 2 });
    const tabs = screen.getAllByRole('tab');
    tabs[2].focus();

    fireEvent.keyDown(document.activeElement!, { key: 'ArrowRight' });
    fireEvent.keyDown(document.activeElement!, { key: 'Enter' });

    expect(onSelectDay).toHaveBeenCalledWith(3);
  });

  it('follows the selected day when the PARENT moves the date (Back/Today/Next)', () => {
    const { rerender } = renderStrip({ selectedIndex: 2 });
    expect(screen.getAllByRole('tab')[2].tabIndex).toBe(0);

    rerender(
      <SchedulerWeekStrip
        dates={WEEK}
        aggregates={AGGREGATES}
        totalMembers={TOTAL_MEMBERS}
        selectedIndex={5}
        onSelectDay={vi.fn()}
        idPrefix="strip-test"
      />
    );

    const tabs = screen.getAllByRole('tab');
    expect(tabs.filter((t) => t.tabIndex === 0)).toHaveLength(1);
    expect(tabs[5].tabIndex).toBe(0);
  });
});

describe('SchedulerWeekStrip — the tint carries a numeric cue and the shared ramp', () => {
  it('renders the aggregate NUMBER on every day that has availability, and nothing on an empty day', () => {
    renderStrip();
    const tabs = screen.getAllByRole('tab');
    // AGGREGATES = [1, 0, 4, 2, 4, 0, 3]; the empty days must show no stray "0".
    expect(tabs[0].textContent).toContain('1');
    expect(tabs[2].textContent).toContain('4');
    expect(tabs[1].textContent).not.toContain('0');
    expect(tabs[5].textContent).not.toContain('0');
  });

  it('tints from calendarWashColor — the SAME translucent ramp the day column uses', () => {
    const { container } = renderStrip();
    const tinted = container.querySelectorAll('[style*="background-color: rgba(34, 197, 94"]');
    // Five of the seven days have a non-zero peak; the two empty days get NO background at all
    // (calendarWashColor returns undefined, which is what keeps the gridlines visible).
    expect(tinted).toHaveLength(5);
  });

  it('carries no spacing that could push a 46.7px cell under the 44px touch floor', () => {
    const { container } = renderStrip();
    const list = screen.getByRole('tablist', { name: /choose a day/i });
    // `gap-px` (1px hairline) and nothing else — no container padding, no per-cell border.
    expect(list.className).toContain('gap-px');
    expect(list.className).not.toMatch(/\bgap-(1|2|3|4)\b/);
    expect(list.className).not.toMatch(/\bp[xy]?-\d/);
    container.querySelectorAll('[role="tab"]').forEach((tab) => {
      expect(tab.className).not.toMatch(/\bborder\b/);
      expect(tab.className).not.toMatch(/\bp[xy]?-\d/);
      // 56px tall — the height half of the touch floor, asserted as the authored class because
      // jsdom has no layout (the real box is measured in plan 88.1-14's Playwright spec).
      expect(tab.className).toContain('h-14');
    });
  });
});
