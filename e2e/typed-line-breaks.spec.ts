import { test, expect, type Page } from '@playwright/test';

import { expectNoApiWrites, holdWrites, type WriteHold } from './support/inFlight';
import { scrubbedFetch } from './support/scrubbedFetch';

// Phase 88.6.1-52 (R10 / AC-31, shared rule 12) — typed line breaks at 375px, in a real browser
// (the `phone` project, iPhone SE 375x667).
//
// What this proves: AC-31's 375px half for ALL FIVE typed-text sites in the app —
//   - the game page's session comments, own review and other reviews (gameDetail/page.js, plan 52);
//   - the group planning page's check-in message (OpenPollsList.js, plan 88.6.1-29);
//   - the event page's RSVP notes (RsvpSection.js, plan 88.6.1-38).
// Plans 88.6.1-29 and 88.6.1-38 fixed their sites in jsdom and hand the phone half to this file.
// For each site: (a) a typed newline renders as two lines (the element's innerText keeps the break
// and a Range over its text yields at least two line boxes); (b) a 300-character unbroken value
// does not overflow its own box or the 375px viewport, and the document has no horizontal scroll;
// (c) whitespace-only and blank-line values render (a run of three or more breaks as one blank
// line, owner ruling #115) without breaking the layout.
//
// CI only: the phone project needs the `.auth` storage state, which does not exist locally. The
// RED half is the jsdom class pins (gameDetail/page.test.tsx R10-1..R10-6 for this file's three
// sites; plans 29 and 38's pins for theirs).
//
// Network: every intercept is a GET, fulfilled or patched in the browser. Every non-GET request is
// held unanswered by the shared write hold (holdWrites, e2e/support/inFlight.ts), registered first
// in every test, and each test asserts it caught none bound for the app or the backend, so "no
// write is sent" is checked, not promised. No response body is ever logged, printed or attached.
//
// DECISION Phase 88.6.1-52 (R10, the 375px half): CHOSEN — synthesising the game view in the
// browser for a fake UUID game id, because the CI fixture seeds no game (scripts/e2e-fixtures.js
// creates its event without one). REJECTED — (a) re-pointing E2E_EVENT_DETAIL_PATH
// (`DECISION Phase 88-30 (DEF-88-24-05)` in padding-budget.spec.ts already rejected it: the
// variable is shared); (b) a new backend fixture (the backend is outside this phase); (c) one spec
// per surface (three copies of the same measuring helper). Changing this is a decision, not a
// cleanup.

test.skip(
  ({ isMobile }) => !isMobile,
  'SPEC Req 10 / AC-31: the typed-line-break layout half is a phone-forward gate (375x667), so this spec runs only in the phone project'
);

// Seeded fixtures minted by the backend's scripts/e2e-fixtures.js in CI. Same obviously-fake
// fallback idiom and the same variable names as contrast.spec.ts, so a fixture rename moves every
// spec together. '1' is not a UUID on purpose: gameDetail's isUuid guard drops it, so a missing
// variable fails loudly at the first settle instead of resolving to some other row.
const E2E_GROUP_ID = process.env.E2E_GROUP_ID ?? '1';
const E2E_EVENT_DETAIL_PATH =
  process.env.E2E_EVENT_DETAIL_PATH ?? `/gameDetail?event_id=1&group_id=${E2E_GROUP_ID}`;

const FAKE_GAME_ID = '7a7a7a7a-7a7a-4a7a-8a7a-7a7a7a7a7a7a';
const FAKE_REVIEWER_ID = '9b9b9b9b-9b9b-4b9b-8b9b-9b9b9b9b9b9b';
const FAKE_SESSION_IDS = [
  '5a5a5a5a-5a5a-4a5a-8a5a-5a5a5a5a5a01',
  '5a5a5a5a-5a5a-4a5a-8a5a-5a5a5a5a5a02',
];
// Sentry's same-origin tunnel (next.config.js, `tunnelRoute`). Whenever the build carries a DSN
// the browser SDK POSTs its envelopes there and the hold catches them. Whether CI's build carries
// one was not read; it is telemetry, not a write to the fixture, so it is excluded by name.
const SENTRY_TUNNEL_PATH = '/monitoring';

const OPEN_QUOTE = '“';
const CLOSE_QUOTE = '”';

type Probe = 'newline' | 'long' | 'whitespace';
const PROBE_NAMES: Probe[] = ['newline', 'long', 'whitespace'];

// One capital letter plus 299 Ws: exactly 300 characters with no break opportunity.
const long = (letter: string) => `${letter}${'W'.repeat(299)}`;

// Typed values per site. `newline` values are short on purpose: before the fix they fit on one
// line, so the line-box count is a real red. Each site has its own letter so a failure names it.
const PROBES = {
  newline: {
    comments: ['S1\nS2'],
    ownReview: 'M1\nM2',
    otherReview: 'T1\nT2',
    checkIns: ['C1\nC2'],
    notes: ['N1\nN2'],
  },
  long: {
    comments: [long('S')],
    ownReview: long('M'),
    otherReview: long('T'),
    checkIns: [long('C')],
    notes: [long('N')],
  },
  whitespace: {
    comments: ['   ', '\n\n\n'],
    ownReview: '   ',
    otherReview: '\n\n\n',
    checkIns: ['   ', '\n\n\n'],
    notes: ['   ', '\n\n\n'],
  },
} as const;

// What a value renders as (owner ruling #115, plan 88.6.1-84's collapseBlankLines: a run of three
// or more breaks shows as one blank line). Only the probe values above go through this.
const rendered = (value: string) => value.replace(/\n{3,}/g, '\n\n');

const daysFromNow = (days: number) => new Date(Date.now() + days * 24 * 60 * 60 * 1000).toISOString();

async function openGamePage(page: Page, probe: Probe): Promise<void> {
  const values = PROBES[probe];

  await page.route('**/api/games/**', async (route) => {
    const request = route.request();
    if (request.method() !== 'GET' || new URL(request.url()).pathname !== `/api/games/${FAKE_GAME_ID}`) {
      await route.fallback();
      return;
    }
    // The GAME fixture's shape (gameDetail/page.test.tsx), with the fake id and no description.
    await route.fulfill({
      status: 200,
      json: {
        id: FAKE_GAME_ID,
        name: 'Wingspan',
        description: null,
        image_url: '',
        is_custom: false,
        min_players: 1,
        max_players: 5,
        playing_time: 60,
        theme: 'Nature',
        year_published: 2019,
        bgg_id: 266192,
      },
    });
  });

  await page.route('**/api/events/group/**', async (route) => {
    const request = route.request();
    if (request.method() !== 'GET' || new URL(request.url()).pathname !== `/api/events/group/${E2E_GROUP_ID}`) {
      await route.fallback();
      return;
    }
    // Past sessions in the SESSION fixture's shape; the page keeps only rows whose game_id matches.
    await route.fulfill({
      status: 200,
      json: values.comments.map((comments, index) => ({
        id: FAKE_SESSION_IDS[index],
        game_id: FAKE_GAME_ID,
        group_id: E2E_GROUP_ID,
        start_date: daysFromNow(-(7 + index)),
        duration_minutes: 90,
        comments,
        EventParticipations: [],
      })),
    });
  });

  await page.route('**/api/game-reviews/game/**', async (route) => {
    const request = route.request();
    if (request.method() !== 'GET') {
      await route.fallback();
      return;
    }
    // The page sends user_id only once identity resolves, and detects the own review by
    // User.id === that id, so the own review carries the request's own user_id (null before).
    const selfId = new URL(request.url()).searchParams.get('user_id');
    await route.fulfill({
      status: 200,
      json: [
        {
          id: 'e2e-r10-own-review',
          rating: '4.0',
          review_text: values.ownReview,
          is_recommended: true,
          createdAt: daysFromNow(-3),
          User: { id: selfId, username: 'R10 Self' },
        },
        {
          id: 'e2e-r10-other-review',
          rating: '3.0',
          review_text: values.otherReview,
          is_recommended: false,
          createdAt: daysFromNow(-2),
          User: { id: FAKE_REVIEWER_ID, username: 'R10 Reviewer' },
        },
      ],
    });
  });

  await page.goto(`/gameDetail?game_id=${FAKE_GAME_ID}&group_id=${E2E_GROUP_ID}`);

  const failure =
    'the synthetic game view never settled — it needs the three GET routes above (/api/games/<fake id>, /api/events/group/<E2E_GROUP_ID>, /api/game-reviews/game/...) and a UUID E2E_GROUP_ID (the fallback "1" is dropped by the page\'s isUuid guard on purpose)';
  await expect(page.getByRole('heading', { name: /^Game Sessions \(\d+\)$/ }), failure).toBeVisible({
    timeout: 15_000,
  });
  await expect(page.getByText('(You)', { exact: true }), `${failure}; "(You)" needs the identity-keyed review request`).toBeVisible({
    timeout: 15_000,
  });
}

async function openCheckIns(page: Page, probe: Probe): Promise<void> {
  const values = PROBES[probe];
  await page.route(`**/api/groups/${E2E_GROUP_ID}/prompts/open`, async (route) => {
    if (route.request().method() !== 'GET') {
      await route.fallback();
      return;
    }
    // Every field openPromptsSchema reads (src/lib/schemas/prompts.ts).
    await route.fulfill({
      status: 200,
      json: {
        prompts: values.checkIns.map((custom_message, index) => ({
          id: `e2e-r10-check-in-${index + 1}`,
          can_close: false,
          group_id: E2E_GROUP_ID,
          game_id: null,
          deadline: daysFromNow(3),
          status: 'active',
          week_identifier: 'e2e-r10',
          custom_message,
          Creator: null,
          GroupPromptSetting: null,
        })),
      },
    });
  });

  await page.goto(`/groupPlanning?group_id=${E2E_GROUP_ID}`);
  await expect(
    page.getByText('Availability check-in', { exact: true }).first(),
    'the check-ins list never showed the fulfilled check-in — GET /api/groups/<E2E_GROUP_ID>/prompts/open is answered above',
  ).toBeVisible({ timeout: 15_000 });
}

async function openRsvpNotes(page: Page, probe: Probe): Promise<void> {
  const values = PROBES[probe];
  let rowCount = -1;
  await page.route('**/api/rsvp/event/**', async (route) => {
    if (route.request().method() !== 'GET') {
      await route.fallback();
      return;
    }
    const response = await scrubbedFetch(route);
    let body: { rsvps?: Array<Record<string, unknown>> } & Record<string, unknown>;
    try {
      body = await response.json();
    } catch {
      await route.fulfill({ response });
      return;
    }
    const rows = Array.isArray(body.rsvps) ? body.rsvps.map((row) => ({ ...row })) : [];
    rowCount = rows.length;
    values.notes.forEach((note, index) => {
      if (rows[index]) rows[index].note = note;
    });
    // `summary` is left unchanged.
    await route.fulfill({ response, json: { ...body, rsvps: rows } });
  });

  await page.goto(E2E_EVENT_DETAIL_PATH);
  await expect(
    page.getByRole('group', { name: /^RSVP for / }),
    'the RSVP section never rendered on E2E_EVENT_DETAIL_PATH',
  ).toBeVisible({ timeout: 15_000 });
  expect(
    rowCount,
    `the RSVP list needs ${values.notes.length} row(s) to carry the probe notes — scripts/e2e-fixtures.js seeds Diana's and Bob's yes rows on the detail event`,
  ).toBeGreaterThanOrEqual(values.notes.length);
}

interface Target {
  site: string;
  tag: string;
  text: string;
  expected: number;
}

interface SiteMatch {
  whiteSpace: string;
  overflowWrap: string;
  scrollWidth: number;
  clientWidth: number;
  right: number;
  innerText: string;
  lineTops: number;
}

interface Measured {
  sites: Array<{ site: string; count: number; matches: SiteMatch[] }>;
  docScrollWidth: number;
  innerWidth: number;
}

// ONE in-page read: every element of the tag whose textContent equals the text EXACTLY, with the
// geometry and computed styles each assertion needs. lineTops counts the distinct rounded tops of
// the line boxes a Range over the element's contents produces.
async function measureSites(page: Page, targets: Target[]): Promise<Measured> {
  return page.evaluate((list) => {
    const sites = list.map(({ site, tag, text }) => {
      const found = Array.from(document.querySelectorAll<HTMLElement>(tag)).filter(
        (el) => el.textContent === text,
      );
      const matches = found.map((el) => {
        const cs = getComputedStyle(el);
        const range = document.createRange();
        range.selectNodeContents(el);
        const tops = new Set(Array.from(range.getClientRects()).map((rect) => Math.round(rect.top)));
        return {
          whiteSpace: cs.whiteSpace,
          overflowWrap: cs.overflowWrap,
          scrollWidth: el.scrollWidth,
          clientWidth: el.clientWidth,
          right: el.getBoundingClientRect().right,
          innerText: el.innerText,
          lineTops: tops.size,
        };
      });
      return { site, count: found.length, matches };
    });
    return {
      sites,
      docScrollWidth: document.documentElement.scrollWidth,
      innerWidth: window.innerWidth,
    };
  }, targets);
}

// The targets per surface and probe, each looked up by its RENDERED text.
function targetsFor(surface: Surface, probe: Probe): Target[] {
  const values = PROBES[probe];
  if (surface === 'game page') {
    if (probe === 'whitespace') {
      // A session and the own review are three spaces; a session and the other review are three
      // newlines, which render as two.
      return [
        { site: 'game page — three spaces (a session + the own review)', tag: 'p', text: '   ', expected: 2 },
        { site: 'game page — three newlines (a session + the other review)', tag: 'p', text: '\n\n', expected: 2 },
      ];
    }
    return [
      { site: 'session comments', tag: 'p', text: values.comments[0], expected: 1 },
      { site: 'own review', tag: 'p', text: values.ownReview, expected: 1 },
      { site: 'other review', tag: 'p', text: values.otherReview, expected: 1 },
    ];
  }
  if (surface === 'check-ins') {
    return values.checkIns.map((value) => ({
      site: `check-in message ${JSON.stringify(value.slice(0, 12))}`,
      tag: 'span',
      text: `${OPEN_QUOTE}${rendered(value)}${CLOSE_QUOTE}`,
      expected: 1,
    }));
  }
  return values.notes.map((value) => ({
    site: `RSVP note ${JSON.stringify(value.slice(0, 12))}`,
    tag: 'span',
    text: rendered(value),
    expected: 1,
  }));
}

// The two lines a `newline` value must render as (its own line break kept in innerText).
const NEWLINE_LINES: Record<Surface, string[]> = {
  'game page': ['S1\nS2', 'M1\nM2', 'T1\nT2'],
  'check-ins': ['C1\nC2'],
  'RSVP notes': ['N1\nN2'],
};

type Surface = 'game page' | 'check-ins' | 'RSVP notes';
const SURFACES: Array<{ name: Surface; open: (page: Page, probe: Probe) => Promise<void> }> = [
  { name: 'game page', open: openGamePage },
  { name: 'check-ins', open: openCheckIns },
  { name: 'RSVP notes', open: openRsvpNotes },
];

// The end of every test: the hold caught no write (Sentry's tunnel excepted by name), then every
// route is removed. RED note: a throwaway POST to any /api/ path planted on page load makes this
// list length 1; without the hold, the same write would reach the backend unseen.
async function expectNoWritesThenUnroute(page: Page, hold: WriteHold): Promise<void> {
  const writes = hold.held.filter((request) => new URL(request.url).pathname !== SENTRY_TUNNEL_PATH);
  expect(
    writes,
    `the write hold caught ${writes.length} request(s): ${writes
      .map((request) => `${request.method} ${new URL(request.url).pathname}`)
      .join(', ')}`,
  ).toHaveLength(0);
  await page.unrouteAll({ behavior: 'ignoreErrors' });
}

let hold: WriteHold | undefined;

test.beforeEach(() => {
  hold = undefined;
});

test.afterEach(async ({ page }) => {
  try {
    expectNoApiWrites(hold);
  } finally {
    await page.unrouteAll({ behavior: 'ignoreErrors' });
  }
});

for (const surface of SURFACES) {
  for (const probe of PROBE_NAMES) {
    test(`${surface.name} at 375 — ${probe} (R10 / AC-31)`, async ({ page }) => {
      // The hold FIRST: Playwright runs matching routes in the order opposite to their
      // registration, so each surface route below runs first and its route.fallback() reaches it.
      hold = await holdWrites(page);
      await surface.open(page, probe);

      const targets = targetsFor(surface.name, probe);
      const measured = await measureSites(page, targets);

      measured.sites.forEach(({ site, count, matches }, index) => {
        const target = targets[index];
        if (probe === 'whitespace') {
          expect(count, `${site}: expected ${target.expected} element(s) rendering ${JSON.stringify(target.text)}`).toBe(target.expected);
        } else {
          expect(count, `${site}: no ${target.tag} renders exactly ${JSON.stringify(target.text.slice(0, 20))}`).toBeGreaterThanOrEqual(1);
        }
        for (const match of matches) {
          if (probe === 'newline') {
            const lines = NEWLINE_LINES[surface.name][index];
            expect(match.innerText, `${site}: innerText ${JSON.stringify(match.innerText)} lost the typed break`).toContain(lines);
            expect(match.lineTops, `${site}: ${match.lineTops} line box(es) — the typed break must start a second line`).toBeGreaterThanOrEqual(2);
            expect(match.whiteSpace, `${site}: white-space`).toBe('pre-line');
          }
          if (probe === 'long') {
            expect(
              match.scrollWidth,
              `${site}: scrollWidth ${match.scrollWidth} vs clientWidth ${match.clientWidth} — the unbroken string overflows its box`,
            ).toBeLessThanOrEqual(match.clientWidth + 1);
            expect(match.right, `${site}: right edge ${match.right} past the ${measured.innerWidth}px viewport`).toBeLessThanOrEqual(
              measured.innerWidth + 1,
            );
            expect(match.overflowWrap, `${site}: overflow-wrap`).toBe('anywhere');
          }
          if (probe === 'whitespace') {
            expect(match.whiteSpace, `${site}: white-space`).toBe('pre-line');
            expect(match.right, `${site}: right edge ${match.right} past the ${measured.innerWidth}px viewport`).toBeLessThanOrEqual(
              measured.innerWidth + 1,
            );
          }
        }
      });
      if (probe !== 'newline') {
        expect(
          measured.docScrollWidth,
          `the document scrolls sideways: scrollWidth ${measured.docScrollWidth} at a ${measured.innerWidth}px viewport`,
        ).toBeLessThanOrEqual(measured.innerWidth);
      }

      await expectNoWritesThenUnroute(page, hold);
    });
  }
}

// Phase 88.6.1-52 (D-25, copy row E5, AC-32): the backwards date range at 375px. It reuses the
// synthetic game view (`newline` probe: one past session, 7 days ago), so the From/To pair below
// filters it out and the empty list must explain itself.
const E5_TEXT = 'To Date must be on or after From Date.';

test('Sessions filter at 375 — a backwards date range explains itself (E5, D-25)', async ({ page }) => {
  hold = await holdWrites(page);
  await openGamePage(page, 'newline');

  await page.getByRole('button', { name: /Show Filters/ }).click();
  const toDate = page.getByLabel('To Date');
  await page.getByLabel('From Date').fill('2026-05-10');
  await toDate.fill('2026-05-01');

  const message = page.getByText(E5_TEXT);
  await expect(message, 'E5 shows under To Date while To is before From').toBeVisible();
  await expect(toDate).toHaveAttribute('aria-invalid', 'true');
  await expect(page.getByText('No sessions match your filters.'), 'the empty list shows beside E5').toBeVisible();

  const geometry = await message.evaluate((el) => ({
    right: el.getBoundingClientRect().right,
    innerWidth: window.innerWidth,
    docScrollWidth: document.documentElement.scrollWidth,
  }));
  expect(geometry.right, `E5's right edge ${geometry.right} past the ${geometry.innerWidth}px viewport`).toBeLessThanOrEqual(
    geometry.innerWidth + 1,
  );
  expect(
    geometry.docScrollWidth,
    `the document scrolls sideways: scrollWidth ${geometry.docScrollWidth} at a ${geometry.innerWidth}px viewport`,
  ).toBeLessThanOrEqual(geometry.innerWidth);

  await toDate.fill('2026-05-20');
  await expect(toDate).toHaveValue('2026-05-20');
  await expect(message, 'E5 clears once the range is the right way round').toHaveCount(0);
  await expect(toDate).not.toHaveAttribute('aria-invalid');

  await expectNoWritesThenUnroute(page, hold);
});
