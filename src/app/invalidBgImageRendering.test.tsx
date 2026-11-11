// Phase 88.6-41 (W49 / FSEC-03 / D-20 (i)) — the RENDERED half of the five-site
// `hasBackgroundImage` convergence.
//
// WHY THIS FILE EXISTS AT ALL. `CalendarMonthView.js`'s own deferral marker named
// its exit condition verbatim: converging the flag onto the validated style
// "CHANGES WHAT AN INVALID-URL TILE PAINTS", and the family was registered so it
// could be converged "in one pass with a rendered check". A source scan
// (`groupColourRendering.test.ts` test 31) proves the raw URL no longer reaches a
// sink; it cannot prove what the browser then paints. This is that check, on all
// FOUR converted surfaces — a check on the month tile alone could not support an
// acceptance that claims all of them.
//
// THE FIXTURE. `/uploads/x.png` is invalid BY CONSTRUCTION: `safeBgImageStyle`
// leaves `allowRelative` at its default, so a relative reference is rejected
// (`safeBgImageStyle.ts:26-27`, `:42-44`, `:60`). Every fixture group ALSO has a
// dark stored colour, and that is load-bearing rather than incidental: the
// white-on-white regression this convergence prevents needs a dark ground UNDER
// the white wash to appear at all, so a no-colour fixture passes while the real
// defect stands.
//
// THE SHAPE OF EACH CASE. Three renders of the SAME group — no image, INVALID
// image, VALID image — and the claim is the convergence itself: an invalid URL
// must render byte-identically to no image, and a valid URL must differ. That is
// stronger than pinning one literal, because it cannot be satisfied by a half
// conversion (flag converged, wash left raw) in either direction. The specific
// literals the acceptance names are asserted on top of it.
import * as React from 'react';
import { render, screen, cleanup, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const INVALID_URL = '/uploads/x.png';
const VALID_URL = 'https://example.test/photo.png';
/** Dark enough that `isDarkBackground` is true — the case the wash would ruin. */
const DARK_HEX = '#722f37';

const WASH_085 = 'background-color: rgba(255, 255, 255, 0.85)';
const OVERLAY_07 = 'background-color: rgba(255, 255, 255, 0.7)';
const PHOTO_DIM_04 = 'background-color: rgba(0, 0, 0, 0.4)';
const DARK_DIM_CLASS = 'dark:bg-[rgb(0_0_0/0.15)]';

// ---------------------------------------------------------------------------
// Module mocks. Hoisted, so they are shared by every surface in this file; each
// one only removes chrome that is irrelevant to what a background image paints.
// ---------------------------------------------------------------------------
const SELF_UUID = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';

vi.mock('@/app/components/TimezoneProvider', () => ({
  useTimezone: () => ({ timezone: 'America/New_York', setTimezone: vi.fn() }),
}));
vi.mock('../components/TimezoneProvider', () => ({
  useTimezone: () => ({ timezone: 'America/New_York', setTimezone: vi.fn() }),
}));
vi.mock('@/app/components/QRCodeModal', () => ({ default: () => null }));
vi.mock('@/app/components/TimezoneNudgeBanner', () => ({ default: () => null }));

vi.mock('@/lib/hooks/useSelfIdentity', () => ({
  SELF_IDENTITY_KEY: ['users', 'self'],
  useSelfIdentity: () => ({
    selfUuid: SELF_UUID,
    self: { id: SELF_UUID, user_id: 'auth0|self' },
    query: { isError: false, error: null, refetch: vi.fn() },
    isPending: false,
  }),
}));
vi.mock('next/navigation', () => ({
  useSearchParams: () => new URLSearchParams('id=GROUP1'),
  useRouter: () => ({ push: vi.fn() }),
}));
vi.mock('@auth0/nextjs-auth0/client', () => ({
  useUser: () => ({ user: { sub: 'auth0|self' }, isLoading: false }),
}));
vi.mock('@/app/components/createEvent', () => ({ default: () => null }));
vi.mock('@/app/components/ManageMembers', () => ({ default: () => null }));
vi.mock('@/app/components/GroupGamesList', () => ({ default: () => null }));
vi.mock('@/app/components/EventCalendar', () => ({ default: () => null }));
vi.mock('@/app/components/PendingMemberBanner', () => ({ default: () => null }));
vi.mock('@/app/components/GroupLibrary', () => ({ default: () => null }));
vi.mock('@/app/components/GroupSettings', () => ({ default: () => null }));
vi.mock('@/app/components/SafeImage', () => ({ default: () => null }));
vi.mock('@/app/components/KebabMenu', () => ({ default: () => null }));

vi.mock('@/lib/api', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/api')>();
  return {
    ...actual,
    groupsAPI: { getGroup: vi.fn(), getGroupMembers: vi.fn() },
    eventsAPI: { ...actual.eventsAPI, getGroupEvents: vi.fn(), getEventInviteToken: vi.fn() },
    listsAPI: { getGroupGames: vi.fn() },
  };
});

import CalendarMonthView from './components/CalendarMonthView';
import CalendarListView from './components/CalendarListView';
import EventDayModal from './components/EventDayModal';
import GroupHomePage from './groupHomePage/page';
import { groupsAPI, eventsAPI, listsAPI } from '@/lib/api';

type Mock = ReturnType<typeof vi.fn>;

const day = new Date();
day.setDate(15);
day.setHours(12, 0, 0, 0);
const future = new Date(day.getTime() + 365 * 24 * 60 * 60 * 1000);

/** One event on a coloured group, with whatever image URL the case is about. */
const eventWith = (image: string | null) => ({
  id: 'evt-1',
  start_date: future.toISOString(),
  duration_minutes: 90,
  Game: { name: 'Catan' },
  Group: { name: 'Tuesday Crew', background_color: DARK_HEX, background_image_url: image },
  rsvp_summary: null,
});

afterEach(cleanup);

/**
 * Renders `fn` for the three image cases and returns each markup snapshot.
 * Element identity is irrelevant here — what the surface PAINTS is the claim.
 */
async function threeCases(fn: (image: string | null) => Promise<string> | string) {
  // Radix mints a fresh `:rN:` id per mount, so three renders of the SAME markup
  // differ only in those ids. Normalising them is what makes the equality claim
  // about PAINT rather than about mount order; nothing else is touched.
  const norm = (html: string) => html.replace(/:r[0-9a-z]+:/g, ':rN:');
  const none = norm(await fn(null));
  cleanup();
  const invalid = norm(await fn(INVALID_URL));
  cleanup();
  const valid = norm(await fn(VALID_URL));
  cleanup();
  return { none, invalid, valid };
}

/** The convergence claim, asserted the same way on every surface. */
function expectInvalidBehavesAsNoImage(
  surface: string,
  { none, invalid, valid }: { none: string; invalid: string; valid: string },
) {
  expect(
    invalid,
    `${surface}: an INVALID background URL does not paint what NO background paints. ` +
      'The renderer refused that URL, so anything keyed on it — text treatment, contrast ' +
      'wash, scrim — is styled for an image that is not there (FSEC-03 / W49).',
  ).toBe(none);
  expect(
    valid,
    `${surface}: a VALID background URL paints the same as no background — this check has ` +
      'gone vacuous (the image branch is dead, or the fixture stopped validating).',
  ).not.toBe(none);
}

// ===========================================================================
// 1. The month tile — the surface whose own marker named this rendered check.
// ===========================================================================
describe('W49 rendered — CalendarMonthView month tile', () => {
  const renderTile = (image: string | null) => {
    render(
      <CalendarMonthView
        days={[{ date: future, isCurrentMonth: true }]}
        activeEvents={[eventWith(image)]}
        currentDate={future}
        variant="full"
        onDayClick={vi.fn()}
        onEventClick={vi.fn()}
        onNavigateMonth={vi.fn()}
        onGoToday={vi.fn()}
        monthNames={['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December']}
        tzLegend={null}
      />,
    );
    return document.body.innerHTML;
  };

  it('an invalid URL paints the plain/tinted treatment and NO 0.7 white overlay', async () => {
    const cases = await threeCases(renderTile);
    expectInvalidBehavesAsNoImage('CalendarMonthView', cases);

    // The literal the acceptance names, both directions — so "absent" cannot be
    // absent-because-nothing-rendered.
    expect(cases.invalid, `the 0.7 overlay still paints on an invalid URL`).not.toContain(OVERLAY_07);
    expect(cases.none, 'the 0.7 overlay paints with no image at all').not.toContain(OVERLAY_07);
    expect(cases.valid, 'the 0.7 overlay is gone from the VALID case too — that is a regression').toContain(OVERLAY_07);
  });
});

// ===========================================================================
// 2. The day-modal row — plain treatment, and NO 0.85 white wash.
// ===========================================================================
describe('W49 rendered — EventDayModal event row', () => {
  beforeEach(() => {
    (eventsAPI.getEventInviteToken as Mock).mockResolvedValue({ invite_url: 'https://example.test/i/a' });
  });

  const renderRow = (image: string | null) => {
    render(
      <EventDayModal
        selectedDay={{ date: future, events: [eventWith(image)] }}
        onClose={vi.fn()}
        onEventClick={vi.fn()}
      />,
    );
    return document.body.innerHTML;
  };

  it('an invalid URL paints the plain treatment and NO 0.85 white wash', async () => {
    const cases = await threeCases(renderRow);
    expectInvalidBehavesAsNoImage('EventDayModal', cases);

    expect(cases.invalid, 'the 0.85 wash still paints on an invalid URL — white text under a near-white wash').not.toContain(WASH_085);
    expect(cases.none, 'the 0.85 wash paints with no image at all').not.toContain(WASH_085);
    expect(cases.valid, 'the 0.85 wash is gone from the VALID case too — that is a regression').toContain(WASH_085);
  });
});

// ===========================================================================
// 3. The list row — the twin of the above, in a file with no suite until now.
// ===========================================================================
describe('W49 rendered — CalendarListView event row', () => {
  const renderRow = (image: string | null) => {
    render(
      <CalendarListView events={[eventWith(image)]} onEventClick={vi.fn()} timezone="America/New_York" />,
    );
    return document.body.innerHTML;
  };

  it('an invalid URL paints the plain treatment and NO 0.85 white wash', async () => {
    const cases = await threeCases(renderRow);
    expectInvalidBehavesAsNoImage('CalendarListView', cases);

    expect(cases.invalid, 'the 0.85 wash still paints on an invalid URL').not.toContain(WASH_085);
    expect(cases.none, 'the 0.85 wash paints with no image at all').not.toContain(WASH_085);
    expect(cases.valid, 'the 0.85 wash is gone from the VALID case too — that is a regression').toContain(WASH_085);
  });
});

// ===========================================================================
// 4. The group-home header — the SCRIM PAIR, not only its negative half.
//
// This one is a SWAP, and the half that ARRIVES is `dark:`-only: an invalid-URL
// group WITH a stored colour leaves the dim marker's case (1) (inline 0.4, both
// themes) for its case (2) (transparent in light, 0.15 in dark, via the class).
// A light-mode "no 0.4 dim" assertion could never observe the half that arrived,
// on a surface whose text contrast (WCAG 1.4.3) depends on exactly that pairing —
// so the class is asserted PRESENT alongside the inline value being absent. The
// class IS the dark-mode observation available here: jsdom applies no Tailwind,
// and `dark:bg-[rgb(0_0_0/0.15)]` in the markup is precisely what dark mode
// consumes at runtime.
// ===========================================================================
describe('W49 rendered — groupHomePage header scrim pair', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    (groupsAPI.getGroupMembers as Mock).mockResolvedValue([
      { id: SELF_UUID, user_id: 'auth0|self', username: 'Me', UserGroup: { role: 'owner' } },
    ]);
    (eventsAPI.getGroupEvents as Mock).mockResolvedValue([]);
    (listsAPI.getGroupGames as Mock).mockResolvedValue([]);
  });

  const renderHeader = async (image: string | null) => {
    (groupsAPI.getGroup as Mock).mockResolvedValue({
      id: 'GROUP1',
      name: 'My Group',
      background_color: DARK_HEX,
      background_image_url: image,
    });
    render(<GroupHomePage />);
    await screen.findByRole('link', { name: 'Plan Game Session' });
    await waitFor(() => expect(listsAPI.getGroupGames as Mock).toHaveBeenCalled());
    return document.body.innerHTML;
  };

  it('an invalid URL paints the plain treatment, NO inline 0.4 dim, AND the dark 0.15 class', async () => {
    const cases = await threeCases(renderHeader);
    expectInvalidBehavesAsNoImage('groupHomePage header', cases);

    // The negative half…
    expect(cases.invalid, 'the inline 0.4 photo dim still paints on an invalid URL').not.toContain(PHOTO_DIM_04);
    // AMENDED Phase 88.9-27 (owner ruling O21b / pick O02d1): the VALID case paints NO 0.4 dim
    // either; it carries the O02d1 paint-order pair instead (white + 1.5px outline painted first),
    // and the invalid case carries neither (it still behaves as no image).
    expect(cases.valid, 'the inline 0.4 photo dim still paints on a VALID image (O21b ruled no photo dim)').not.toContain(PHOTO_DIM_04);
    expect(cases.valid, 'the VALID case lost the O02d1 paint-order pair').toContain('--t-paint: stroke fill');
    // The inline DECLARATION form: the className utilities name the property too.
    expect(cases.invalid, 'the O02d1 paint-order pair leaked onto an invalid URL').not.toContain('--t-paint: ');
    expect(cases.invalid, 'the O02d1 paint-order pair leaked onto an invalid URL').not.toContain('--t-paint-l: ');

    // …and the half that ARRIVES, which only a dark-mode reading can see.
    expect(
      cases.invalid,
      'the `dark:` 0.15 dim did not arrive. The 0.4 is REPLACED, not removed — an invalid-URL ' +
        'group with a stored colour belongs in the dim marker\'s case (2), and without this half ' +
        'the header loses its dark-mode dim entirely.',
    ).toContain(DARK_DIM_CLASS);
    expect(cases.valid, 'the `dark:` 0.15 class leaked onto the real-image case (1)').not.toContain(DARK_DIM_CLASS);
  });

  // Owner ruling 88.9-RULINGS.md R-P4 (2026-11-08, MED-66 option A): with the photo dim gone,
  // the translucent 10% white wash under Manage Members leaves white ink at 1.00:1 over a white
  // photo. On a VALID image the control takes the opaque elevated surface in dark instead; the
  // owner-ruled wash stays byte for byte on every no-image header, and an invalid URL behaves
  // as no image.
  it('R-P4 (88.9-27): on a VALID image Manage Members takes the opaque elevated ground in dark, not the 10% wash; no image keeps the wash', async () => {
    const manageMembersClass = async (image: string | null) => {
      await renderHeader(image);
      const cls = screen.getByRole('button', { name: 'Manage Members' }).getAttribute('class') ?? '';
      cleanup();
      return cls;
    };
    const valid = await manageMembersClass(VALID_URL);
    expect(valid, 'Manage Members on a photo lost the opaque elevated dark ground').toContain('dark:bg-surface-elevated');
    for (const wash of ['dark:bg-white/10', 'dark:text-white', 'dark:backdrop-blur-xs']) {
      expect(valid, `Manage Members on a photo still carries ${wash}`).not.toContain(wash);
    }

    const none = await manageMembersClass(null);
    expect(none, 'the owner-ruled no-image wash is gone').toContain('dark:bg-white/10');
    expect(none, 'the owner-ruled no-image blur is gone').toContain('dark:backdrop-blur-xs');
    expect(none, 'the elevated photo ground leaked onto a no-image header').not.toContain('dark:bg-surface-elevated');

    const invalid = await manageMembersClass(INVALID_URL);
    expect(invalid, 'an invalid URL does not style Manage Members as no image').toBe(none);
  });
});
