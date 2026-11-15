// Phase 88.9-61 (owner fix rows 52-X25 ruled X25a, 52-X29 ruled A, the 4:35 PM and 4:45 PM
// additions of 2026-11-14): the Calendar list is ONE two-section render on every arm.
//
// What the owner saw (X25): "if you open up the past events, and scroll it looks like the past
// events are under the Upcoming events heading". And on the group page at phone width (X29): "it
// looks like games that happened previously are upcoming. Especially as there are no years on any
// of the dates." The ruling: two separate, equal, folding headers (Upcoming open, Past closed), a
// rule above Past, the year on a date outside the current year, and no Today delineator.
//
// Every test loops the three arms (the phone sheet, the home List view, the group page List
// view), because the point of X29 A is that they are the same render. Rendered directly with an
// explicit timezone and a pinned Date, so nothing here drifts with the calendar.
//
// Comments are // lines only (CF-9). Plain it( lines, one per test, on purpose: a later plan
// counts them by a line grep.
import * as React from 'react';
import { render, screen, cleanup, within, fireEvent, act } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import CalendarListView from './CalendarListView';

const TZ = 'America/New_York';
// Friday 2:00 PM in New York.
const NOW = new Date('2026-09-04T18:00:00.000Z');
const HOUR = 60 * 60 * 1000;
const DAY = 24 * HOUR;
const ARMS = ['sheet', 'full', 'compact'] as const;
type Arm = (typeof ARMS)[number];

const at = (offsetMs: number) => new Date(NOW.getTime() + offsetMs).toISOString();
const night = (id: string, name: string, start_date: string) => ({
  id,
  group_id: 'g1',
  game_id: `game-${id}`,
  start_date,
  status: 'scheduled',
  Game: { name },
  Group: { name: 'Alpha' },
  EventParticipations: [],
});

// Three upcoming nights (one of them next year) and three past ones (one of them last year).
// The two instants written out were checked with Intl before they were written down:
// 2027-01-09T00:00Z is Friday, January 8, 2027, 7 PM EST; 2025-03-15T23:00Z is Saturday,
// March 15, 2025, 7 PM EDT.
const SOON = night('soon', 'Catan', at(2 * HOUR));
const NEXT_WEEK = night('next', 'Gloomhaven', at(3 * DAY));
const NEXT_YEAR = night('ny', 'Brass', '2027-01-09T00:00:00.000Z');
const PAST_RECENT = night('p1', 'Wingspan', at(-3 * DAY));
const PAST_OLDER = night('p2', 'Azul', at(-10 * DAY));
const PAST_LAST_YEAR = night('p3', 'Root', '2025-03-15T23:00:00.000Z');
// Deliberately scrambled: the component's own sort is under test.
const EVENTS = [NEXT_YEAR, PAST_OLDER, SOON, PAST_LAST_YEAR, NEXT_WEEK, PAST_RECENT];

function renderArm(variant: Arm, events: unknown[] = EVENTS) {
  return render(
    <CalendarListView events={events} onEventClick={vi.fn()} timezone={TZ} loading={false} variant={variant} />,
  );
}

const upcomingButton = () => screen.getByRole('button', { name: 'Upcoming events' });
const pastButton = () => screen.getByRole('button', { name: /^Past events \(\d+\)$/ });
// A row title is the heading that lives inside an EventRow (the role=button container).
const rowTitles = (scope: HTMLElement): string[] =>
  Array.from(scope.querySelectorAll('h4, h5, h6'))
    .filter((el) => el.closest('[role="button"]') !== null)
    .map((el) => (el.textContent ?? '').trim());
const dayHeaders = (scope: HTMLElement): string[] =>
  within(scope)
    .queryAllByRole('heading', { level: 4 })
    .map((el) => (el.textContent ?? '').trim());
const sectionOf = (button: HTMLElement): HTMLElement => {
  const section = button.closest('section');
  expect(section, 'the header button sits in no section').not.toBeNull();
  return section as HTMLElement;
};
const panelOf = (button: HTMLElement): HTMLElement => {
  const id = button.getAttribute('aria-controls');
  expect(id, 'the header button names no controlled region').toBeTruthy();
  const panel = document.getElementById(id as string);
  expect(panel, 'aria-controls names an element that is not in the document').not.toBeNull();
  return panel as HTMLElement;
};

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(NOW);
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe('CalendarListView — two folding sections on every arm (88.9-61, X25a + X29 A)', () => {
  it('X25a / X29 (88.9): every arm renders Upcoming events and Past events (N) as two h3 headers, each wrapping a button with aria-expanded and aria-controls, Upcoming open and Past closed', () => {
    for (const arm of ARMS) {
      renderArm(arm);

      const h3s = screen.getAllByRole('heading', { level: 3 });
      expect(h3s.map((h) => (h.textContent ?? '').trim()), `${arm}: the two section headers`).toEqual([
        'Upcoming events',
        'Past events (3)',
      ]);
      // The heading WRAPS the button: a heading inside a button would read as a row title.
      expect(within(h3s[0]).getByRole('button'), `${arm}: Upcoming is a button inside its h3`).toBe(upcomingButton());
      expect(within(h3s[1]).getByRole('button'), `${arm}: Past is a button inside its h3`).toBe(pastButton());
      for (const button of [upcomingButton(), pastButton()]) {
        expect(button.querySelector('h1, h2, h3, h4, h5, h6'), `${arm}: no heading inside a header button`).toBeNull();
        expect(button.className.split(/\s+/), `${arm}: the 44px floor at the call site`).toContain('min-h-11');
      }

      expect(upcomingButton(), `${arm}: Upcoming opens expanded`).toHaveAttribute('aria-expanded', 'true');
      expect(pastButton(), `${arm}: Past opens collapsed`).toHaveAttribute('aria-expanded', 'false');
      expect(panelOf(upcomingButton()).hidden, `${arm}: the Upcoming region is shown`).toBe(false);
      expect(panelOf(pastButton()).hidden, `${arm}: the Past region is hidden`).toBe(true);
      expect(panelOf(upcomingButton()), `${arm}: two different regions`).not.toBe(panelOf(pastButton()));

      // Each section is named by its own header.
      expect(sectionOf(upcomingButton()).getAttribute('aria-labelledby'), `${arm}: Upcoming section label`).toBe(h3s[0].id);
      expect(sectionOf(pastButton()).getAttribute('aria-labelledby'), `${arm}: Past section label`).toBe(h3s[1].id);
      expect(h3s[0].id.endsWith('-upcoming'), `${arm}: the Upcoming heading id keeps its suffix`).toBe(true);

      // Only upcoming rows are on screen on arrival.
      expect(rowTitles(document.body), `${arm}: rows on arrival`).toEqual(['Catan', 'Gloomhaven', 'Brass']);
      cleanup();
    }
  });

  it('X25a (88.9): a header folds and unfolds its own section only', () => {
    for (const arm of ARMS) {
      renderArm(arm);
      const shown = () => screen.queryAllByRole('heading', { level: 5 }).map((h) => (h.textContent ?? '').trim());

      fireEvent.click(upcomingButton());
      expect(upcomingButton(), `${arm}: Upcoming folded`).toHaveAttribute('aria-expanded', 'false');
      expect(panelOf(upcomingButton()).hidden).toBe(true);
      expect(pastButton(), `${arm}: Past untouched by the Upcoming fold`).toHaveAttribute('aria-expanded', 'false');
      expect(shown(), `${arm}: nothing shown with both folded`).toEqual([]);

      fireEvent.click(pastButton());
      expect(pastButton(), `${arm}: Past opened`).toHaveAttribute('aria-expanded', 'true');
      expect(upcomingButton(), `${arm}: Upcoming untouched by the Past unfold`).toHaveAttribute('aria-expanded', 'false');
      expect(shown(), `${arm}: only past rows shown`).toEqual(['Wingspan', 'Azul', 'Root']);

      fireEvent.click(upcomingButton());
      expect(upcomingButton()).toHaveAttribute('aria-expanded', 'true');
      expect(pastButton(), `${arm}: Past stays open`).toHaveAttribute('aria-expanded', 'true');
      expect(shown(), `${arm}: both shown, upcoming first`).toEqual(['Catan', 'Gloomhaven', 'Brass', 'Wingspan', 'Azul', 'Root']);

      fireEvent.click(pastButton());
      expect(pastButton()).toHaveAttribute('aria-expanded', 'false');
      expect(upcomingButton(), `${arm}: Upcoming stays open`).toHaveAttribute('aria-expanded', 'true');
      expect(shown()).toEqual(['Catan', 'Gloomhaven', 'Brass']);
      cleanup();
    }
  });

  it("X25a (88.9): folding a section while focus is inside it moves focus to that section's header button", () => {
    for (const arm of ARMS) {
      renderArm(arm);
      const rowNamed = (name: string) =>
        screen.getByRole('heading', { level: 5, name }).closest('[role="button"]') as HTMLElement;

      // Upcoming: focus a row, then fold WITHOUT focusing the header (fireEvent.click moves no focus).
      act(() => rowNamed('Gloomhaven').focus());
      expect(document.activeElement).toBe(rowNamed('Gloomhaven'));
      fireEvent.click(upcomingButton());
      expect(document.activeElement, `${arm}: focus moved to the Upcoming header`).toBe(upcomingButton());
      fireEvent.click(upcomingButton());

      // Past: the same, in its own section.
      fireEvent.click(pastButton());
      act(() => rowNamed('Azul').focus());
      fireEvent.click(pastButton());
      expect(document.activeElement, `${arm}: focus moved to the Past header`).toBe(pastButton());

      // Focus OUTSIDE the folding section is left alone: the Past header keeps it while Upcoming folds.
      act(() => pastButton().focus());
      fireEvent.click(upcomingButton());
      expect(document.activeElement, `${arm}: a fold does not steal focus from elsewhere`).toBe(pastButton());
      cleanup();
    }
  });

  it('X29 (88.9): no Today delineator and no separator role on any arm; Past rows open most-recent-first below a 1px border-line rule', () => {
    for (const arm of ARMS) {
      renderArm(arm);

      expect(screen.queryByRole('separator'), `${arm}: no separator`).toBeNull();
      expect(screen.queryByText(/^Today, /), `${arm}: no Today chip`).toBeNull();

      const pastSection = sectionOf(pastButton());
      const classes = pastSection.className.split(/\s+/);
      expect(classes, `${arm}: the rule above Past`).toEqual(expect.arrayContaining(['border-t', 'border-line', 'pt-3']));
      // The rule belongs to Past alone.
      expect(sectionOf(upcomingButton()).className.split(/\s+/), `${arm}: no rule above Upcoming`).not.toContain('border-t');
      expect(sectionOf(upcomingButton()).contains(pastSection), `${arm}: Past is not nested in Upcoming`).toBe(false);

      fireEvent.click(pastButton());
      expect(rowTitles(sectionOf(upcomingButton())), `${arm}: upcoming soonest-first`).toEqual(['Catan', 'Gloomhaven', 'Brass']);
      expect(rowTitles(pastSection), `${arm}: past most-recent-first`).toEqual(['Wingspan', 'Azul', 'Root']);
      cleanup();
    }
  });

  it("X25a / X29 (88.9): a day header outside the current year carries the year, this year's do not", () => {
    for (const arm of ARMS) {
      renderArm(arm);
      fireEvent.click(pastButton());

      expect(dayHeaders(sectionOf(upcomingButton())), `${arm}: upcoming day headers`).toEqual([
        'Friday, September 4',
        'Monday, September 7',
        'Friday, January 8, 2027',
      ]);
      expect(dayHeaders(sectionOf(pastButton())), `${arm}: past day headers`).toEqual([
        'Tuesday, September 1',
        'Tuesday, August 25',
        'Saturday, March 15, 2025',
      ]);
      cleanup();
    }
  });

  it('X29 (88.9): the list opens at its top on every arm', () => {
    // jsdom lays nothing out, so every offset reads 0 and a mount-time centre-scroll would be
    // invisible. Give elements a real-looking offset and height for this test: a list that still
    // anchors itself part-way down on mount then writes a non-zero scrollTop.
    const offsetTop = vi.spyOn(HTMLElement.prototype, 'offsetTop', 'get').mockReturnValue(500);
    const clientHeight = vi.spyOn(HTMLElement.prototype, 'clientHeight', 'get').mockReturnValue(100);
    try {
      for (const arm of ARMS) {
        const { container } = renderArm(arm);
        const region = container.querySelector('.overflow-y-auto') as HTMLElement | null;
        expect(region, `${arm}: the scroll region`).not.toBeNull();
        expect((region as HTMLElement).scrollTop, `${arm}: the list opens at its top`).toBe(0);
        // The first thing in the region is the Upcoming header, not a past row.
        expect((region as HTMLElement).querySelector('h3, h4, h5'), `${arm}: the region leads with the Upcoming header`).toBe(
          screen.getByRole('heading', { level: 3, name: 'Upcoming events' }),
        );
        cleanup();
      }
    } finally {
      offsetTop.mockRestore();
      clientHeight.mockRestore();
    }
  });

  it('X25a (88.9): both headers stick on the card ground above the rows, the scroll region pads its top for them (WCAG 2.4.11), and each header button draws its focus ring inside itself (WCAG 2.4.7)', () => {
    // jsdom lays nothing out, so this pins the CLASSES that carry the behaviour; the rendered
    // proof (a header really stuck, a focused row really clear of it, the ring really inset) is
    // e2e/calendar-list-sections.spec.ts in CI.
    for (const arm of ARMS) {
      const { container } = renderArm(arm);

      for (const button of [upcomingButton(), pastButton()]) {
        const heading = button.closest('h3') as HTMLElement;
        const headingClasses = heading.className.split(/\s+/);
        // Sticks at the top of the region, above the rows (they paint at z-index 1), on the card
        // ground so a row scrolling under it does not show through.
        expect(headingClasses, `${arm}: the header sticks on the card ground`).toEqual(
          expect.arrayContaining(['sticky', 'top-0', 'z-10', 'bg-surface-card']),
        );
        const buttonClasses = button.className.split(/\s+/);
        // The ring is drawn INSIDE the button: the scroll region clips an outside ring on the left
        // and above a stuck header. The Button primitive's default offset pair must be gone, not
        // merely joined by the inset pair.
        expect(buttonClasses, `${arm}: the inset ring`).toEqual(
          expect.arrayContaining(['focus-visible:ring-inset', 'focus-visible:ring-offset-0', 'focus-visible:ring-2']),
        );
        expect(buttonClasses, `${arm}: the default outside offset is dropped`).not.toContain('focus-visible:ring-offset-2');
      }

      // 3.5rem of scroll padding at the top of the region: the 44px header, the row's 4px of
      // ring, and 8px of air. In rem so it grows with the text, like the header's own floor.
      const region = container.querySelector('.overflow-y-auto') as HTMLElement | null;
      expect(region, `${arm}: the scroll region`).not.toBeNull();
      expect((region as HTMLElement).className.split(/\s+/), `${arm}: the region pads its top for a stuck header`).toContain('scroll-pt-14');
      cleanup();
    }
  });

  it('X27 (88.9): a guest night carries the dashed amber outline and the Guest pill on the full and compact arms as on the sheet; a member row keeps its hairline', () => {
    // 88.9-63 (X27 + orchestrator decision 3): the guest mark was sheet-only, so the same night
    // was outlined on the phone and unmarked on its desktop twin. Every arm marks it now. The
    // viewer joined Catan as a guest and is an ordinary participant of Gloomhaven.
    const VIEWER = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
    const guestNight = { ...SOON, EventParticipations: [{ user_id: VIEWER, is_guest: true }] };
    const memberNight = { ...NEXT_WEEK, EventParticipations: [{ user_id: VIEWER, is_guest: false }] };
    const rowOf = (title: string): HTMLElement => {
      const heading = screen.getAllByRole('heading').find((el) => (el.textContent ?? '').trim() === title && el.closest('[role="button"]') !== null);
      expect(heading, `no row titled ${title}`).toBeDefined();
      return (heading as HTMLElement).closest('[role="button"]') as HTMLElement;
    };

    // CalendarListView is a JS component: its viewer id defaults to null, so its inferred prop
    // type admits no string. The same cast idiom as the EventCalendar refresh suite.
    const ListWithViewer = CalendarListView as unknown as React.ComponentType<Record<string, unknown>>;
    for (const arm of ARMS) {
      render(
        <ListWithViewer
          events={[guestNight, memberNight]}
          onEventClick={vi.fn()}
          timezone={TZ}
          loading={false}
          variant={arm}
          viewerDbUserId={VIEWER}
        />,
      );

      const guestRow = rowOf('Catan');
      const guestClasses = guestRow.className.split(/\s+/);
      for (const token of ['border', 'border-dashed', 'border-amber-700', 'dark:border-amber-500/70']) {
        expect(guestClasses, `${arm}: the guest row carries the outline token ${token}`).toContain(token);
      }
      expect(guestClasses, `${arm}: the outline is an exclusive arm, never stacked on the hairline`).not.toContain('border-line');
      expect(within(guestRow).queryByText('Guest'), `${arm}: the guest row carries the Guest pill`).not.toBeNull();
      // No inline border colour: an inline declaration would beat both border arms.
      expect(guestRow.style.borderColor, `${arm}: no inline border colour on the guest row`).toBe('');

      const memberRow = rowOf('Gloomhaven');
      const memberClasses = memberRow.className.split(/\s+/);
      expect(memberClasses, `${arm}: the member row keeps its hairline`).toContain('border-line');
      expect(memberClasses, `${arm}: the member row is not dashed`).not.toContain('border-dashed');
      expect(within(memberRow).queryByText('Guest'), `${arm}: the member row carries no Guest pill`).toBeNull();
      cleanup();
    }

    // With no viewer id nothing is a guest row, on any arm.
    for (const arm of ARMS) {
      renderArm(arm, [guestNight, memberNight]);
      const row = rowOf('Catan');
      expect(row.className.split(/\s+/), `${arm}: no viewer id, no outline`).not.toContain('border-dashed');
      expect(within(row).queryByText('Guest'), `${arm}: no viewer id, no Guest pill`).toBeNull();
      cleanup();
    }
  });
});
