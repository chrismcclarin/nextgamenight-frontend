// 88.6.1 code review A-47 — ScheduleList's own suite. The list's delete-confirm focus arms are
// pinned through its host in `PromptScheduleManager.test.tsx` (T1-T6); this file pins what the
// list renders on its own.
import * as React from 'react';
import { render, screen, cleanup, fireEvent, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ComponentType } from 'react';
import { expectFocusRing, expectRingGround } from '@/test-utils/focusRingAssert';

vi.mock('./TimezoneProvider', () => ({
  useTimezone: () => ({ timezone: 'America/New_York' }),
}));

import ScheduleListDefault from './ScheduleList';

// A JS component whose inferred props mark everything required; cast to what the suite passes.
const ScheduleList = ScheduleListDefault as unknown as ComponentType<Record<string, unknown>>;

const SCHEDULE = {
  id: 's1',
  template_name: 'Monday Board Night',
  schedule_day_of_week: 1,
  schedule_time: '19:00',
  schedule_timezone: 'America/New_York',
  is_active: true,
};

afterEach(() => cleanup());

describe('ScheduleList — the in-flight Pause/Resume looks unavailable, not only reads so (A-47)', () => {
  it('the desktop Pause button carries the house aria-disabled wash alongside aria-disabled', () => {
    render(<ScheduleList schedules={[SCHEDULE]} onToggle={vi.fn()} togglingIds={{ s1: true }} />);
    const pause = screen.getByRole('button', { name: 'Pause' });
    expect(pause).toHaveAttribute('aria-disabled', 'true');
    // The KebabMenu / ResponseDashboard Remind precedent: the gated look is `aria-disabled:text-content-muted`.
    // AMENDED Phase 88.9-23 (O-17): muted ink replaced the opacity wash, with the kebab items.
    expect(pause.className.split(/\s+/)).toContain('aria-disabled:text-content-muted');
  });
});

// 52-X46 (owner, 2026-11-13 5:26 PM Pacific, plus the focus-ring addendum; plan 88.9-57): the
// desktop Pause/Resume sits between Edit and Delete and was a raw button with its own smaller box
// and the browser's outline. It is the Button primitive now, on the ghost arm with its tint fills.
describe('ScheduleList — 52-X46 Pause/Resume on the Button primitive (88.9-57)', () => {
  it('X46 (88.9-57): Pause/Resume is the Button primitive beside Edit and Delete — the same .btn box and house offset ring, its tint kept, no hand-copied box', () => {
    const tokens = (el: HTMLElement) => el.className.split(/\s+/);
    const { unmount } = render(<ScheduleList schedules={[SCHEDULE]} onToggle={vi.fn()} />);

    const pause = screen.getByRole('button', { name: 'Pause' });
    for (const token of [
      // The primitive's box, floor and house ring on the card halo.
      'btn',
      'min-h-11',
      // Its own tint, and the in-flight muted ink (A-47 / O-17), which the ghost arm carries.
      'bg-status-warning-subtle',
      'text-content-status-warning',
      'enabled-hover:bg-status-warning-subtle-hover',
      'aria-disabled:text-content-muted',
    ]) {
      expect(tokens(pause), token).toContain(token);
    }
    expectFocusRing(pause, 'Pause');
    expectRingGround(pause, 'card', 'Pause');
    for (const token of [
      // The hand-copied box is gone ...
      'px-3',
      'py-1.5',
      'text-sm',
      // ... and the ghost arm's own ground, ink and hover lose to the tint.
      'bg-transparent',
      'text-content-secondary',
      'enabled-hover:bg-surface-hover',
    ]) {
      expect(tokens(pause), token).not.toContain(token);
    }

    // Its two neighbours are the same primitive: the same box and both ring-offset tokens.
    for (const name of ['Edit', 'Delete']) {
      const neighbour = screen.getByRole('button', { name });
      for (const token of ['btn', 'min-h-11']) {
        expect(tokens(neighbour), `${name}: ${token}`).toContain(token);
      }
      expectFocusRing(neighbour, name);
      expectRingGround(neighbour, 'card', name);
    }
    // Names unchanged.
    expect(pause).toHaveTextContent(/^Pause$/);
    expect(pause).toHaveAttribute('title', 'Pause schedule');
    unmount();

    // A paused row: Resume wears the success trio on the same primitive.
    render(<ScheduleList schedules={[{ ...SCHEDULE, is_active: false }]} onToggle={vi.fn()} />);
    const resume = screen.getByRole('button', { name: 'Resume' });
    for (const token of [
      'btn',
      'min-h-11',
      'bg-status-success-subtle',
      'text-content-status-success',
      'enabled-hover:bg-status-success-subtle-hover',
      'aria-disabled:text-content-muted',
    ]) {
      expect(tokens(resume), token).toContain(token);
    }
    expect(resume).toHaveTextContent(/^Resume$/);
    expect(resume).toHaveAttribute('title', 'Resume schedule');
  });
});

describe('ScheduleList — opening the delete confirm moves focus into it (A-43)', () => {
  it('desktop Delete: focus lands on the confirm row\'s Cancel (the safe default; T3 in PromptScheduleManager.test.tsx pins Cancel\'s return)', () => {
    render(<ScheduleList schedules={[SCHEDULE]} onDelete={vi.fn()} />);
    const del = screen.getByRole('button', { name: 'Delete' });
    del.focus();
    fireEvent.click(del);
    const cancel = screen.getByRole('button', { name: 'Cancel' });
    expect(document.activeElement).toBe(cancel);
  });

  it('phone kebab Delete: focus lands on Cancel after KebabMenu restored its trigger', () => {
    render(<ScheduleList schedules={[SCHEDULE]} onDelete={vi.fn()} />);
    const trigger = screen.getByRole('button', { name: 'Schedule actions' });
    fireEvent.click(trigger);
    const list = document.getElementById(trigger.getAttribute('aria-controls') as string) as HTMLElement;
    fireEvent.click(within(list).getByRole('button', { name: 'Delete' }));
    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Cancel' }));
  });

  it('the focused Cancel is described by the confirm prompt, so the move announces what is being confirmed (A-43 announce)', () => {
    render(<ScheduleList schedules={[SCHEDULE]} onDelete={vi.fn()} />);
    const del = screen.getByRole('button', { name: 'Delete' });
    del.focus();
    fireEvent.click(del);
    const cancel = screen.getByRole('button', { name: 'Cancel' });
    expect(document.activeElement).toBe(cancel);
    expect(cancel).toHaveAccessibleDescription(/^Delete .+\? This will stop sending prompts\.$/);
  });
});

// Phase 88.9-34 (owner pick E6a, 88.9-PICKS-B4.json item E6, #91): value first. The four
// fact labels step down to the muted ink and the row wrapper carries the primary ink, so
// every value (including the computed Response window) reads primary. Muted on the card
// measures 6.58 light / 6.00 dark (tokenContrast test 65). The status badges are untouched.
describe('E6a (88.9) — value first', () => {
  it('E6a (88.9): values primary, labels muted', () => {
    render(
      <ScheduleList
        schedules={[{ ...SCHEDULE, min_participants: 3, default_deadline_hours: 48 }]}
      />
    );
    for (const text of ['When:', 'Game:', 'Min players:', 'Response window:']) {
      const label = screen.getByText(text);
      const classes = label.className.split(/\s+/);
      expect(classes, text).toContain('text-content-muted');
      expect(classes, text).not.toContain('text-content-primary');
      const wrapper = label.closest('div')!;
      const wrapperClasses = wrapper.className.split(/\s+/);
      expect(wrapperClasses, text).toContain('text-content-primary');
      expect(wrapperClasses, text).not.toContain('text-content-secondary');
    }
    // The values themselves are bare text inside the wrapper, so they inherit its ink.
    expect(screen.getByText('2 days', { exact: false }).closest('div')).toBe(
      screen.getByText('When:').closest('div')
    );
  });
});

// Phase 89.6-41 (GR, owner 2026-11-22: 'A row stays a row while everything in it fits whole. When it
// does not, items stack. Nothing is squeezed, shrunk, cut or broken to avoid stacking.'): the
// schedule row's parts are the house blocks, each keeping its alignment utility, so at large text
// the pill moves under the name, the actions move under the details and the confirm buttons wrap.
describe('Phase 89.6-41 — the schedule list at large text', () => {
  const classesOf = (el: Element | null) => (el?.getAttribute('class') ?? '').split(/\s+/);

  it('89.6-41 GR: the title row is a bb-cluster that keeps items-center and gap-3', () => {
    render(<ScheduleList schedules={[SCHEDULE]} />);
    const titleRow = screen.getByRole('heading', { level: 3, name: SCHEDULE.template_name }).parentElement;
    for (const token of ['bb-cluster', 'items-center', 'gap-3', 'mb-2']) expect(classesOf(titleRow), token).toContain(token);
    expect(classesOf(titleRow)).not.toContain('flex');
  });

  it('89.6-41 GR: the outer row is a bb-row that keeps items-start, info is bb-row-text and both action cells are bb-row-end', () => {
    render(<ScheduleList schedules={[SCHEDULE]} onEdit={vi.fn()} />);
    const info = screen.getByRole('heading', { level: 3, name: SCHEDULE.template_name }).parentElement?.parentElement ?? null;
    const outer = info?.parentElement ?? null;
    expect(classesOf(outer)).toEqual(['bb-row', 'items-start', 'gap-x-4']);
    expect(classesOf(info)).toEqual(['bb-row-text']);
    const desktop = screen.getByRole('button', { name: 'Edit' }).parentElement;
    const phone = screen.getByRole('button', { name: 'Schedule actions' }).closest('.md\\:hidden');
    expect(classesOf(desktop)).toEqual(['hidden', 'md:flex', 'items-start', 'gap-2', 'bb-row-end']);
    expect(classesOf(phone)).toEqual(['md:hidden', 'bb-row-end']);
    for (const cell of [desktop, phone]) expect(classesOf(cell)).not.toContain('ml-4');
    expect(classesOf(outer)).not.toContain('justify-between');
    expect(classesOf(info)).not.toContain('flex-1');
  });

  it('89.6-41 GR: the confirm buttons sit in a bb-cluster that keeps gap-2, Confirm Delete first', () => {
    render(<ScheduleList schedules={[SCHEDULE]} onDelete={vi.fn()} />);
    fireEvent.click(screen.getByRole('button', { name: 'Delete' }));
    const confirm = screen.getByRole('button', { name: 'Confirm Delete' });
    const row = confirm.parentElement;
    expect(classesOf(row)).toEqual(['bb-cluster', 'gap-2']);
    expect(row?.firstElementChild).toBe(confirm);
  });
});
