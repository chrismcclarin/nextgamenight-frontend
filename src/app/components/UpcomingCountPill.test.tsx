/**
 * SPEC Req 2 / UI-SPEC §6.1 — `UpcomingCountPill`, the ONE amber count pill that renders at
 * two use sites (the Calendar button, plan 88.5-07; the sheet's "This week" subheader, plan
 * 88.5-08).
 *
 * WHAT THIS EXISTS TO CATCH
 * -------------------------
 * 1. A SECOND COPY OF THE PILL. The pill is rendered twice from one count. Two copies of the
 *    amber span is the duplication the project tenet forbids, and after the owner's 2026-08-31
 *    ruling it is also where the per-theme fill fork lives (UI-SPEC §6.1.3) — two copies means
 *    two places for the fork to rot. These pins are written against the component, so a use
 *    site that hand-rolls its own span has nothing holding it.
 *
 * 2. A THEME-EQUAL PILL READING AS A "SIMPLIFICATION". The light arm is amber-700 + white ink;
 *    the dark arm is amber-500 (`--amber-500`) + warm-900 ink. That fork is the owner's ruling,
 *    NOT an accident of two people editing the same string. Test 5 pins BOTH arms in the class
 *    string, because a future reader who collapses them to one arm produces a pill measuring
 *    2.25:1 on the dark button fill and 2.76:1 on the dark sheet — under the 3:1 acceptance
 *    SPEC Req 2 keeps (UI-SPEC §12 item 6). `tokenContrast.test.ts` test 52 pins the same fork
 *    one layer down, at the token values; this one pins that the component actually asks for
 *    them.
 *
 * 3. THE SUPPRESSED STATE COLLAPSING INTO `0`. `count === null` means "we are not making a
 *    count claim" (identity resolving, or the events fetch pending/errored). `count === 0`
 *    means "we counted, and it is none". They render identically — nothing — and that is
 *    exactly why the distinction erodes: someone types `count > 0` over the null branch and the
 *    behaviour is unchanged until the backend is slow, at which point a stale `events=[]` reads
 *    as a confident "none". That is the bug `DECISION Phase 88-33` fixed on `UpcomingEventsCard`
 *    and `PhoneEventBar.tsx:81-93` carried forward. Tests 2 and 3 pin the two states SEPARATELY,
 *    with their different reasons written down, so deleting either one is visible.
 *
 * 4. THE COUNT BEING ANNOUNCED TWICE. The span is `aria-hidden="true"`: the number reaches
 *    assistive tech through the HOST control's accessible name (`Calendar, 3 upcoming games
 *    this week` — UI-SPEC §6.1.5), never from the pill as well. Test 4.
 *
 * ANTI-VACUITY (test 7, in the shape of `ClickableMemberName.indicator.test.tsx`'s test 7)
 * ----------------------------------------------------------------------------------------
 * Tests 2 and 3 assert ABSENCE. A negative assertion passes for the wrong reason whenever the
 * query is broken. Test 7 runs the exact same query against a rendering fixture and proves it
 * can see a pill when there is one.
 */
import * as React from 'react';
import { describe, it, expect, afterEach } from 'vitest';
import { render, cleanup } from '@testing-library/react';

import UpcomingCountPill, { UpcomingCountPill as Named } from './UpcomingCountPill';

afterEach(cleanup);

/** The one query every test uses, so the negative arms and test 7 cannot drift apart. */
function pillOf(container: HTMLElement): HTMLSpanElement | null {
  return container.querySelector('span');
}

describe('UpcomingCountPill (SPEC Req 2 / UI-SPEC §6.1)', () => {
  it('1. renders a span carrying the count when count >= 1', () => {
    const { container } = render(<UpcomingCountPill count={3} />);
    const pill = pillOf(container);
    expect(pill, 'count=3 must render the pill span').not.toBeNull();
    expect(pill?.textContent).toBe('3');
  });

  it('2. renders NOTHING at count === 0 — "we counted, and it is none"', () => {
    // The host control still says "0 upcoming games this week" in its accessible name
    // (UI-SPEC §6.1.5); what is suppressed here is the visual dot, not the claim.
    const { container } = render(<UpcomingCountPill count={0} />);
    expect(
      container.firstChild,
      'count=0 must render nothing — a zero pill is visual noise for the most common state',
    ).toBeNull();
  });

  it('3. renders NOTHING at count === null — SUPPRESSED, a DIFFERENT reason from 0', () => {
    // `null` is "we are not making a count claim at all": identity is still resolving, or the
    // events fetch is in flight or errored. Same rendered output as test 2, different meaning.
    // The host control's name drops the count clause entirely in this state, which is the half
    // that would silently break if someone folded this branch into `count > 0`.
    const { container } = render(<UpcomingCountPill count={null} />);
    expect(
      container.firstChild,
      'count=null is the SUPPRESSED state and must render nothing; collapsing it into the 0 branch restores the DECISION Phase 88-33 "none in the next 7 days" lie',
    ).toBeNull();
  });

  it('4. the span is aria-hidden — the number is announced by the HOST control, never twice', () => {
    const { container } = render(<UpcomingCountPill count={3} />);
    expect(pillOf(container)?.getAttribute('aria-hidden')).toBe('true');
  });

  it('5. the class string carries BOTH theme arms — the fork is deliberate, not a duplicate', () => {
    // UI-SPEC §12 item 6 + §6.1.3 (owner ruling 2026-08-31). Light: the `--color-btn-accent-*`
    // pair. Dark: `--amber-500` fill with `--warm-900` ink. A pill with only one arm is a
    // REGRESSION, not a simplification.
    const { container } = render(<UpcomingCountPill count={3} />);
    const cls = pillOf(container)?.className ?? '';
    for (const arm of [
      '[background-color:var(--color-btn-accent-bg)]',
      '[color:var(--color-btn-accent-text)]',
      'dark:[background-color:var(--amber-500)]',
      'dark:[color:var(--warm-900)]',
    ]) {
      expect(
        cls,
        `UI-SPEC §6.1.3 — the pill must carry \`${arm}\`; dropping it collapses the per-theme fork the owner ruled on 2026-08-31 (dark amber-700 measures 2.25:1 on the button fill, under the 3:1 acceptance)`,
      ).toContain(arm);
    }
    // ...and it must NOT take the `.btn-accent` class, which is theme-EQUAL by design
    // (`tokenContrast.test.ts` test 45) and therefore cannot express the fork at all.
    expect(
      cls.split(/\s+/),
      'UI-SPEC §6.1.1 — `.btn-accent` on a non-button pre-empts Phase 88.6\'s `.btn` sweep AND is theme-equal by design; the token references above read the same light values without either problem',
    ).not.toContain('btn-accent');
  });

  it('6. a two-digit count renders in full and keeps its min-width floor', () => {
    // jsdom has no layout, so the FLOOR is asserted as the class that carries it. `min-w-5`
    // (20px) is what keeps a single digit circular; `px-1.5` is what lets 12 grow instead of
    // clipping.
    const { container } = render(<UpcomingCountPill count={12} />);
    const pill = pillOf(container);
    expect(pill?.textContent).toBe('12');
    const cls = (pill?.className ?? '').split(/\s+/);
    expect(cls, 'UI-SPEC §6.1.1 — `min-w-5` is the 20px floor').toContain('min-w-5');
    expect(cls, 'UI-SPEC §6.1.1 — `h-5` fixes the 20px height').toContain('h-5');
    expect(cls, 'UI-SPEC §6.1.1 — `px-1.5` is what lets 2-3 digits grow').toContain('px-1.5');
    expect(cls, 'UI-SPEC §6.1.1 — `tabular-nums` stops the pill jittering as the count changes').toContain('tabular-nums');
  });

  it('7. ANTI-VACUITY — the query tests 2 and 3 use CAN see a pill when one exists', () => {
    // Without this, a typo in `pillOf` would make tests 2 and 3 pass against any component at
    // all, including one that never renders.
    const { container } = render(<UpcomingCountPill count={1} />);
    expect(container.firstChild, 'the negative arms are only meaningful if this positive one holds').not.toBeNull();
    expect(pillOf(container)).not.toBeNull();
  });

  it('8. the named and default exports are the SAME component', () => {
    // Both are exported (the `PhoneEventBar.tsx:178-179` house idiom). Two call sites import it
    // in plans 07 and 08; if the exports ever diverged, one site could get a stale copy.
    expect(Named).toBe(UpcomingCountPill);
  });

  it('9. the caller-supplied className is appended, not swapped for the contract classes', () => {
    // Both use sites pass positioning (`ml-auto`-free adjacency on the button, a leading gap in
    // the sheet). If `className` REPLACED the base string, a call site could silently ship an
    // unstyled, uncoloured pill that still passed every other test here.
    const { container } = render(<UpcomingCountPill count={3} className="ms-1" />);
    const cls = (pillOf(container)?.className ?? '').split(/\s+/);
    expect(cls, 'the caller class must survive').toContain('ms-1');
    expect(cls, 'the contract classes must survive alongside it').toContain('rounded-full');
    expect(cls, 'the fork must survive alongside it').toContain('dark:[color:var(--warm-900)]');
  });
});
