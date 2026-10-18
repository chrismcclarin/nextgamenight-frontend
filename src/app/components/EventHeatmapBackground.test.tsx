// Convergence pins for EventHeatmapBackground (PRIM-01 / 84-10).
//
// EventHeatmapBackground is the PASSIVE read overlay (locked 72-02 / D1 Opt 1):
// it converges on the shared ReadCell for COLOR + aria ONLY, rendered with
// roving={false}. It must NOT become a roving focus-owner — arrow keys must NOT
// move document.activeElement (Tab+focus+Esc only). The roving={false} source
// assertion is covered by the plan's grep gate; here we pin the behavior.
import * as React from 'react';
import { render, screen, fireEvent, cleanup, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { axe } from 'vitest-axe';

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

/** Review #178: the two ARIA required-context rules, scoped by rule id (the composed audit's runOnly idiom). */
const REQUIRED_CONTEXT = {
  runOnly: { type: 'rule' as const, values: ['aria-required-parent', 'aria-required-children'] },
};

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
  // The accessible-name algorithm (jsdom, Testing Library, macOS VoiceOver) reads ReadCell's
  // explicit `aria-label` (ReadCell, anchor `role="gridcell"`), so the level must be IN that name
  // at rest; the tooltip's aria-describedby exists only while it is OPEN. iOS VoiceOver adds a
  // second rule: it lands on a cell only when the cell has NO accessible children (research AT-1,
  // the WebKit leaf rule) - hence the leaf pin below.
  // Amended by DECISION Phase 88.6.1-24 (D-34, copy row C1): the names are now the scheduler's C1
  // template, and an EMPTY cell takes C1's plain note with no "0 of N available", because an empty
  // cell has no wash level - the zero arm of `mergedCellColor` (src/lib/availabilityColor.ts:100)
  // returns the neutral surface - so T-88.6-71's colour-only concern does not arise there. Every
  // cell that HAS a level still names it.
  it('names the count and the total on every annotated cell, not just inside the tooltip', () => {
    render(<EventHeatmapBackground heatmapData={heatmapData} loading={false} anchorDate="2026-06-29" />);
    // 2026-06-29 is a Monday; the fixture's 18:00 UTC slot lands on the 18:00 row under the mocked
    // profile zone UTC, and both half-hour cells of that hour carry the hourly count.
    expect(
      screen.getByRole('gridcell', { name: 'Monday, June 29 at 6:00 PM, 3 of 4 available' })
    ).toBeInTheDocument();
    expect(
      screen.getByRole('gridcell', { name: 'Monday, June 29 at 6:30 PM, 3 of 4 available' })
    ).toBeInTheDocument();
    const names = screen.getAllByRole('gridcell').map((cell) => cell.getAttribute('aria-label') ?? '');
    const counted = names.filter((name) => /, \d+ of \d+ available$/.test(name));
    expect(counted).toHaveLength(2);
    names
      .filter((name) => !/, \d+ of \d+ available$/.test(name))
      .forEach((name) =>
        expect(name).toMatch(/^[A-Z][a-z]+day, [A-Z][a-z]+ \d{1,2} at \d{1,2}:(00|30) (AM|PM)$/)
      );
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

  it('exposes no accessible child in any cell, so the cell itself is the leaf iOS VoiceOver lands on (88.6.1-24, D-34)', () => {
    render(<EventHeatmapBackground heatmapData={heatmapData} loading={false} anchorDate="2026-06-29" />);
    const cells = screen.getAllByRole('gridcell');
    // Anti-vacuity: the keyed hour's two cells each hold the count span.
    expect(cells.filter((cell) => cell.childNodes.length > 0).length).toBeGreaterThanOrEqual(2);
    cells.forEach((cell) =>
      cell.childNodes.forEach((node) => {
        expect(node.nodeType).toBe(Node.ELEMENT_NODE);
        expect((node as Element).getAttribute('aria-hidden'), cell.getAttribute('aria-label') ?? '').toBe('true');
      })
    );
  });

  it('puts every gridcell inside the row and grid context ARIA requires (88.6.1-24, review #178)', async () => {
    // Lives here because the composed create-event audit mocks this component to null
    // (createEvent.integration.test.tsx, `vi.mock('@/app/components/EventHeatmapBackground'`), so
    // nothing else runs these two rules on this grid. Both rules are tagged wcag131.
    const { container } = render(
      <EventHeatmapBackground heatmapData={heatmapData} loading={false} anchorDate="2026-06-29" />
    );
    expect(await axe(container, REQUIRED_CONTEXT)).toHaveNoViolations();
  });

  it('names the grid "Group availability" for a screen reader (88.6.1-24, owner ruling #178)', () => {
    render(<EventHeatmapBackground heatmapData={heatmapData} loading={false} anchorDate="2026-06-29" />);
    expect(screen.getAllByRole('grid')).toHaveLength(1);
    const grid = screen.getByRole('grid', { name: 'Group availability' });
    expect(grid.hasAttribute('aria-labelledby')).toBe(false);
    expect(
      within(grid).getByRole('gridcell', { name: 'Monday, June 29 at 6:00 PM, 3 of 4 available' })
    ).toBeInTheDocument();
  });
});

// Plan 88.6.1-85 Task 2 (owner ruling 2026-10-18, the sibling of close ruling P-94): the visual reads
// "M/T/W", the reader reads "Monday, Tuesday, Wednesday". Each day columnheader is NAMED with the
// full weekday and the day number while its visible letter and number stay as they are. Expected
// names are written as literals, never re-derived with date-fns. The week of 2026-06-29 (a Monday,
// under the mocked zone UTC) holds two two-digit days and five single-digit ones.
describe('EventHeatmapBackground — the day header is named with the full day (88.6.1-85 Task 2, owner ruling 2026-10-18)', () => {
  const EXPECTED_DAY_NAMES = [
    'Monday 29', 'Tuesday 30', 'Wednesday 1', 'Thursday 2', 'Friday 3', 'Saturday 4', 'Sunday 5',
  ];
  // HD-1 and HD-2 read the same render, so the named half and the visible half cannot drift.
  const renderChart = () =>
    render(<EventHeatmapBackground heatmapData={heatmapData} loading={false} anchorDate="2026-06-29" />);

  it('HD-1 resolves the seven day headers by role and computed name, Monday 29 .. Sunday 5, in DOM order', () => {
    renderChart();
    // By COMPUTED accessible name, never the raw attribute: a label on a wrapper while another
    // element takes the columnheader role, or one overridden by aria-labelledby, fails here.
    const resolved = EXPECTED_DAY_NAMES.map((name) => screen.getByRole('columnheader', { name }));
    const all = screen.getAllByRole('columnheader');
    expect(all).toHaveLength(7);
    resolved.forEach((el, i) => {
      expect(all[i]).toBe(el);
    });
  });

  it('HD-2 the same render still shows the letter and the number, M29 first and S5 seventh', () => {
    // CONFIRM-ONLY half: green before and after this plan. The visible spans are unchanged.
    renderChart();
    const all = screen.getAllByRole('columnheader');
    expect(all[0].textContent).toBe('M29');
    expect(all[6].textContent).toBe('S5');
  });
});
