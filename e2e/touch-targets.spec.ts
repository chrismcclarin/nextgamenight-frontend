import { test, expect, type Locator, type Page } from '@playwright/test';
// Plan 88.1-19 MEASUREMENT instruments — read-only attachments, no assertions, and NOT a
// spec file so Playwright cannot collect it as a suite. See `e2e/support/diagnostics.ts`.
import { attachDiagnostics, probeOverflowCulprits, probeViewport } from './support/diagnostics';
// Phase 88.6-12 task 4: the keyboard-modality focus idiom, IMPORTED rather than re-implemented.
// `focusByKeyboard` presses Tab (to set Chromium's focus-visible heuristic to KEYBOARD) and then
// focuses the target; without the Tab a script-focused <button> never matches `:focus-visible` and
// the ring rules never apply. Its own docblock in `e2e/support/contrast.ts` carries the reasoning.
// A local copy would be the duplication this project's tenet forbids; `support/contrast.ts` is not
// a spec file, so importing it adds no collected suite.
import { focusByKeyboard } from './support/contrast';

/**
 * Phase 87.8 Plan 08 — SPEC R4 (44x44 effective hit areas) + SPEC R6 (pressed-state
 * feedback) coverage, PHONE PROJECT ONLY.
 *
 * PROJECT GUARD: every new spec joins BOTH projects automatically — `journeys` and
 * `phone` share `testMatch: /.*\.spec\.ts/` (playwright.config.ts:44 and :87). This
 * file inverts the guard tailwind-v4-styles.spec.ts:57 uses: it SKIPS the desktop
 * `journeys` project and runs only at phone width, because R4/R6 are phone-tenet
 * requirements measured at the phone viewport (iPhone SE (3rd gen), 375x667 — D-06;
 * was iPhone 13 390x664 when this spec was written under plan 08).
 *
 * CLASSIFY BEFORE DEBUGGING — hover inertness is expected, not a defect.
 * Tailwind v4 wraps every `hover:` utility in `@media (hover: hover)`, which is FALSE
 * on this project's phone emulation (isMobile + hasTouch), so all ~222 hover sites are
 * INERT here — recorded at playwright.config.ts:80-84. If an assertion in this file
 * fails, first determine whether the cause is hover-inertness (expected v4 behaviour;
 * must NOT be "fixed") or a genuine layout/press defect. Pressed-state feedback in this
 * app deliberately does NOT depend on hover: `.btn:active:not(:disabled)` and the
 * per-site `active:opacity-75` utilities fire on :active, which touch does drive.
 *
 * MECHANISM UNDER TEST (R4): each census CTA grows from a PER-CTA `min-h-11` utility
 * added at its own call site by plan 87.8-01 Task 2(a). If a geometry assertion fails,
 * look first at that call site's className.
 *
 * CORRECTED Phase 88.8 plan 13 (comment only, no behavioural change). This paragraph
 * previously read "`.btn` (globals.css:756-767) declares no min-height and no height",
 * and BOTH halves are now wrong: `.btn` lives near `globals.css:1917`, and Phase 88-01
 * (D-36) later added a PHONE-WIDTH `min-height: 2.75rem` floor at `globals.css:2227-2231`.
 * An executor reading the stale claim would reasonably conclude the floor does not exist
 * and add a redundant utility — and the house phone-only form is `max-md:min-h-11`, never
 * a bare `min-h-11` (the D-36 block rejects an all-viewport floor by name because it
 * deforms the `w-8 h-8` steppers). The `D-36:` test below is the one that measures the
 * floor itself; the per-CTA utility is still what holds the census CTAs above it on
 * DESKTOP, where `.btn` is deliberately floorless.
 *
 * CENSUS SOURCE: the SPEC R4 re-census list in 87.8-01-SUMMARY.md (8 CTAs, file:line +
 * text per row). This spec asserts every phone-reachable census CTA, not a hardcoded
 * two-CTA pair. grouplist.js:103 (error-state "+ Create New Group") shares its
 * accessible name with the main branch and only one renders at a time, so the single
 * role+name locator covers whichever branch is live.
 *
 * SELECTOR POLICY: role/label/text only — never Tailwind classes (invite.spec.ts:18).
 * The add-friend control is located by its DYNAMIC accessible name pattern
 * `Add {username} as a friend` (ClickableMemberName.js aria-label).
 *
 * Fixtures follow the env-const idiom (tailwind-v4-styles.spec.ts:47-49): seeded ids
 * minted by the backend's scripts/e2e-fixtures.js in CI. Do not run locally —
 * credentials are intentionally absent (playwright.config.ts:19-21).
 *
 * EXTENDED Phase 88-30 (DEF-88-28-02). 88-28 raised the Header hamburger (`p-2` ->
 * `p-2.5`) and the KebabMenu trigger (`px-2 py-1` -> `min-h-11 min-w-11`) BY ARITHMETIC
 * only — RESEARCH logged the pre-change hamburger as assumption A7 ("the arithmetic is
 * sound but it was NOT measured in a browser") and the kebab's own must-have figure was
 * wrong by a factor that mattered (it described the hamburger). Both are now measured at
 * 375px here. 88-30 also adds the D-36 `.btn` phone-floor pair: the floor is live on a
 * shipped bare-`.btn` call site, and the `.btn-compact` opt-out still wins the cascade.
 */

const E2E_GROUP_ID = process.env.E2E_GROUP_ID ?? '1';
const E2E_AVAILABILITY_TOKEN = process.env.E2E_AVAILABILITY_TOKEN ?? 'seed-availability-token';
// gameDetail is where RsvpSection stacks member rows (space-y-1) with the add-friend
// "+" control — the tap-isolation surface. Same URL shape EventCalendar/GroupGamesList
// use: /gameDetail?event_id=<id>&group_id=<id>.
const E2E_EVENT_DETAIL_PATH =
  process.env.E2E_EVENT_DETAIL_PATH ?? `/gameDetail?event_id=1&group_id=${E2E_GROUP_ID}`;

/** Vacuity guard: a zero-count locator would make every assertion after it vacuous —
 *  that is a failure of the LOCATOR (or of fixture seeding), not of the touch-target
 *  work. Assert loudly instead of silently passing. */
async function guardResolved(locator: Locator, what: string, atLeast = 1): Promise<void> {
  // toBeVisible FIRST: it auto-waits, so the count sample below runs against a
  // settled page. locator.count() has NO auto-wait — sampling it first raced the
  // post-fetch render and failed 5 of these guards on the first armed CI run
  // (30833214370) while the CTAs and fixture rows were in fact all present.
  await expect(
    locator.first(),
    `locator for ${what} resolved no visible element — a zero-count locator makes the geometry assertion vacuous; this is a failure of the LOCATOR or the fixture state, not of the touch-target work`,
  ).toBeVisible();
  const count = await locator.count();
  expect(
    count,
    `locator for ${what} resolved ${count} elements (expected >= ${atLeast}) — a zero-count locator makes the geometry assertion vacuous; this is a failure of the LOCATOR or the fixture state, not of the touch-target work`,
  ).toBeGreaterThanOrEqual(atLeast);
}

/** R4 geometry: BOTH dimensions >= 44. Height-only would reproduce the exact gap R4
 *  closes — the fix is `min-h-11`, which sets min-height and NOT min-width, so a
 *  narrow census-added CTA would pass a height-only check while failing R4. */
async function assertMin44(locator: Locator, label: string): Promise<void> {
  const box = await locator.first().boundingBox();
  expect(box, `${label}: boundingBox() returned null — element not rendered`).not.toBeNull();
  if (!box) return;
  const mechanism =
    'grows from the per-CTA min-h-11 utility at its own call site (plan 87.8-01), NOT a global .btn rule — .btn declares no min-height, so a failure here is at the call site className';
  expect(
    box.height,
    `${label} height ${box.height}px < 44px — ${mechanism}`,
  ).toBeGreaterThanOrEqual(44);
  expect(
    box.width,
    `${label} width ${box.width}px < 44px — min-h-11 sets NO min-width, so a narrow CTA fails R4 even at full height; ${mechanism}`,
  ).toBeGreaterThanOrEqual(44);
}

/** R6 pressed-state: drive :active explicitly (pointer down without up), read the
 *  COMPUTED opacity (what the user perceives — never a class name), then release.
 *  The pointer is moved off the element before release so the press never completes
 *  into a click (no navigations / submits / side effects from this probe). */
async function assertPressedOpacity(page: Page, locator: Locator, label: string): Promise<void> {
  const target = locator.first();
  // Deliver the press through hover()'s actionability pipeline — auto-scroll,
  // stability (element in the same position for two consecutive frames), and a
  // hit-target check that the element actually receives the pointer — then press
  // where the pointer already is. Manually captured boundingBox() coordinates
  // went stale under CI load twice: the below-fold availability submit was
  // "pressed" outside the 667px viewport (run 30833214370), and a mid-page
  // layout shift on groupPlanning moved the CTA between capture and press (run
  // 30836863411) — both times the press became a page-wide text drag and the
  // probe read opacity 1 on an element it never touched.
  await target.hover();
  await page.mouse.down();
  try {
    const opacity = await target.evaluate((el) => getComputedStyle(el).opacity);
    expect(
      parseFloat(opacity),
      `${label} computed opacity while pressed is ${opacity}, expected ~0.75 — the press idiom is an instant opacity dim (.btn:active:not(:disabled) for .btn sites, per-site active:opacity-75 for non-.btn tappables, D-12); hover styles are inert on touch and are NOT the mechanism`,
    ).toBeCloseTo(0.75, 2);
  } finally {
    // Move away before releasing so no click event completes on the element.
    await page.mouse.move(1, 1);
    await page.mouse.up();
  }
}

/** D-11 dark-theme pre-assertion (tailwind-v4-styles.spec.ts:78-86): a computed-style
 *  read in light mode would be meaningless and its failure misdiagnosed. */
async function assertDarkTheme(page: Page): Promise<void> {
  await expect(page.locator('html')).toHaveClass(/dark/);
}

interface EffectiveGeometry {
  ownWidth: number;
  ownHeight: number;
  effectiveWidth: number;
  effectiveHeight: number;
  /** The computed `::after` insets of whichever element carried the extension. Zeros when
   *  nothing did — which for a control that is SUPPOSED to have one is a probe/markup
   *  failure, not a pass, and every caller says so in its message. */
  insets: { left: number; right: number; top: number; bottom: number };
  /** `the control itself` / `<span> inside it` / `nothing`. Named in failure messages so a
   *  regression report says WHERE the extension went, not just that the number shrank. */
  extendedBy: string;
}

/**
 * The EFFECTIVE hit area of a control: its own border box UNIONED with whatever a
 * negative-inset `::after` pseudo-element extends it by, on itself or on any descendant.
 *
 * WHY NOT `boundingBox()`. A pseudo-element extension does not change the originating
 * element's own rect — `getBoundingClientRect()` on the add-friend "+" reads 24x24 and on an
 * expanded member chip reads 32x32, both of which are the DESIGNED visible sizes and neither
 * of which is the tappable area. A naive `boundingBox()` check would fail those controls for
 * entirely the wrong reason and would then be "fixed" by growing them visibly, which is the
 * exact outcome 87.8 D-13 rejected.
 *
 * WHY DESCENDANTS COUNT. `MemberChipStack` puts the extension on an inner wrapper span
 * (`HIT_EXTENSION`, `MemberChipStack.tsx:200`) rather than on the `role="button"` trigger
 * itself, because the trigger is `ClickableMemberName`'s own element. A pointer landing on
 * that pseudo hits the wrapper, which is INSIDE the trigger, so the tap reaches the trigger —
 * the extension really is part of the control's hit area, and measuring only the trigger's
 * own `::after` would report no extension at all.
 *
 * EXTRACTED Phase 88.5 plan 10 from the add-friend test that first wrote this arithmetic
 * inline (87.8-08). It is now measured at five call sites; five copies of one rule is the
 * kind of drift this project treats as debt rather than as a style question. The arithmetic
 * is byte-for-byte the one it replaced — negative insets EXTEND the box, positive ones are
 * ignored — so the add-friend numbers (24 + 10 + 10 = 44, 24 + 4 + 4 = 32) are unchanged.
 */
async function readEffectiveGeometry(locator: Locator): Promise<EffectiveGeometry> {
  return locator.first().evaluate((el) => {
    const px = (v: string) => (Number.isFinite(parseFloat(v)) ? parseFloat(v) : 0);
    const own = el.getBoundingClientRect();

    let left = own.left;
    let right = own.right;
    let top = own.top;
    let bottom = own.bottom;
    let insets = { left: 0, right: 0, top: 0, bottom: 0 };
    let extendedBy = 'nothing — no negative-inset ::after on this control or inside it';

    for (const node of [el, ...Array.from(el.querySelectorAll('*'))]) {
      const after = window.getComputedStyle(node, '::after');
      // No pseudo at all — `content: none` is what an element with no ::after rule reports.
      if (after.content === 'none') continue;
      const i = {
        left: px(after.left),
        right: px(after.right),
        top: px(after.top),
        bottom: px(after.bottom),
      };
      // A NON-negative inset shrinks or matches the box; only negative ones extend it.
      if (i.left >= 0 && i.right >= 0 && i.top >= 0 && i.bottom >= 0) continue;
      const r = node.getBoundingClientRect();
      left = Math.min(left, r.left + Math.min(0, i.left));
      right = Math.max(right, r.right - Math.min(0, i.right));
      top = Math.min(top, r.top + Math.min(0, i.top));
      bottom = Math.max(bottom, r.bottom - Math.min(0, i.bottom));
      insets = i;
      extendedBy = node === el ? 'the control itself' : `<${node.tagName.toLowerCase()}> inside it`;
    }

    return {
      ownWidth: own.width,
      ownHeight: own.height,
      effectiveWidth: right - left,
      effectiveHeight: bottom - top,
      insets,
      extendedBy,
    };
  });
}

/** MEASUREMENT ONLY (plan 88.1-19): the IN-PAGE box of a CTA, in CSS pixels. Read-only.
 *  Paired with Playwright's own `boundingBox()`, which is visual-viewport-SCALED, this is
 *  what separates "the button is short" from "the page is scaled". Asserts nothing. */
function readCtaBox(locator: Locator) {
  return locator.first().evaluate((el) => {
    const round = (n: number) => Math.round(n * 1000) / 1000;
    const r = el.getBoundingClientRect();
    const cs = window.getComputedStyle(el);
    return {
      rectWidth: round(r.width),
      rectHeight: round(r.height),
      offsetWidth: (el as HTMLElement).offsetWidth,
      offsetHeight: (el as HTMLElement).offsetHeight,
      computedMinHeight: cs.minHeight,
      computedHeight: cs.height,
      computedTransform: cs.transform,
      className: (typeof el.className === 'string' ? el.className : '').slice(0, 120),
    };
  });
}

/* --- Phase 88.5 locators (SPEC Req 2 / 3 / 5) -----------------------------------------
 *
 * SELECTOR POLICY, unchanged: role / label / text only. The Calendar button's accessible
 * name carries a count as of plan 88.5-07 ("Calendar, {n} upcoming games this week",
 * UI-SPEC 6.1.5), so it is matched by PREFIX + word boundary — not an exact string, and not
 * a bare substring either. The `calendarSheet` DIALOG's name stays exactly "Calendar"; do
 * not relax that one to match.
 */
const calendarButton = (page: Page) => page.getByRole('button', { name: /^calendar\b/i });
const calendarSheet = (page: Page) => page.getByRole('dialog', { name: 'Calendar' });

/** The COLLAPSED member-chip stack on a home group card. Its accessible name is built by
 *  `MemberChipStack.tsx`'s `collapsedName()` — "Members: {names}[ and N more]. Show all
 *  members." — and the chips inside it are `aria-hidden` glyphs, so that name is the only
 *  thing there is to match on. */
const collapsedChipStack = (page: Page) =>
  page.getByRole('button', { name: /^members: .*show all members\.$/i });

/** The control that collapses an EXPANDED chip stack back. Only a stack that is currently
 *  expanded renders one, so this doubles as the "is it expanded" signal. */
const showLessControl = (page: Page) =>
  page.getByRole('button', { name: 'Show less', exact: true });

/**
 * Wait until a freshly-opened dialog has finished ANIMATING IN, so geometry read inside it is
 * the settled geometry.
 *
 * WHY THIS EXISTS (plan 88.1-19 measured it, run 32774690333). The Create Event submit read
 * 43.913 / 43.9636 / 43.9915 across three successive reads in a single attempt, climbing toward
 * 44 while its x/y drifted — a uniform ancestor scale, not a CSS height. Computed `min-height`
 * on the button was exactly `44px` the whole time and `offsetHeight` was 44. The source is
 * `src/components/ui/dialog.tsx` — `duration-200 data-[state=open]:animate-in
 * data-[state=open]:zoom-in-95` — and `expect(heading).toBeVisible()` resolves at animation
 * START, not end. The recorded page-scale/overflow hypothesis was REFUTED by the same run
 * (`scrollWidth 375 === clientWidth 375`, `visualViewport.scale 1`, zero overflow culprits).
 *
 * So this is a SETTLE, never a threshold change: 44 is untouched and must stay untouched.
 * EVERY `boundingBox()` assertion taken inside a freshly-opened Radix dialog anywhere in this
 * suite has the same latent race — that is why this is a shared helper and not an inline wait.
 *
 * Two gates, because either alone can lie:
 *   1. The Web Animations API — await every finite animation on the dialog subtree. Infinite
 *      ones (spinners) are excluded or this would never resolve. Under `prefers-reduced-motion`
 *      there may be none at all, which is a legitimate no-op.
 *   2. A stability poll on the measured height, as the backstop for anything the WAAPI does not
 *      cover (a transition starting a frame later, layout settling after the animation ends).
 */
async function settleOpenAnimation(page: Page, target: Locator, label: string): Promise<void> {
  const dialog = page.getByRole('dialog').first();
  await dialog.evaluate(async (el) => {
    const running = (el as HTMLElement)
      .getAnimations({ subtree: true })
      .filter((a) => a.effect?.getTiming().iterations !== Infinity);
    await Promise.all(running.map((a) => a.finished.catch(() => undefined)));
  });

  // Two consecutive identical readings = the box has stopped moving.
  let previous: number | null = null;
  await expect
    .poll(
      async () => {
        const height = (await readCtaBox(target)).rectHeight;
        const stable = previous !== null && height === previous;
        previous = height;
        return stable;
      },
      {
        message: `${label}: geometry never stopped changing — the dialog open animation (dialog.tsx zoom-in-95 / duration-200) is still running, or something else is resizing it. Measuring here reads a mid-animation number (plan 88.1-19 measured 43.913 -> 43.9636 -> 43.9915 climbing toward 44). Do NOT lower the 44px floor to accommodate it.`,
        timeout: 5_000,
        intervals: [50, 50, 100, 100, 250],
      },
    )
    .toBe(true);
}

/** One `elementFromPoint` reading, resolved against the two members of a pair. */
interface HitProbe {
  x: number;
  y: number;
  insideA: boolean;
  insideB: boolean;
  tag: string;
  text: string;
}

interface PairProbe {
  axis: 'x' | 'y';
  /** The measured gap between the two boxes, in CSS px. `gap-3` is 12. */
  gap: number;
  /** The larger of the two controls' `::after` extensions, in CSS px. `-inset-1.5` is 6. */
  extension: number;
  aLabel: string;
  bLabel: string;
  /** 2px inside A's near edge — must land in A, never in B. */
  nearEdgeA: HitProbe;
  /** 2px inside B's near edge — must land in B, never in A. */
  nearEdgeB: HitProbe;
  /** `extension - 2` past A's near edge, inside A's OWN claimed extension zone. */
  extensionA: HitProbe;
  /** `extension - 2` past B's near edge, inside B's OWN claimed extension zone. */
  extensionB: HitProbe;
}

interface ChipRowProbe {
  itemCount: number;
  chipPair: PairProbe | null;
  showLessPair: PairProbe | null;
  /** Every item in the row with its label and box — quoted into failure messages so a red
   *  run says what the row actually contained. */
  diagnostics: string;
}

/**
 * Probe the expanded chip row's tap isolation — the whole thing in ONE synchronous evaluate.
 *
 * WHY THE EDGES AND NEVER THE CENTRES (copied from the D-13 test at this file's add-friend
 * isolation case, because the reasoning is identical and re-deriving it invites a weaker
 * version): a mis-sized or regressed extension only ever reaches a few pixels past the
 * boundary it is violating — the CENTRE of a neighbouring chip is the one point that failure
 * mode can never reach, so a centre probe cannot fail and is vacuous on BOTH axes.
 *
 * FOUR probes per pair, because the near-edge pair alone is NOT falsifiable here and that is
 * worth stating rather than discovering later. A chip's extension is 6px and the row gap is
 * 12px, so even at `gap-2` (8px) each extension stops 2px short of the neighbour's own box:
 * the classic "2px inside the neighbour" probe would stay green through exactly the
 * regression this test exists to catch. The two EXTENSION probes are the falsifiable pair —
 * they ask whether each control still owns the zone it claims. At `gap-3` chip A owns
 * [A.right, A.right+6] and chip B owns [B.left-6, B.left] and the two meet exactly, so
 * A.right+4 resolves to A. At `gap-2` those zones OVERLAP by 4px, B's pseudo paints later in
 * tree order and therefore wins the hit test, and A.right+4 resolves to B. Both pairs are
 * asserted: the near-edge probes pin the guarantee everyone reads the test for, the extension
 * probes are the ones with teeth.
 *
 * `scrollIntoView({ block: 'center' })` first, synchronously, and every rect read after it:
 * `elementFromPoint` only resolves points inside the viewport, and assertions do not
 * auto-scroll — only actions do (run 30838155400 recorded "hit: none" for exactly this).
 * Nothing is CLICKED here, unlike the add-friend D-13 case: a chip tap opens a member
 * popover rather than mutating anything, so there is no side effect whose absence could be
 * asserted, and a popover mounting mid-probe would cover the remaining points.
 */
async function probeExpandedChipRow(row: Locator): Promise<ChipRowProbe> {
  return row.evaluate((rowEl) => {
    rowEl.scrollIntoView({ block: 'center', inline: 'nearest' });

    const px = (v: string) => (Number.isFinite(parseFloat(v)) ? parseFloat(v) : 0);
    const round = (n: number) => Math.round(n * 100) / 100;

    const items = Array.from(rowEl.children).filter(
      (el) => el.getBoundingClientRect().height > 0,
    ) as HTMLElement[];

    const labelOf = (el: HTMLElement) =>
      (el.getAttribute('aria-label') ?? el.textContent ?? '').trim().slice(0, 40) || '<unlabelled>';
    const isShowLess = (el: HTMLElement) => (el.textContent ?? '').trim() === 'Show less';

    /** The largest negative `::after` inset on the element or anything inside it, in px. */
    const extensionOf = (el: HTMLElement) => {
      let ext = 0;
      for (const node of [el, ...Array.from(el.querySelectorAll('*'))]) {
        const after = window.getComputedStyle(node, '::after');
        if (after.content === 'none') continue;
        ext = Math.max(ext, -px(after.left), -px(after.right), -px(after.top), -px(after.bottom));
      }
      return ext;
    };

    const hit = (x: number, y: number, a: HTMLElement, b: HTMLElement) => {
      const el = document.elementFromPoint(x, y);
      return {
        x: round(x),
        y: round(y),
        insideA: el !== null && (el === a || a.contains(el)),
        insideB: el !== null && (el === b || b.contains(el)),
        tag: el instanceof Element ? el.tagName : 'none',
        text: (el?.textContent ?? '').trim().slice(0, 40),
      };
    };

    const probePair = (a: HTMLElement, b: HTMLElement) => {
      const extA = extensionOf(a);
      const extB = extensionOf(b);
      // BOTH must carry an extension or the extension probes below would ask a control that
      // claims no zone whether it owns one. An `unknown`-status chip is deliberately inert
      // (MemberChipStack's RESEARCH B-5 marker) and has none — skip such a pair rather than
      // reporting a failure that is really a fixture shape.
      if (extA === 0 || extB === 0) return null;
      const ext = Math.max(extA, extB);
      const ra = a.getBoundingClientRect();
      const rb = b.getBoundingClientRect();

      if (rb.left >= ra.right - 1) {
        // B sits to the RIGHT of A. The probe line must be inside both boxes vertically.
        const overlapTop = Math.max(ra.top, rb.top);
        const overlapBottom = Math.min(ra.bottom, rb.bottom);
        if (overlapBottom - overlapTop < 2) return null;
        const y = (overlapTop + overlapBottom) / 2;
        return {
          axis: 'x' as const,
          gap: round(rb.left - ra.right),
          extension: ext,
          aLabel: labelOf(a),
          bLabel: labelOf(b),
          nearEdgeA: hit(ra.right - 2, y, a, b),
          nearEdgeB: hit(rb.left + 2, y, a, b),
          extensionA: hit(ra.right + (ext - 2), y, a, b),
          extensionB: hit(rb.left - (ext - 2), y, a, b),
        };
      }

      if (rb.top >= ra.bottom - 1) {
        // B sits BELOW A (the row wrapped). `gap-3` sets the row gap as well as the column
        // gap, so the arithmetic is identical on this axis.
        const overlapLeft = Math.max(ra.left, rb.left);
        const overlapRight = Math.min(ra.right, rb.right);
        if (overlapRight - overlapLeft < 2) return null;
        const x = (overlapLeft + overlapRight) / 2;
        return {
          axis: 'y' as const,
          gap: round(rb.top - ra.bottom),
          extension: ext,
          aLabel: labelOf(a),
          bLabel: labelOf(b),
          nearEdgeA: hit(x, ra.bottom - 2, a, b),
          nearEdgeB: hit(x, rb.top + 2, a, b),
          extensionA: hit(x, ra.bottom + (ext - 2), a, b),
          extensionB: hit(x, rb.top - (ext - 2), a, b),
        };
      }

      return null;
    };

    // CONSECUTIVE pairs only — in a flex row, DOM-consecutive is also layout-adjacent, and a
    // non-consecutive pair would measure a "gap" that spans a whole chip.
    let chipPair = null;
    const chips = items.filter((el) => !isShowLess(el));
    for (let i = 0; i < chips.length - 1 && chipPair === null; i += 1) {
      chipPair = probePair(chips[i], chips[i + 1]);
    }

    let showLessPair = null;
    const showLessIndex = items.findIndex(isShowLess);
    if (showLessIndex > 0) {
      showLessPair = probePair(items[showLessIndex - 1], items[showLessIndex]);
    }
    if (showLessPair === null && showLessIndex >= 0 && showLessIndex < items.length - 1) {
      showLessPair = probePair(items[showLessIndex], items[showLessIndex + 1]);
    }
    // Wrapped-row fallback (2026-09-01, expanded chips carry visible names): chip+name
    // items are wide enough that "Show less" can wrap onto a row of its own, where its
    // DOM-consecutive neighbour is the RIGHTMOST chip above — no x-overlap, both probes
    // above return null. Its layout-adjacent partner is then whichever chip sits directly
    // ABOVE it; scan every item and let probePair's own overlap guards reject the
    // non-adjacent ones. The vertical probes have the same teeth: `gap-3` sets the row
    // gap to 12px, so 6+6 extension zones meet exactly on the y axis too.
    if (showLessPair === null && showLessIndex >= 0) {
      for (let i = 0; i < items.length && showLessPair === null; i += 1) {
        if (i === showLessIndex) continue;
        showLessPair = probePair(items[i], items[showLessIndex]);
      }
    }

    const diagnostics = items
      .map((el) => {
        const r = el.getBoundingClientRect();
        return `"${labelOf(el)}" [${round(r.left)},${round(r.top)} ${round(r.width)}x${round(r.height)} ext:${extensionOf(el)}]`;
      })
      .join(' | ');

    return { itemCount: items.length, chipPair, showLessPair, diagnostics };
  });
}

/**
 * Assert one pair is isolated: neither control's hit extension reaches into the other's box,
 * and each still owns the extension zone it claims.
 *
 * `expectedGap` is asserted directly as well as through the hit tests. That looks redundant
 * and is not: it is the assertion that names the BROKEN TERM. A regression report reading
 * "the expanded chip row's gap is 8px, expected 12 (gap-3) — 6 + 6 = 12 means an extension
 * terminates EXACTLY at the gap, and 8 makes two 6px extensions overlap by 4px" is actionable
 * where "probe at (191,402) resolved the wrong element" is a debugging session. The hit tests
 * are what prove the CONSEQUENCE is real rather than arithmetic on paper.
 */
function assertPairIsolated(
  pair: PairProbe | null,
  what: string,
  expectedGap: number,
  diagnostics: string,
): void {
  if (pair === null) return; // the caller has already failed on the null; keep TS happy.

  const context = `${what} (${pair.aLabel} / ${pair.bLabel}), separated on the ${pair.axis} axis by ${pair.gap}px with a ${pair.extension}px extension each. Row: ${diagnostics}`;

  expect(
    pair.gap,
    `${what}: the measured gap is ${pair.gap}px, expected ${expectedGap} (gap-3). Each control carries a ${pair.extension}px hit extension, and 6 + 6 = 12 is what makes an extension terminate EXACTLY at the gap. Dropping one step on the spacing scale re-opens the tap-stealing defect 87.8 D-13 was written against — that is a decision, not a density tweak (MemberChipStack.tsx's own marker says so). ${context}`,
  ).toBeCloseTo(expectedGap, 0);

  // The GUARANTEE: neither extension reaches inside the other control's own box.
  expect(
    pair.nearEdgeB.insideA,
    `${what}: the point 2px inside ${pair.bLabel}'s near edge (${pair.nearEdgeB.x},${pair.nearEdgeB.y}) resolved to ${pair.aLabel} — its extension has crossed the gap INTO its neighbour, so a tap meant for one member opens the other's popover (hit: <${pair.nearEdgeB.tag}> "${pair.nearEdgeB.text}"). ${context}`,
  ).toBe(false);
  expect(
    pair.nearEdgeB.insideB,
    `${what}: the point 2px inside ${pair.bLabel}'s near edge did not land inside ${pair.bLabel} at all (hit: <${pair.nearEdgeB.tag}> "${pair.nearEdgeB.text}") — the probe geometry is off; fix the probe, not the layout. ${context}`,
  ).toBe(true);
  expect(
    pair.nearEdgeA.insideB,
    `${what}: the point 2px inside ${pair.aLabel}'s near edge (${pair.nearEdgeA.x},${pair.nearEdgeA.y}) resolved to ${pair.bLabel} (hit: <${pair.nearEdgeA.tag}> "${pair.nearEdgeA.text}"). ${context}`,
  ).toBe(false);
  expect(
    pair.nearEdgeA.insideA,
    `${what}: the point 2px inside ${pair.aLabel}'s near edge did not land inside ${pair.aLabel} at all (hit: <${pair.nearEdgeA.tag}> "${pair.nearEdgeA.text}") — probe geometry, not layout. ${context}`,
  ).toBe(true);

  // THE FALSIFIABLE PAIR: each control still owns its own extension zone. These are the two
  // that go red at gap-2, where the zones overlap and the later pseudo wins the hit test.
  expect(
    pair.extensionA.insideA,
    `${what}: ${pair.aLabel}'s own hit extension no longer owns the point ${pair.extension - 2}px past its edge (${pair.extensionA.x},${pair.extensionA.y}) — it resolved to <${pair.extensionA.tag}> "${pair.extensionA.text}"${pair.extensionA.insideB ? `, which belongs to ${pair.bLabel}` : ''}. Two ${pair.extension}px extensions across a ${pair.gap}px gap overlap by ${2 * pair.extension - pair.gap}px, and the pseudo-element later in tree order wins. ${context}`,
  ).toBe(true);
  expect(
    pair.extensionB.insideB,
    `${what}: ${pair.bLabel}'s own hit extension no longer owns the point ${pair.extension - 2}px past its edge (${pair.extensionB.x},${pair.extensionB.y}) — it resolved to <${pair.extensionB.tag}> "${pair.extensionB.text}"${pair.extensionB.insideA ? `, which belongs to ${pair.aLabel}` : ''}. ${context}`,
  ).toBe(true);
}

test.describe('Phase 87.8 R4/R6 — touch-target geometry and press feedback (phone project)', () => {
  // Inverse of the tailwind-v4-styles.spec.ts:57 guard: this file is phone-only.
  // Both projects match every spec (playwright.config.ts:44, :87), so without this
  // skip the desktop journeys project would run phone-tenet assertions at 1280px.
  test.skip(({ isMobile }) => !isMobile, 'R4/R6 are phone-tenet requirements — phone project only');

  test('R4: home/group-list census CTAs measure >= 44x44 and press-dim', async ({ page }) => {
    await page.goto('/');
    await assertDarkTheme(page);

    // Census rows 3+4: "+ Create New Group" (aria-label "Create new group") — the
    // error-state and main branches share this name; exactly one renders.
    const createGroup = page.getByRole('button', { name: /create new group/i });
    await guardResolved(createGroup, 'the "+ Create New Group" CTA (grouplist.js census rows 3/4)');
    await assertMin44(createGroup, '"+ Create New Group"');

    // Census row 5: "Invite Member" — one per group card; the fixture user owns at
    // least one group, so at least one must render (guard asserts, no silent skip).
    const inviteMember = page.getByRole('button', { name: /invite member to group/i });
    await guardResolved(inviteMember, 'the per-card "Invite Member" CTA (grouplist.js census row 5)');
    await assertMin44(inviteMember, '"Invite Member"');

    // Census row (ADDED Phase 88.5 plan 10, SPEC Req 2): the phone-only Calendar button —
    // now with the amber count pill rendered INSIDE it (`UserHomePage.js:352-367`). The
    // floor is the explicit `min-h-11 min-w-11` pair at that call site, not `.btn`'s
    // phone-only height floor, and this assertion is the one that would catch the pill
    // pushing the control off it in some later layout change.
    const calendar = calendarButton(page);
    await guardResolved(calendar, 'the phone Calendar button (SPEC Req 2 — the counted entry point)');
    await assertMin44(calendar, 'the Calendar button (with the count pill inside it)');

    // And measured as an EFFECTIVE hit area too, for a reason that is not redundant: a real
    // <button> must reach the floor with its OWN box. If these two numbers ever diverge, the
    // control has quietly started depending on a pseudo-element to look big enough to tap,
    // which is the D-13 technique — legitimate for a 24px inline glyph, wrong for a CTA.
    const calendarGeometry = await readEffectiveGeometry(calendar);
    expect(
      calendarGeometry.effectiveHeight,
      `the Calendar button's effective height is ${calendarGeometry.effectiveHeight}px < 44px (own ${calendarGeometry.ownHeight}px, extended by ${calendarGeometry.extendedBy}) — the floor is the min-h-11 at its own call site`,
    ).toBeGreaterThanOrEqual(44);
    expect(
      calendarGeometry.effectiveWidth,
      `the Calendar button's effective width is ${calendarGeometry.effectiveWidth}px < 44px (own ${calendarGeometry.ownWidth}px) — min-h-11 sets NO min-width; the paired min-w-11 is the mechanism`,
    ).toBeGreaterThanOrEqual(44);
    expect(
      calendarGeometry.effectiveHeight,
      `the Calendar button's effective height (${calendarGeometry.effectiveHeight}px) exceeds its own box (${calendarGeometry.ownHeight}px) — something has added a hit extension (${calendarGeometry.extendedBy}) to a control that is supposed to reach 44px on its own geometry. That is a decision, not a cleanup: it makes the tappable area invisible.`,
    ).toBeCloseTo(calendarGeometry.ownHeight, 1);

    // R6: the surface's primary CTA gives live pressed feedback.
    await assertPressedOpacity(page, createGroup, '"+ Create New Group"');
  });

  test('R4: groupHomePage + Create Event modal census CTAs measure >= 44x44 and press-dim', async ({ page }, testInfo) => {
    await page.goto(`/groupHomePage?id=${E2E_GROUP_ID}`);
    await assertDarkTheme(page);

    // Census row 6: "Plan Game Session" (a Link styled .btn — inline-flex, so the
    // min-h-11 utility applies to it exactly as to a button).
    const planSession = page.getByRole('link', { name: /plan game session/i });
    await guardResolved(planSession, 'the "Plan Game Session" link (groupHomePage census row 6)');
    await assertMin44(planSession, '"Plan Game Session"');
    await assertPressedOpacity(page, planSession, '"Plan Game Session"');

    // MEASUREMENT ONLY (plan 88.1-19) — the CONTROL half of the submit reading below, and it
    // MUST be sampled HERE, before the modal opens. Radix's DialogContent marks the whole
    // background inert/aria-hidden, so once the Create Event modal is open this role-based
    // locator resolves NOTHING and any read against it hangs until the test timeout. That is
    // not a hypothesis: the first instrumented run (32773229213) timed out at exactly this
    // read placed after the modal opened, and produced no submit measurement at all.
    const planSessionControl = {
      inPage: await readCtaBox(planSession),
      playwrightBoundingBox: await planSession.first().boundingBox(),
    };

    // Census row 7: the Create Event modal's submit. Reached the same way the green
    // create-event journey reaches it (tailwind-v4-styles.spec.ts:59-76).
    await page.getByRole('button', { name: /add new game event/i }).click();
    await expect(page.getByRole('heading', { name: /create event/i })).toBeVisible();
    const submit = page.getByRole('button', { name: /^(create|update) event$/i });
    await guardResolved(submit, 'the Create Event submit CTA (createEvent.js census row 7)');

    // The dialog is VISIBLE at this point but not yet settled — `toBeVisible()` above resolves
    // at animation start. See settleOpenAnimation's block for the measured numbers.
    await settleOpenAnimation(page, submit, '"Create Event" submit');

    // MEASUREMENT ONLY (plan 88.1-19), immediately before the assertion that read 43.835px.
    // Read-only: nothing here scrolls, clicks or writes a style.
    //
    // THE DISCRIMINATOR IS THE PAIR OF HEIGHTS. `getBoundingClientRect().height` is CSS
    // pixels; Playwright's `boundingBox().height` is the VISUAL-VIEWPORT-SCALED number, and
    // the phone project sets `isMobile: true`. So:
    //   - in-page 44 and Playwright 43.835 -> page scale, not CSS. The cause is horizontal
    //     overflow (`docScrollWidth` > `docClientWidth`) shrinking the scale, and
    //     `probeOverflowCulprits` NAMES the element instead of leaving it inferred.
    //   - in-page ALSO 43.835 -> it is CSS, and the fix belongs at the call site
    //     (`createEvent.js:1268`, which already carries `min-h-11`).
    // `planSession` is the CONTROL: it PASSED on the failing run, and whether it passed
    // because it is naturally taller than 44 or because it is unscaled is what makes the
    // submit's reading interpretable at all. It is captured above, pre-modal, for the
    // inert-background reason recorded there.
    await attachDiagnostics(testInfo, 'submit-44px', {
      viewport: await probeViewport(page),
      overflowCulprits: await probeOverflowCulprits(page),
      submitInPage: await readCtaBox(submit),
      submitPlaywrightBoundingBox: await submit.first().boundingBox(),
      planSessionControl,
    });

    await assertMin44(submit, '"Create Event" submit');
    await assertPressedOpacity(page, submit, '"Create Event" submit');

    // 88-CODE-REVIEW D1: the modal fleet's close button. One assertion here covers all 37
    // Modal.Header call sites — every migrated modal renders this exact DialogClose from
    // Modal.tsx's ModalHeader. It wears a REAL min-h-11/min-w-11 box (the 88-28 idiom this
    // spec's own comment at the hamburger records), so assertMin44's boundingBox() read is
    // the correct instrument — a regression to the bare ~15x24px glyph reds here.
    const modalClose = page.getByRole('button', { name: 'Close' });
    await guardResolved(modalClose, "the Create Event modal's close button (Modal.tsx ModalHeader DialogClose)");
    await assertMin44(modalClose, 'modal fleet close button');
  });

  test('R4: groupPlanning census CTAs measure >= 44x44 and press-dim', async ({ page }) => {
    await page.goto(`/groupPlanning?group_id=${E2E_GROUP_ID}`);
    await assertDarkTheme(page);

    // Both census CTAs live inside the "Check-ins" section (PromptScheduleSection.js),
    // which groupPlanning mounts ALREADY EXPANDED (defaultExpanded={true},
    // groupPlanning/page.js:247) once userRole resolves — do NOT click the header
    // "to expand": the header is a TOGGLE, so that click collapses the section.
    // The body hides via max-h-0 with a 200ms transition, so a sample taken
    // mid-transition still reads visible — that made the collapse land between
    // this test's guard and its press in two different ways (phantom press in run
    // 30836863411, hover timeout in run 30838155400). The guards below auto-wait
    // through the section's mount and data load; if the default ever flips to
    // collapsed, they fail loudly and the fixer adds a STATE-AWARE expand here.
    // Both CTAs are permission-gated (canCreate / canManageSchedules); the fixture
    // user OWNS the seeded group, so both must render — no silent skip path: a
    // non-rendering CTA must read as a fixture/locator failure, never as a pass.
    const startCheckin = page.getByRole('button', { name: /start a check-in/i });
    await guardResolved(startCheckin, 'the "+ Start a check-in" CTA (OpenPollsList.js census row 1)');
    await assertMin44(startCheckin, '"+ Start a check-in"');

    /* Census row 2 is STATE-DEPENDENT since 88-18 (DECISION marker on
       PromptScheduleManager.js's create button): with zero schedules the
       "+ New Schedule" button is SUPPRESSED and the EmptyState's "Create a
       schedule" Button carries the action instead — two identical primary
       CTAs a finger-width apart were ruled noise on a phone. The CI fixture
       group seeds no schedules, so EITHER affordance may be the live one;
       exactly ONE must render (both = the 88-18 suppression regressed,
       neither = fixture/locator failure), and whichever renders is measured. */
    const newSchedule = page.getByRole('button', { name: /new schedule/i });
    const emptyCreate = page.getByRole('button', { name: /create a schedule/i });
    await expect(
      newSchedule.or(emptyCreate).first(),
      'no schedule-create affordance rendered at all — fixture or locator failure, never a pass',
    ).toBeVisible();
    const bothCount = (await newSchedule.count()) + (await emptyCreate.count());
    expect(
      bothCount,
      `${bothCount} schedule-create affordances resolved (expected exactly 1) — two means the 88-18 empty-state suppression regressed; zero means the fixture/locator broke`,
    ).toBe(1);
    const liveCreate = (await newSchedule.count()) === 1 ? newSchedule : emptyCreate;
    await assertMin44(liveCreate, 'the schedule-create CTA (census row 2 — "+ New Schedule" or the EmptyState\'s "Create a schedule")');

    await assertPressedOpacity(page, startCheckin, '"+ Start a check-in"');
  });

  test('R4: availability submit CTA measures >= 44x44 and press-dims', async ({ page }) => {
    await page.goto(`/availability-form/${E2E_AVAILABILITY_TOKEN}`);
    await assertDarkTheme(page);

    // Census row 8: the availability submit (AvailabilityForm.js, w-full + min-h-11).
    const submit = page.getByRole('button', { name: /submit availability|update availability/i });
    await guardResolved(submit, 'the availability submit CTA (AvailabilityForm.js census row 8)');
    await assertMin44(submit, 'availability submit');
    await assertPressedOpacity(page, submit, 'availability submit');
  });

  /* Phase 88-30 (DEF-88-28-02): the two controls plan 88-28 RESIZED are the two whose
     new size was never measured. Both are located by their shipped accessible names —
     "Toggle menu" (Header.js) and "Group actions" (the `ariaLabel` groupHomePage passes
     to KebabMenu) — so the selector policy above holds and a rename fails loudly rather
     than silently measuring nothing.

     The hamburger is `md:hidden`, so this assertion is only meaningful in the phone
     project; the file-level skip already guarantees that. The kebab renders at every
     breakpoint (its own marker says so) but its floor is a phone-tenet requirement, so it
     is asserted here rather than in `journeys`. */
  test('R4: hamburger and KebabMenu trigger measure >= 44x44 at 375px (88-28 geometry, measured not derived)', async ({ page }) => {
    await page.goto('/');
    await assertDarkTheme(page);

    // 88-28: `p-2` -> `p-2.5` = 10 + 24 (the w-6 h-6 svg) + 10 = 44x44. The fix was
    // chosen OVER an invisible `after:` extension precisely so the button's OWN
    // bounding box measures 44 — which is what assertMin44 reads.
    const hamburger = page.getByRole('button', { name: 'Toggle menu' });
    await guardResolved(hamburger, 'the Header hamburger (md:hidden — phone only)');
    await assertMin44(hamburger, 'Header hamburger');

    // The kebab is gated on `userRole && userRole !== 'pending'`; the fixture user owns
    // the seeded group, so it MUST render — a missing kebab is a fixture/locator failure,
    // never a silent skip.
    await page.goto(`/groupHomePage?id=${E2E_GROUP_ID}`);
    await assertDarkTheme(page);
    const kebab = page.getByRole('button', { name: 'Group actions' });
    await guardResolved(kebab, 'the groupHomePage KebabMenu trigger (owner/member only)');
    await assertMin44(kebab, 'KebabMenu trigger');

    // 88-CODE-REVIEW MED#13: the ITEMS behind the trigger — the destructive row
    // actions D-40 routed through this menu — carried the census's ~36px FAIL
    // even after 88-28 floored the trigger. min-h-11 on the item row; all six
    // render sites inherit from the one shared component, so one opened menu
    // is the fleet assertion.
    //
    // Plan 88.6-16 (D-12) dropped the ARIA menu pattern from KebabMenu: the items
    // are plain `<button>`s in a `<ul role="list">`, and the trigger names that list
    // through `aria-controls` ONLY while it is open. Scoping through the attribute
    // keeps the measurement inside the OPEN list exactly as the old role query did,
    // and it additionally proves the relationship is live in a real browser — the
    // half jsdom's `keyboardOperability` arm cannot see. The id comes from React's
    // `useId`, whose value contains colons, so it is matched with an attribute
    // selector rather than `#id`.
    await kebab.click();
    const listId = await kebab.getAttribute('aria-controls');
    expect(
      listId,
      'the KebabMenu trigger exposes aria-controls while its menu is open (88.6-16 D-12)',
    ).toBeTruthy();
    const firstItem = page.locator(`[id="${listId}"]`).getByRole('button').first();
    await guardResolved(firstItem, 'the first KebabMenu item (opened menu)');
    await assertMin44(firstItem, 'KebabMenu item row');
  });

  /* DECISION Phase 88-30 (D-36 / DEF-1): the `.btn-compact` half of this test measures
     PLANTED probe elements, chosen OVER driving the two shipped `w-8 h-8` steppers in
     `BrowseMoreModal.js` — which is the obvious move and the thing a future reader will
     "fix" this to.

     MEASURED, not assumed: those steppers are UNREACHABLE in CI. `BrowseMoreModal` mounts
     only from `QuickSuggestions` (QuickSuggestions.js:115), whose "Browse more" trigger
     renders only when `suggestions.length > 0` (:161-176). `suggestionService.getSuggestions`
     builds its entire candidate set from `UserGame` rows (services/suggestionService.js:121)
     and returns `{ suggestions: [] }` when that set is empty (:150), and
     `scripts/seed-sample-data.js` creates ZERO `UserGame` rows (grep: no matches). So the
     seeded group has no suggestions, no "Browse more" button, and no steppers. Driving them
     would need a new backend fixture — a cross-repo change that also alters the Create Event
     surface four other green specs walk.

     What the probe DOES claim, and it is the half nothing else can see: that in the EMITTED
     stylesheet at 375px, `.btn-compact` still beats the unlayered `.btn { min-height: 2.75rem }`
     phone floor. That is a pure cascade fact about authoring order (globals.css:1100-1108),
     which jsdom cannot evaluate and which `decisionMarkers.test.ts:120-122` can only pin at
     SOURCE level. The two are complementary: that suite proves the call sites wear the class
     and the rule exists; this proves the browser resolves them the way the marker claims.

     The bare-`.btn` probe alongside it is the anti-vacuity guard: if the media query stopped
     applying (a breakpoint edit, a layering "cleanup"), the compact probe would pass at 32px
     for the WRONG reason. Both probes must disagree, or the test is meaningless. */
  test('D-36: the .btn phone floor is live on a shipped call site, and .btn-compact still opts out', async ({ page }) => {
    await page.goto(`/groupHomePage?id=${E2E_GROUP_ID}`);
    await assertDarkTheme(page);

    /* The arm that used to stand here read, verbatim:
     *
     *   // The REAL call site: "Manage Members" is a bare `.btn` with NO per-CTA `min-h-11`
     *   // (groupHomePage/page.js), so the ONLY thing that can hold it at 44px here is the D-36
     *   // phone floor. "Plan Game Session" (asserted above) carries its own `min-h-11` and
     *   // therefore proves nothing about the floor.
     *   const manageMembers = page.getByRole('button', { name: /manage members/i });
     *   await guardResolved(manageMembers, 'the "Manage Members" bare-.btn CTA (no per-CTA min-h-11)');
     *   await assertMin44(manageMembers, '"Manage Members" (bare .btn, floored by D-36 only)');
     *
     * AMENDED Phase 88.6-12 (RESEARCH Pitfall 6): the original subject was a real call site,
     * chosen because at the time a bare `.btn` was the only shape that could prove the media
     * rule. Phase 88.6 migrated that control to `<Button>`, which carries `min-h-11` on its cva
     * base at every width — so the assertion would have kept passing for a DIFFERENT reason and
     * stopped measuring the media rule entirely. Re-pointed at a planted bare `.btn`, which no
     * migration can take away.
     *
     * The probe is not a generic one: it wears the exact class string "Manage Members" ships
     * with today (`groupHomePage/page.js:872-878`, re-derived 2026-09-15) minus nothing, so the
     * cascade fact being measured is the same one — a `.btn` carrying a pile of padding and
     * ring utilities and NO `min-h-*`, whose only 44px source is the `@media (width < 48rem)`
     * rule. It is distinct from the `bare` probe below, which is the minimal `btn btn-secondary`
     * shape; the two measure the floor under different utility loads and both must hold.
     *
     * If a real bare-`.btn` call site still exists after every sweep, prefer the planted probe
     * anyway — an arm whose subject can be migrated away is an arm with an expiry date. (The two
     * `BrowseMoreModal` steppers are not a candidate: they carry `.btn-compact`, which opts OUT
     * of the floor by design.)
     */
    const probes = await page.evaluate(() => {
      const make = (className: string) => {
        const el = document.createElement('button');
        el.type = 'button';
        el.className = className;
        el.textContent = '+';
        document.body.appendChild(el);
        return el;
      };
      // Same class list the shipped steppers wear (BrowseMoreModal.js), plus a bare
      // control for the floor. `w-8`/`h-8` are emitted because those steppers use them.
      const compact = make('btn btn-compact btn-secondary w-8 h-8');
      const bare = make('btn btn-secondary');
      // The re-pointed real-call-site arm: "Manage Members"'s own shipped class string
      // (groupHomePage/page.js:872-878). Every class here is emitted because that call site
      // wears it today; `e2e/` is outside the `@source` globs (globals.css:10, :86-88), so a
      // class no `src/` file wears would render nothing and measure nothing.
      const shipped = make(
        'btn px-4 py-2 md:px-6 md:py-3 font-semibold text-sm md:text-base whitespace-nowrap ' +
          'text-content-primary bg-white/80 ring-1 ring-line-control dark:ring-0 ' +
          'rounded-btn hover:bg-surface-hover transition-all shadow-theme-md ' +
          'focus:outline-hidden focus-visible:ring-2 focus-visible:ring-focus-ring focus-visible:ring-offset-2',
      );
      const read = (el: HTMLElement) => {
        const r = el.getBoundingClientRect();
        return { width: r.width, height: r.height, minHeight: getComputedStyle(el).minHeight };
      };
      const result = { compact: read(compact), bare: read(bare), shipped: read(shipped) };
      compact.remove();
      bare.remove();
      shipped.remove();
      return result;
    });

    // (a) The floor is live at 375px — if this fails, the compact result below means nothing.
    expect(
      probes.bare.height,
      `bare .btn probe measured ${probes.bare.height}px (min-height: ${probes.bare.minHeight}) — the D-36 phone floor is NOT applying at 375px, which makes the .btn-compact assertion below vacuous. Look at globals.css's @media (width < 48rem) block and its authoring order, not at BrowseMoreModal`,
    ).toBeGreaterThanOrEqual(44);

    // (b) The opt-out wins: the stepper stays SQUARE, not stretched into a 32x44 lozenge.
    expect(
      probes.compact.height,
      `.btn.btn-compact probe measured ${probes.compact.height}px tall (min-height: ${probes.compact.minHeight}) — expected 32px. The opt-out lost the cascade: 87.8 AF-2 rejected an all-viewport floor precisely because it deforms these w-8 h-8 steppers into 32x44. Check that .btn-compact is still UNLAYERED and still authored AFTER the media block`,
    ).toBeCloseTo(32, 1);
    expect(
      Math.abs(probes.compact.width - probes.compact.height),
      `.btn.btn-compact probe measured ${probes.compact.width}x${probes.compact.height} — the steppers are square BY DESIGN and a height-only assertion would not have caught a 32x44 deformation`,
    ).toBeLessThanOrEqual(1);

    // (c) The RE-POINTED real-call-site arm (AMENDED Phase 88.6-12, see the block above): the
    // same shape "Manage Members" ships with — `.btn` plus a pile of utilities, no `min-h-*` —
    // still clears 44px from the media rule ALONE. Its `px-4 py-2` / `md:px-6 md:py-3` padding
    // utilities are dead under unlayered `.btn` (globals.css:2666-2674), which is part of the
    // fact being measured, not an accident of the probe.
    expect(
      probes.shipped.height,
      `the shipped-class-string .btn probe measured ${probes.shipped.height}px (min-height: ${probes.shipped.minHeight}) — a bare .btn carrying no min-h-* utility is below the 44px floor at 375px. This is the D-36 @media (width < 48rem) rule and nothing else; look at globals.css's media block and its authoring order. This probe replaced a "Manage Members" locator in 88.6-12 precisely so that migrating that control to <Button> could not make this assertion pass for the wrong reason`,
    ).toBeGreaterThanOrEqual(44);
  });

  /* UI-SPEC §9.3 **E10 · overflow** — two row-action controls side by side in ONE row at 375px
     produce no horizontal overflow. Landed Phase 88.6-12 (wave 5), BEFORE plan 18 migrates the
     two gameDetail controls onto `<Button>`; plan 18 re-runs this arm rather than authoring a
     second one. If you are plan 18 and about to write an adjacency probe: this is it — extend it.

     WHAT IT MEASURES AND IN WHAT ORDER:

       1. A PLANTED replica of the shipped row, ALWAYS. The row is
          `<div class="flex items-center gap-2 shrink-0 ml-auto">` (gameDetail/page.js:1956) with
          `GuestInviteButton` (className at :198) and the two-tap Remove (className at :1978)
          inside it, re-derived 2026-09-15. The replica carries the LONGEST label each control can
          render — "Already a member" and "Remove Bartholomew" — because a row only overflows at
          its widest state and a short-label probe would pass on a row that breaks in production.

       2. The SHIPPED row, WHEN THE FIXTURE RENDERS IT. This half is CONDITIONAL, deliberately,
          and the reasoning is the one already recorded a few tests above for the `.btn-compact`
          steppers: both controls sit behind `canInviteGuest(p, userRole)` / `(owner|admin) &&
          p.user_id && !isCurrentUser` (gameDetail/page.js:85-91, :1839-1844), i.e. they need a
          GUEST participation row on the fixture event with the viewer as owner. The backend's
          `scripts/e2e-fixtures.js` seeds `EventRsvp` rows for the RsvpSection surface and nothing
          that is known to satisfy that gate. A hard `guardResolved` here would red the phase's
          whole phone lane on a fixture fact rather than on a layout fact.
          This is NOT a silent skip: the planted half above is unconditional and carries the
          anti-vacuity floor, and the count of shipped rows found is asserted to be 0 or more with
          the number reported, so a reader always knows which halves ran. When the fixture does
          seed the pair, the shipped half asserts the same predicate on the real element.

     The predicate, both halves: the row's `scrollWidth` fits its `clientWidth` (allow 1px), each
     control's right edge stays within the row's, and the document induces no horizontal scroll
     (the `group-settings-danger.spec.ts:194-206` idiom).

     CI ONLY: e2e credentials are absent locally by design (`playwright.config.ts:22-24`) and CI
     runs `--project=setup --project=journeys --project=phone` (`ci.yml:652`). A local skip is not
     a pass. */
  test('UI-SPEC §9.3 E10: a two-control row-action pair does not overflow its row at 375px', async ({
    page,
  }, testInfo) => {
    await page.goto(E2E_EVENT_DETAIL_PATH);
    await assertDarkTheme(page);

    const viewportWidth = page.viewportSize()?.width ?? 375;

    // --- half 1: the planted replica, unconditional -------------------------------------
    const planted = await page.evaluate(() => {
      const host = document.createElement('div');
      // 375px from an INLINE style, never a Tailwind class: `e2e/` is outside the `@source`
      // globs (globals.css:10, :86-88), so a width class this file invents is never emitted
      // and the container would silently measure whatever the body gives it.
      host.setAttribute('style', 'width: 375px; padding: 0; margin: 0;');

      const row = document.createElement('div');
      // The shipped row wrapper, gameDetail/page.js:1956.
      row.className = 'flex items-center gap-2 shrink-0 ml-auto';

      const make = (className: string, text: string) => {
        const el = document.createElement('button');
        el.type = 'button';
        el.className = className;
        el.textContent = text;
        row.appendChild(el);
        return el;
      };
      // GuestInviteButton's resting className (gameDetail/page.js:198) with its widest label
      // ("Already a member"), and the two-tap Remove's (gameDetail/page.js:1978) with a long
      // participant name — `labelFor` renders `Remove {username}` in its armed state.
      const invite = make(
        'inline-flex min-h-11 items-center text-xs px-2 py-1 rounded-sm border border-line transition-colors hover:bg-surface-hover text-content-link',
        'Already a member',
      );
      const remove = make(
        'inline-flex min-h-11 items-center text-xs px-2 py-1 border rounded-sm transition-colors shrink-0 border-status-error text-content-status-error hover:bg-status-error-subtle',
        'Remove Bartholomew',
      );

      host.appendChild(row);
      document.body.appendChild(host);

      const rowRect = row.getBoundingClientRect();
      const result = {
        hostWidth: host.getBoundingClientRect().width,
        rowScrollWidth: row.scrollWidth,
        rowClientWidth: row.clientWidth,
        rowRight: rowRect.right,
        inviteRight: invite.getBoundingClientRect().right,
        removeRight: remove.getBoundingClientRect().right,
        inviteHeight: invite.getBoundingClientRect().height,
        removeHeight: remove.getBoundingClientRect().height,
      };
      host.remove();
      return result;
    });

    // Anti-vacuity: the container really is 375px and both controls really rendered.
    expect(
      planted.hostWidth,
      'UI-SPEC §9.3 E10: the planted container did not measure 375px, so every measurement below is against the wrong width. The width comes from an inline style on purpose — a Tailwind width class would not be emitted for e2e/ (globals.css:10, :86-88)',
    ).toBeCloseTo(375, 0);
    expect(
      Math.min(planted.inviteHeight, planted.removeHeight),
      'UI-SPEC §9.3 E10: one of the two planted row controls has zero height — it did not render, and the overflow assertions below would be vacuous. Check that every class in the replica is one `src/` still emits',
    ).toBeGreaterThan(0);

    expect(
      planted.rowScrollWidth,
      `UI-SPEC §9.3 E10: the planted two-control row scrolls to ${planted.rowScrollWidth}px inside a ${planted.rowClientWidth}px box at 375px — the pair overflows its row at its widest labels. Source companion: the per-control 44px floor is pinned at src/app/components/controlSizeFloor.test.tsx; this is the rendered half that source cannot see`,
    ).toBeLessThanOrEqual(planted.rowClientWidth + 1);
    for (const [label, right] of [
      ['the invite control', planted.inviteRight],
      ['the remove control', planted.removeRight],
    ] as const) {
      expect(
        right,
        `UI-SPEC §9.3 E10: ${label}'s right edge (${right}px) is past the row's (${planted.rowRight}px) at 375px`,
      ).toBeLessThanOrEqual(planted.rowRight + 1);
    }

    // --- half 2: the shipped row, when the fixture renders it ----------------------------
    // Located by ACCESSIBLE NAME, never a class (this file's selector policy).
    const removeControl = page.getByRole('button', { name: /^remove /i });
    const shippedRows = await removeControl.count();
    expect(
      shippedRows,
      'UI-SPEC §9.3 E10: negative count from the shipped-row locator — impossible; the locator itself is broken',
    ).toBeGreaterThanOrEqual(0);

    if (shippedRows > 0) {
      const row = removeControl.first().locator('xpath=..');
      const shipped = await row.evaluate((node) => {
        const el = node as HTMLElement;
        const rect = el.getBoundingClientRect();
        const kids = Array.from(el.children).map((c) => c.getBoundingClientRect().right);
        return {
          scrollWidth: el.scrollWidth,
          clientWidth: el.clientWidth,
          right: rect.right,
          childCount: kids.length,
          widestChildRight: kids.length > 0 ? Math.max(...kids) : rect.right,
        };
      });
      expect(
        shipped.scrollWidth,
        `UI-SPEC §9.3 E10 (shipped row): the row action group scrolls to ${shipped.scrollWidth}px inside a ${shipped.clientWidth}px box at 375px`,
      ).toBeLessThanOrEqual(shipped.clientWidth + 1);
      expect(
        shipped.widestChildRight,
        `UI-SPEC §9.3 E10 (shipped row): a row control's right edge (${shipped.widestChildRight}px) is past the row's (${shipped.right}px) at 375px`,
      ).toBeLessThanOrEqual(shipped.right + 1);
    }

    // --- which halves ran, on the record -------------------------------------------------
    // Reported, not asserted against a threshold: the planted half above is the gate, and this
    // line is what stops the conditional half from being a silent skip. `attachDiagnostics` is
    // the file's own read-only reporting channel (e2e/support/diagnostics.ts).
    //
    // DELIBERATELY NOT ASSERTED HERE: a document-level `scrollWidth <= viewport` check on the
    // event-detail page. E10's contract is about the two-control ROW, and a page-wide overflow
    // assertion on a surface this plan does not own would red on unrelated pre-existing debt and
    // be read as an E10 failure. The document-level idiom IS used, in the E1/E5 arm below, on the
    // surface that arm plants into. Adding one here is a decision, not a cleanup.
    await attachDiagnostics(testInfo, 'e10-row-overflow', {
      plantedRowScrollWidth: planted.rowScrollWidth,
      plantedRowClientWidth: planted.rowClientWidth,
      viewportWidth,
      shippedRowActionPairsFound: shippedRows,
    });
  });

  /* UI-SPEC §9.3 **E1 · long-text** and **E5 · overflow** — the two 375px RENDERED backstops.
     jsdom performs no layout, so the geometry half of each contract cannot be measured in a
     vitest suite; this arm is its only home. The SOURCE halves stay where they are and are the
     companions a red should be read against:
       - E1: plan 06's `Button.test.tsx` pin that the cva base carries no `truncate`;
       - E5: plan 03's `Heading.test.tsx` class-list pin that the cva base carries `wrap-anywhere`.

     PLANTED, in ONE container whose 375px width comes from an INLINE `style` and never from a
     Tailwind class: `e2e/` is outside the three `@source` globs (globals.css:10, :86-88), so a
     class only this file wears is never emitted and a probe wearing it measures nothing. For the
     same reason every class the probes wear is one `src/` already emits — `btn`/`btn-primary`
     from the shipped CTAs, `min-h-11` from the `Button` cva base, and
     `font-bold wrap-anywhere text-xl leading-tight` from `Heading.tsx`'s cva base + `heading`
     rung (re-derived 2026-09-15 from the landed primitive, `Heading.tsx:60` and `:64`).

     NO PROJECT GUARD OF ITS OWN: this is a 375px measurement and it belongs inside this file's
     phone-only describe, which is exactly what that block is for. The `journeys` arm added by the
     same plan is the opposite case and carries a mirror guard — do not "fix" this one to match it.

     CI ONLY (`playwright.config.ts:22-24`, `ci.yml:652`). A local skip is not a pass. */
  test('UI-SPEC §9.3 E1/E5: a long button label wraps without clipping, and an unbroken 60-char heading token stays inside its column at 375px', async ({
    page,
  }) => {
    await page.goto('/');
    await assertDarkTheme(page);

    const viewportWidth = page.viewportSize()?.width ?? 375;

    const probes = await page.evaluate(() => {
      const host = document.createElement('div');
      host.setAttribute('style', 'width: 375px; padding: 0; margin: 0;');

      const addButton = (text: string) => {
        const el = document.createElement('button');
        el.type = 'button';
        el.className = 'btn btn-primary min-h-11';
        el.textContent = text;
        host.appendChild(el);
        return el;
      };

      // E1. The SHORT label is one word. The LONG label is SYNTHETIC, and the reason is
      // arithmetic rather than preference: `.btn` is `font-size: .875rem` / `font-weight: 600`
      // with `padding: .5rem 1rem` (globals.css `.btn` rule), so a 375px column leaves 343px of
      // text width, and the longest labels in the shipped census ("Switch to Manual Entry",
      // "Add New Game Event") sit well inside that — a real label could not exercise the wrap
      // this row asserts. The synthetic one is 66 characters.
      // IT IS NOT ASSUMED TO WRAP: the assertion below is that the long probe is TALLER than
      // its short sibling, which is precisely a runtime verification that it exceeded one line.
      // If a future `.btn` type-scale change makes 66 characters fit, that assertion reds and
      // the label is what needs lengthening — do not weaken the assertion instead.
      const short = addButton('Save');
      const long = addButton(
        'Send the availability reminder to everyone in this group right now',
      );

      // E5. `Heading`'s base + `heading` rung on an <h2> carrying a 60-character unbroken
      // token. `wrap-anywhere` is the load-bearing class: `break-words` does not count in
      // min-content and so cannot stop a long token widening its column (plan 03).
      const TOKEN = 'A'.repeat(60);
      const heading = document.createElement('h2');
      heading.className = 'font-bold wrap-anywhere text-xl leading-tight';
      heading.textContent = TOKEN;
      host.appendChild(heading);

      // E5 negative control, paired the way the D-36 probes above are paired: the SAME token
      // without the wrap utility MUST overflow. If it does not, the container is not
      // constraining anything and the positive probe proves nothing.
      const control = document.createElement('h2');
      control.className = 'font-bold text-xl';
      control.textContent = TOKEN;
      host.appendChild(control);

      document.body.appendChild(host);

      const hostRect = host.getBoundingClientRect();
      const box = (el: HTMLElement) => {
        const r = el.getBoundingClientRect();
        const cs = getComputedStyle(el);
        return {
          width: r.width,
          height: r.height,
          right: r.right,
          scrollWidth: el.scrollWidth,
          textOverflow: cs.textOverflow,
          overflow: cs.overflow,
          lineHeight: cs.lineHeight,
        };
      };
      const result = {
        hostWidth: hostRect.width,
        hostRight: hostRect.right,
        hostClientWidth: host.clientWidth,
        short: box(short),
        long: box(long),
        heading: box(heading),
        control: box(control),
      };
      host.remove();
      return result;
    });

    // --- anti-vacuity --------------------------------------------------------------------
    expect(
      probes.hostWidth,
      'UI-SPEC §9.3 E1/E5: the planted container did not measure 375px, so nothing below is measured at phone width. The width is an inline style on purpose (globals.css:10, :86-88 — e2e/ is outside @source)',
    ).toBeCloseTo(375, 0);
    expect(
      probes.short.height,
      'UI-SPEC §9.3 E1: the SHORT-label probe has zero height — `btn btn-primary min-h-11` rendered nothing, so the wrap comparison below is vacuous. Every probe class must be one `src/` already emits',
    ).toBeGreaterThan(0);
    expect(
      probes.control.scrollWidth,
      `UI-SPEC §9.3 E5 (negative control): the wrap-less <h2> scrolls to only ${probes.control.scrollWidth}px inside a ${probes.hostClientWidth}px container — it was supposed to OVERFLOW. Its partner probe therefore proves nothing: either the 60-character token is no longer long enough at this width, or the container is not constraining its children`,
    ).toBeGreaterThan(probes.hostClientWidth + 1);

    // --- E1 · long-text ------------------------------------------------------------------
    // WRAPPED, not merely ">= 44": the `@media (width < 48rem)` `.btn` floor guarantees 44px
    // for BOTH probes, so a height-only floor would pass on a long label clipped to one line.
    // Taller-than-its-short-sibling is the only assertion that can tell the two apart.
    expect(
      probes.long.height,
      `UI-SPEC §9.3 E1: the long-label button measured ${probes.long.height}px tall, the same as or less than the short-label sibling (${probes.short.height}px) — the long label did NOT wrap onto a second line at 375px. Source companion: plan 06's Button.test.tsx pin that the cva base carries no \`truncate\`; if that pin is green and this is red, the clipping is coming from a call-site utility or from \`.btn\` itself, not from the primitive`,
    ).toBeGreaterThan(probes.short.height);
    expect(
      probes.long.right,
      `UI-SPEC §9.3 E1: the long-label button's right edge (${probes.long.right}px) is past its 375px container's (${probes.hostRight}px) — the label widened the column instead of wrapping inside it`,
    ).toBeLessThanOrEqual(probes.hostRight + 1);
    expect(
      probes.long.scrollWidth,
      `UI-SPEC §9.3 E1: the long-label button scrolls to ${probes.long.scrollWidth}px inside its 375px container (clientWidth ${probes.hostClientWidth}px). The comparison is against the PARENT, not the button's own box`,
    ).toBeLessThanOrEqual(probes.hostClientWidth + 1);
    expect(
      probes.long.textOverflow,
      `UI-SPEC §9.3 E1: the long-label button computes \`text-overflow: ${probes.long.textOverflow}\` — the label is being clipped with an ellipsis rather than wrapped. Source companion: plan 06's no-\`truncate\` pin on the cva base`,
    ).not.toBe('ellipsis');
    expect(
      probes.long.overflow,
      `UI-SPEC §9.3 E1: the long-label button computes \`overflow: ${probes.long.overflow}\` — a non-visible overflow clips the wrapped second line`,
    ).toBe('visible');

    // --- E5 · overflow -------------------------------------------------------------------
    expect(
      probes.heading.right,
      `UI-SPEC §9.3 E5: the <h2> carrying a 60-character unbroken token has its right edge at ${probes.heading.right}px, past its 375px container's (${probes.hostRight}px). Source companion: plan 03's Heading.test.tsx class-list pin that the cva base carries \`wrap-anywhere\` — if that pin is green and this is red, the utility is emitted but not applying`,
    ).toBeLessThanOrEqual(probes.hostRight + 1);
    expect(
      probes.heading.scrollWidth,
      `UI-SPEC §9.3 E5: the <h2> scrolls to ${probes.heading.scrollWidth}px inside a ${probes.hostClientWidth}px container — \`wrap-anywhere\` is not breaking the 60-character token. \`break-words\` does NOT count in min-content and is not a substitute (plan 03)`,
    ).toBeLessThanOrEqual(probes.hostClientWidth + 1);

    const docWidths = await page.evaluate(() => ({
      scrollWidth: document.documentElement.scrollWidth,
      clientWidth: document.documentElement.clientWidth,
    }));
    expect(
      docWidths.scrollWidth,
      `UI-SPEC §9.3 E5: document scrollWidth ${docWidths.scrollWidth}px exceeds the ${viewportWidth}px viewport (clientWidth ${docWidths.clientWidth}px) after the probes were removed — the page itself induces horizontal scroll at phone width`,
    ).toBeLessThanOrEqual(viewportWidth);
  });

  /* UI-SPEC §9.3 **E6 · overflow** and **E6 · long-text** — `KebabMenu`'s two 375px RENDERED
     backstops (Phase 88.6-16, D-12).

     WHY THEY ARE HERE AND NOT IN `KebabMenu.test.tsx`. jsdom performs no layout: every box it
     reports is zero, so a `scrollWidth <= clientWidth` assertion there is `0 <= 0` — green forever,
     for a menu that clips every item. That is asserted rather than assumed, by the
     `jsdom measures NOTHING` guard in `src/app/components/KebabMenu.test.tsx`, which reds if jsdom
     ever grows layout. The SOURCE halves stay in that file and are the companions a red here
     should be read against:
       - E6 overflow: the popover is `absolute right-0 min-w-[160px]` and carries no fixed width;
       - E6 long-text: the item carries no clipping utility in EITHER state and `min-h-11` is a
         floor, not a fixed height.

     PLANTED, for the same two reasons the E1/E5 arm above is planted. (1) The largest authored
     item set is `ManageMembers.js:595`'s mobile member kebab, which needs the Manage Members modal
     open on a seeded multi-member group — a fixture path this spec does not walk, and a hard guard
     on it would red the phone lane on a fixture fact rather than a layout fact (the same reasoning
     the shipped D-36 and E10 markers in this file already record). (2) `e2e/` is outside the three
     `@source` globs (`globals.css:10`, `:86-88`), so a class only this file wears is never emitted;
     every class below is copied VERBATIM from `KebabMenu.js`'s own shipped strings (re-derived
     2026-09-15 from the landed component: the `<ul>` className and the item `<button>` className),
     which is also what makes a future divergence between the replica and the component show up as
     a red rather than as a silent no-op.

     CI ONLY (`playwright.config.ts:22-24`, `ci.yml:652`). A local skip is not a pass. */
  test('UI-SPEC §9.3 E6: the kebab popover stays inside 375px with its largest item set, and a long item label wraps at >= 44px armed and disarmed', async ({
    page,
  }) => {
    await page.goto('/');
    await assertDarkTheme(page);

    const LONG_LABEL =
      'Transfer ownership of this group to this member right now, permanently and irreversibly';

    const probes = await page.evaluate((longLabel: string) => {
      // The 375px host width is an INLINE style, never a Tailwind class — see the marker above.
      // `relative` mirrors `KebabMenu.js`'s wrapper, which is what `absolute right-0` anchors to.
      const host = document.createElement('div');
      host.setAttribute('style', 'width: 375px; padding: 0; margin: 0;');
      const anchor = document.createElement('div');
      anchor.className = 'relative shrink-0';
      // the anchor sits at the row's right edge, as it does in every shipped row
      anchor.setAttribute('style', 'position: relative; margin-left: auto; width: 44px;');
      host.appendChild(anchor);

      const LIST_CLASS =
        'absolute right-0 top-full mt-1 z-20 min-w-[160px] bg-surface-card border border-line rounded-md shadow-theme-lg py-1';
      const ITEM_CLASS =
        'w-full min-h-11 text-left px-3 py-2 text-sm active:opacity-75 transition-colors disabled:opacity-50 disabled:cursor-not-allowed aria-disabled:opacity-50 aria-disabled:cursor-not-allowed focus:outline-hidden focus-visible:ring-2 focus-visible:ring-focus-ring focus-visible:ring-inset';
      const ARMED_EXTRA = 'text-content-status-error bg-status-error-subtle font-semibold';
      const RESTING_EXTRA = 'text-content-primary hover:bg-surface-hover';

      const buildList = (labels: Array<{ text: string; armed?: boolean }>) => {
        const ul = document.createElement('ul');
        ul.className = LIST_CLASS;
        ul.setAttribute('role', 'list');
        const buttons: HTMLElement[] = [];
        for (const { text, armed } of labels) {
          const li = document.createElement('li');
          const b = document.createElement('button');
          b.type = 'button';
          b.className = `${ITEM_CLASS} ${armed ? ARMED_EXTRA : RESTING_EXTRA}`;
          b.textContent = text;
          li.appendChild(b);
          ul.appendChild(li);
          buttons.push(b);
        }
        anchor.appendChild(ul);
        return { ul, buttons };
      };

      // The LARGEST authored item set: ManageMembers.js:595's mobile member kebab with the
      // owner-only transfer item spread in (`:625-632`).
      const largest = buildList([
        { text: 'Make admin' },
        { text: 'Remove' },
        { text: 'Transfer ownership to this member' },
      ]);

      document.body.appendChild(host);

      const box = (el: HTMLElement) => {
        const r = el.getBoundingClientRect();
        const cs = getComputedStyle(el);
        return {
          width: r.width,
          height: r.height,
          left: r.left,
          right: r.right,
          scrollWidth: el.scrollWidth,
          clientWidth: el.clientWidth,
          textOverflow: cs.textOverflow,
          overflow: cs.overflow,
        };
      };

      const hostRect = host.getBoundingClientRect();
      const result: Record<string, unknown> = {
        hostWidth: hostRect.width,
        hostLeft: hostRect.left,
        hostRight: hostRect.right,
        list: box(largest.ul),
        items: largest.buttons.map(box),
      };

      // Now the long-text probe, in BOTH states, in the same 375px host.
      largest.ul.remove();
      const disarmed = buildList([{ text: longLabel }]);
      (result as { longDisarmed?: unknown }).longDisarmed = box(disarmed.buttons[0]);
      (result as { longListDisarmed?: unknown }).longListDisarmed = box(disarmed.ul);
      disarmed.ul.remove();

      const armed = buildList([{ text: `${longLabel} — tap again`, armed: true }]);
      (result as { longArmed?: unknown }).longArmed = box(armed.buttons[0]);
      (result as { longListArmed?: unknown }).longListArmed = box(armed.ul);

      // the single-line control: the SAME item class with a one-word label, so "the long one
      // wrapped" is a comparison and not an assumption
      armed.ul.remove();
      const shortProbe = buildList([{ text: 'Remove' }]);
      (result as { shortItem?: unknown }).shortItem = box(shortProbe.buttons[0]);

      host.remove();
      return result as {
        hostWidth: number;
        hostLeft: number;
        hostRight: number;
        list: ReturnType<typeof box>;
        items: ReturnType<typeof box>[];
        longDisarmed: ReturnType<typeof box>;
        longListDisarmed: ReturnType<typeof box>;
        longArmed: ReturnType<typeof box>;
        longListArmed: ReturnType<typeof box>;
        shortItem: ReturnType<typeof box>;
      };
    }, LONG_LABEL);

    // --- anti-vacuity ----------------------------------------------------------------------
    expect(
      probes.hostWidth,
      'UI-SPEC §9.3 E6: the planted container did not measure 375px, so nothing below is measured at phone width. The width is an inline style on purpose (globals.css:10, :86-88 — e2e/ is outside @source)',
    ).toBeCloseTo(375, 0);
    expect(
      probes.list.width,
      'UI-SPEC §9.3 E6: the planted popover has zero width — it did not render, and every containment assertion below is vacuous. Every class in the replica must be one `src/` already emits',
    ).toBeGreaterThan(0);
    expect(
      probes.shortItem.height,
      'UI-SPEC §9.3 E6: the single-line control item has zero height, so the wrap comparison below cannot mean anything',
    ).toBeGreaterThan(0);

    // --- E6 · overflow ---------------------------------------------------------------------
    expect(
      probes.list.right,
      `UI-SPEC §9.3 E6: the open popover's right edge (${probes.list.right}px) is past its 375px container's (${probes.hostRight}px) with the largest authored item set. Source companion: KebabMenu.test.tsx's "right-anchored and min-width bounded" pin — if that is green and this is red, the clipping comes from a call-site wrapper, not the component`,
    ).toBeLessThanOrEqual(probes.hostRight + 1);
    expect(
      probes.list.left,
      `UI-SPEC §9.3 E6: the open popover's left edge (${probes.list.left}px) is outside its 375px container's (${probes.hostLeft}px) — it grew past the LEFT edge instead of staying inside`,
    ).toBeGreaterThanOrEqual(probes.hostLeft - 1);
    for (const [index, item] of probes.items.entries()) {
      expect(
        item.scrollWidth,
        `UI-SPEC §9.3 E6: item ${index} scrolls to ${item.scrollWidth}px inside its ${item.clientWidth}px box — its label is clipped inside the popover at 375px`,
      ).toBeLessThanOrEqual(item.clientWidth + 1);
    }

    // --- E6 · long-text --------------------------------------------------------------------
    // WRAPPED, not merely ">= 44": `min-h-11` guarantees 44px for a clipped single line too, so a
    // height-only floor would pass on a label truncated to one row. Taller-than-the-single-line
    // control is the only assertion that can tell the two apart.
    expect(
      probes.longDisarmed.height,
      `UI-SPEC §9.3 E6: the long item label measured ${probes.longDisarmed.height}px tall, the same as or less than the one-word control (${probes.shortItem.height}px) — it did NOT wrap onto a second line at 375px`,
    ).toBeGreaterThan(probes.shortItem.height);
    expect(
      probes.longDisarmed.textOverflow,
      `UI-SPEC §9.3 E6: the long item computes \`text-overflow: ${probes.longDisarmed.textOverflow}\` — the label is clipped with an ellipsis rather than wrapped`,
    ).not.toBe('ellipsis');
    expect(
      probes.longDisarmed.scrollWidth,
      `UI-SPEC §9.3 E6: the long item scrolls to ${probes.longDisarmed.scrollWidth}px inside its ${probes.longDisarmed.clientWidth}px box — the label widened the item instead of wrapping inside it`,
    ).toBeLessThanOrEqual(probes.longDisarmed.clientWidth + 1);
    expect(
      probes.longListDisarmed.right,
      `UI-SPEC §9.3 E6: with a long label the popover's right edge (${probes.longListDisarmed.right}px) is past the 375px container's (${probes.hostRight}px)`,
    ).toBeLessThanOrEqual(probes.hostRight + 1);

    // the ARMED swap is a different class string, so it is measured separately
    expect(
      probes.longArmed.height,
      `UI-SPEC §9.3 E6: the ARMED long item measured ${probes.longArmed.height}px tall — below the 44px floor. The armed label swap must not shrink the target`,
    ).toBeGreaterThanOrEqual(44);
    expect(
      probes.longArmed.height,
      `UI-SPEC §9.3 E6: the ARMED long item measured ${probes.longArmed.height}px, the same as or less than the one-word control (${probes.shortItem.height}px) — the armed label did not wrap either`,
    ).toBeGreaterThan(probes.shortItem.height);
    expect(
      probes.longListArmed.right,
      `UI-SPEC §9.3 E6: with an ARMED long label the popover's right edge (${probes.longListArmed.right}px) is past the 375px container's (${probes.hostRight}px)`,
    ).toBeLessThanOrEqual(probes.hostRight + 1);
  });

  test('R4: add-friend "+" carries a 44x32 ::after hit extension (owner-accepted asymmetric floor)', async ({ page }) => {
    await page.goto(E2E_EVENT_DETAIL_PATH);
    await assertDarkTheme(page);

    // Located by the DYNAMIC accessible-name pattern — the aria-label names the
    // person (`Add {username} as a friend`), which is the element's entire
    // accessible name (its only visible content is the "+" glyph).
    const addFriend = page.getByRole('button', { name: /^add .+ as a friend$/i });
    await guardResolved(
      addFriend,
      'the add-friend "+" control (needs an RSVP row whose member is not yet a friend — fixture must seed one)',
    );

    // The button's OWN box is 24x24 BY DESIGN (w-6 h-6 — D-13 technique 2: the control
    // must not visibly grow). Do NOT assert on boundingBox(); measure the effective
    // hit area the ::after pseudo-element adds instead.
    //
    // Phase 88.5 plan 10: the arithmetic that used to be written inline here is now the
    // shared `readEffectiveGeometry` helper, unchanged in substance — four more controls
    // need exactly this measurement and five copies of it would drift.
    const geometry = await readEffectiveGeometry(addFriend);

    expect(
      geometry.effectiveWidth,
      `add-friend effective width ${geometry.effectiveWidth}px < 44px — expected 24 + 10 + 10 = 44 (own ${geometry.ownWidth}px + 10px -inset-x each side); insets: ${JSON.stringify(geometry.insets)}`,
    ).toBeGreaterThanOrEqual(44);
    expect(
      geometry.effectiveHeight,
      `add-friend effective height ${geometry.effectiveHeight}px < 32px — expected 24 + 4 + 4 = 32 (own ${geometry.ownHeight}px + 4px -inset-y each side; 32 not 44 is the OWNER-ACCEPTED asymmetric floor of 2026-08-02 — the 4px space-y-1 row gap forbids a symmetric extension); insets: ${JSON.stringify(geometry.insets)}`,
    ).toBeGreaterThanOrEqual(32);
  });

  test('D-13: tap isolation on both axes — the extension never steals the username\'s or the adjacent row\'s taps', async ({ page }) => {
    await page.goto(E2E_EVENT_DETAIL_PATH);
    await assertDarkTheme(page);

    // Record any friend-request POST — the side effect that must NOT fire from
    // either probe point.
    const friendRequests: string[] = [];
    page.on('request', (req) => {
      if (req.url().includes('/friendships/request')) friendRequests.push(req.url());
    });

    const addFriend = page.getByRole('button', { name: /^add .+ as a friend$/i });
    await guardResolved(
      addFriend,
      'the add-friend "+" control for tap isolation (fixture must seed a not-yet-friend RSVP row)',
    );

    // WHY THE EDGES AND NEVER THE CENTRES: a mis-sized or regressed extension only
    // ever reaches a few pixels past the boundary it is violating — the CENTRE of the
    // username or of the adjacent row is the one point that failure mode can never
    // reach, so a centre probe cannot fail and is vacuous on BOTH axes. Probe (a) is
    // the username's edge nearest the button (the first point an oversized or
    // mis-signed horizontal extension reaches); probe (b) is the vertically adjacent
    // row's near edge (the first point a mis-sized after:-inset-y reaches). Probe (b)
    // is unconditional: the surface this control renders on (RsvpSection.js) stacks
    // member rows via space-y-1, so the vertical failure mode is always reachable.
    const probes = await addFriend.first().evaluate((btn) => {
      // elementFromPoint only resolves points INSIDE the viewport — the RSVP
      // section sits below the fold at 375x667 and nothing in this test scrolls
      // (assertions don't auto-scroll, only actions do), so unscrolled probes
      // returned null ("hit: none", run 30838155400). Centre the row first;
      // block:'center' also keeps the probe points clear of the sticky header.
      // scrollIntoView is synchronous, so the rects read below are post-scroll.
      btn.scrollIntoView({ block: 'center', inline: 'nearest' });
      const btnRect = btn.getBoundingClientRect();

      // The adjacent username span is the button's previous sibling inside the same
      // row (ClickableMemberName renders <span>{username}</span> then the "+").
      const username = btn.previousElementSibling as HTMLElement | null;
      const usernameRect = username?.getBoundingClientRect() ?? null;

      // The vertically adjacent row: walk up to the row element (direct child of the
      // space-y-1 stack) and take its sibling row — next if present, else previous.
      let row: HTMLElement | null = btn.parentElement;
      let adjacentRow: HTMLElement | null = null;
      while (row && !adjacentRow) {
        const sibling = (row.nextElementSibling ?? row.previousElementSibling) as HTMLElement | null;
        if (sibling && sibling.getBoundingClientRect().height > 0) {
          const sr = sibling.getBoundingClientRect();
          // A stacked sibling row sits above or below the button's row, not beside it.
          if (sr.top >= btnRect.bottom - 1 || sr.bottom <= btnRect.top + 1) adjacentRow = sibling;
        }
        if (!adjacentRow) row = row.parentElement;
      }
      const adjacentRect = adjacentRow?.getBoundingClientRect() ?? null;

      // Hit-test AND activate in the SAME synchronous tick. Three CI rounds proved
      // that any coordinate crossing an await boundary on this page goes stale:
      // the surface settles asynchronously (self-RSVP banner, summary line, member
      // popovers), so native taps at previously-measured points hit the wrong
      // element under CI load — run 30839631190 (popover overlay), 30840571076
      // (popover mount race), 30843134195 (vertical layout shift between measure
      // and tap). elementFromPoint + el.click() here is the race-free equivalent:
      // the browser hit-tests the point and activates exactly that element, with
      // zero opportunity for the layout to move in between. The gesture pipeline
      // itself is not what D-13 probes — the extension's tap-STEALING property is
      // pure hit-test geometry plus handler wiring, both of which this exercises.
      const hit = (x: number, y: number) => {
        const el = document.elementFromPoint(x, y);
        return {
          x,
          y,
          el: el instanceof HTMLElement ? el : null,
          isButton: el === btn || (el !== null && btn.contains(el)),
          tag: el?.tagName ?? 'none',
          text: (el?.textContent ?? '').slice(0, 40),
          insideUsername: username !== null && el !== null && (el === username || username.contains(el)),
        };
      };

      // (a) username's edge nearest the button: the username precedes the button, so
      // its NEAR edge is its right edge — probe 2px inward from it, vertically centred.
      const probeA = usernameRect
        ? hit(usernameRect.right - 2, usernameRect.top + usernameRect.height / 2)
        : null;

      // (b) the adjacent row's NEAR edge: the horizontal position of the button's
      // centre (where the extension lives), 2px inside the neighbouring row's edge
      // closest to the button.
      let probeB = null;
      if (adjacentRect) {
        const x = btnRect.left + btnRect.width / 2;
        const y =
          adjacentRect.top >= btnRect.bottom - 1
            ? adjacentRect.top + 2 // row below: just inside its top edge
            : adjacentRect.bottom - 2; // row above: just inside its bottom edge
        probeB = hit(x, y);
      }

      // BOTH hit-tests above ran against the pristine, popover-free layout; only
      // now are the resolved elements ACTIVATED — (b) first (already-friend row,
      // no add-friend action), then (a) (its username click legitimately opens
      // the member popover, asserted present-then-dismissed outside this
      // evaluate). React 18 flushes discrete click handlers synchronously, so
      // (b)'s popover could otherwise mount before (a)'s hit-test and cover it —
      // hit-test-both-THEN-activate-both removes that last ordering hazard.
      // Element references, not coordinates, are what get activated, so nothing
      // here can go stale.
      probeB?.el?.click();
      probeA?.el?.click();

      // The el references must not cross the evaluate boundary (not serialisable).
      const strip = (p: typeof probeA) =>
        p ? { x: p.x, y: p.y, isButton: p.isButton, tag: p.tag, text: p.text, insideUsername: p.insideUsername } : null;
      return { probeA: strip(probeA), probeB: strip(probeB), hasUsername: username !== null, hasAdjacentRow: adjacentRow !== null };
    });

    // Vacuity guards for the probe GEOMETRY itself.
    expect(
      probes.hasUsername,
      'no username span found adjacent to the add-friend button — the probe cannot be constructed; DOM shape changed, fix the probe, not the geometry',
    ).toBe(true);
    expect(
      probes.hasAdjacentRow,
      'no vertically adjacent member row found — probe (b) is MANDATORY on this surface (RsvpSection stacks rows via space-y-1); the fixture must seed at least two RSVP-visible members',
    ).toBe(true);

    // (a) Horizontal isolation: the point 2px inside the username's near edge must
    // hit the username (or its contents) — NEVER the add-friend button. The ml-2.5
    // clearance exists precisely so the 10px leftward extension terminates AT the
    // username's edge instead of inside it.
    expect(
      probes.probeA?.isButton,
      `probe (a) at the username's near edge (${probes.probeA?.x},${probes.probeA?.y}) hit the add-friend button — its leftward extension crossed the ml-2.5 clearance into the username's box (hit: ${probes.probeA?.tag} "${probes.probeA?.text}")`,
    ).toBe(false);
    expect(
      probes.probeA?.insideUsername,
      `probe (a) did not land inside the username span (hit: ${probes.probeA?.tag} "${probes.probeA?.text}") — probe geometry is off; fix the probe`,
    ).toBe(true);

    // (b) Vertical isolation: the point 2px inside the adjacent row's near edge must
    // hit that row's own content — NEVER the add-friend button. after:-inset-y-1 is
    // capped at 4px precisely so it terminates at the 4px space-y-1 gap.
    expect(
      probes.probeB?.isButton,
      `probe (b) at the adjacent row's near edge (${probes.probeB?.x},${probes.probeB?.y}) hit the add-friend button — its vertical extension crossed the 4px space-y-1 gap into the neighbouring row (hit: ${probes.probeB?.tag} "${probes.probeB?.text}")`,
    ).toBe(false);

    // Behavioural half: the probe activations happened INSIDE the evaluate above
    // (hit-test + el.click() in one synchronous tick — see the comment on hit()).
    // The expected behaviour: the adjacent-row activation carries no add-friend
    // side effect, and the username activation opens the member popover — which
    // must appear (positive proof the point resolved to the username), then be
    // dismissed and proven gone (presence-then-absence; absence-only checks race
    // the popover mount, run 30840571076).
    await expect(
      page.getByRole('button', { name: 'Add friend', exact: true }),
      'the username-edge activation must open the member popover with its "Add friend" action — if this never appears, the probe point did not resolve to the username',
    ).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(page.getByRole('button', { name: 'Add friend', exact: true })).toHaveCount(0);

    // Absence over a window, not an instant: the request pipeline is async (an
    // access-token fetch precedes POST /friendships/request), so a same-tick
    // sample reads 0 vacuously even when a tap DID activate the control. Give the
    // pipeline a bounded settle, then assert nothing fired and nothing swapped.
    await page.waitForTimeout(750);
    expect(
      friendRequests,
      `taps at the probe points fired ${friendRequests.length} friend-request call(s) — the hit extension is stealing adjacent taps`,
    ).toHaveLength(0);
    // The control still renders as "+" (aria-label intact, no swap to "⏳ Pending"),
    // proving neither tap activated it.
    await expect(addFriend.first()).toBeVisible();
    await expect(page.getByText('⏳ Pending')).toHaveCount(0);
  });

  test('R6: add-friend "+" press-dims via its per-site active:opacity-75', async ({ page }) => {
    await page.goto(E2E_EVENT_DETAIL_PATH);
    await assertDarkTheme(page);

    const addFriend = page.getByRole('button', { name: /^add .+ as a friend$/i });
    await guardResolved(addFriend, 'the add-friend "+" control for the press-feedback probe');
    // Non-.btn tappable: the press mechanism is the per-site active:opacity-75 token
    // plus cursor-pointer (REQUIRED for :active to fire on iOS — this bare button
    // does not use .btn, which is what carries cursor elsewhere). The helper releases
    // the pointer away from the element, so no friend request is sent by this probe.
    await assertPressedOpacity(page, addFriend, 'add-friend "+"');
  });

  /* ==========================================================================================
   * Phase 88.5 plan 10 — the five NEW tappable families (UI-SPEC section 12 item 10, A-9).
   *
   * Everything below is geometry at 375px, which is the only layer that can see it: jsdom has
   * no layout, so `MemberChipStack.test.tsx` can pin the class strings and the DOM shape but
   * cannot measure a single one of these numbers. The 32 + 6 + 6 = 44 chip arithmetic and the
   * "an extension terminates exactly at the 12px gap" claim are unfalsifiable anywhere else.
   * ========================================================================================== */

  test('R4 (SPEC Req 4): the calendar sheet hero\'s RSVP controls clear the 44px floor', async ({
    page,
  }) => {
    await page.goto('/');
    await assertDarkTheme(page);

    await guardResolved(calendarButton(page), 'the phone Calendar button (the route to the hero)');
    await calendarButton(page).click();
    const sheet = calendarSheet(page);
    await expect(sheet).toBeVisible();

    for (const name of ["I'm in", "Can't make it"]) {
      const control = sheet.getByRole('button', { name, exact: true });
      await guardResolved(
        control,
        `the hero's "${name}" RSVP control — the hero only renders when the seeded account has an upcoming event (NextGameNightCard returns null for a null event), so a miss here is a FIXTURE failure owned by periodictabletopbackend_v2/Sonnet/scripts/e2e-fixtures.js`,
      );
      // The sheet is a Radix dialog and geometry read at `toBeVisible()` is read at
      // animation START — see this helper's own block for the 43.913 -> 43.9915 measurement
      // that made it necessary.
      await settleOpenAnimation(page, control, `the hero's "${name}" control`);

      const geometry = await readEffectiveGeometry(control);
      // THE MECHANICAL FORM OF A PROHIBITION. `NextGameNightCard.tsx:370` carries `min-h-11`
      // and its marker says in as many words not to "restore" `RsvpSection.js:165`'s
      // `px-3 py-2` pairing in its place: `text-sm` (20px line) plus 16px of vertical padding
      // computes to about 36px, which fails this floor. That is the regression this assertion
      // exists to catch, so the number is named here rather than left to a diff review.
      expect(
        geometry.effectiveHeight,
        `the hero's "${name}" control measures ${geometry.effectiveHeight}px tall (own box ${geometry.ownHeight}px, extended by ${geometry.extendedBy}) — expected >= 44 from the min-h-11 at NextGameNightCard.tsx:370. Copying RsvpSection's px-3 py-2 pairing here computes to about 36px, which is exactly the prohibition D-07 constraint (i) records.`,
      ).toBeGreaterThanOrEqual(44);
      expect(
        geometry.effectiveWidth,
        `the hero's "${name}" control measures ${geometry.effectiveWidth}px wide — the two buttons are flex-1 halves of a full-width segmented group, so anything under 44 means the group itself collapsed`,
      ).toBeGreaterThanOrEqual(44);
      // Same non-redundancy argument as the Calendar button above: a real <button> reaches
      // the floor on its OWN box. A divergence here means a pseudo-element started carrying
      // the difference.
      expect(
        geometry.effectiveHeight,
        `the hero's "${name}" control needs a hit extension (${geometry.extendedBy}) to reach its effective ${geometry.effectiveHeight}px from an own box of ${geometry.ownHeight}px — the D-13 invisible-extension technique is for inline glyphs, not for a CTA that is supposed to BE 44px tall`,
      ).toBeCloseTo(geometry.ownHeight, 1);
    }
  });

  test('R4 (SPEC Req 5): the COLLAPSED member-chip stack is one target and clears 44x44', async ({
    page,
  }) => {
    await page.goto('/');
    await assertDarkTheme(page);

    const stack = collapsedChipStack(page);
    await guardResolved(
      stack,
      'the collapsed member-chip stack on a home group card — it renders only for a group with at least one NON-SELF member (UI-SPEC section 8: a viewer-only group renders no stack at all), so a miss here is a FIXTURE failure',
    );

    const geometry = await readEffectiveGeometry(stack);
    expect(
      geometry.effectiveHeight,
      `the collapsed chip stack measures ${geometry.effectiveHeight}px tall (own ${geometry.ownHeight}px) — expected >= 44 from the min-h-11 on the trigger. The chips inside it are 32px, so the trigger's own height utility is the entire mechanism`,
    ).toBeGreaterThanOrEqual(44);
    // WIDTH IS THE DIMENSION ACTUALLY AT RISK, and it is not symmetrical with height.
    // MEASURED in chromium at 375px (plan 88.5-10): a four-member stack is
    // 32 + 3 x 24 (the -ml-2 overlap) + 4 (pr-1) = 108px and clears the floor by miles; a
    // ONE-member stack is 32 + 4 = 36px and does NOT. `min-h-11` sets no min-width — the same
    // asymmetry `assertMin44`'s own comment records for the census CTAs — so the paired
    // `min-w-11` added to the trigger by this plan is what makes the single-member case legal.
    // A group of the viewer plus one other person is an ordinary shape, not an edge case.
    expect(
      geometry.effectiveWidth,
      `the collapsed chip stack measures ${geometry.effectiveWidth}px wide (own ${geometry.ownWidth}px) — expected >= 44. A one-member group renders a single 32px chip plus pr-1 = 36px, which is under the floor unless the trigger carries min-w-11 alongside min-h-11`,
    ).toBeGreaterThanOrEqual(44);
  });

  test('R4 + D-13 (SPEC Req 5): each EXPANDED chip is 32 + 6 + 6 = 44, and no chip steals its neighbour\'s taps', async ({
    page,
  }) => {
    await page.goto('/');
    await assertDarkTheme(page);

    const stack = collapsedChipStack(page);
    await guardResolved(stack, 'the collapsed member-chip stack (the route to the expanded row)');
    await stack.first().click();

    await guardResolved(
      showLessControl(page),
      'the "Show less" control — its presence IS the expanded state, so a miss here means the stack did not expand (the trigger stopPropagation may have stopped working and the tap navigated to the group instead)',
    );

    // The expanded row: `Show less`'s parent. Reached this way rather than by a test id
    // because the row is a plain div with no role — and its `useId`-derived id contains
    // colons, which are not valid in a bare CSS id selector.
    const row = showLessControl(page).first().locator('xpath=..');
    const chipTriggers = row.getByRole('button').filter({ hasNotText: 'Show less' });
    await guardResolved(
      chipTriggers,
      'the expanded chip triggers — the seeded account needs a group with at least TWO non-self members for the isolation probe below to be constructible; that is a FIXTURE failure, not a pass',
      2,
    );

    // (1) EVERY chip's effective geometry, one at a time through the shared helper. The
    // trigger's own box is the 32px chip; the 6px symmetric extension lives on the wrapper
    // span INSIDE it (HIT_EXTENSION), which is why `boundingBox()` would report 32 here and
    // fail for the wrong reason.
    const chipCount = await chipTriggers.count();
    for (let i = 0; i < chipCount; i += 1) {
      const geometry = await readEffectiveGeometry(chipTriggers.nth(i));
      expect(
        geometry.effectiveWidth,
        `expanded chip ${i + 1} of ${chipCount} has an effective width of ${geometry.effectiveWidth}px — expected 32 + 6 + 6 = 44 (own box ${geometry.ownWidth}px, extended by ${geometry.extendedBy}, insets ${JSON.stringify(geometry.insets)}). A broken sum names which term moved: a 32 means the extension is missing entirely, a 40 means after:-inset-1.5 became after:-inset-1`,
      ).toBeGreaterThanOrEqual(44);
      expect(
        geometry.effectiveHeight,
        `expanded chip ${i + 1} of ${chipCount} has an effective height of ${geometry.effectiveHeight}px — expected 32 + 6 + 6 = 44 (own box ${geometry.ownHeight}px, extended by ${geometry.extendedBy}, insets ${JSON.stringify(geometry.insets)})`,
      ).toBeGreaterThanOrEqual(44);
      expect(
        geometry.extendedBy,
        `expanded chip ${i + 1} reaches its floor on its OWN box (${geometry.ownWidth}x${geometry.ownHeight}) with no hit extension found — either the chip grew visibly, which D-13 rejects, or the HIT_EXTENSION pseudo is not applying and the 44px is coming from somewhere unintended`,
      ).not.toContain('nothing');
    }

    // (2) TAP ISOLATION at the gap edges.
    const probe = await probeExpandedChipRow(row);
    expect(
      probe.chipPair,
      `no adjacent pair of extension-carrying chips could be constructed from the ${probe.itemCount} items in the expanded row — the probe cannot be built, so fix the probe or the fixture, never the geometry. Row: ${probe.diagnostics}`,
    ).not.toBeNull();
    assertPairIsolated(probe.chipPair, 'two adjacent expanded member chips', 12, probe.diagnostics);
  });

  test('R4 + D-13 (SPEC Req 5): the "Show less" control clears 44x44 and steals no neighbouring tap', async ({
    page,
  }) => {
    await page.goto('/');
    await assertDarkTheme(page);

    const stack = collapsedChipStack(page);
    await guardResolved(stack, 'the collapsed member-chip stack (the route to "Show less")');
    await stack.first().click();

    const showLess = showLessControl(page);
    await guardResolved(
      showLess,
      'the "Show less" control — the only way back out of an expanded stack on a phone, and the one revealed-state control in this phase that would otherwise ship with no geometry assertion at all',
    );

    const geometry = await readEffectiveGeometry(showLess);
    expect(
      geometry.effectiveHeight,
      `"Show less" has an effective height of ${geometry.effectiveHeight}px (own ${geometry.ownHeight}px, extended by ${geometry.extendedBy}, insets ${JSON.stringify(geometry.insets)}) — expected >= 44 from min-h-11 plus its own 6px symmetric extension`,
    ).toBeGreaterThanOrEqual(44);
    expect(
      geometry.effectiveWidth,
      `"Show less" has an effective width of ${geometry.effectiveWidth}px (own ${geometry.ownWidth}px) — expected >= 44 from the text-xs word pair plus px-1 plus 6 + 6 of extension. This is a TEXT control, so its width follows its copy: shortening the label is a decision that has to keep clearing this floor`,
    ).toBeGreaterThanOrEqual(44);
    expect(
      geometry.extendedBy,
      `"Show less" carries no hit extension (own box ${geometry.ownWidth}x${geometry.ownHeight}) — it is written with the same HIT_EXTENSION constant as the chips (MemberChipStack.tsx:200, applied at :500) precisely so a 12px-gap row cannot leave it as the one un-extended target`,
    ).not.toContain('nothing');

    const row = showLess.first().locator('xpath=..');
    const probe = await probeExpandedChipRow(row);
    expect(
      probe.showLessPair,
      `"Show less" has no adjacent extension-carrying neighbour in the expanded row, so the isolation probe cannot be built — fix the probe or the fixture, never the geometry. Row: ${probe.diagnostics}`,
    ).not.toBeNull();
    assertPairIsolated(
      probe.showLessPair,
      '"Show less" and its immediate neighbour',
      12,
      probe.diagnostics,
    );
  });

  /**
   * DECISION Phase 88.8 DR-A: the 44x44 proof for the Email section is PLAYWRIGHT
   * GEOMETRY here, chosen OVER a vitest `min-height`/`min-width` assertion in the
   * section's colocated suite. The rejected option is not merely weaker — it cannot
   * measure anything. `vitest.config.mts:56` is `environment: 'jsdom'` with no `css`
   * key; `vitest.setup.ts` loads jest-dom, axe and a `matchMedia` stub only; and the
   * 44px floor lives in a MEDIA-QUERY rule (`globals.css:2227-2231`). In this repo's
   * own jsdom the media rule never applies, the window is 1024px rather than 375px,
   * `getBoundingClientRect()` returns all zeros and `parseFloat` yields `NaN` — at
   * which point an executor lands on the meaningless-but-green class-string assertion
   * that eleven shipped tests already use. `src/app/components/controlSizeFloor.test.tsx`
   * carries an explicit shipped REFUSAL to do this: "Deliberately NOT asserted here:
   * the 44px touch-target floor ... Adding a height assertion to this file would smuggle
   * that decision in." The SPEC names the browser project three times as the proof
   * mechanism and vitest zero times. Do not move this back into vitest.
   *
   * EVERY CONTROL IN THE SECTION IS REACHABLE NOW, which is a change worth recording.
   * Under the pre-A12 design the `Change` action lived in a verified state CI could not
   * reach without minting a live code, so it was routed to Phase 88.6 as UNMEASURED.
   * After SPEC A12 the IDLE state is the default and `Change` is the first thing on
   * screen, so all five phone-reachable controls are measured here.
   *
   * NO MAIL, NO BACKEND CHANGE, NO FIXTURE EDIT AND NO `page.route` (this suite has zero
   * `page.route` usage today). Both response arms of Save render the SAME three controls:
   * the send-success arm and the provider-refused arm (`verification_sent: false`) both
   * land in awaiting-code, the second with an error banner and Resend promoted. So the
   * test is provider-agnostic by construction — `services/emailService.js` no-ops without
   * `RESEND_API_KEY`, and `.github/workflows/ci.yml` references no mail provider at all.
   *
   * SEQUENCING — this test drives LIVE backend endpoints, so it cannot pass until the
   * backend is merged. `ci.yml` resolves the e2e job's backend checkout as
   * `${{ github.event.inputs.backend-ref || 'main' }}`, so a default run pins the backend
   * to `main`. Plan 14 merges the backend FIRST, so by the time the frontend PR merges,
   * `main` does carry plan 09's endpoints — but the frontend PR's OWN CI may have run
   * BEFORE that backend merge, in which case this test is red for a reason that is not a
   * defect. Re-run the frontend PR's e2e after the backend merge, or dispatch it with
   * `backend-ref` pointed at the backend branch (the established cross-repo pattern).
   * Do NOT "fix" a pre-merge red by weakening the assertion or skipping the test, and do
   * NOT "repair" a genuine red by adding a bare `min-h-11` — `globals.css:2197-2226`
   * rejects an all-viewport floor by name and the house phone-only form is
   * `max-md:min-h-11`.
   */
  /* CENSUS SCOPE, CORRECTED 2026-09-05 (code review #39). The title said "all five
     controls" while the section has SEVEN, so a partial census was reading as a
     complete gate. "Cancel" is now measured. The seventh — "Use my sign-in address"
     — is NOT reachable from this fixture and is named here rather than silently
     omitted: it renders only when the SERVER answers `revert_available: true`
     (round 2 HIGH-B; the earlier `email_changed_at` keying is gone), which
     requires a COMPLETED verification, and completing one needs the 8-character
     code out of a real mail that CI never sends (no provider key, so every send in
     CI is a refusal). Measuring it needs a seeded already-changed user, which is a
     fixture change this spec does not own. It carries the same `max-md:min-h-11`
     as its five measured siblings and is rendered by the same `Button`, so the
     risk is bounded — but bounded is not measured, and this comment is the record
     of that difference. */
  test('R4 (SPEC R12): six of the seven Email-section controls measure >= 44x44 at 375px', async ({ page }) => {
    // Component under test: src/app/components/EmailAddressSection.tsx, mounted on
    // /userProfile between the profile card and the Theme card. Named here as a
    // cross-reference only — every locator below is role + accessible name, per
    // this file's selector policy.
    await page.goto('/userProfile');
    await assertDarkTheme(page);

    // Selectors are role + accessible name ONLY, per this file's stated policy.
    // 1. IDLE — Change is the default-state control after SPEC A12.
    const change = page.getByRole('button', { name: 'Change', exact: true });
    await guardResolved(change, 'the Email section "Change" action (idle state)');
    await assertMin44(change, '"Change" (Email section, idle)');

    // 2. EDITING — Save. It carries `aria-disabled` while the field is empty and
    //    is deliberately NOT natively disabled (DR-C), so it is present and
    //    measurable from the moment the editing state renders.
    await change.click();
    const save = page.getByRole('button', { name: 'Save', exact: true });
    await guardResolved(save, 'the Email section "Save" action (editing state)');
    await assertMin44(save, '"Save" (Email section, editing)');

    // 2b. EDITING — Cancel, Save's sibling in the same row. Added 2026-09-05; it
    //     was omitted from the original census with no stated reason.
    const cancel = page.getByRole('button', { name: 'Cancel', exact: true });
    await guardResolved(cancel, 'the Email section "Cancel" action (editing state)');
    await assertMin44(cancel, '"Cancel" (Email section, editing)');

    // 3. AWAITING-CODE — Verify, Resend code and Discard change. Reached with a
    //    real Save; both response arms land here.
    await page.getByLabel(/new email address/i).fill('e2e-email-census@example.com');
    await save.click();

    const verify = page.getByRole('button', { name: 'Verify', exact: true });
    await guardResolved(verify, 'the Email section "Verify" action (awaiting-code state)');
    await assertMin44(verify, '"Verify" (Email section, awaiting-code)');

    const resend = page.getByRole('button', { name: 'Resend code', exact: true });
    await guardResolved(resend, 'the Email section "Resend code" action');
    await assertMin44(resend, '"Resend code" (Email section, awaiting-code)');

    const discard = page.getByRole('button', { name: 'Discard change', exact: true });
    await guardResolved(discard, 'the Email section "Discard change" action');
    await assertMin44(discard, '"Discard change" (Email section, awaiting-code)');

    // 4. RETURN THE FIXTURE TO IDLE. This is NOT optional housekeeping, and the
    //    reason became LITERALLY true on 2026-09-04 rather than nearly true.
    //    CI names no mail provider and `emailService.js` no-ops without a key, so
    //    every send in CI is a provider refusal. Under plan 09's PREVIOUS
    //    behaviour a refused send DESTROYED its token, so the fixture self-cleaned
    //    and this step was belt-and-braces. The owner's 2026-09-04 ruling KEEPS
    //    the token on a refusal, so the row now genuinely survives the run and
    //    genuinely re-hydrates the section into awaiting-code for every later spec
    //    that opens this page. Plan 09's cancel route exists for exactly this.
    //    Removing this step is a decision, not a cleanup.
    await discard.click();
    await expect(page.getByRole('button', { name: 'Change', exact: true })).toBeVisible();
  });
});

/* ==========================================================================================
   Phase 88.6-12 task 4 — D10 item 6: the GATED-HOVER, FOCUS-RING and HOVER-PIN proofs.
   DESKTOP `journeys` PROJECT ONLY.
   ==========================================================================================

   WHY THIS CANNOT LIVE IN THE PHONE PROJECT. Plan 05's `enabled-hover` custom variant compiles
   INSIDE a hover-capability media query (`globals.css:177-183`):

       @custom-variant enabled-hover {
         @media (hover: hover) {
           &:not(:disabled):not([aria-disabled='true']):hover { @slot; }
         }
       }

   Playwright's phone device profile reports `isMobile: true, hasTouch: true` and
   `matchMedia('(hover: hover)')` FALSE — recorded at `playwright.config.ts:106-110`, where the
   same fact is noted as making all ~222 `hover:` occurrences inert. A hover assertion run there
   would pass by never applying anything, which is the exact vacuity shape this plan exists to
   prevent.

   NAMING THE PROJECT IS NOT ENOUGH — THE FILE'S STRUCTURE IS WHAT SELECTS IT, and as the file
   stands it selects the WRONG one in both directions:
     - written INSIDE the file-wide describe (which opens at `:578` and carries
       `test.skip(({ isMobile }) => !isMobile, …)` at `:582`), this arm would inherit that skip,
       collect ZERO tests under `--project=journeys`, and its `<automated>` command would pass on
       an empty run;
     - hoisted out to fix that but left UNGUARDED, it would ALSO run under `--project=phone`,
       where `enabled-hover` never applies and all three proofs pass having asserted nothing.
   Both failure modes are green. So this describe sits OUTSIDE that block and carries the MIRROR
   guard — skip when the project IS mobile — as an EXECUTABLE statement, not a comment and not a
   naming convention. Each test additionally asserts `isMobile === false` in its own body, so an
   inverted guard reds instead of silently measuring the wrong capability.

   TASK 2(d)'s §9.3 E1/E5 ARM IS THE OPPOSITE CASE AND WAS DELIBERATELY LEFT ALONE: it is a 375px
   measurement, it belongs inside the existing phone-only describe, and it takes no guard. Do not
   "converge" the two.

   PLANTED PROBES, NOT SHIPPED CALL SITES. This plan runs in wave 5, BEFORE the gated-state
   migrations in plans 08 and 15-39, so no migrated subject exists yet. Same idiom as the D-36
   block above: `document.createElement`, one `page.evaluate` per read, classes that `src/` already
   emits, elements removed before the test ends.

   CI ONLY: `playwright.config.ts:22-24` (credentials absent locally by design) and `ci.yml:652`
   (`--project=setup --project=journeys --project=phone`). A local skip is not a pass.

   EXECUTED-COUNT FLOOR — DISCLOSED GAP. `scripts/gate-c-executed-floor.mjs` is this repo's idiom
   for "assert the gate actually EXECUTED", but it is scoped to `contrast.spec.ts` in the `phone`
   project. No equivalent floor covers this arm in `journeys`. The in-body `isMobile` assertions
   are the local substitute; the durable floor is registered in `.planning/WINDOWS.md`. */

/** The `Button` cva base, variant `primary`, as it ships after plan 06.
 *
 *  TRANSCRIBED from `src/components/ui/Button.tsx` (the cva base array plus
 *  `variant.primary`), and transcription is the only option here: importing `buttonVariants`
 *  into a Playwright spec would pull React, Radix Slot and `cva` through the Playwright
 *  transpiler. THE DRIFT GUARD IS NOT THIS COMMENT: `src/lib/cn.twMergeV3.test.ts` freezes the
 *  same literal and plan 06 made itself its re-seed owner, so a base change that forgets this
 *  file reds there. And if the base drifts in a way that matters HERE, proof 2's focused-vs-
 *  unfocused differential and proof 3's lg-vs-md comparison red rather than pass — neither is a
 *  string comparison against a transcribed value. */
const BTN_RING = 'focus:outline-hidden focus-visible:ring-2 focus-visible:ring-focus-ring focus-visible:ring-offset-2';
/** Everything in the base EXCEPT the elevation tokens, so each probe can supply its own pair
 *  and the resulting `box-shadow` composites stay comparable layer-for-layer. */
const BTN_SKELETON = `btn btn-primary ${BTN_RING} min-h-11`;
/** The base's own resting/hover elevation pair (plan 06, D10). */
const BASE_ELEVATION = 'shadow-theme-sm enabled-hover:shadow-theme-md';

/** Split a computed `box-shadow` into LAYERS on TOP-LEVEL commas only.
 *
 *  `rgba(0, 0, 0, 0)` contains commas, so a naive `value.split(',')` shatters one layer into
 *  four fragments and the per-layer loop then either throws on them or passes vacuously. The
 *  same reasoning and the same implementation are in `e2e/support/contrast.ts`
 *  (`shadowLayers`); it is private there, so this is a second copy rather than an import —
 *  registered in `.planning/WINDOWS.md` with the convergence owner. */
function shadowLayersOf(value: string): string[] {
  const out: string[] = [];
  let depth = 0;
  let current = '';
  for (const ch of value) {
    if (ch === '(') depth += 1;
    else if (ch === ')') depth -= 1;
    if (ch === ',' && depth === 0) {
      out.push(current.trim());
      current = '';
      continue;
    }
    current += ch;
  }
  if (current.trim().length > 0) out.push(current.trim());
  return out;
}

/** The alpha of a layer's colour, or 1 when it carries no explicit alpha. */
function layerAlpha(layer: string): number {
  const rgba = /rgba?\(([^)]*)\)/i.exec(layer);
  if (!rgba) return 1;
  const parts = rgba[1].replace(/\//g, ' ').split(/[\s,]+/).filter(Boolean);
  return parts.length >= 4 ? Number(parts[3]) : 1;
}

interface PlantedProbe {
  /** Accessible name, which is also how the test locates it. */
  name: string;
  className: string;
  disabled?: boolean;
  ariaDisabled?: boolean;
}

/** Plant a set of probes into a host container and return a remover. */
async function plantProbes(page: Page, probes: PlantedProbe[]): Promise<void> {
  await page.evaluate((specs) => {
    const host = document.createElement('div');
    host.setAttribute('data-e2e-hover-ring-probes', '');
    // Inline style, never a Tailwind class: `e2e/` is outside the `@source` globs
    // (globals.css:10, :86-88), so a class only this file wears is never emitted.
    host.setAttribute('style', 'position: relative; display: flex; gap: 8px; padding: 8px;');
    for (const spec of specs) {
      const el = document.createElement('button');
      el.type = 'button';
      el.className = spec.className;
      el.textContent = spec.name;
      if (spec.disabled) el.disabled = true;
      if (spec.ariaDisabled) el.setAttribute('aria-disabled', 'true');
      host.appendChild(el);
    }
    document.body.appendChild(host);
  }, probes);
}

async function removeProbes(page: Page): Promise<void> {
  await page.evaluate(() => {
    document.querySelectorAll('[data-e2e-hover-ring-probes]').forEach((el) => el.remove());
  });
}

interface ShadowRead {
  boxShadow: string;
  ringColor: string;
}

/**
 * Read one probe's computed `box-shadow` plus its resolved ring colour, AFTER the transition
 * has settled.
 *
 * THE SETTLE IS NOT DEFENSIVE — IT IS THE WHOLE CORRECTNESS OF THIS ARM, and it was found by
 * running the probes in a real Chromium rather than by reasoning. `.btn` carries
 * `transition: var(--theme-transition)` (globals.css:2173), and `--theme-transition`
 * (globals.css:1684) includes `box-shadow 0.25s ease`. Reading `getComputedStyle` immediately
 * after a `hover()` or a `focus()` therefore returns an INTERPOLATED value. Measured
 * 2026-09-15 in Chromium at 1280x720, reading with no settle:
 *
 *   focused default probe -> `rgba(251, 191, 36, 0.05) 0px 0px 0px 0.199587px`
 *
 * i.e. the amber focus ring at 5% of its alpha and 1/20th of its spread — about one frame into a
 * 250ms transition. The consequences, both of them silent:
 *   - the ring's non-transparent-layer check read alpha 0.05 and FAILED on a correct tree;
 *   - the gated probe's focused read came back byte-identical to its unfocused one (0% progress),
 *     so the focused-vs-unfocused DIFFERENTIAL failed on a correct tree too.
 * A settle-less version of this arm is a flaky red that a future reader would "fix" by loosening
 * the ring assertions — which is the failure this note exists to prevent.
 *
 * Two gates, the same pair `settleOpenAnimation` above uses and for the same reason: the Web
 * Animations API alone can miss a transition that starts a frame later, and a poll alone can
 * catch two identical mid-flight frames on a slow runner.
 */
async function readShadow(locator: Locator): Promise<ShadowRead> {
  await locator.evaluate(async (node) => {
    const running = (node as HTMLElement)
      .getAnimations()
      .filter((a) => a.effect?.getTiming().iterations !== Infinity);
    await Promise.all(running.map((a) => a.finished.catch(() => undefined)));
  });

  const latest: { value: ShadowRead | null } = { value: null };
  let previous: string | null = null;
  await expect
    .poll(
      async () => {
        const now = await locator.evaluate((node) => {
          const cs = getComputedStyle(node as HTMLElement);
          return {
            boxShadow: cs.boxShadow,
            ringColor: cs.getPropertyValue('--tw-ring-color').trim(),
          };
        });
        const stable = previous !== null && now.boxShadow === previous;
        previous = now.boxShadow;
        latest.value = now;
        return stable;
      },
      {
        message:
          'D10 item 6: the computed `box-shadow` never stopped changing. `.btn` transitions box-shadow over 0.25s (globals.css:1684, :2173); if it is still moving after 5s something is animating it continuously. Do NOT remove the settle and read the interpolated value instead.',
        timeout: 5_000,
        intervals: [50, 50, 100, 100, 250],
      },
    )
    .toBe(true);

  const settled = latest.value;
  if (settled === null) throw new Error('D10 item 6: the shadow poll produced no reading at all.');
  return settled;
}

test.describe('Phase 88.6-12 D10 item 6 — gated hover, focus ring and hover pin (journeys/desktop project)', () => {
  // THE MIRROR GUARD. The file-wide describe above skips when NOT mobile; this one skips when it
  // IS. Both halves are needed: without this line these three proofs also run at 375px, where
  // `enabled-hover` never applies and every one of them passes having asserted nothing.
  test.skip(
    ({ isMobile }) => isMobile,
    'D10 item 6: `enabled-hover` compiles inside @media (hover: hover), which the phone device profile never satisfies — these proofs are desktop-only by construction',
  );

  test.afterEach(async ({ page }) => {
    await removeProbes(page);
  });

  test('D10: a gated Button does not lift on hover — natively disabled AND aria-disabled', async ({
    page,
    isMobile,
  }) => {
    expect(
      isMobile,
      'D10 item 6: this test is running in a MOBILE project. The mirror guard above has been inverted or removed, and `enabled-hover` cannot apply here — the assertions below would pass having measured nothing',
    ).toBe(false);

    await page.goto(`/groupHomePage?id=${E2E_GROUP_ID}`);
    await assertDarkTheme(page);

    await plantProbes(page, [
      { name: 'gated native probe', className: `${BTN_SKELETON} ${BASE_ELEVATION}`, disabled: true },
      { name: 'gated aria probe', className: `${BTN_SKELETON} ${BASE_ELEVATION}`, ariaDisabled: true },
      { name: 'enabled control probe', className: `${BTN_SKELETON} ${BASE_ELEVATION}` },
    ]);

    const gated = [
      { label: 'natively `disabled`', locator: page.getByRole('button', { name: 'gated native probe' }) },
      { label: '`aria-disabled="true"`', locator: page.getByRole('button', { name: 'gated aria probe' }) },
    ];

    for (const probe of gated) {
      await guardResolved(probe.locator, `the ${probe.label} planted probe`);
      const resting = await readShadow(probe.locator);
      // VACUITY GUARD FIRST: if the resting value is empty or the bare keyword, the comparison
      // below proves nothing. `--shadow-sm` holds a valid transparent zero-length shadow after
      // 88.6-05's N1, so a real composite is expected here — the bare keyword `none` is the
      // signature of that revert, and its dedicated detector is plan 05's two Gate C pins in
      // `e2e/contrast.spec.ts`, not this arm.
      expect(
        resting.boxShadow.trim(),
        `D10 item 6: the ${probe.label} probe's RESTING computed box-shadow is empty — the hover comparison below would be vacuous. Check that the probe's classes are ones \`src/\` still emits (globals.css:10, :86-88)`,
      ).not.toBe('');
      expect(
        resting.boxShadow.trim(),
        `D10 item 6: the ${probe.label} probe's RESTING computed box-shadow is the bare keyword \`none\`. That is invalid inside Tailwind's composite list and annihilates the focus ring; the revert detector for it is plan 05's two Gate C pins in e2e/contrast.spec.ts. Fix \`--shadow-sm\`, do not loosen this`,
      ).not.toBe('none');

      await probe.locator.hover();
      const hovered = await readShadow(probe.locator);
      expect(
        hovered.boxShadow,
        `D10 item 6: the ${probe.label} probe's box-shadow CHANGED under hover (rest \`${resting.boxShadow}\` -> hover \`${hovered.boxShadow}\`) — a gated control lifted under the pointer and reads as pressable. TWO mechanisms can cause this and the failure is one or the other: (1) plan 05's \`enabled-hover\` variant lost one of its three clauses — the @media (hover: hover) wrapper, :not(:disabled), or :not([aria-disabled='true']) — each of which compiles clean on its own (globals.css:177-183, gated separately by src/app/cascadeOrder.test.ts); or (2) plan 06's cva base reverted its hover token to a bare \`hover:\` spelling (src/components/ui/Button.tsx)`,
      ).toBe(resting.boxShadow);
      // Move the pointer away so the next probe starts unhovered.
      await page.mouse.move(1, 1);
    }

    // POSITIVE CONTROL, so the three assertions above cannot pass because hover is inert here.
    // An ENABLED probe wearing the same base MUST change under hover; if it does not, the media
    // query is not matching and the gated results mean nothing.
    const enabled = page.getByRole('button', { name: 'enabled control probe' });
    await guardResolved(enabled, 'the ENABLED positive-control probe');
    const enabledRest = await readShadow(enabled);
    await enabled.hover();
    const enabledHover = await readShadow(enabled);
    expect(
      enabledHover.boxShadow,
      `D10 item 6 (positive control): an ENABLED probe wearing the same \`${BASE_ELEVATION}\` pair did NOT change under hover (\`${enabledRest.boxShadow}\`). \`enabled-hover\` is not applying at all in this project, so the two gated assertions above passed for the wrong reason. Check that this describe really runs in \`journeys\` and that matchMedia('(hover: hover)') is true there`,
    ).not.toBe(enabledRest.boxShadow);
    await page.mouse.move(1, 1);
  });

  test('D10: a focus-visible ring survives on BOTH a gated and a default Button — differential, non-transparent layer, and a ring-less negative control', async ({
    page,
    isMobile,
  }) => {
    expect(isMobile, 'D10 item 6: running in a MOBILE project — the mirror guard is inverted').toBe(false);

    await page.goto(`/groupHomePage?id=${E2E_GROUP_ID}`);
    await assertDarkTheme(page);

    await plantProbes(page, [
      { name: 'ring default probe', className: `${BTN_SKELETON} ${BASE_ELEVATION}` },
      { name: 'ring gated probe', className: `${BTN_SKELETON} ${BASE_ELEVATION}`, ariaDisabled: true },
      // NEGATIVE CONTROL: the same base MINUS the three ring utilities. It must FAIL the same
      // predicate. A one-sided proof of a "the ring exists" rule is exactly the shape that
      // passes when the ring is gone.
      { name: 'ringless negative control probe', className: `btn btn-primary min-h-11 ${BASE_ELEVATION}` },
    ]);

    /* WHY THIS IS NOT A `box-shadow !== 'none'` COMPARISON, stated because that is the obvious
       version and it is VACUOUS on this tree. Plan 05's N1 changed `--shadow-sm` from the bare
       keyword `none` to `0 0 #0000`, so every `<Button>` now computes a VALID all-transparent
       composite at rest and in every state and is never the string `none`. A `!== 'none'`
       assertion would therefore pass with `focus-visible:ring-2` deleted, with twMerge dropping
       it against a call-site `ring-0`, with `--color-focus-ring` transparent, and with plan 05's
       `enabled-hover` scoping suppressing it. Three independent checks replace it. */
    const predicate = async (
      name: string,
    ): Promise<{ differs: boolean; hasOpaqueRingLayer: boolean; unfocused: string; focused: string; ringColor: string }> => {
      const locator = page.getByRole('button', { name });
      await guardResolved(locator, `the planted probe "${name}"`);
      // Blur everything first so the "unfocused" read really is unfocused.
      await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
      const unfocused = await readShadow(locator);
      // The shipped keyboard-modality idiom (`e2e/support/contrast.ts` `focusByKeyboard`): a Tab
      // press sets the heuristic to KEYBOARD, then `.focus()` lands on the target. Without the
      // Tab, `:focus-visible` never matches a script-focused button in Chromium and the ring
      // rules never apply — which would make this whole proof read as "the ring is gone".
      await focusByKeyboard(page, locator);
      const focused = await readShadow(locator);

      // Normalise the ring colour THROUGH THE BROWSER rather than string-matching a format:
      // `--tw-ring-color` may serialise as `oklch(...)` while `box-shadow` serialises as
      // `rgb(...)`/`rgba(...)`. Painting it onto a throwaway element and reading `color` back
      // gives the same normalised form the shadow uses. NEVER a hard-coded colour string.
      const normalisedRing = await page.evaluate((raw) => {
        if (raw === '') return '';
        const probe = document.createElement('span');
        probe.style.color = raw;
        document.body.appendChild(probe);
        const out = getComputedStyle(probe).color;
        probe.remove();
        return out;
      }, focused.ringColor);

      const layers = shadowLayersOf(focused.boxShadow);
      const hasOpaqueRingLayer =
        normalisedRing !== '' &&
        layerAlpha(normalisedRing) > 0 &&
        layers.some((layer) => layer.includes(normalisedRing) && layerAlpha(layer) > 0);

      return {
        differs: focused.boxShadow !== unfocused.boxShadow,
        hasOpaqueRingLayer,
        unfocused: unfocused.boxShadow,
        focused: focused.boxShadow,
        ringColor: normalisedRing,
      };
    };

    for (const name of ['ring default probe', 'ring gated probe']) {
      const r = await predicate(name);
      // (a) THE DIFFERENTIAL.
      expect(
        r.differs,
        `D10 item 6: "${name}" computes the SAME box-shadow focused and unfocused (\`${r.focused}\`) — the focus-visible ring is not painting. Causes, in order of likelihood: the three ring utilities were dropped from the cva base (src/components/ui/Button.tsx); twMerge dropped them against a conflicting token; \`--color-focus-ring\` resolved transparent; or plan 05's \`enabled-hover\` scoping swallowed the ring line. NOT a \`--shadow-sm\` revert — that detector is plan 05's two Gate C pins in e2e/contrast.spec.ts`,
      ).toBe(true);
      // (b) A NON-TRANSPARENT LAYER CARRYING THE PAGE-RESOLVED RING COLOUR.
      expect(
        r.hasOpaqueRingLayer,
        `D10 item 6: "${name}" focused, no box-shadow layer carries the page-resolved ring colour (\`${r.ringColor || '(--tw-ring-color is EMPTY, i.e. the element never matched :focus-visible)'}\`) at non-zero alpha. Layers: ${shadowLayersOf(r.focused).join(' || ')}. A differential alone is not enough — an all-transparent change would satisfy it`,
      ).toBe(true);
    }

    // (c) THE PAIRED NEGATIVE CONTROL. It must FAIL the same predicate, in the spirit of the two
    // paired D-36 probes above: if a probe that CANNOT have a ring still satisfies the predicate,
    // the predicate is measuring something else and the two passes above are worthless.
    const control = await predicate('ringless negative control probe');
    expect(
      control.differs && control.hasOpaqueRingLayer,
      `D10 item 6 (negative control): a probe wearing the base classes MINUS \`${BTN_RING}\` SATISFIED the ring predicate (differs=${control.differs}, opaqueRingLayer=${control.hasOpaqueRingLayer}, focused=\`${control.focused}\`). The predicate is therefore not measuring the ring, and the two positive results above prove nothing. Do not weaken the positive assertions — fix the predicate`,
    ).toBe(false);
  });

  test('D10 / UI-SPEC §3.4 rule 2: a site that pins its own elevation hovers to ITS tier, not the base\'s', async ({
    page,
    isMobile,
  }) => {
    expect(isMobile, 'D10 item 6: running in a MOBILE project — the mirror guard is inverted').toBe(false);

    await page.goto(`/groupHomePage?id=${E2E_GROUP_ID}`);
    await assertDarkTheme(page);

    await plantProbes(page, [
      // The pinned site, in the spelling UI-SPEC §3.4 rule 2 requires. This is also the string
      // plan 06 MEASURED as the post-merge output: a call-site `enabled-hover:shadow-theme-lg`
      // de-dupes the base's `enabled-hover:shadow-theme-md` out of the merged class list, so the
      // shipped DOM carries exactly one `enabled-hover:` shadow token. The probe reproduces that.
      { name: 'pinned lg probe', className: `${BTN_SKELETON} shadow-theme-lg enabled-hover:shadow-theme-lg` },
      // REFERENCE probes, so the comparison is against values READ FROM THE PAGE rather than
      // hard-coded shadow strings. They wear the identical skeleton, differing only in the
      // resting elevation token and carrying no hover variant — so their composites are
      // layer-for-layer comparable with the pinned probe's hovered composite.
      { name: 'reference lg probe', className: `${BTN_SKELETON} shadow-theme-lg` },
      { name: 'reference md probe', className: `${BTN_SKELETON} shadow-theme-md` },
    ]);

    const pinned = page.getByRole('button', { name: 'pinned lg probe' });
    const refLg = page.getByRole('button', { name: 'reference lg probe' });
    const refMd = page.getByRole('button', { name: 'reference md probe' });
    for (const [label, locator] of [
      ['the pinned probe', pinned],
      ['the reference lg probe', refLg],
      ['the reference md probe', refMd],
    ] as const) {
      await guardResolved(locator, label);
    }

    const lgValue = (await readShadow(refLg)).boxShadow;
    const mdValue = (await readShadow(refMd)).boxShadow;
    // ANTI-VACUITY: the two tiers must actually differ, or the comparison below cannot fail.
    expect(
      lgValue,
      `D10 item 6: the resolved \`shadow-theme-lg\` and \`shadow-theme-md\` composites are IDENTICAL (\`${lgValue}\`), so no hover comparison can distinguish them. Either both tokens resolved to the same value or neither utility emitted`,
    ).not.toBe(mdValue);

    await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
    await pinned.hover();
    const hovered = (await readShadow(pinned)).boxShadow;
    expect(
      hovered,
      `D10 item 6 / UI-SPEC §3.4 rule 2: the pinned probe hovered to \`${hovered}\`, which is NOT the resolved \`shadow-theme-lg\` value (\`${lgValue}\`). If it matches the \`md\` value (\`${mdValue}\`) the base's hover token won and the pinned CTA SHRINKS on hover — an inverted elevation. Two mechanisms: plan 05's \`enabled-hover\` variant, or plan 06's cva base token. The source-level half of this rule is \`src/app/shadowTier.test.ts\`'s hover-pin assertion`,
    ).toBe(lgValue);
    expect(
      hovered,
      `D10 item 6 / UI-SPEC §3.4 rule 2: the pinned probe hovered to the base's \`md\` tier (\`${mdValue}\`) instead of its own \`lg\` pin — the inverted-elevation defect itself`,
    ).not.toBe(mdValue);
    await page.mouse.move(1, 1);
  });
});
