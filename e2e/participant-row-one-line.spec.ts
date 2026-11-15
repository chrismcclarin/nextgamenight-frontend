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
  // name input. The same opener as the test above; nothing is submitted; closed with Escape.
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
});
