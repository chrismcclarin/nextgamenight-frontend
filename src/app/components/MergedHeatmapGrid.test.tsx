// Convergence pins for MergedHeatmapGrid (PRIM-01 / 84-10).
//
// MergedHeatmapGrid is the REAL merged div-grid (renders the merged cell + owns a
// grid-level handler today). After convergence it renders the shared ReadCell
// (merged variant) and owns roving focus via a cellRefs map driving REAL DOM
// focus on arrow keys, so its grid-level handleKeyDown can be removed.
import * as React from 'react';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('../components/TimezoneProvider', () => ({
  useTimezone: () => ({ timezone: 'UTC' }),
  TimezoneProvider: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));
vi.mock('@auth0/nextjs-auth0/client', () => ({ useUser: () => ({ user: null }) }));

import MergedHeatmapGrid from './MergedHeatmapGrid';

afterEach(cleanup);

const slots = [
  { date: '2026-06-29', dayOfWeek: 1, hour: 12, availableCount: 2, availableMembers: [{ user_id: 'a', username: 'Ann' }] },
  { date: '2026-06-30', dayOfWeek: 2, hour: 12, availableCount: 0, availableMembers: [] },
];

describe('MergedHeatmapGrid — converged on ReadCell with container-owned roving focus', () => {
  it('renders role="gridcell" cells for the merged grid', () => {
    render(<MergedHeatmapGrid slots={slots} totalMembers={4} selectedSlot={null} onSlotSelect={() => {}} />);
    // 2 day columns x 11 hour rows
    expect(screen.getAllByRole('gridcell')).toHaveLength(2 * 11);
  });

  it('arrow keydown moves document.activeElement to the adjacent cell (cellRefs focus)', () => {
    render(<MergedHeatmapGrid slots={slots} totalMembers={4} selectedSlot={null} onSlotSelect={() => {}} />);
    const cells = screen.getAllByRole('gridcell');
    cells[0].focus();
    expect(document.activeElement).toBe(cells[0]);

    fireEvent.keyDown(cells[0], { key: 'ArrowRight' });
    expect(document.activeElement).toBe(cells[1]); // (0,1)

    fireEvent.keyDown(document.activeElement as HTMLElement, { key: 'ArrowDown' });
    expect(document.activeElement).toBe(cells[3]); // (1,1) = 1*2 + 1
  });
});
