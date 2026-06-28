// Convergence pins for HeatmapGrid (PRIM-01 / 84-10).
//
// After convergence HeatmapGrid renders the shared ReadCell (intensity variant)
// and owns roving focus itself: a focusedCoord + a cellRefs map drive REAL DOM
// focus (document.activeElement) on arrow keys — mirroring WeekGrid — so the
// grid-level handleKeyDown can be removed without losing arrow-key navigation.
import * as React from 'react';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('../components/TimezoneProvider', () => ({
  useTimezone: () => ({ timezone: 'UTC' }),
  TimezoneProvider: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));
vi.mock('@auth0/nextjs-auth0/client', () => ({ useUser: () => ({ user: null }) }));
// SuggestionCard pulls in @/lib/api (the full API client) — stub it; it only
// renders when there are viable suggestions + a groupId (neither in these tests).
vi.mock('./SuggestionCard', () => ({ default: () => null }));

import HeatmapGrid from './HeatmapGrid';

afterEach(cleanup);

// HeatmapGrid is a checkJs .js component whose inferred props type marks the
// no-default fields required; cast to keep the test focused on behavior.
const Grid = HeatmapGrid as unknown as (props: Record<string, unknown>) => React.JSX.Element;
const renderGrid = () =>
  render(<Grid suggestions={[]} totalMembers={4} weekStartDate={new Date('2026-06-29')} />);

describe('HeatmapGrid — converged on ReadCell with container-owned roving focus', () => {
  it('renders role="gridcell" cells (7 cols x 12 rows)', () => {
    renderGrid();
    expect(screen.getAllByRole('gridcell')).toHaveLength(7 * 12);
  });

  it('arrow keydown moves document.activeElement to the adjacent cell (cellRefs focus)', () => {
    renderGrid();
    const cells = screen.getAllByRole('gridcell');
    cells[0].focus();
    expect(document.activeElement).toBe(cells[0]);

    fireEvent.keyDown(cells[0], { key: 'ArrowRight' });
    expect(document.activeElement).toBe(cells[1]); // (0,1)

    fireEvent.keyDown(document.activeElement as HTMLElement, { key: 'ArrowDown' });
    expect(document.activeElement).toBe(cells[8]); // (1,1) = 1*7 + 1
  });
});
