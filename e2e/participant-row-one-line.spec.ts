import { test, expect } from '@playwright/test';

// Phase 88.9-21 (C5a, UI-SPEC row R2-14): the Create Event dialog's participant row at 375px.
//
// WHAT IT PINS. The row's labels (Participant Name, New Player, Score, Faction)
// move from 12px to 14px, and the move must NOT undo the owner's one-line phone tuning recorded at
// src/app/components/ParticipantRow.js ("width so Score + Faction + Remove share ONE line at 375px instead of stranding"):
// Score, Faction and Remove still share one line. RED today (the labels compute 12px) until plan
// 88.9-34 builds the row; the one-line half is held throughout.
//
// HOW IT RUNS. Phone project only (the iPhone SE preset, 375 x 667), CI only (the phone project
// needs the setup project's login state, which exists only in CI). It reaches the row the way
// e2e/empty-status-region-idle.spec.ts ("const add = page.getByRole('button', { name: /add participant/i });") does:
// group page, Create Event, one + Add Participant tap. NO WRITES: the form is never
// submitted, and the dialog is closed with Escape. No capture option is set here; messages print
// px values only.

test.describe('Phase 88.9-21 C5a — the participant row at 375 (phone project)', () => {
  test.skip(({ isMobile }) => !isMobile, 'C5a phone-tenet geometry — phone project only');

  test("C5a (88.9): at 375 the participant row's labels are 14px and Score, Faction and Remove still share one line", async ({
    page,
  }) => {
    const groupId = process.env.E2E_GROUP_ID ?? '1';
    await page.goto(`/groupHomePage?id=${groupId}`);
    await page.getByRole('button', { name: 'Create Event', exact: true }).click();
    await expect(page.getByRole('heading', { name: /create event/i })).toBeVisible();

    await page.getByRole('button', { name: /add participant/i }).click();

    // Only CUSTOM rows render a label element "Participant Name"; the tap adds one, so the last
    // labelled name input is the new row's.
    const names = page.getByLabel('Participant Name', { exact: true });
    await expect(names.last(), 'the new custom participant row rendered').toBeVisible();

    const row = await names.last().evaluate((input) => {
      // The row root is the nearest ancestor that also holds this row's Remove button.
      let root: HTMLElement | null = input.parentElement;
      while (root && !root.querySelector('button[title="Remove participant"]')) root = root.parentElement;
      if (!root) return null;
      const shown = (el: Element) => {
        const r = el.getBoundingClientRect();
        return r.width > 0 && r.height > 0;
      };
      const byText = (selector: string, text: string) =>
        Array.from(root!.querySelectorAll<HTMLElement>(selector)).find(
          (el) => (el.textContent ?? '').trim() === text && shown(el)
        ) ?? null;
      const size = (el: HTMLElement | null) => (el ? getComputedStyle(el).fontSize : null);
      const boxOf = (el: Element | null) => {
        if (!el) return null;
        const r = el.getBoundingClientRect();
        return { top: r.top, bottom: r.bottom };
      };
      const scoreLabel = byText('label', 'Score') as HTMLLabelElement | null;
      const factionLabel = byText('label', 'Faction') as HTMLLabelElement | null;
      return {
        sizes: {
          'Participant Name': size(byText('label', 'Participant Name')),
          'New Player': size(byText('span', 'New Player')),
          Score: size(scoreLabel),
          Faction: size(factionLabel),
        },
        boxes: {
          'Score input': boxOf(scoreLabel ? document.getElementById(scoreLabel.htmlFor) : null),
          'Faction input': boxOf(factionLabel ? document.getElementById(factionLabel.htmlFor) : null),
          Remove: boxOf(root.querySelector('button[title="Remove participant"]')),
        },
      };
    });
    expect(row, 'the participant row root (the ancestor holding its Remove button) was found').not.toBeNull();

    for (const [label, fontSize] of Object.entries(row!.sizes)) {
      expect(fontSize, `the ${label} label renders`).not.toBeNull();
      expect(fontSize, `the ${label} label computes ${fontSize}, want 14px`).toBe('14px');
    }

    const boxes = Object.entries(row!.boxes);
    for (const [name, box] of boxes) {
      expect(box, `the ${name} has a box`).not.toBeNull();
    }
    const tops = boxes.map(([, box]) => box!.top);
    const bottoms = boxes.map(([, box]) => box!.bottom);
    const maxTop = Math.max(...tops);
    const minBottom = Math.min(...bottoms);
    expect(
      maxTop,
      `Score, Faction and Remove share one line: the largest top (${maxTop.toFixed(1)}px) must sit above the smallest bottom (${minBottom.toFixed(1)}px)`
    ).toBeLessThan(minBottom);

    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth - window.innerWidth
    );
    expect(overflow, 'no horizontal overflow at 375px').toBeLessThanOrEqual(0);

    // Closed without saving.
    await page.keyboard.press('Escape');
  });

  // Plan 88.9-65 (owner fix row 52-X40 and its addendum). The row held two New Player checkboxes
  // for one value, each hidden at one width; at 375 the visible one's tap area measured 90 by 20,
  // under WCAG 2.5.8's 24px. There is now ONE checkbox, on the Participant Name line (owner at
  // N32: right justified on that line), and its label is a real 44 by 44 box that stops above the
  // name input (since 88.9-52 R15b that 44 by 44 box holds on a phone only, below sm since R4 D6; wider is compact, and
  // this test measures at 375). The same opener as the test above; nothing is submitted; closed with Escape.
  test('X40 (88.9-65): at 375 the one New Player checkbox sits on the Participant Name line and its label box is at least 44 by 44, while Score, Faction and Remove still share one line', async ({
    page,
  }) => {
    const groupId = process.env.E2E_GROUP_ID ?? '1';
    await page.goto(`/groupHomePage?id=${groupId}`);
    await page.getByRole('button', { name: 'Create Event', exact: true }).click();
    await expect(page.getByRole('heading', { name: /create event/i })).toBeVisible();
    await page.getByRole('button', { name: /add participant/i }).click();
    const names = page.getByLabel('Participant Name', { exact: true });
    await expect(names.last(), 'the new custom participant row rendered').toBeVisible();

    // Every box is read in ONE evaluate, so the row cannot move between two reads.
    const read = await names.last().evaluate((input) => {
      let root: HTMLElement | null = input.parentElement;
      while (root && !root.querySelector('button[title="Remove participant"]')) root = root.parentElement;
      if (!root) return null;
      const boxOf = (el: Element | null) => {
        if (!el) return null;
        const r = el.getBoundingClientRect();
        return { left: r.left, right: r.right, top: r.top, bottom: r.bottom, width: r.width, height: r.height };
      };
      const labelByText = (text: string) =>
        Array.from(root!.querySelectorAll<HTMLLabelElement>('label')).find((el) => (el.textContent ?? '').trim() === text) ?? null;
      const checkboxes = Array.from(root.querySelectorAll<HTMLInputElement>('input[type="checkbox"]'));
      const shown = checkboxes.filter((el) => {
        const r = el.getBoundingClientRect();
        return r.width > 0 && r.height > 0;
      });
      const newPlayerLabel = shown.length > 0 ? shown[0].closest('label') : null;
      const scoreLabel = labelByText('Score');
      const factionLabel = labelByText('Faction');
      return {
        checkboxesInRow: checkboxes.length,
        checkboxesShown: shown.length,
        newPlayerText: newPlayerLabel ? (newPlayerLabel.textContent ?? '').trim() : null,
        newPlayer: boxOf(newPlayerLabel),
        nameLabel: boxOf(labelByText('Participant Name')),
        nameInput: boxOf(input),
        row: boxOf(root),
        score: boxOf(scoreLabel ? document.getElementById(scoreLabel.htmlFor) : null),
        faction: boxOf(factionLabel ? document.getElementById(factionLabel.htmlFor) : null),
        remove: boxOf(root.querySelector('button[title="Remove participant"]')),
      };
    });
    expect(read, 'the participant row root (the ancestor holding its Remove button) was found').not.toBeNull();
    const { newPlayer, nameLabel, nameInput, row, score, faction, remove } = read!;
    expect(newPlayer, 'the New Player label has a box').not.toBeNull();
    expect(nameLabel, 'the Participant Name label has a box').not.toBeNull();
    expect(nameInput, 'the name input has a box').not.toBeNull();
    expect(row, 'the row has a box').not.toBeNull();

    // eslint-disable-next-line no-console -- the row height and the tap box are recorded from the CI log (before and after, plan 88.9-65)
    console.log(
      `[88.9-65 X40] row height at 375: ${row!.height.toFixed(1)}px; New Player label box ${newPlayer!.width.toFixed(1)} x ${newPlayer!.height.toFixed(1)}px; checkboxes in the row ${read!.checkboxesInRow}, shown ${read!.checkboxesShown}`,
    );

    expect(read!.checkboxesInRow, 'one New Player checkbox in the row, not a pair of width-gated twins').toBe(1);
    expect(read!.checkboxesShown, 'the one checkbox is shown at 375').toBe(1);
    expect(read!.newPlayerText, 'the checkbox sits inside its New Player label').toBe('New Player');
    expect(
      Math.min(newPlayer!.width, newPlayer!.height),
      `the New Player label box is ${newPlayer!.width.toFixed(1)} x ${newPlayer!.height.toFixed(1)}px, want at least 44 x 44`,
    ).toBeGreaterThanOrEqual(44);

    // On the Participant Name line, to its right, and clear of the name input below.
    expect(
      newPlayer!.top < nameLabel!.bottom && nameLabel!.top < newPlayer!.bottom,
      `New Player (top ${newPlayer!.top.toFixed(1)}, bottom ${newPlayer!.bottom.toFixed(1)}) shares a line with Participant Name (top ${nameLabel!.top.toFixed(1)}, bottom ${nameLabel!.bottom.toFixed(1)})`,
    ).toBe(true);
    expect(
      nameLabel!.right,
      `Participant Name (right ${nameLabel!.right.toFixed(1)}px) sits left of New Player (left ${newPlayer!.left.toFixed(1)}px)`,
    ).toBeLessThanOrEqual(newPlayer!.left + 0.5);
    expect(
      newPlayer!.bottom,
      `the New Player box (bottom ${newPlayer!.bottom.toFixed(1)}px) stops above the name input (top ${nameInput!.top.toFixed(1)}px)`,
    ).toBeLessThanOrEqual(nameInput!.top + 0.5);

    // The owner's one-line tuning still holds.
    const cluster = [score, faction, remove];
    for (const box of cluster) expect(box, 'Score, Faction and Remove each have a box').not.toBeNull();
    const maxTop = Math.max(...cluster.map((box) => box!.top));
    const minBottom = Math.min(...cluster.map((box) => box!.bottom));
    expect(
      maxTop,
      `Score, Faction and Remove share one line: the largest top (${maxTop.toFixed(1)}px) must sit above the smallest bottom (${minBottom.toFixed(1)}px)`,
    ).toBeLessThan(minBottom);

    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
    expect(overflow, 'no horizontal overflow at 375px').toBeLessThanOrEqual(0);

    // Closed without saving.
    await page.keyboard.press('Escape');
  });

  // 88.9-52 R4 D6 (owner page pick G6 = C, 2026-11-18): the one-line desktop row is taken from
  // 640px (sm) in place of 768 (src/app/components/ParticipantRow.js ("AMENDED Phase 88.9-52 (R4 D6, owner page pick G6 = C, 2026-11-18): the one-line layout is taken")).
  // Read in this project's browser with the window widened: at 700 the name box, Score, Faction
  // and Remove share one line, the three boxes are one height (42px) with bottoms level with
  // Remove (44px), Score is 64px and Faction 96px wide, each label is 4px above its box; at 620
  // the row is still the phone's two lines with 44px boxes. Same opener as above; nothing is
  // submitted; closed with Escape.
  // AMENDED Phase 89.6-24 (S5, owner first look 2026-11-22 'S5: Fix'): from 640 to 767 the boxes keep
  // the phone floor, so at 700 the three are 44px (was 42px), still one height with bottoms level
  // with Remove, and the row is 85px (was 83); 42px from 768 up as before
  // (src/app/components/ParticipantRow.js ("AMENDED Phase 89.6-24 (S5, owner first look 2026-11-22")).
  test('R4 D6 (88.9-52): the participant row is one line at 700 (boxes level, 44px since 89.6-24 S5) and two lines at 620 (44px boxes)', async ({ page }) => {
    const groupId = process.env.E2E_GROUP_ID ?? '1';
    await page.goto(`/groupHomePage?id=${groupId}`);
    await page.getByRole('button', { name: 'Create Event', exact: true }).click();
    await expect(page.getByRole('heading', { name: /create event/i })).toBeVisible();
    await page.getByRole('button', { name: /add participant/i }).click();
    const names = page.getByLabel('Participant Name', { exact: true });
    await expect(names.last(), 'the new custom participant row rendered').toBeVisible();
    const height = page.viewportSize()?.height ?? 667;

    const readRow = () =>
      names.last().evaluate((input) => {
        let root: HTMLElement | null = input.parentElement;
        while (root && !root.querySelector('button[title="Remove participant"]')) root = root.parentElement;
        if (!root) return null;
        const boxOf = (el: Element | null) => {
          if (!el) return null;
          const r = el.getBoundingClientRect();
          return { left: r.left, right: r.right, top: r.top, bottom: r.bottom, width: r.width, height: r.height };
        };
        const labelByText = (text: string) =>
          Array.from(root!.querySelectorAll<HTMLLabelElement>('label')).find((el) => (el.textContent ?? '').trim() === text) ?? null;
        const nameLabel = labelByText('Participant Name');
        const scoreLabel = labelByText('Score');
        const factionLabel = labelByText('Faction');
        return {
          window: document.documentElement.clientWidth,
          overflow: document.documentElement.scrollWidth - window.innerWidth,
          row: boxOf(root),
          nameLabel: boxOf(nameLabel),
          scoreLabel: boxOf(scoreLabel),
          factionLabel: boxOf(factionLabel),
          name: boxOf(input),
          score: boxOf(scoreLabel ? document.getElementById(scoreLabel.htmlFor) : null),
          faction: boxOf(factionLabel ? document.getElementById(factionLabel.htmlFor) : null),
          remove: boxOf(root.querySelector('button[title="Remove participant"]')),
        };
      });

    await page.setViewportSize({ width: 700, height });
    await expect.poll(async () => (await readRow())?.window, { message: 'R4 D6: the window did not become 700px wide' }).toBe(700);
    const wide = await readRow();
    if (!wide || !wide.row || !wide.name || !wide.score || !wide.faction || !wide.remove || !wide.nameLabel || !wide.scoreLabel || !wide.factionLabel) {
      throw new Error('R4 D6: a part of the participant row was not found at 700');
    }
    const wideLine = JSON.stringify(wide);
    // eslint-disable-next-line no-console -- the measured row is recorded from the CI log
    console.log(`[88.9-52 R4 D6 participant row] 700: ${wideLine}`);
    // One line: the name box and the three controls overlap up and down, left to right in order.
    expect(wide.score.top, `R4 D6, 700: Score is below the name box, the row is still two lines (${wideLine})`).toBeLessThan(wide.name.bottom);
    expect(wide.name.right, `R4 D6, 700: the name box runs into Score (${wideLine})`).toBeLessThanOrEqual(wide.score.left - 15.5);
    expect(wide.score.right, `R4 D6, 700: Score runs into Faction (${wideLine})`).toBeLessThanOrEqual(wide.faction.left - 15.5);
    expect(wide.faction.right, `R4 D6, 700: Faction runs into Remove (${wideLine})`).toBeLessThanOrEqual(wide.remove.left - 15.5);
    // The three boxes: one height, the Input's own phone floor (44px, 89.6-24 S5), bottoms level with Remove.
    for (const [what, box] of [['the name box', wide.name], ['Score', wide.score], ['Faction', wide.faction]] as const) {
      expect(Math.abs(box.height - 44), `R4 D6 + S5, 700: ${what} is ${box.height}px tall, not 44px (${wideLine})`).toBeLessThanOrEqual(1);
      expect(Math.abs(box.bottom - wide.remove.bottom), `R4 D6, 700: ${what} ends ${box.bottom - wide.remove.bottom}px off Remove's bottom (${wideLine})`).toBeLessThanOrEqual(1);
    }
    expect(wide.remove.height, `R4 D6, 700: Remove is ${wide.remove.height}px tall`).toBeGreaterThanOrEqual(44);
    expect(Math.abs(wide.score.width - 64), `R4 D6, 700: Score is ${wide.score.width}px wide, not 64px`).toBeLessThanOrEqual(1);
    expect(Math.abs(wide.faction.width - 96), `R4 D6, 700: Faction is ${wide.faction.width}px wide, not 96px`).toBeLessThanOrEqual(1);
    // The mock measured the name box at about 335px.
    expect(wide.name.width, `R4 D6, 700: the name box is ${wide.name.width}px wide (the mock measured about 335px)`).toBeGreaterThanOrEqual(300);
    // Each label 4px above its box.
    for (const [what, label, box] of [['Participant Name', wide.nameLabel, wide.name], ['Score', wide.scoreLabel, wide.score], ['Faction', wide.factionLabel, wide.faction]] as const) {
      expect(Math.abs(box.top - label.bottom - 4), `R4 D6, 700: ${what} is ${box.top - label.bottom}px above its box, not 4px (${wideLine})`).toBeLessThanOrEqual(1);
    }
    expect(Math.abs(wide.row.height - 85), `R4 D6 + S5, 700: the row is ${wide.row.height}px tall, not 85px (${wideLine})`).toBeLessThanOrEqual(2);
    expect(wide.overflow, 'R4 D6: no sideways page scroll at 700').toBeLessThanOrEqual(0);

    // Below 640 nothing changes: two lines, 44px type-in boxes.
    await page.setViewportSize({ width: 620, height });
    await expect.poll(async () => (await readRow())?.window, { message: 'R4 D6: the window did not become 620px wide' }).toBe(620);
    const narrow = await readRow();
    if (!narrow || !narrow.name || !narrow.score || !narrow.faction || !narrow.remove) throw new Error('R4 D6: a part of the participant row was not found at 620');
    const narrowLine = JSON.stringify(narrow);
    expect(narrow.score.top, `R4 D6, 620: Score is beside the name box, the one-line row started under 640 (${narrowLine})`).toBeGreaterThanOrEqual(narrow.name.bottom);
    for (const [what, box] of [['the name box', narrow.name], ['Score', narrow.score], ['Faction', narrow.faction]] as const) {
      expect(box.height, `R4 D6, 620: ${what} is ${box.height}px tall, under the 44px phone floor (${narrowLine})`).toBeGreaterThanOrEqual(44);
    }
    expect(narrow.overflow, 'R4 D6: no sideways page scroll at 620').toBeLessThanOrEqual(0);

    // Closed without saving.
    await page.keyboard.press('Escape');
  });
});
