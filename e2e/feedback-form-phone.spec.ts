import { test, expect, type Locator, type Page } from '@playwright/test';

// Phase 88.6.1-34 — the Report Bug form (FeedbackForm.js, opened from the signed-in footer's
// "Report bug" link) at 375px, in the `phone` project only.
//
// WHAT EACH TEST MEASURES, in a real engine, that jsdom cannot:
//   Test A (task 1) — copy row F1: after an attach the polite attach line reads
//     "Screenshot attached: {name}", stays on ONE line (truncate) and inside the dialog; before
//     the attach the empty region is out of flow (computed position absolute, the D-22
//     srOnlyWhenEmpty house shape).
//   Test B (task 2) — the idle form: the gap from the screenshot block to the button row equals
//     the form's own space-y-4 gap (read in the same run as the description-to-screenshot gap),
//     so the empty error region and gate line no longer leave a band; the file input is named
//     "Screenshot (optional) …" and Subject is named without its star; a POSITIVE CONTROL (a
//     rejected file's line, in flow, 4px below the drop zone) makes the idle reading non-vacuous.
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

  test("idle form at 375 — no band under the screenshot block; the field is named 'Screenshot (optional)'; the stars are silent; a rejected file's line sits 4px below the drop zone", async ({
    page,
  }) => {
    const dialog = await openReportBug(page);
    const submit = dialog.getByRole('button', { name: /^Submit$/ });
    await guardResolved(submit, 'the Report Bug form Submit button');

    // The gate must settle first, or the form is not idle.
    await expect(
      submit,
      'Submit still aria-disabled — the self row never settled, so the form is not idle',
    ).not.toHaveAttribute('aria-disabled', 'true');
    await expect(
      dialog.locator('[id$="-submit-status"]'),
      "FIXTURE failure, not a product failure: the gate line is not empty, so the e2e account's self row does not carry a real address (the reply-to line is shown) and the form is not idle",
    ).toHaveText('');

    // Names in a real browser (MEDLOW-32 and the silent stars, AC-33 clause 2).
    await expect(
      dialog.getByLabel(/^Screenshot \(optional\)/),
      'the file input must be named starting "Screenshot (optional)" (aria-labelledby: section label, then drop zone)',
    ).toHaveAttribute('type', 'file');
    await expect(
      dialog.getByRole('textbox', { name: 'Subject', exact: true }),
      'the Subject input must be named exactly "Subject" — the required star is aria-hidden',
    ).toBeVisible();

    // Idle geometry, one read: blocks are the form's direct div children found from inside.
    const idle = await submit.evaluate((btn) => {
      const form = btn.closest('form');
      if (!form) return null;
      const textarea = form.querySelector('textarea');
      const input = form.querySelector('input[type="file"]');
      const descBlock = textarea?.closest('form > div');
      const shotBlock = input?.closest('form > div');
      const btnRow = btn.closest('form > div');
      if (!descBlock || !shotBlock || !btnRow) return null;
      const d = descBlock.getBoundingClientRect();
      const s = shotBlock.getBoundingClientRect();
      const b = btnRow.getBoundingClientRect();
      return { cal: s.top - d.bottom, idle: b.top - s.bottom };
    });
    expect(idle, 'idle geometry read failed — the description, screenshot or button block was not found').not.toBeNull();
    if (!idle) return;
    expect(
      Math.abs(idle.cal - 16),
      `description-to-screenshot gap is ${idle.cal}px — expected the form's space-y-4 gap of 16px (+-1); this calibrates the next read`,
    ).toBeLessThanOrEqual(1);
    expect(
      Math.abs(idle.idle - idle.cal),
      `screenshot-to-buttons gap is ${idle.idle}px against the ${idle.cal}px stack gap — before plan 88.6.1-34 the empty error region's margin and the gate line's reserved line read larger (estimate about +32px); this is the first browser measurement`,
    ).toBeLessThanOrEqual(1);

    // Positive control: a rejected file's line IS in flow, 4px below the drop zone, inside the block.
    await dialog.locator('input[type="file"]').setInputFiles({
      name: 'too-big.png',
      mimeType: 'image/png',
      buffer: Buffer.alloc(2 * 1024 * 1024 + 1),
    });
    const errorRegion = dialog.locator('[id$="-screenshot-error"]');
    await expect(errorRegion, 'the over-size rejection line must appear').toHaveText(/too large/i);

    const ctl = await submit.evaluate((btn) => {
      const form = btn.closest('form');
      if (!form) return null;
      const input = form.querySelector('input[type="file"]');
      const err = form.querySelector('[id$="-screenshot-error"]');
      if (!(input instanceof HTMLInputElement) || !err) return null;
      const drop = form.querySelector('label[for="' + CSS.escape(input.id) + '"]');
      const shotBlock = input.closest('form > div');
      const btnRow = btn.closest('form > div');
      if (!drop || !shotBlock || !btnRow) return null;
      return {
        position: getComputedStyle(err).position,
        offset: err.getBoundingClientRect().top - drop.getBoundingClientRect().bottom,
        gap: btnRow.getBoundingClientRect().top - shotBlock.getBoundingClientRect().bottom,
      };
    });
    expect(ctl, 'positive-control read failed — the input, drop zone, error region or blocks were not found').not.toBeNull();
    if (!ctl) return;
    expect(
      ctl.position,
      `rejection line computed position is "${ctl.position}" — expected in flow when set (srOnlyWhenEmpty hides only an EMPTY region)`,
    ).not.toBe('absolute');
    expect(
      Math.abs(ctl.offset - 4),
      `rejection line sits ${ctl.offset}px below the drop zone — expected 4px (mt-1, +-1)`,
    ).toBeLessThanOrEqual(1);
    expect(
      Math.abs(ctl.gap - idle.cal),
      `with the rejection line shown the screenshot-to-buttons gap is ${ctl.gap}px against the ${idle.cal}px stack gap — the line must grow the screenshot block, not add a band below it`,
    ).toBeLessThanOrEqual(1);
  });
});
