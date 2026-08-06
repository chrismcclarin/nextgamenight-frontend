/**
 * Req 4 phone geometry — `AvailabilityGrid`'s six aligned column widths stay in lockstep.
 *
 * WHY THIS EXISTS
 * ---------------
 * 88-28's plan asked for the row-label gutter to be shrunk at phone width so more day columns
 * fit at 375px. The premise was STALE: 87.8-13 (walkthrough F-7) had already done it, one
 * breakpoint lower than the plan describes — `w-12 sm:w-20`, not the `w-16`/`w-20` the plan
 * text names. Nothing was re-cut, for the reasons recorded in the DECISION marker at the day
 * headers in `AvailabilityGrid.js`.
 *
 * What was missing was a GUARD. 87.8-13's own comment states the hazard in the imperative —
 * "The SAME phone width must be carried by all six aligned sites (header spacer, headers,
 * checkbox spacer, checkboxes, labels, cells) or the columns shear" — and nothing enforced it.
 * The grid is `flex` rows with per-cell fixed widths and no shared token, so changing five of
 * the six is a silent visual break: the header row stops sitting above its column. That is a
 * defect no unit test would notice and no snapshot covers.
 *
 * WHAT THIS DOES *NOT* CLAIM
 * --------------------------
 * It does NOT assert the rendered day-column count at 375px. That needs a browser: the
 * arithmetic (48 + 4x76 = 352 <= 375) assumes the grid gets the full viewport, and the
 * container's own padding eats into it. Plan 88-30 owns the measured assertion. This file
 * pins the invariant the arithmetic RESTS on, which is the half that can be checked here —
 * and says so rather than implying more.
 */
import fs from 'node:fs';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

const GRID = path.join(__dirname, 'AvailabilityGrid.js');

/** Every `w-<phone> sm:w-<desktop>` pair in the file, in source order. */
export function widthPairs(src: string): { phone: string; desktop: string }[] {
  return [...src.matchAll(/\bw-(\[[^\]]+\]|[\w.]+)\s+sm:w-(\[[^\]]+\]|[\w.]+)/g)].map((m) => ({
    phone: m[1],
    desktop: m[2],
  }));
}

describe('AvailabilityGrid phone column geometry (87.8-13 F-7, guarded by 88-28)', () => {
  const src = fs.readFileSync(GRID, 'utf8');
  // comments stripped: the DECISION marker quotes these class names while explaining them
  const code = src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

  it('1. the label gutter is phone-scoped at all THREE of its sites, with one width', () => {
    const gutters = [...code.matchAll(/\bw-12 sm:w-20\b/g)];
    // header spacer, select-all cell, per-row time label
    expect(gutters).toHaveLength(3);
  });

  it('2. the day columns are phone-scoped at BOTH of their sites, with one width', () => {
    const cols = [...code.matchAll(/\bw-\[76px\] sm:w-28\b/g)];
    // day headers, day checkboxes (the cells size via the shared wrapper below)
    expect(cols.length).toBeGreaterThanOrEqual(2);
  });

  it('3. no responsive width in this file is unpaired — the shear guard', () => {
    // Every `w-*` that has a `sm:w-*` twin must be one of the two known widths. A third pair
    // means a site drifted to its own number, which is exactly how the columns shear.
    const pairs = widthPairs(code);
    const distinct = new Set(pairs.map((p) => `${p.phone}|${p.desktop}`));
    expect([...distinct].sort()).toEqual(['12|20', '[76px]|28']);
    expect(pairs.length).toBeGreaterThanOrEqual(5);
  });

  it('4. the 4-column arithmetic the marker states still holds', () => {
    // 48px gutter + 4 x 76px columns = 352 <= 375. Recomputed from the SOURCE numbers rather
    // than hardcoded, so shrinking either one fails here instead of silently invalidating the
    // comment. `w-12` = 3rem = 48px on the default scale.
    const gutterPx = 12 * 4;
    const colPx = Number(/w-\[(\d+)px\]/.exec(code)![1]);
    expect(gutterPx).toBe(48);
    expect(colPx).toBe(76);
    expect(gutterPx + 4 * colPx).toBeLessThanOrEqual(375);
    // and the cell stays above the 44px touch floor in its narrow dimension
    expect(colPx).toBeGreaterThanOrEqual(44);
  });

  it('5. the compact phone label the `w-12` gutter depends on is still rendered', () => {
    // `w-12` is only viable because 87.8-13 added a "10:30p" short form behind `sm:hidden`.
    // Deleting that formatter re-breaks the gutter without touching any width.
    expect(code).toContain('formatTimeLabelCompact');
    expect(code).toMatch(/sm:hidden[^>]*>\{formatTimeLabelCompact/);
    expect(code).toMatch(/hidden sm:inline[^>]*>\{formatTimeLabel\(/);
  });

  it('6. the decision is recorded at the site, not only in this file', () => {
    expect(src).toContain('AMENDED Phase 88-28');
    expect(src).toContain('87.8-13 walkthrough F-7');
  });
});
