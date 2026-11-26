import { test, expect, type Page } from '@playwright/test';

import { setTextMode } from './support/wordLines';

// The app chrome at large text (Phase 89.6-26, SPEC R4). Two reads the sweep rows cannot make:
//
//   1. O-5 (owner pick O-5 = C, 2026-11-22: "One line between the page links and the settings rows"),
//      signed in. With the phone menu open at 375 x 667, at 100% and at 200% text, the words Invites,
//      Theme and Send feedback start at one x, the three settings rows are one height, and the panel
//      draws exactly one line (one descendant with a top border). At 320 x 568 with 200% text the Send
//      feedback row, the last row, can be scrolled fully into view inside the panel. Then, measured
//      only (no assertion on size): the desktop header's bell and Theme icon at 1400 x 900 with 200%
//      text, where the desktop list is drawn, written to the log for a register row.
//   2. S-9 (register entry "Header (scoped check 3-B, not reproduced)"), signed out. At 800 x 900 with
//      200% text the menu button is drawn (the strip is 25rem, under the 40rem switch); with the menu
//      open, dropping the text to 100% makes the stylesheet hide the button, and the menu and its dim
//      layer close: src/app/Header.js ("an open menu closes when its own button stops being drawn,").
//      The menu state is read from the button's aria-expanded attribute, which stays in the DOM while
//      the button is not drawn, so a hidden button alone can never satisfy it (review M038).
//
// Both run in both projects: each test sets its own viewport. No write: no button that saves is
// pressed. The signed-in test runs in CI only (the stored sign-in exists there).

const PX = 0.5;
const SETTINGS_LABELS = ['Invites', 'Theme', 'Send feedback'] as const;

async function openMenu(page: Page): Promise<void> {
  const button = page.getByRole('button', { name: 'Toggle menu', exact: true });
  await button.waitFor({ state: 'visible', timeout: 15_000 });
  if ((await button.getAttribute('aria-expanded')) !== 'true') await button.click();
  await expect(button).toHaveAttribute('aria-expanded', 'true');
  await expect(page.locator('[data-slot="header-menu-panel"]')).toHaveCSS('opacity', '1');
}

/** The three settings rows' label x and row height, and the panel's top borders, in one read. */
const readMenu = (page: Page) =>
  page.evaluate((labels) => {
    const panel = document.querySelector('[data-slot="header-menu-panel"]') as HTMLElement;
    const rows = labels.map((label) => {
      const walker = document.createTreeWalker(panel, NodeFilter.SHOW_TEXT);
      for (let node = walker.nextNode(); node; node = walker.nextNode()) {
        if ((node.textContent ?? '').trim() !== label) continue;
        const range = document.createRange();
        range.selectNodeContents(node);
        const row = (node.parentElement as HTMLElement).closest('button') as HTMLElement;
        return { label, x: range.getBoundingClientRect().left, height: row.getBoundingClientRect().height };
      }
      return { label, x: NaN, height: NaN };
    });
    const lines = (Array.from(panel.querySelectorAll('*')) as HTMLElement[]).filter((el) => {
      const cs = getComputedStyle(el);
      return parseFloat(cs.borderTopWidth) > 0 && cs.borderTopStyle !== 'none';
    }).length;
    return { rows, lines };
  }, [...SETTINGS_LABELS]);

test.describe('chrome at large text, signed in (89.6-26)', () => {
  test('O-5 (89.6-26): the phone menu draws one line, its settings labels start at one x and its settings rows are one height', async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 667 });
    await page.goto('/');
    for (const mode of ['100', '200'] as const) {
      const at = `375 x 667, ${mode}% text`;
      await setTextMode(page, mode, `O-5 ${at}`);
      await openMenu(page);
      const { rows, lines } = await readMenu(page);
      const summary = rows.map((row) => `${row.label} x ${row.x} h ${row.height}`).join('; ');
      expect(rows.every((row) => Number.isFinite(row.x)), `${at}: a settings row is missing (${summary})`).toBe(true);
      const xs = rows.map((row) => row.x);
      const heights = rows.map((row) => row.height);
      expect(Math.max(...xs) - Math.min(...xs), `${at}: the settings labels do not start at one x (${summary})`).toBeLessThanOrEqual(PX);
      expect(Math.max(...heights) - Math.min(...heights), `${at}: the settings rows are not one height (${summary})`).toBeLessThanOrEqual(PX);
      expect(lines, `${at}: the open menu draws ${lines} lines, not the one between the page links and the settings rows`).toBe(1);
    }

    // 320 x 568 with 200% text: the last row can be scrolled fully into view inside the panel.
    await page.setViewportSize({ width: 320, height: 568 });
    await openMenu(page);
    const last = await page.evaluate(() => {
      const panel = document.querySelector('[data-slot="header-menu-panel"]') as HTMLElement;
      const row = Array.from(panel.querySelectorAll('button')).find((b) => (b.textContent ?? '').includes('Send feedback')) as HTMLElement;
      row.scrollIntoView({ block: 'nearest' });
      const r = row.getBoundingClientRect();
      const p = panel.getBoundingClientRect();
      return { top: r.top, bottom: r.bottom, roomTop: p.top, roomBottom: Math.min(p.bottom, document.documentElement.clientHeight) };
    });
    expect(
      last.bottom <= last.roomBottom + PX && last.top >= last.roomTop - PX,
      `320 x 568, 200% text: the Send feedback row cannot be scrolled into view (row ${last.top} to ${last.bottom}, room ${last.roomTop} to ${last.roomBottom})`,
    ).toBe(true);

    // Measured only: the desktop header's bell and Theme icon at 1400 x 900, 200% text.
    await page.setViewportSize({ width: 1400, height: 900 });
    const desktop = await page.evaluate(() => {
      const nav = document.querySelector('nav[aria-label="Main"]') as HTMLElement;
      const bell = nav.querySelector('button[aria-label="Notifications"]');
      const list = bell?.closest('ul');
      const theme = list ? list.querySelector('li:last-child button') : null;
      const size = (el: Element | null | undefined) => {
        if (!el) return null;
        const b = el.getBoundingClientRect();
        const s = el.querySelector('svg')?.getBoundingClientRect();
        return { box: `${b.width} x ${b.height}`, svg: s ? `${s.width} x ${s.height}` : null };
      };
      return { bell: size(bell), theme: size(theme) };
    });
    expect(desktop.bell, '1400 x 900, 200% text: the desktop bell is not drawn').not.toBeNull();
    // eslint-disable-next-line no-console -- the desktop icon sizes are recorded from the CI log (plan 89.6-26)
    console.log(`O-5 desktop icons 1400x900 200%: bell ${JSON.stringify(desktop.bell)}, theme ${JSON.stringify(desktop.theme)}`);
  });
});

test.describe('chrome at large text, signed out (89.6-26)', () => {
  test.use({ storageState: { cookies: [], origins: [] } });

  test('S-9 (89.6-26): a text-size drop with the menu open closes the menu and the dim layer', async ({ page }) => {
    await page.setViewportSize({ width: 800, height: 900 });
    await page.goto('/');
    await setTextMode(page, '200', 'S-9 800 x 900');
    // includeHidden: a role query skips a button the stylesheet does not draw, and this read must
    // reach it exactly then.
    const button = page.getByRole('button', { name: 'Toggle menu', exact: true, includeHidden: true });
    const dim = page.locator('[data-slot="header-menu-dim"]');
    await openMenu(page);
    await expect(dim, 'S-9: the dim layer is not drawn with the menu open').toHaveCSS('opacity', '1');

    await setTextMode(page, '100', 'S-9 800 x 900');
    // Read from the DOM: the attribute is there whether or not the stylesheet draws the button.
    await expect.poll(() => button.getAttribute('aria-expanded'), { timeout: 2_000, message: 'S-9: the menu stayed open after the text dropped to 100%' }).toBe('false');
    await expect(dim, 'S-9: the dim layer stayed drawn after the text dropped to 100%').toHaveCSS('opacity', '0', { timeout: 2_000 });
    await expect(dim, 'S-9: the dim layer still takes clicks after the text dropped to 100%').toHaveCSS('pointer-events', 'none', { timeout: 2_000 });
  });
});
