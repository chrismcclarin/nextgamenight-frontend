// Surface rows: the not-found page (R17, enforced by plan 89.6-08 as the sweep's tracer) and the
// link-only and document pages plan 89.6-23 turns on. One row per line, each with its census id.
// How a row is turned on: e2e/support/largeTextSurfaces/index.ts ("HOW A SWEEP PLAN TURNS A ROW ON").
import type { Page } from '@playwright/test';

import { THIRTY_LETTER_WORD } from '../wordLines';
import type { SurfaceRow } from './index';

// R17 is any URL with no route (src/app/not-found.tsx). The root is the page's main: the header
// strip and the footer around it are rows of their own (the chrome module).
const reachNotFound: SurfaceRow['reach'] = async (page) => {
  await page.goto('/large-text-sweep-no-such-page');
  await page.getByRole('heading', { level: 1, name: 'This page took a wrong turn' }).waitFor({ state: 'visible' });
  return { root: page.locator('main') };
};

// Link rows are swept SIGNED OUT, because a person opens these pages from a text or an email: each
// reach clears the context's cookies (the sweep's journeys project carries the stored sign-in)
// before it navigates.
const signedOut = async (page: Page): Promise<void> => {
  await page.context().clearCookies();
};

// R14: the RSVP link (src/app/rsvp/[token]/page.js). The page sends GET /rsvp/respond on load,
// which records the answer and spends the token (src/lib/api.ts ("respondViaToken: async (token")),
// so it is a writing GET: answered in the browser here, never sent on. The ids are placeholders;
// the answer is the backend's success body (backend:Sonnet/routes/rsvp.js ("success: true,")) with
// the longest game name a link can carry.
const RSVP_PATH = '/rsvp/large-text-sweep-token?e=large-text-sweep-event&u=large-text-sweep-user&s=yes';
const isRsvpRespond = (url: URL): boolean => url.pathname.endsWith('/rsvp/respond');
const rsvpAnswers: SurfaceRow['answers'] = (url) =>
  isRsvpRespond(url)
    ? {
        success: true,
        status: 'yes',
        event_name: THIRTY_LETTER_WORD,
        event_date: 'Wednesday, September 30, 2026',
        group_id: 'large-text-sweep-group',
        group_name: THIRTY_LETTER_WORD,
      }
    : undefined;
const reachRsvp: SurfaceRow['reach'] = async (page) => {
  await signedOut(page);
  await page.goto(RSVP_PATH);
  await page.getByRole('heading', { level: 1, name: "You're in!" }).waitFor({ state: 'visible', timeout: 15_000 });
  return { root: page.locator('main') };
};

// R14-used: the same link a second time. The backend answers 403 with the expired_link body
// (backend:Sonnet/routes/rsvp.js ("error: 'expired_link',")), which the page maps to its used-link
// card at src/app/rsvp/[token]/page.js ("} else if (result.error === 'expired_link') {"). answers
// always replies 200, so this state registers its own route, after the guard and before the
// navigation (the newest matching route runs first and wins over the guard's).
const routedUsed = new WeakSet<Page>();
const reachRsvpUsed: SurfaceRow['reach'] = async (page) => {
  if (!routedUsed.has(page)) {
    routedUsed.add(page);
    await page.route(isRsvpRespond, async (route) => {
      if (route.request().method() !== 'GET') {
        await route.fallback();
        return;
      }
      await route.fulfill({
        status: 403,
        json: { error: 'expired_link', message: 'This RSVP link has expired or was already used. Open the event to RSVP.' },
      });
    });
  }
  await signedOut(page);
  await page.goto(RSVP_PATH);
  await page.getByRole('heading', { level: 1, name: 'This link has already been used' }).waitFor({ state: 'visible', timeout: 15_000 });
  return { root: page.locator('main') };
};

export const rows: SurfaceRow[] = [
  { id: 'R17', census: 'R17', kind: 'route', owner: '89.6-08', status: 'enforced', reach: reachNotFound },
  { id: 'R02', census: 'R02', kind: 'route', owner: '89.6-23', status: 'pending' },
  { id: 'R03', census: 'R03', kind: 'route', owner: '89.6-23', status: 'pending' },
  { id: 'R06', census: 'R06', kind: 'route', owner: '89.6-23', status: 'pending' },
  { id: 'R09', census: 'R09', kind: 'route', owner: '89.6-23', status: 'pending' },
  { id: 'R10', census: 'R10', kind: 'route', owner: '89.6-23', status: 'pending' },
  { id: 'R11', census: 'R11', kind: 'route', owner: '89.6-23', status: 'pending' },
  { id: 'R12', census: 'R12', kind: 'route', owner: '89.6-23', status: 'pending' },
  { id: 'R13', census: 'R13', kind: 'route', owner: '89.6-23', status: 'pending' },
  { id: 'R14', census: 'R14', kind: 'route', owner: '89.6-23', status: 'enforced', state: 'recorded yes', reach: reachRsvp, answers: rsvpAnswers },
  { id: 'R14-used', census: 'R14', kind: 'route', owner: '89.6-23', status: 'enforced', state: 'used link', reach: reachRsvpUsed },
  { id: 'R15', census: 'R15', kind: 'route', owner: '89.6-23', status: 'pending' },
  { id: 'D35', census: 'D35', kind: 'dialog', owner: '89.6-23', status: 'pending' },
];
