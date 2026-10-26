// @vitest-environment node
//
// Pins the rounding in e2e/support/touchTarget.ts (code review ORCH-WR-01): the touch floor is
// compared on the measured box rounded to 2 decimals, so a 44px box that layout reports as
// 43.99993896484375px (CI run 40220997125, the Past events disclosure) passes, and a box that is
// really short of 44px still fails. Vitest does not collect e2e/, so the pin lives here. Line
// comments only (CF-9).
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

import { MIN_TOUCH_TARGET_PX, roundPx } from '../../e2e/support/touchTarget';

describe('touchTarget — the floor is compared on the box rounded to 2 decimals (code review ORCH-WR-01)', () => {
  it('roundPx absorbs layout float noise and nothing larger', () => {
    // The measured CI value clears the floor once rounded.
    expect(roundPx(43.99993896484375)).toBe(44);
    expect(roundPx(43.99993896484375)).toBeGreaterThanOrEqual(MIN_TOUCH_TARGET_PX);
    expect(roundPx(44)).toBe(44);
    expect(roundPx(44.004)).toBe(44);
    // A control short by a hundredth or more still fails: no tolerance band.
    expect(roundPx(43.994)).toBe(43.99);
    expect(roundPx(43.994)).toBeLessThan(MIN_TOUCH_TARGET_PX);
    expect(roundPx(43.9)).toBeLessThan(MIN_TOUCH_TARGET_PX);
  });

  it('expectTouchTarget compares both axes through roundPx', () => {
    const source = readFileSync(resolve(__dirname, '../../e2e/support/touchTarget.ts'), 'utf8');
    const body = source.slice(source.indexOf('export async function expectTouchTarget('));
    expect(body, 'expectTouchTarget is gone').not.toBe(source);
    expect(body).toContain("expect(roundPx(box.width), message('width')).toBeGreaterThanOrEqual(MIN_TOUCH_TARGET_PX);");
    expect(body).toContain("expect(roundPx(box.height), message('height')).toBeGreaterThanOrEqual(MIN_TOUCH_TARGET_PX);");
  });
});
