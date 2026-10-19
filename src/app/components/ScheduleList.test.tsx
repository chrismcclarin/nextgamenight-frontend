// 88.6.1 code review A-47 — ScheduleList's own suite. The list's delete-confirm focus arms are
// pinned through its host in `PromptScheduleManager.test.tsx` (T1-T6); this file pins what the
// list renders on its own.
import * as React from 'react';
import { render, screen, cleanup } from '@testing-library/react';
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
