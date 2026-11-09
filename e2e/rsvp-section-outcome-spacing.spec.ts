// Phase 88.6.1-38 (Req 8; D-22; W029, WR-301) — the RSVP card's outcome lines at 375px in a real
// browser (the `phone` project).
//
// What this measures:
//   A. while both outcome regions are empty they are visually hidden and out of flow, so the gap
//      between their in-flow neighbours is the stack's own 16px; a visible failure line ("Could
//      not save your response...") has 16px above it AND 16px below it;
//   B. a visible "Note saved" line has 16px above and below, and the failure line it follows has
//      been cleared (empty, out of flow again).
// Before plan 88.6.1-38 the gap BELOW a visible outcome read 0px: the regions sat inside a
// display-contents wrapper, and Tailwind v4's stack rule gives margin-block-end to every child but
// the last, which the wrapper's own children never received (WR-301).
//
// Every measurement sits beside a structural read (the regions are direct children of the stack;
// the trio group carries the stack's 16px margin-bottom), so a broken instrument cannot pass.
//
// It runs in CI only: the phone project needs the `.auth` storage state, which does not exist
// locally. The RED half is the jsdom pins in RsvpSection.statusOnly.test.tsx (the D-22 / W029
// describe), which fail against the wrapper shape.
//
// Intercepts (all in the browser; no RSVP write reaches the backend, so the seeded detail event
// that other specs read is never changed):
//   - the viewer-Yes read injection, e2e/support/viewerRsvp.ts ("export async function injectViewerYesRsvp("):
//     the self-identity read yields the viewer's id and the RSVP list gets one yes row of theirs,
//     so the note field and Save note render. Both reads pass through scrubbedFetch.
//   - POST /api/rsvp is fulfilled in the browser (500 for the failure arm, 200 for the save);
//     any other method falls back.
import { test, expect, type Page, type Locator } from '@playwright/test';
import { ratioAgainstGround } from './support/contrast';
import { injectViewerYesRsvp } from './support/viewerRsvp';

const E2E_GROUP_ID = process.env.E2E_GROUP_ID ?? '1';
const E2E_EVENT_DETAIL_PATH =
  process.env.E2E_EVENT_DETAIL_PATH ?? `/gameDetail?event_id=1&group_id=${E2E_GROUP_ID}`;

const STACK_GAP_PX = 16;
const RESPONSE_FAILURE = 'Could not save your response. Please try again.';
// DECISION Phase 88.9-21 (owner pick E2f2, votes-b4 v11): the ratified short sentence, chosen over the shipped long one — this file reds until plan 88.9-35 changes the setError string.
const NOTE_FAILURE = "Couldn't save. Try again.";
const NOTE_SAVED = 'Note saved';
const RSVP_WRITE_ROUTE = '**/api/rsvp';

// Opens the detail event with the viewer holding a 'yes' answer, and returns the trio group and
// the stack it sits in.
async function openEventWithViewerAnswer(page: Page): Promise<{ group: Locator; stack: Locator }> {
  await injectViewerYesRsvp(page);

  await page.goto(E2E_EVENT_DETAIL_PATH);

  const group = page.getByRole('group', { name: /^RSVP for / });
  await expect(
    group,
    'exactly one RSVP trio on the detail page — scripts/e2e-fixtures.js creates the detail event 3 days in the FUTURE, so a miss is a fixture or route failure, never a skip',
  ).toHaveCount(1);
  await expect(
    page.getByRole('button', { name: 'Save note' }),
    'Save note never appeared — the viewer row is injected by injectViewerYesRsvp (GET /api/users/<one segment> yields the id; GET /api/rsvp/event/<id> appends the row); a miss means that row was never injected',
  ).toBeVisible({ timeout: 15_000 });

  return { group, stack: group.locator('xpath=..') };
}

type Child = { role: string | null; text: string; position: string; top: number; bottom: number };
type Geometry = { groupMarginBottom: string; children: Child[] };

async function measure(stack: Locator): Promise<Geometry> {
  return stack.evaluate((el) => {
    const group = el.querySelector(':scope > [role="group"]');
    const children = Array.from(el.children).map((child) => {
      const rect = child.getBoundingClientRect();
      return {
        role: child.getAttribute('role'),
        text: (child.textContent ?? '').trim(),
        position: getComputedStyle(child).position,
        top: rect.top,
        bottom: rect.bottom,
      };
    });
    return {
      groupMarginBottom: group ? getComputedStyle(group).marginBottom : '(no group child)',
      children,
    };
  });
}

const inFlow = (child: Child) => child.position !== 'absolute';

// The gap above and below the child at `index`, between its in-flow neighbours.
function gapsAround(children: Child[], index: number): { above: number; below: number } {
  const before = children.slice(0, index).filter(inFlow).pop();
  const after = children.slice(index + 1).find(inFlow);
  const self = children[index];
  return {
    above: before ? self.top - before.bottom : Number.NaN,
    below: after ? after.top - self.bottom : Number.NaN,
  };
}

async function routeRsvpWrite(page: Page, status: number, json: unknown): Promise<void> {
  await page.unroute(RSVP_WRITE_ROUTE);
  await page.route(RSVP_WRITE_ROUTE, async (route) => {
    if (route.request().method() !== 'POST') {
      await route.fallback();
      return;
    }
    await route.fulfill({ status, json });
  });
}

function sanity(geometry: Geometry): void {
  expect(
    geometry.groupMarginBottom,
    `the trio group's computed margin-bottom is ${geometry.groupMarginBottom}; 16px means the stack's space-y-4 rule reaches its direct children`,
  ).toBe(`${STACK_GAP_PX}px`);
  const alerts = geometry.children.filter((c) => c.role === 'alert').length;
  const statuses = geometry.children.filter((c) => c.role === 'status').length;
  expect(
    alerts,
    `direct children with role=alert: ${alerts}; the failure region must be a DIRECT child of the stack — if it is not, the wrapper is back`,
  ).toBe(1);
  expect(
    statuses,
    `direct children with role=status: ${statuses}; the note-save region must be a DIRECT child of the stack — if it is not, the wrapper is back`,
  ).toBeGreaterThanOrEqual(1);
}

test.describe('RsvpSection outcome spacing at 375 (Phase 88.6.1-38, W029)', () => {
  test.skip(({ isMobile }) => !isMobile, 'phone-tenet geometry — phone project only');

  test('RsvpSection at 375 — empty regions add no gap; a visible failure line has 16px above and below (W029)', async ({
    page,
  }) => {
    const { group, stack } = await openEventWithViewerAnswer(page);

    const idle = await measure(stack);
    sanity(idle);

    // Idle: every region is empty and out of flow, and its in-flow neighbours sit 16px apart.
    const regionIdx = idle.children
      .map((c, i) => (c.role === 'alert' || c.role === 'status' ? i : -1))
      .filter((i) => i >= 0);
    for (const i of regionIdx) {
      expect(idle.children[i].position, `idle region #${i} is position ${idle.children[i].position}; sr-only (absolute) means it is out of flow`).toBe('absolute');
      expect(idle.children[i].text, `idle region #${i} holds "${idle.children[i].text}"; it must be empty`).toBe('');
    }
    const firstRegion = Math.min(...regionIdx);
    const lastRegion = Math.max(...regionIdx);
    const before = idle.children.slice(0, firstRegion).filter(inFlow).pop();
    const after = idle.children.slice(lastRegion + 1).find(inFlow);
    expect(before && after, 'the regions have an in-flow neighbour on each side').toBeTruthy();
    const idleGap = after!.top - before!.bottom;
    expect(
      Math.abs(idleGap - STACK_GAP_PX),
      `idle gap across the empty regions = ${idleGap}px; the stack's own 16px means an empty region adds nothing`,
    ).toBeLessThanOrEqual(1);

    // Failure arm.
    await routeRsvpWrite(page, 500, { error: 'e2e mock failure' });
    await group.getByRole('button', { pressed: false }).first().click();
    const alert = stack.locator(':scope > [role="alert"]');
    await expect(alert, 'a rejected status write shows the failure line').toHaveText(RESPONSE_FAILURE);

    const failed = await measure(stack);
    sanity(failed);
    const alertIdx = failed.children.findIndex((c) => c.role === 'alert');
    expect(failed.children[alertIdx].position, `the set failure region is position ${failed.children[alertIdx].position}; a visible line must be in flow`).not.toBe('absolute');
    const gaps = gapsAround(failed.children, alertIdx);
    expect(
      Math.abs(gaps.above - STACK_GAP_PX),
      `gap ABOVE the failure line = ${gaps.above}px; 16px is the stack's own spacing`,
    ).toBeLessThanOrEqual(1);
    expect(
      Math.abs(gaps.below - STACK_GAP_PX),
      `gap BELOW the failure line = ${gaps.below}px; it read 0 before plan 88.6.1-38 (WR-301), 16px is the stack's own spacing`,
    ).toBeLessThanOrEqual(1);

    await page.unrouteAll({ behavior: 'ignoreErrors' });
  });

  test("RsvpSection at 375 — 'Note saved' has 16px above and below, and the failure line clears", async ({
    page,
  }) => {
    const { stack } = await openEventWithViewerAnswer(page);
    const save = page.getByRole('button', { name: 'Save note' });
    const alert = stack.locator(':scope > [role="alert"]');

    await routeRsvpWrite(page, 500, { error: 'e2e mock failure' });
    await save.click();
    await expect(alert, 'a rejected note write shows the note failure line').toHaveText(NOTE_FAILURE);

    await routeRsvpWrite(page, 200, { id: 'e2e-viewer-rsvp', status: 'yes', note: null });
    await save.click();
    await expect(
      stack.locator(':scope > [role="status"]').filter({ hasText: NOTE_SAVED }),
      "a successful note write shows 'Note saved' in the stack",
    ).toBeVisible();

    const saved = await measure(stack);
    sanity(saved);
    const savedIdx = saved.children.findIndex((c) => c.role === 'status' && c.text === NOTE_SAVED);
    expect(savedIdx, "the 'Note saved' region is a direct child of the stack").toBeGreaterThanOrEqual(0);
    expect(saved.children[savedIdx].position, `the 'Note saved' region is position ${saved.children[savedIdx].position}; a visible line must be in flow`).not.toBe('absolute');
    const gaps = gapsAround(saved.children, savedIdx);
    expect(
      Math.abs(gaps.above - STACK_GAP_PX),
      `gap ABOVE 'Note saved' = ${gaps.above}px; 16px is the stack's own spacing`,
    ).toBeLessThanOrEqual(1);
    expect(
      Math.abs(gaps.below - STACK_GAP_PX),
      `gap BELOW 'Note saved' = ${gaps.below}px; it read 0 before plan 88.6.1-38 (WR-301), 16px is the stack's own spacing`,
    ).toBeLessThanOrEqual(1);

    const alertChild = saved.children.find((c) => c.role === 'alert')!;
    expect(alertChild.text, `the failure region holds "${alertChild.text}" after the save; success and failure clear each other`).toBe('');
    expect(alertChild.position, `the cleared failure region is position ${alertChild.position}; empty means out of flow (absolute)`).toBe('absolute');

    await page.unrouteAll({ behavior: 'ignoreErrors' });
  });

  test('E2a/E2f2 (88.9): the note outcome renders on the counter row and Save note does not move', async ({ page }) => {
    await openEventWithViewerAnswer(page);
    const save = page.getByRole('button', { name: 'Save note' });
    const counter = page.getByText(/^\d+\/500$/);
    await expect(counter, 'E2a: the note character counter is not visible').toBeVisible();
    const saveBefore = await save.boundingBox();
    const counterBox = await counter.boundingBox();
    expect(saveBefore, 'E2a: Save note has no layout box').not.toBeNull();
    expect(counterBox, 'E2a: the counter has no layout box').not.toBeNull();
    const fmt = (b: { x: number; y: number; width: number; height: number }) =>
      `x=${b.x.toFixed(1)} y=${b.y.toFixed(1)} w=${b.width.toFixed(1)} h=${b.height.toFixed(1)}`;
    const expectSaveStill = async (when: string) => {
      const now = await save.boundingBox();
      expect(now, `E2a: Save note has no layout box ${when}`).not.toBeNull();
      expect(Math.abs(now!.x - saveBefore!.x), `E2a: Save note moved sideways ${when} (${fmt(saveBefore!)} -> ${fmt(now!)})`).toBeLessThanOrEqual(0.5);
      expect(Math.abs(now!.y - saveBefore!.y), `E2a: Save note moved vertically ${when} (${fmt(saveBefore!)} -> ${fmt(now!)})`).toBeLessThanOrEqual(0.5);
    };

    // Failure arm (E2f2): the ratified sentence, on the counter row between the counter and Save note.
    await routeRsvpWrite(page, 500, { error: 'e2e mock failure' });
    await save.click();
    const failure = page.getByText(NOTE_FAILURE, { exact: true }).filter({ visible: true });
    await expect(failure, 'E2f2: exactly one visible note failure line').toHaveCount(1);
    const f = await failure.boundingBox();
    expect(f, 'E2a: the failure line has no layout box').not.toBeNull();
    const fy = f!.y + f!.height / 2;
    const row = `failure ${fmt(f!)}; counter ${fmt(counterBox!)}; Save note ${fmt(saveBefore!)}`;
    expect(fy >= saveBefore!.y && fy <= saveBefore!.y + saveBefore!.height, `E2a: the failure line is not on the counter row (${row})`).toBe(true);
    expect(f!.x, `E2a: the failure line starts left of the counter's right edge (${row})`).toBeGreaterThanOrEqual(counterBox!.x + counterBox!.width);
    expect(f!.x + f!.width, `E2a: the failure line runs past Save note's left edge (${row})`).toBeLessThanOrEqual(saveBefore!.x);
    const ink = await ratioAgainstGround(failure, 'E2f2 failure line');
    expect(ink.ratio, `E2f2 failure line: ${ink.ratio.toFixed(3)}:1 (ink ${ink.fg} on ${ink.ground}), floor 4.5:1`).toBeGreaterThanOrEqual(4.5);
    await expectSaveStill('after the failure');

    // Success arm: a 16px check and Note saved in the same slot; the failure line clears.
    await routeRsvpWrite(page, 200, { id: 'e2e-viewer-rsvp', status: 'yes', note: null });
    await save.click();
    const saved = page.getByText(NOTE_SAVED, { exact: true }).filter({ visible: true });
    await expect(saved, 'E2a: exactly one visible Note saved').toHaveCount(1);
    const s = await saved.boundingBox();
    expect(s, 'E2a: Note saved has no layout box').not.toBeNull();
    const sy = s!.y + s!.height / 2;
    expect(sy >= saveBefore!.y && sy <= saveBefore!.y + saveBefore!.height, `E2a: Note saved is not on the counter row (saved ${fmt(s!)}; Save note ${fmt(saveBefore!)})`).toBe(true);
    const check = saved.locator('xpath=..').locator('svg').first();
    const k = await check.boundingBox();
    expect(k, 'E2a: no check icon beside Note saved').not.toBeNull();
    expect(Math.abs(k!.width - 16), `E2a: the check is not 16px wide (${fmt(k!)})`).toBeLessThanOrEqual(0.5);
    expect(Math.abs(k!.height - 16), `E2a: the check is not 16px tall (${fmt(k!)})`).toBeLessThanOrEqual(0.5);
    expect(k!.x + k!.width, `E2a: the check is not before the text (check ${fmt(k!)}; text ${fmt(s!)})`).toBeLessThanOrEqual(s!.x + 1);
    await expectSaveStill('after the save');
    await expect(page.getByText(NOTE_FAILURE, { exact: true }).filter({ visible: true }), 'E2a: the failure line is still visible after the save').toHaveCount(0);

    await page.unrouteAll({ behavior: 'ignoreErrors' });
  });
});
