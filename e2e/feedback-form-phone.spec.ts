import { test, expect, type Locator, type Page } from '@playwright/test';

// Phase 88.6.1-34 — the Report Bug form (FeedbackForm.js, opened from the signed-in footer's
// "Report bug" link) at 375px, in the `phone` project only.
//
// WHAT EACH TEST MEASURES, in a real engine, that jsdom cannot:
//   Test A (task 1) — copy row F1: after an attach the polite attach line reads
//     "Screenshot attached: {name}", stays on ONE line (truncate) and inside the dialog; before
//     the attach the empty region is out of flow (computed position absolute, the D-22
//     srOnlyWhenEmpty house shape).
//
// NOT RUN LOCALLY. The `phone` project depends on the `setup` project, which signs in through
// Auth0 with credentials that are deliberately absent on a developer machine (there is no local
// `.auth` state). CI's `e2e` job runs this file on the phase PR. So the RED run against the
// pre-88.6.1-34 tree was NOT made here: the jsdom pins in src/app/components/FeedbackForm.test.tsx
// carry the red half, and this file is the real-browser proof of the green half.
//
// Every typed value and file name below is a synthetic literal; no environment value is read or
// printed. Selector policy: role, label and text locators plus id SUFFIX attribute selectors
// (React useId ids contain colons), never a Tailwind class; DOM reads go through `evaluate`.

const REPORT_TRIGGER_NAME = 'Report bug or suggest feature';
const DIALOG_NAME = 'Report Bug or Suggest Feature';

// The 8-byte PNG signature. The form's change handler checks only the MIME type and the size.
const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

// A synthetic name well past what fits on one 375px line (84 characters before `.png`).
const LONG_NAME =
  'synthetic-e2e-screenshot-name-that-is-deliberately-much-longer-than-one-phone-line.png';

// Vacuity guard, the shape of `guardResolved` in phone-home-event-discovery.spec.ts, copied
// locally (specs never import from each other). A zero-count locator makes every assertion
// after it vacuous — that is a failure of the LOCATOR or the fixture state, not of the work.
async function guardResolved(locator: Locator, what: string): Promise<void> {
  await expect(
    locator.first(),
    `locator for ${what} resolved no visible element — a zero-count locator makes every assertion after it vacuous; this is a failure of the LOCATOR or the fixture state, not of the 88.6.1-34 work`,
  ).toBeVisible();
  const count = await locator.count();
  expect(
    count,
    `locator for ${what} resolved ${count} elements (expected >= 1) — a failure of the LOCATOR or the fixture state, not of the 88.6.1-34 work`,
  ).toBeGreaterThanOrEqual(1);
}

async function openReportBug(page: Page): Promise<Locator> {
  await page.goto('/');
  const trigger = page.getByRole('button', { name: REPORT_TRIGGER_NAME });
  await guardResolved(
    trigger,
    `the footer's "${REPORT_TRIGGER_NAME}" button (AuthFooter in src/app/components/Footer.js — rendered only for a signed-in visitor, so a missing trigger means the setup project's session did not load)`,
  );
  await trigger.first().click();
  const dialog = page.getByRole('dialog', { name: DIALOG_NAME });
  await expect(dialog, `the "${DIALOG_NAME}" dialog did not open after the footer trigger was pressed`).toBeVisible();
  return dialog;
}

test.describe('Report Bug form at 375px (Phase 88.6.1-34)', () => {
  test.skip(({ isMobile }) => !isMobile, 'phone-tenet geometry — phone project only');

  test("F1 at 375 — the attach line reads 'Screenshot attached: {name}', on one line, inside the dialog", async ({
    page,
  }) => {
    const dialog = await openReportBug(page);
    const region = dialog.locator('[id$="-screenshot-attached"]');
    await expect(region, 'the attach region must be mounted (empty) before any attach').toHaveCount(1);

    // Before any attach: empty, and out of flow (the house srOnlyWhenEmpty shape, D-22).
    await expect(region, 'the attach region must be EMPTY before any attach').toHaveText('');
    const idlePosition = await region.evaluate((el) => getComputedStyle(el).position);
    expect(
      idlePosition,
      `empty attach region computed position is "${idlePosition}" — expected "absolute" (sr-only while empty, so it reserves no layout)`,
    ).toBe('absolute');

    await dialog
      .locator('input[type="file"]')
      .setInputFiles({ name: LONG_NAME, mimeType: 'image/png', buffer: PNG_SIGNATURE });

    await expect(region, 'copy row F1 after the attach, exact text').toHaveText(
      `Screenshot attached: ${LONG_NAME}`,
    );

    const m = await region.evaluate((el) => {
      const cs = getComputedStyle(el);
      const r = el.getBoundingClientRect();
      const dlg = el.closest('[role="dialog"]');
      const d = dlg ? dlg.getBoundingClientRect() : null;
      const fontSize = parseFloat(cs.fontSize);
      const parsedLh = parseFloat(cs.lineHeight);
      const lineHeight = Number.isNaN(parsedLh) ? fontSize * 1.5 : parsedLh;
      return {
        position: cs.position,
        right: r.right,
        height: r.height,
        dialogRight: d ? d.right : Number.NaN,
        lineHeight,
      };
    });
    expect(
      m.position,
      `set attach region computed position is "${m.position}" — expected in flow (visible when set, V-18 kept)`,
    ).not.toBe('absolute');
    expect(
      m.right,
      `attach line right edge ${m.right}px exceeds the dialog's right edge ${m.dialogRight}px (+0.5) — the long name overflowed the dialog at 375px`,
    ).toBeLessThanOrEqual(m.dialogRight + 0.5);
    expect(
      m.height,
      `attach line height ${m.height}px exceeds one line (${m.lineHeight}px + 1) — truncate should hold the long name to a single line`,
    ).toBeLessThanOrEqual(m.lineHeight + 1);
  });
});
