// Surface rows: the not-found page (R17, enforced by plan 89.6-08 as the sweep's tracer) and the
// link-only and document pages plan 89.6-23 turns on. One row per line, each with its census id.
// How a row is turned on: e2e/support/largeTextSurfaces/index.ts ("HOW A SWEEP PLAN TURNS A ROW ON").
import { test, type Page } from '@playwright/test';

import { compositeGround, contrastRatio, probeElement, ratioAgainstGround } from '../contrast';
import { settleAnimations } from '../inFlight';
import { EMOJI_NAME, THIRTY_LETTER_WORD } from '../wordLines';
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

// The invite and restore links. Each page reads one public preview of its token on load:
// /invites/info/ at src/lib/api.ts ("getInviteInfo: (token: string) =>"),
// /events/invite-preview/ at src/lib/api.ts ("getEventInvitePreview: (token: string) =>"),
// /groups/invite-preview/ at src/lib/api.ts ("getInvitePreview: (token: string) =>") and
// /groups/restore-preview/ at src/lib/api.ts ("getRestorePreview: (token: string) =>"). None of
// the four writes (the row-list test's scan of the backend names every writing GET), but each is
// answered in the browser anyway: the answer carries the longest names a link page can show, and
// nothing reaches the backend.
const LINK_TOKEN = 'large-text-sweep-token';
const TWO_SENTENCE_DESCRIPTION = 'We meet every other Friday for heavy euro games and a long dinner. Bring a snack and your favourite strategy.';
const answerByPath =
  (part: string, body: unknown): SurfaceRow['answers'] =>
  (url) =>
    url.pathname.includes(part) ? body : undefined;

// R09: the email invite, signed out ("You're invited!").
const inviteInfoAnswers = answerByPath('/invites/info/', { inviter_name: EMOJI_NAME, group_name: THIRTY_LETTER_WORD, member_count: 12 });
const reachInviteAccept: SurfaceRow['reach'] = async (page) => {
  await signedOut(page);
  await page.goto(`/invite/accept?token=${LINK_TOKEN}`);
  await page.getByRole('heading', { level: 1, name: "You're invited!" }).waitFor({ state: 'visible', timeout: 15_000 });
  await page.getByText(THIRTY_LETTER_WORD, { exact: false }).first().waitFor({ state: 'visible' });
  return { root: page.locator('main') };
};

// R10: the game-night invite, signed out (the preview).
const gameInviteAnswers = answerByPath('/events/invite-preview/', { game_name: THIRTY_LETTER_WORD, event_date: '2030-09-25T19:30:00Z' });
const reachGameInvite: SurfaceRow['reach'] = async (page) => {
  await signedOut(page);
  await page.goto(`/invite/game/${LINK_TOKEN}`);
  await page.getByRole('heading', { level: 1, name: THIRTY_LETTER_WORD }).waitFor({ state: 'visible', timeout: 15_000 });
  return { root: page.locator('main') };
};

// R11: the group invite, signed out (the preview, with an owner-written description).
const isGroupInvitePreview = (url: URL): boolean => url.pathname.includes('/groups/invite-preview/');
const groupInviteAnswers = answerByPath('/groups/invite-preview/', {
  group_id: 'large-text-sweep-group',
  group_name: THIRTY_LETTER_WORD,
  group_description: TWO_SENTENCE_DESCRIPTION,
  member_count: 12,
});
const reachGroupInvite: SurfaceRow['reach'] = async (page) => {
  await signedOut(page);
  await page.goto(`/invite/group/${LINK_TOKEN}`);
  await page.getByRole('heading', { level: 1, name: THIRTY_LETTER_WORD }).waitFor({ state: 'visible', timeout: 15_000 });
  return { root: page.locator('main') };
};

// R11-preview-failed: the preview read fails with a status other than 404, so the page takes its
// non-404 arm (src/app/invite/group/[token]/page.js ("setPreviewFailed(err?.status === 404 ? 'not_found' : 'other');"))
// and shows the amber card with Try again above a secondary Go Home. A 500 needs its own route
// (answers always replies 200), registered after the guard and before the navigation.
const routedPreviewFailed = new WeakSet<Page>();
const reachGroupInviteFailed: SurfaceRow['reach'] = async (page) => {
  if (!routedPreviewFailed.has(page)) {
    routedPreviewFailed.add(page);
    await page.route(isGroupInvitePreview, async (route) => {
      if (route.request().method() !== 'GET') {
        await route.fallback();
        return;
      }
      await route.fulfill({ status: 500, json: { error: 'large-text sweep: the invite preview failed' } });
    });
  }
  await signedOut(page);
  await page.goto(`/invite/group/${LINK_TOKEN}`);
  await page.getByRole('heading', { level: 1, name: "Couldn't load this invite" }).waitFor({ state: 'visible', timeout: 15_000 });
  return { root: page.locator('main') };
};

// FL-10 (register FL-10, owner N36 "Fine"): in the one light cell of the lane, Go Home on the
// preview-failed card is hovered and three ratios are measured, the label against the hovered fill
// (text, 4.5:1 floor) and the fill against the card around it at rest and on hover (recorded, see
// the plan 89.6-23 SUMMARY for the reading of WCAG 1.4.11). The values are attached before the
// assert, so a red run prints them. The hover is moved off before returning, so later cells read
// the button at rest.
const goHomeContrast: SurfaceRow['extras'] = async (page, cell) => {
  if (cell.theme !== 'light') return;
  const goHome = page.getByRole('link', { name: 'Go Home', exact: true });
  // The fill is the button's own composited ground; the card around it is its parent's (the
  // button's own fill is opaque, so its own walk stops there and cannot see past it).
  const fillAndAround = async (): Promise<{ fill: string; around: string; ratio: number }> => {
    const fill = compositeGround(await probeElement(goHome, ['background-color']), 0);
    const around = compositeGround(await probeElement(goHome.locator('xpath=..'), ['background-color']), 0);
    if (fill === null || around === null) throw new Error('FL-10: no opaque ground behind Go Home');
    return { fill, around, ratio: contrastRatio(fill, around) ?? Number.NaN };
  };
  const atRest = await fillAndAround();
  await goHome.hover();
  await settleAnimations(goHome);
  const label = await ratioAgainstGround(goHome, 'FL-10 Go Home label, hovered');
  const hovered = await fillAndAround();
  await page.mouse.move(0, 0);
  await settleAnimations(goHome);
  const record = {
    cell: cell.id,
    label: label.fg,
    fill: label.ground,
    ratio: Number(label.ratio.toFixed(2)),
    fillAgainstCardAtRest: { fill: atRest.fill, card: atRest.around, ratio: Number(atRest.ratio.toFixed(2)) },
    fillAgainstCardHovered: { fill: hovered.fill, card: hovered.around, ratio: Number(hovered.ratio.toFixed(2)) },
  };
  await test.info().attach('FL-10-go-home-hover', { body: JSON.stringify(record, null, 2), contentType: 'application/json' });
  if (!(label.ratio >= 4.5)) throw new Error(`FL-10: the hovered Go Home label is ${record.ratio}:1 on its fill (label ${record.label}, fill ${record.fill}), under 4.5:1`);
};

// R13: the restore link, signed out ("Sign in to bring it back").
const restoreAnswers = answerByPath('/groups/restore-preview/', { group_name: THIRTY_LETTER_WORD, purge_after: '2030-09-30T12:00:00Z' });
const reachRestore: SurfaceRow['reach'] = async (page) => {
  await signedOut(page);
  await page.goto(`/restore/group/${LINK_TOKEN}`);
  await page.getByRole('link', { name: 'Sign in to bring it back' }).waitFor({ state: 'visible', timeout: 15_000 });
  return { root: page.locator('main') };
};

// R03: the availability link (src/app/availability-form/[token]/page.js), ready state. The page
// validates its token with a POST on load (src/lib/api.ts ("validateToken: async (token: string, formLoadedAt = null) =>")):
// the guard holds every non-GET and a held /api request fails the test, so the POST is answered
// here by its own route (registered after the guard, so it runs first), never sent on. The body is
// the backend's success shape (backend:Sonnet/routes/magicAuth.js ("// Success response with info needed by frontend")),
// with saved availability on (so "Use my saved availability" is pressable), Google off (so Import
// is absent), an expiry 30 minutes out (so the expiry warning shows), the emoji name as the person
// and the 30-letter word as the game. The backend sends no game today (found-new, plan 89.6-23
// SUMMARY), so a real link reads "Game TBD"; the name is answered so the longest text is read.
// The existing-response read is answered with null (no earlier answer).
const isMagicValidate = (url: URL): boolean => url.pathname.endsWith('/magic-auth/validate');
const routedValidate = new WeakSet<Page>();
const routeMagicValidate = async (page: Page): Promise<void> => {
  if (routedValidate.has(page)) return;
  routedValidate.add(page);
  await page.route(isMagicValidate, async (route) => {
    if (route.request().method() !== 'POST') {
      await route.fallback();
      return;
    }
    await route.fulfill({
      status: 200,
      json: {
        valid: true,
        user: { name: EMOJI_NAME, timezone: 'America/Los_Angeles' },
        prompt_id: 'large-text-sweep-prompt',
        expiresAt: new Date(Date.now() + 30 * 60 * 1000).toISOString(),
        graceUsed: false,
        gcal_connected: false,
        has_saved_availability: true,
        window_start: new Date().toISOString().slice(0, 10),
        game: { name: THIRTY_LETTER_WORD },
      },
    });
  });
};
// Exported for plan 89.6-20's R03-grid row, which reuses R03's reach and answers by import.
export const availabilityAnswers: SurfaceRow['answers'] = (url) => (url.pathname.includes('/availability-responses/') ? null : undefined);
const openAvailabilityForm = async (page: Page): Promise<void> => {
  await routeMagicValidate(page);
  await signedOut(page);
  await page.goto(`/availability-form/${LINK_TOKEN}`);
  await page.getByRole('heading', { level: 1, name: 'Submit Your Availability' }).waitFor({ state: 'visible', timeout: 15_000 });
  await page.getByRole('button', { name: 'Use my saved availability' }).waitFor({ state: 'visible' });
};
export const reachAvailability: SurfaceRow['reach'] = async (page) => {
  await openAvailabilityForm(page);
  return { root: page.locator('main') };
};

// D35: "Replace your current selections?", opened by painting one slot and pressing "Use my saved
// availability" (src/app/components/AvailabilityForm.js ("title: 'Replace your current selections?',")).
// The dialog is its own root (a portal outside main). Nothing in it is pressed: Replace would send
// the saved-availability read, and Cancel would close it.
const reachReplaceDialog: SurfaceRow['reach'] = async (page) => {
  await openAvailabilityForm(page);
  await page.locator('[data-slot-id]').first().click();
  await page.getByRole('button', { name: 'Use my saved availability' }).click();
  const dialog = page.getByRole('dialog', { name: 'Replace your current selections?' });
  await dialog.waitFor({ state: 'visible', timeout: 15_000 });
  return { root: dialog, dialog };
};

// The static pages, opened signed out from the footer or after signing out. None reads anything
// that needs an answer.
const reachStatic =
  (path: string, heading: string): SurfaceRow['reach'] =>
  async (page) => {
    await signedOut(page);
    await page.goto(path);
    await page.getByRole('heading', { level: 1, name: heading }).waitFor({ state: 'visible', timeout: 15_000 });
    return { root: page.locator('main') };
  };
const reachAbout = reachStatic('/about', 'About Next Game Night');
// R06 has two copies: the default goodbye and the one after an account is deleted
// (src/app/goodbye/page.tsx ("const ACCOUNT_DELETED = 'account_deleted';")).
const reachGoodbye = reachStatic('/goodbye', 'Your account has been deleted');
const reachGoodbyeDeleted = reachStatic('/goodbye?reason=account_deleted', 'This account has been deleted');
// R12 is reached at /Privacy, the Footer's path (the capital P is required for Google auth; never
// lower-case the link). next.config.js rewrites it to /privacy, the same page.
const reachPrivacy = reachStatic('/Privacy', 'Privacy Policy');
const reachTerms = reachStatic('/terms', 'Terms of Service');

export const rows: SurfaceRow[] = [
  { id: 'R17', census: 'R17', kind: 'route', owner: '89.6-08', status: 'enforced', reach: reachNotFound },
  { id: 'R02', census: 'R02', kind: 'route', owner: '89.6-23', status: 'enforced', reach: reachAbout },
  { id: 'R03', census: 'R03', kind: 'route', owner: '89.6-23', status: 'enforced', state: 'ready', reach: reachAvailability, answers: availabilityAnswers },
  { id: 'R06', census: 'R06', kind: 'route', owner: '89.6-23', status: 'enforced', state: 'default', reach: reachGoodbye },
  { id: 'R06-deleted', census: 'R06', kind: 'route', owner: '89.6-23', status: 'enforced', state: 'account deleted', reach: reachGoodbyeDeleted },
  { id: 'R09', census: 'R09', kind: 'route', owner: '89.6-23', status: 'enforced', state: 'signed out', reach: reachInviteAccept, answers: inviteInfoAnswers },
  { id: 'R10', census: 'R10', kind: 'route', owner: '89.6-23', status: 'enforced', state: 'signed-out preview', reach: reachGameInvite, answers: gameInviteAnswers },
  { id: 'R11', census: 'R11', kind: 'route', owner: '89.6-23', status: 'enforced', state: 'signed-out preview', reach: reachGroupInvite, answers: groupInviteAnswers },
  { id: 'R11-preview-failed', census: 'R11', kind: 'route', owner: '89.6-23', status: 'enforced', state: 'preview failed', reach: reachGroupInviteFailed, extras: goHomeContrast },
  { id: 'R12', census: 'R12', kind: 'route', owner: '89.6-23', status: 'enforced', reach: reachPrivacy },
  { id: 'R13', census: 'R13', kind: 'route', owner: '89.6-23', status: 'enforced', state: 'signed out', reach: reachRestore, answers: restoreAnswers },
  { id: 'R14', census: 'R14', kind: 'route', owner: '89.6-23', status: 'enforced', state: 'recorded yes', reach: reachRsvp, answers: rsvpAnswers },
  { id: 'R14-used', census: 'R14', kind: 'route', owner: '89.6-23', status: 'enforced', state: 'used link', reach: reachRsvpUsed },
  { id: 'R15', census: 'R15', kind: 'route', owner: '89.6-23', status: 'enforced', reach: reachTerms },
  { id: 'D35', census: 'D35', kind: 'dialog', owner: '89.6-23', status: 'enforced', reach: reachReplaceDialog, answers: availabilityAnswers },
];
