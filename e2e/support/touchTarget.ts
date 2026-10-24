import { expect, type Locator, type Page } from '@playwright/test';

// The ONE touch-target box check for e2e specs: a control's rendered box is at least
// MIN_TOUCH_TARGET_PX on the axes the site asserts, optionally inside the viewport. It reads the
// BORDER BOX only (boundingBox(), never an effective hit area) and does not settle: a caller whose
// control animates in settles first (settleAnimations in e2e/support/inFlight.ts, or the site's own
// settle step), then calls this.
//
// DECISION Phase 88.6.2-11 (helpers): one box check, chosen OVER the per-spec copies it replaced
// (eight spec-local 44px functions and one inline check before this plan). axes 'height' is the
// opt-out for a w-full control, whose width the site covers with its containment checks; the
// default checks both axes. `why` carries each site's own mechanism words, PER AXIS when the
// site's two messages differed, so a failure never prints the other axis's cause. A spec-local
// wrapper may supply `.first()`, a settle step or `why`, never a second comparison. Changing this
// is a decision, not a cleanup.

/** The floor, in CSS px. */
export const MIN_TOUCH_TARGET_PX = 44;

export interface TouchTargetOptions {
  /** 'both' (the default) checks width and height; 'height' checks height only. */
  axes?: 'both' | 'height';
  /** The site's mechanism words: one string for both axes, or one per axis. */
  why?: string | { width?: string; height?: string };
  /** Also expect the box fully inside this page's viewport width. */
  withinViewportOf?: Page;
}

/** Expect `locator`'s rendered box to clear the touch floor; every message names the label and both measured numbers. */
export async function expectTouchTarget(
  locator: Locator,
  label: string,
  options: TouchTargetOptions = {},
): Promise<void> {
  const { axes = 'both', why, withinViewportOf } = options;
  const box = await locator.boundingBox();
  expect(box, `${label}: boundingBox() returned null — not rendered`).not.toBeNull();
  if (!box) return;
  const measured = `${box.width}px wide x ${box.height}px tall`;
  const reason = (axis: 'width' | 'height'): string | undefined =>
    typeof why === 'string' ? why : why?.[axis];
  const message = (axis: 'width' | 'height'): string => {
    const text = `${label}: ${axis} is below the ${MIN_TOUCH_TARGET_PX}px floor (${measured})`;
    const because = reason(axis);
    return because ? `${text} — ${because}` : text;
  };

  if (axes === 'both') expect(box.width, message('width')).toBeGreaterThanOrEqual(MIN_TOUCH_TARGET_PX);
  expect(box.height, message('height')).toBeGreaterThanOrEqual(MIN_TOUCH_TARGET_PX);

  if (withinViewportOf) {
    const viewport = withinViewportOf.viewportSize();
    expect(viewport, `${label}: the page has no viewport size`).not.toBeNull();
    if (!viewport) return;
    expect(box.x, `${label}: the left edge is outside the viewport (x ${box.x}px; ${measured})`).toBeGreaterThanOrEqual(0);
    expect(
      box.x + box.width,
      `${label}: the right edge is outside the ${viewport.width}px viewport (x ${box.x}px; ${measured})`,
    ).toBeLessThanOrEqual(viewport.width);
  }
}
