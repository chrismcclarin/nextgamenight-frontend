import { expect, type Locator, type Page } from '@playwright/test';

import { focusByKeyboard } from './contrast';
import { settleAnimations } from './inFlight';

// expectFocusRingClearOfText(page, control, text, label) — for a control that sits to the RIGHT of
// a run of text: give the control a real keyboard focus, let its ring finish painting, and assert
// that the ring box (the border box plus whatever the ring paints OUTSIDE it) starts at or right of
// the text's last glyph.
//
// How the ring box is found: the computed `box-shadow` is the list of shadows the browser actually
// painted (Tailwind draws the ring, and its offset band, as spread shadows). The list is split on
// the commas that are not inside parentheses; every shadow WITHOUT the word `inset` paints outside
// the border box by its spread (the fourth length), and the largest such spread is the ring's
// outward extent. An inset ring paints inside the box, so its outward extent is 0.
//
// The text box is a Range over the text element's contents, i.e. the glyphs themselves, not the
// element's box: a heading or paragraph box can be wider than its text, and a long name wraps.
//
// The 0.5px tolerance absorbs subpixel rounding only. The defect it guards (V-1a) is 4px: the house
// ring's 2px offset plus its 2px width, painted over the last letter of the username.
//
// DECISION Phase 88.6.1-53 (V-1a / AC-23): the ring box is DERIVED from the box-shadow the browser
// painted and compared with a Range over the glyphs. REJECTED: (a) comparing the button box with the
// heading box — the pencil's -m-2 box touches the heading by construction, so that check cannot tell
// an outset ring from an inset one; (b) a screenshot diff — font- and theme-fragile, and it would
// capture personal data on a signed-in page. ONE helper, shared by e2e/profile-pencil-ring.spec.ts
// (the Edit-username pencil) and e2e/profile-pressed-controls.spec.ts (the SMS banner's Dismiss); a
// second copy is rejected by the milestone's duplication tenet. Changing the measurement is a
// decision, not a cleanup.

interface RingRead {
  focusVisible: boolean;
  boxShadow: string;
  shadows: { inset: boolean; spread: number }[];
  outward: number;
  rect: { left: number; right: number; top: number; bottom: number };
  textRect: { left: number; right: number; width: number };
}

export async function expectFocusRingClearOfText(
  page: Page,
  control: Locator,
  text: Locator,
  label: string,
): Promise<void> {
  await focusByKeyboard(page, control);
  await settleAnimations(control);

  const textHandle = await text.elementHandle();
  expect(textHandle, `${label}: the text element did not resolve`).not.toBeNull();

  const read: RingRead = await control.evaluate((el, textEl) => {
    const cs = getComputedStyle(el);
    const boxShadow = cs.boxShadow;

    // Split on commas outside parentheses: rgb(…) / oklch(…) colours carry their own commas.
    const parts: string[] = [];
    let depth = 0;
    let current = '';
    for (const ch of boxShadow) {
      if (ch === '(') depth += 1;
      if (ch === ')') depth -= 1;
      if (ch === ',' && depth === 0) {
        parts.push(current);
        current = '';
      } else {
        current += ch;
      }
    }
    if (current.trim()) parts.push(current);

    const shadows =
      boxShadow === 'none'
        ? []
        : parts.map((part) => {
            // Lengths only: strip any function (the colour) first so its numbers are not read.
            const withoutFunctions = part.replace(/[a-z-]+\([^)]*\)/gi, ' ');
            const lengths = Array.from(withoutFunctions.matchAll(/(-?\d*\.?\d+)px/g)).map((m) => Number(m[1]));
            return { inset: /\binset\b/.test(part), spread: lengths[3] ?? 0 };
          });
    const outward = Math.max(0, ...shadows.filter((s) => !s.inset).map((s) => s.spread));

    const box = el.getBoundingClientRect();
    const range = document.createRange();
    range.selectNodeContents(textEl as Node);
    const t = range.getBoundingClientRect();

    return {
      focusVisible: el.matches(':focus-visible'),
      boxShadow,
      shadows,
      outward,
      rect: { left: box.left, right: box.right, top: box.top, bottom: box.bottom },
      textRect: { left: t.left, right: t.right, width: t.width },
    };
  }, textHandle);

  const measured = JSON.stringify(read);
  expect(read.focusVisible, `${label}: the control never matched :focus-visible (${measured})`).toBe(true);
  // Anti-vacuity: an unpainted ring would otherwise pass with outward 0.
  expect(read.boxShadow, `${label}: no box-shadow is painted, so no ring is drawn (${measured})`).not.toBe('none');
  expect(
    read.shadows.some((s) => s.spread >= 2),
    `${label}: no shadow has a spread of 2px or more, so no ring is drawn (${measured})`,
  ).toBe(true);
  expect(read.textRect.width, `${label}: the text box is empty (${measured})`).toBeGreaterThan(0);
  expect(
    read.rect.left - read.outward,
    `${label}: the focus ring paints ${read.outward}px outside the control and its left edge ` +
      `(${read.rect.left - read.outward}px) is left of the text's last glyph (${read.textRect.right}px), ` +
      `so it covers the text (${measured})`,
  ).toBeGreaterThanOrEqual(read.textRect.right - 0.5);
}
