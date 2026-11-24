// TEMPORARY, removed in the next commit (Phase 89.6-11, CI-07b; CONTEXT D-07 removal-rule exception).
// A ONE-TIME capture of the Pending Members queue (census D14) at 320 x 568 with 200% text. The
// queue is owned by a written removal (Phase 91.1), so it has no sweep row and is never fixed in
// Phase 89.6; this records once whether it can be read and pressed. It asserts only that the queue
// rendered and that nothing was written. Nothing in the queue is pressed.
// It sets its own viewport and uses click(), never tap(), so it runs in both CI projects; the phone
// project's read is the one judged. The pending member is SYNTHETIC: a row in the browser's answer.
import { writeFileSync } from 'node:fs';

import { expect, test } from '@playwright/test';

import { expectNoApiWrites, holdWrites, settleAnimations } from './support/inFlight';
import { routeMemberRoster } from './support/memberRoster';
import { readLargeTextCell } from './support/wordLines';

const E2E_GROUP_ID = process.env.E2E_GROUP_ID ?? '';
const PENDING = {
  id: '00000000-0000-4000-8000-0000000000d4',
  user_id: 'auth0|e2e-synthetic-pending',
  username: 'E2E Pending',
  email: null,
  UserGroup: { role: 'pending' },
};

test.afterEach(async ({ page }) => {
  await page.unrouteAll({ behavior: 'ignoreErrors' });
});

test('D14 capture (89.6-11, CI-07b): the Pending Members queue at 320 x 568 with 200% text, read once, nothing pressed', async ({ page }, testInfo) => {
  expect(E2E_GROUP_ID, 'E2E_GROUP_ID must be set: the CI step that runs scripts/e2e-fixtures.js exports it').toBeTruthy();
  const hold = await holdWrites(page);
  await routeMemberRoster(page, E2E_GROUP_ID, (rows) => [...rows, PENDING]);
  await page.setViewportSize({ width: 320, height: 568 });
  await page.goto(`/groupHomePage?id=${E2E_GROUP_ID}`);
  const manage = page.getByRole('button', { name: 'Manage Members' });
  await expect(manage).toBeVisible({ timeout: 15_000 });
  await manage.click();
  const dialog = page.getByRole('dialog', { name: 'Manage Group Members' });
  await expect(dialog).toBeVisible({ timeout: 15_000 });
  await page.addStyleTag({ content: 'html { font-size: 200% !important; }' });
  await expect
    .poll(() => page.evaluate(() => getComputedStyle(document.documentElement).fontSize), {
      message: 'D14 capture: the root font size did not become 32px after the 200% style tag',
    })
    .toBe('32px');

  // The queue rendered: its heading, and one Approve and one Reject for the one pending member.
  const heading = dialog.getByRole('heading', { name: 'Pending Members' });
  await expect(heading).toBeVisible({ timeout: 15_000 });
  const approve = dialog.getByRole('button', { name: 'Approve', exact: true });
  const reject = dialog.getByRole('button', { name: 'Reject', exact: true });
  await expect(approve).toHaveCount(1);
  await expect(reject).toHaveCount(1);
  await settleAnimations(dialog);
  await heading.scrollIntoViewIfNeeded();

  // The picture: the dialog as it stands, every member name and address masked but the synthetic one.
  const picture = testInfo.outputPath('d14-320x568-200.png');
  await dialog.screenshot({ path: picture, mask: [dialog.locator('p.wrap-anywhere').filter({ hasNotText: 'E2E Pending' })] });
  await testInfo.attach('d14-320x568-200', { path: picture, contentType: 'image/png' });

  // The read, recorded and not asserted.
  const queue = dialog.locator('div.mb-6').filter({ has: page.getByRole('heading', { name: 'Pending Members' }) });
  const cell = await readLargeTextCell(queue, { dialog });
  const pressable = async (button: typeof approve) => {
    await button.scrollIntoViewIfNeeded();
    const box = await button.boundingBox();
    const sheet = await dialog.boundingBox();
    const onTop = await button.evaluate((el) => {
      const r = el.getBoundingClientRect();
      const hit = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
      return Boolean(hit && el.contains(hit));
    });
    const inside = Boolean(box && sheet && box.x >= sheet.x - 0.5 && box.x + box.width <= sheet.x + sheet.width + 0.5 && box.y >= sheet.y - 0.5 && box.y + box.height <= sheet.y + sheet.height + 0.5);
    return { box, dialog: sheet, atLeast44: Boolean(box && box.width >= 44 && box.height >= 44), wholeInsideDialog: inside, underFinger: onTop };
  };
  const read = { project: testInfo.project.name, cell, approve: await pressable(approve), reject: await pressable(reject) };
  const file = testInfo.outputPath('d14-read.json');
  writeFileSync(file, JSON.stringify(read, null, 2));
  await testInfo.attach('d14-read', { path: file, contentType: 'application/json' });
  // eslint-disable-next-line no-console -- the one-time read is recorded from the CI log
  console.log(`[89.6-11 D14 capture] ${JSON.stringify(read)}`);

  expectNoApiWrites(hold);
});
