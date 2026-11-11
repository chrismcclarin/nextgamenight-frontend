import { test, expect } from '@playwright/test';

// Phase 88.9-21 (C5a, UI-SPEC row R2-14): the Create Event dialog's participant row at 375px.
//
// WHAT IT PINS. The row's labels (Participant Name, the phone New Player twin, Score, Faction)
// move from 12px to 14px, and the move must NOT undo the owner's one-line phone tuning recorded at
// src/app/components/ParticipantRow.js ("width so Score + Faction + Remove share ONE line at 375px instead of stranding"):
// Score, Faction and Remove still share one line. RED today (the labels compute 12px) until plan
// 88.9-34 builds the row; the one-line half is held throughout.
//
// HOW IT RUNS. Phone project only (the iPhone SE preset, 375 x 667), CI only (the phone project
// needs the setup project's login state, which exists only in CI). It reaches the row the way
// e2e/empty-status-region-idle.spec.ts ("const add = page.getByRole('button', { name: /add participant/i });") does:
// group page, Add New Game Event, one + Add Participant tap. NO WRITES: the form is never
// submitted, and the dialog is closed with Escape. No capture option is set here; messages print
// px values only.

test.describe('Phase 88.9-21 C5a — the participant row at 375 (phone project)', () => {
  test.skip(({ isMobile }) => !isMobile, 'C5a phone-tenet geometry — phone project only');

  test("C5a (88.9): at 375 the participant row's labels are 14px and Score, Faction and Remove still share one line", async ({
    page,
  }) => {
    const groupId = process.env.E2E_GROUP_ID ?? '1';
    await page.goto(`/groupHomePage?id=${groupId}`);
    await page.getByRole('button', { name: /add new game event/i }).click();
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
});
