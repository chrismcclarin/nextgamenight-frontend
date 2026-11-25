import { expect, type Locator, type Page } from '@playwright/test';

import { describeRing, focusRingMeasurement } from './contrast';
import { settleAnimations } from './inFlight';

// expectFocusRingClearOfText(page, control, text, label) — for a control that sits to the RIGHT of
// a run of text: give the control a real keyboard focus, let its ring finish painting, and assert
// that the ring box (the border box plus whatever the ring paints OUTSIDE it) starts at or right of
// the text's last glyph.
//
// How the ring box is found: the shared ring reader (focusRingMeasurement in e2e/support/contrast.ts)
// reads the two-tone ring the browser painted, an outline over a band, and returns its reach: the
// outline's offset plus its width for the outset ring (4px), 0 for the inset ring, or the widest
// outward box-shadow spread if that is larger. The reader THROWS on any other shape (no outline,
// the browser's own outline, the pre-89.6 box-shadow ring), which is the failure here too.
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
// AMENDED Phase 89.6-14 (O-1 B): the ring is an outline over a band, so the ring box is the border box plus the outline's offset and width (the reader's reach), not the largest box-shadow spread; the single shared reader is kept.

interface BoxRead {
  focusVisible: boolean;
  rect: { left: number; right: number; top: number; bottom: number };
  textRect: { left: number; right: number; width: number };
}

export async function expectFocusRingClearOfText(
  page: Page,
  control: Locator,
  text: Locator,
  label: string,
): Promise<void> {
  // The reader focuses by keyboard, waits for the control's transitions and throws on a non-house shape.
  const ring = await focusRingMeasurement(page, control, label);
  await settleAnimations(control);
  const outward = ring.reach;

  const textHandle = await text.elementHandle();
  expect(textHandle, `${label}: the text element did not resolve`).not.toBeNull();

  const read: BoxRead = await control.evaluate((el, textEl) => {
    const box = el.getBoundingClientRect();
    const range = document.createRange();
    range.selectNodeContents(textEl as Node);
    const t = range.getBoundingClientRect();

    return {
      focusVisible: el.matches(':focus-visible'),
      rect: { left: box.left, right: box.right, top: box.top, bottom: box.bottom },
      textRect: { left: t.left, right: t.right, width: t.width },
    };
  }, textHandle);

  const measured = `${JSON.stringify(read)}; ${describeRing(label, ring)}`;
  expect(read.focusVisible, `${label}: the control never matched :focus-visible (${measured})`).toBe(true);
  // Anti-vacuity: the reader resolving proves a house ring is painted (it throws otherwise).
  expect(read.textRect.width, `${label}: the text box is empty (${measured})`).toBeGreaterThan(0);
  expect(
    read.rect.left - outward,
    `${label}: the focus ring paints ${outward}px outside the control and its left edge ` +
      `(${read.rect.left - outward}px) is left of the text's last glyph (${read.textRect.right}px), ` +
      `so it covers the text (${measured})`,
  ).toBeGreaterThanOrEqual(read.textRect.right - 0.5);
}
