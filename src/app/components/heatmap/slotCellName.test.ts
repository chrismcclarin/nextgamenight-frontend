// Pins for the ONE cell-name template Create Event's two grids share (Phase 88.6.1 plan 24,
// D-12 / D-34, copy row C1).
//
// What this suite pins: the screen-reader name of a scheduler / Create Event heatmap cell. A cell
// with availability is named "{day} at {time}, {n} of {N} available"; a cell without any keeps the
// plain "{day} at {time}". The expected strings below are copied byte-for-byte from copy row C1 of
// the owner-ratified copy table (88.6.1-COPY-TABLE.html:121, row id 'C1'), under the straight
// apostrophe rule (D-32 R8) - C1 has no apostrophe, and SC-5 pins that nothing outside printable
// ASCII (a curly quote, a non-breaking or narrow space) can ride into a name.
//
// Every slot Date below is built as new Date(y, m, d, h, min): that constructor takes LOCAL wall-
// clock parts, and the helper formats LOCAL wall-clock parts, so the result does not depend on the
// runner's timezone. October 5 2026 is a Monday.

import { describe, expect, it } from 'vitest';
import { slotCellName } from './slotCellName';

const isPrintableAscii = (s: string) =>
  Array.from(s).every((ch) => {
    const code = ch.charCodeAt(0);
    return code >= 0x20 && code <= 0x7e;
  });

describe('slotCellName - copy row C1 (88.6.1-24, D-12 / D-34)', () => {
  it('SC-1. a cell with availability is named exactly by the C1 example', () => {
    expect(slotCellName(new Date(2026, 9, 5, 10, 0), 1, 4)).toBe(
      'Monday, October 5 at 10:00 AM, 1 of 4 available'
    );
  });

  it('SC-2. a cell with no availability keeps the plain name (C1 note)', () => {
    expect(slotCellName(new Date(2026, 9, 5, 11, 0), 0, 4)).toBe(
      'Monday, October 5 at 11:00 AM'
    );
  });

  it('SC-3. the two half-hours of one hour carry different names', () => {
    const top = slotCellName(new Date(2026, 9, 5, 10, 0), 1, 4);
    const half = slotCellName(new Date(2026, 9, 5, 10, 30), 1, 4);
    expect(half).not.toBe(top);
    expect(half.endsWith('at 10:30 AM, 1 of 4 available')).toBe(true);
  });

  it('SC-4. noon reads 12:00 PM and the last row reads 11:30 PM', () => {
    expect(slotCellName(new Date(2026, 9, 5, 12, 0), 0, 4)).toBe(
      'Monday, October 5 at 12:00 PM'
    );
    expect(slotCellName(new Date(2026, 9, 5, 23, 30), 2, 4)).toBe(
      'Monday, October 5 at 11:30 PM, 2 of 4 available'
    );
  });

  it('SC-5. every name is printable ASCII only (R12 encoding, D-32 R8)', () => {
    const outputs = [
      slotCellName(new Date(2026, 9, 5, 10, 0), 1, 4),
      slotCellName(new Date(2026, 9, 5, 11, 0), 0, 4),
      slotCellName(new Date(2026, 9, 5, 10, 30), 1, 4),
      slotCellName(new Date(2026, 9, 5, 12, 0), 0, 4),
      slotCellName(new Date(2026, 9, 5, 23, 30), 2, 4),
    ];
    // Anti-vacuity: an empty string would pass the per-character check trivially.
    outputs.forEach((name) => expect(name.length).toBeGreaterThan(0));
    outputs.forEach((name) => expect(isPrintableAscii(name), name).toBe(true));
  });
});
