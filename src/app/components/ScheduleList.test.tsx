// 88.6.1 code review A-47 — ScheduleList's own suite. The list's delete-confirm focus arms are
// pinned through its host in `PromptScheduleManager.test.tsx` (T1-T6); this file pins what the
// list renders on its own.
import * as React from 'react';
import { render, screen, cleanup, fireEvent, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ComponentType } from 'react';

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
    // The KebabMenu / ResponseDashboard Remind precedent: the gated look is `aria-disabled:opacity-50`.
    expect(pause.className.split(/\s+/)).toContain('aria-disabled:opacity-50');
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
});
