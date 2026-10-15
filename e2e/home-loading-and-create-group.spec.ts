import { test, expect, type Route } from '@playwright/test';

// Phase 88.6.1 plan 15 — two Home changes, proven at the phone project's 375 x 667.
//
// (D-35) Create Group while the request is in flight. The submit is the control the person just
// pressed, so its in-flight gate is `aria-disabled` plus a synchronous ref latch, never the
// native `disabled` attribute (a natively disabled button leaves the focus order). The jsdom
// suite (`src/app/components/createGroup.test.tsx`, arms G1-G4) proves the attributes and the
// request count; jsdom never blurs a disabled element, so THIS spec is where "focus stays on the
// pressed button" is proven in a real browser (C-11 in .planning/codebase/FE-TESTING-CONVENTIONS.md).
//
// CI ONLY. The phone and journeys projects need the `.auth/user.json` login state, which exists
// only in CI (C-14). It was not run locally.
//
// NO GROUP IS CREATED. The create POST is held by the route below and then ABORTED, so nothing
// reaches the backend; the group name is a throwaway that is never written.

// The browser calls the same-origin BFF (`BFF_BASE` is `/api` in src/lib/api.ts), so a create is
// `POST /api/groups`. Only that exact pathname and method is held; everything else continues.
const isCreateGroupPath = (url: URL) => url.pathname === '/api/groups';

test.describe('Home — create group while the request is in flight (D-35)', () => {
  test('create group while the request is in flight: the pressed button stays focused, aria-disabled, and sends one POST', async ({
    page,
  }) => {
    let postCount = 0;
    const held: Route[] = [];
    let markSeen: () => void = () => {};
    const firstPostSeen = new Promise<void>((resolve) => {
      markSeen = resolve;
    });
    await page.route(isCreateGroupPath, async (route) => {
      if (route.request().method() !== 'POST') {
        await route.continue();
        return;
      }
      postCount += 1;
      held.push(route);
      markSeen();
    });

    await page.goto('/');
    await page.getByRole('button', { name: /create new group/i }).click();
    const dialog = page.getByRole('dialog');
    await dialog.getByRole('textbox', { name: 'Group Name' }).fill(`E2E held ${Date.now()}`);
    await dialog.getByRole('button', { name: /^create group$/i }).click();
    await firstPostSeen;

    // In flight: gated by aria-disabled, never the native attribute, and still focused.
    const busy = dialog.getByRole('button', { name: /^creating/i });
    await expect(busy).toHaveAttribute('aria-disabled', 'true');
    await expect(busy).not.toHaveAttribute('disabled');
    await expect(busy).toBeFocused();

    // Phone floor and width: at least 44px tall, inside the 375px viewport.
    const box = await busy.boundingBox();
    expect(box, 'the busy Create Group button has no layout box').not.toBeNull();
    const viewport = page.viewportSize();
    expect(viewport, 'no viewport size').not.toBeNull();
    expect(box!.height).toBeGreaterThanOrEqual(44);
    expect(box!.x).toBeGreaterThanOrEqual(0);
    expect(box!.x + box!.width).toBeLessThanOrEqual(viewport!.width);

    // A second press (a forced click — Playwright's own actionability check treats an
    // aria-disabled control as not enabled — and an Enter on the focused button) sends nothing.
    await busy.click({ force: true });
    await page.keyboard.press('Enter');
    // A negative needs a settle window: long enough for a second fetch to reach the route.
    await page.waitForTimeout(500);
    expect(postCount).toBe(1);

    // Abort the held request: the failure shows inside the still-open dialog, and the person is
    // left where they pressed — on the re-enabled Create Group button.
    await held[0].abort();
    const alert = dialog.getByRole('alert');
    await expect(alert).toBeVisible();
    await expect(alert).toHaveText(/\S/);
    const idle = dialog.getByRole('button', { name: /^create group$/i });
    await expect(idle).toBeFocused();
    await expect(idle).not.toHaveAttribute('aria-disabled');
    expect(postCount).toBe(1);
  });
});
