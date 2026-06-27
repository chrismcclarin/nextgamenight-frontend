// Convergence pins for EventHeatmapBackground (PRIM-01 / 84-10).
//
// EventHeatmapBackground is the PASSIVE read overlay (locked 72-02 / D1 Opt 1):
// it converges on the shared ReadCell for COLOR + aria ONLY, rendered with
// roving={false}. It must NOT become a roving focus-owner — arrow keys must NOT
// move document.activeElement (Tab+focus+Esc only). The roving={false} source
// assertion is covered by the plan's grep gate; here we pin the behavior.
import * as React from 'react';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('../components/TimezoneProvider', () => ({
  useTimezone: () => ({ timezone: 'UTC' }),
  TimezoneProvider: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));
vi.mock('@auth0/nextjs-auth0/client', () => ({ useUser: () => ({ user: { sub: 'me' } }) }));

import EventHeatmapBackground from './EventHeatmapBackground';

afterEach(cleanup);

const heatmapData = {
  slots: [
    { date: '2026-06-29', hour: 18, availableCount: 3, availableMembers: [{ user_id: 'a', username: 'Ann' }] },
  ],
  totalMembers: 4,
  gcalConflicts: [],
  membersWithoutDataCount: 0,
  totalGroupMembers: 4,
};

describe('EventHeatmapBackground — passive ReadCell overlay (roving={false})', () => {
  it('renders role="gridcell" cells through the shared cell', () => {
    render(<EventHeatmapBackground heatmapData={heatmapData} loading={false} anchorDate="2026-06-29" />);
    expect(screen.getAllByRole('gridcell').length).toBeGreaterThan(0);
  });

  it('is NOT a roving grid: an arrow keydown does NOT move document.activeElement', () => {
    render(<EventHeatmapBackground heatmapData={heatmapData} loading={false} anchorDate="2026-06-29" />);
    const cells = screen.getAllByRole('gridcell');
    cells[0].focus();
    expect(document.activeElement).toBe(cells[0]);

    fireEvent.keyDown(cells[0], { key: 'ArrowRight' });
    // Passive overlay: focus stays put (no arrow-key roving handler).
    expect(document.activeElement).toBe(cells[0]);
  });
});
