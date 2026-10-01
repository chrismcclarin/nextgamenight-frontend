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
// 87.4 PR-1: EventHeatmapBackground now consumes useSelfIdentity (react-query);
// mock it so this render path needs no QueryClientProvider. selfUuid undefined
// here — the is-me predicate still resolves via the sub arm.
vi.mock('../../lib/hooks/useSelfIdentity', () => ({
  useSelfIdentity: () => ({ selfUuid: undefined, self: undefined, query: {}, isPending: false }),
}));

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

// ---------------------------------------------------------------------------
// Plan 88.6-26 — the sub-12px fold (D-01) and its two UI-SPEC §9.3 backstops.
//
// WHAT THESE ARE AND ARE NOT. jsdom performs no layout and loads no stylesheet, so nothing here
// measures a pixel. The GEOMETRY half of both E9 rows was measured offline in Chromium at 375px
// over a stylesheet compiled from the live globals.css (two identical settled reads; numbers in
// 88.6-26-SUMMARY.md) and is re-run in CI by e2e/padding-budget.spec.ts. What these arms hold is
// the SOURCE invariant that makes the measured geometry keep holding: the fold target stays
// folded, the gutter stays wide enough for the label it was sized for, and no clip treatment
// appears or disappears at the tightest cell. Each was demonstrated RED against the pre-fold form.
// ---------------------------------------------------------------------------

function renderedClassNames(root: HTMLElement): string[] {
  return [root, ...Array.from(root.querySelectorAll<HTMLElement>('*'))]
    .map((el) => el.getAttribute('class') ?? '')
    .filter(Boolean);
}

describe('UI-SPEC §9.3 E9 · overflow — the dense month grid after the 9/10/11px -> 12px fold', () => {
  it('leaves NO arbitrary text size anywhere in the rendered grid (D-01: 12px is the floor)', () => {
    const { container } = render(
      <EventHeatmapBackground heatmapData={heatmapData} loading={false} anchorDate="2026-06-29" />
    );
    const offenders = renderedClassNames(container as HTMLElement).filter((c) =>
      /\btext-\[\d/.test(c)
    );
    expect(
      offenders,
      'D-01 folds every text-[9px]/[10px]/[11px] site on this surface UP to text-xs. An arbitrary ' +
        'value reappearing here is a new sub-floor site, and it is also invisible to the four-size ' +
        'working-set regex in typeScaleTouchedSurfaces — which is why this arm reads the RENDERED ' +
        'class strings rather than the source.'
    ).toEqual([]);
  });

  it('keeps the hour-label gutter wide enough for the widest compact label AT THE FOLDED SIZE', () => {
    const { container } = render(
      <EventHeatmapBackground heatmapData={heatmapData} loading={false} anchorDate="2026-06-29" />
    );
    const grids = Array.from(container.querySelectorAll<HTMLElement>('.grid.gap-px'));
    expect(grids.length).toBeGreaterThan(0);
    for (const grid of grids) {
      const track = grid.style.gridTemplateColumns;
      const gutter = Number(/^(\d+(?:\.\d+)?)px/.exec(track)?.[1]);
      expect(
        gutter,
        'MEASURED in Chromium at 375px, 2026-09-16: the widest compact label ("12p", font-mono) ' +
          'renders 18.06px at 10px and 21.69px at the folded 12px. The gutter cell spends 4px on ' +
          'pr-1, so a 24px gutter left a 20px content box and the folded label bled 1.69px out of ' +
          'its column — the reflow D-01 names as delta V-7. 26px is the arithmetic floor; the ' +
          'shipped value is 28px. Narrowing this re-opens the bleed; see the DECISION marker at ' +
          'the grid.'
      ).toBeGreaterThanOrEqual(26);
    }
  });

  it('holds the loading skeleton on the SAME gutter track, so nothing shifts when data lands', () => {
    const { container: loadingTree } = render(<EventHeatmapBackground heatmapData={null} loading />);
    const skeleton = loadingTree.querySelector<HTMLElement>('.grid.gap-px');
    cleanup();
    const { container: liveTree } = render(
      <EventHeatmapBackground heatmapData={heatmapData} loading={false} anchorDate="2026-06-29" />
    );
    const live = liveTree.querySelector<HTMLElement>('.grid.gap-px');
    expect(skeleton?.style.gridTemplateColumns).toBe(live?.style.gridTemplateColumns);
  });
});

describe('UI-SPEC §9.3 E9 · long-text — the tightest cell wraps or clips exactly as before the fold', () => {
  it('introduces NO clip, truncate or ellipsis treatment at the count cell or its badge', () => {
    const { container } = render(
      <EventHeatmapBackground heatmapData={heatmapData} loading={false} anchorDate="2026-06-29" />
    );
    const cells = Array.from(container.querySelectorAll<HTMLElement>('[role="gridcell"]'));
    expect(cells.length).toBeGreaterThan(0);
    const clipped = cells
      .flatMap((c) => [c, ...Array.from(c.querySelectorAll<HTMLElement>('span'))])
      .map((el) => el.getAttribute('class') ?? '')
      .filter((c) => /\b(truncate|text-ellipsis|overflow-hidden|line-clamp-)/.test(c));
    expect(
      clipped,
      'the before-fold treatment at these cells was "no clipping at all" — the count simply sits ' +
        'in the cell. E9 · long-text requires the fold to leave that unchanged, so ADDING a clip ' +
        'here to absorb the +1px is the failure this arm catches, not the fix.'
    ).toEqual([]);
  });
});

describe('T-88.6-71 — the availability level reaches the cell RESTING accessible name', () => {
  it('names the count and the total on every annotated cell, not just inside the tooltip', () => {
    render(<EventHeatmapBackground heatmapData={heatmapData} loading={false} anchorDate="2026-06-29" />);
    // ReadCell puts ariaLabel on an EXPLICIT aria-label (ReadCell.tsx:218), which overrides the
    // count span's text — so without the fold at the call site this level is colour-only to a
    // screen reader at rest. The tooltip's aria-describedby exists only while it is OPEN.
    const named = screen.getAllByRole('gridcell', { name: /: 3 of 4 available$/ });
    expect(named.length).toBeGreaterThan(0);
    for (const cell of screen.getAllByRole('gridcell')) {
      expect(cell.getAttribute('aria-label')).toMatch(
        /^Availability for \d{4}-\d{2}-\d{2} hour \d+: \d+ of \d+ available$/
      );
    }
  });

  it('leaves the shared ReadCell primitive to own the attribute — the fix is at the ONE call site', () => {
    render(<EventHeatmapBackground heatmapData={heatmapData} loading={false} anchorDate="2026-06-29" />);
    // The contract this pins: the level arrives through the ariaLabel PROP, so ReadCell still
    // emits exactly one explicit aria-label and no second naming mechanism was introduced.
    for (const cell of screen.getAllByRole('gridcell')) {
      expect(cell.hasAttribute('aria-label')).toBe(true);
      expect(cell.hasAttribute('aria-labelledby')).toBe(false);
    }
  });
});
