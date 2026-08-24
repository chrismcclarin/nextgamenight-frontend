import type { Page, TestInfo } from '@playwright/test';

/**
 * Phase 88.1 plan 19 — READ-ONLY measurement probes for the four failing CI cases.
 *
 * WHY THIS FILE EXISTS. `88.1-VERIFICATION.md` records four e2e failures whose CAUSES are
 * hypotheses, not findings (`.continue-here.md` "Defect triage" is explicit: the DISPROOFS
 * are settled, the causes are not). Nothing in this repo can execute Playwright locally
 * (`playwright.config.ts:19-21` — credentials are absent by design), so the only way to
 * turn a hypothesis into a fact is to instrument the cases and read a real CI browser.
 * Plan 19 measures; plan 20 fixes. Nothing here changes an assertion, a threshold or any
 * product code.
 *
 * WHY IT LIVES UNDER `e2e/support/` AND NOT NEXT TO THE SPECS. Playwright's default
 * `testMatch` glob collects only files whose basename ends in `.spec` or `.test` (plus a
 * js/ts extension), so a module named `diagnostics.ts` is importable without ever being
 * collected as a suite. (The literal glob is not quoted here: it contains a star-slash
 * pair that would close this comment.) `npx playwright test
 * --list` is the proof: the enumerated case count must not grow when this file lands.
 * This is the first module under `e2e/support/`.
 *
 * EVERY PROBE IS READ-ONLY — no scroll, no click, no style write. A probe that changed the
 * page would measure a state the failing gesture never saw.
 *
 * OUTPUT IS DELIBERATELY DUPLICATED, and both halves are load-bearing:
 *   - `testInfo.attach` produces the readable pretty-JSON artifact, but `ci.yml:522-533`
 *     uploads `test-results/` only `if: failure()`.
 *   - the ONE-LINE `console.log` lands in the raw job log, readable via
 *     `gh run view <id> --log | grep '\[DIAG '` with no download at all.
 * A multi-line console dump is unreadable in that log — the single line is a requirement,
 * not a preference. Do not "tidy" either path away.
 *
 * SECURITY (threat T-88.1-60): these probes report geometry, scroll state, tag/class names,
 * `data-coord` values and the `/Privacy` href. No cookies, no storage, no headers, no
 * `.auth/` content ever enters an attachment.
 */

// Every probe rounds to THREE decimals, never fewer: hypothesis C turns on 43.835 vs 44,
// and a two-decimal round would still show it but a one-decimal round would erase it.
// The rounding helper is re-declared inside each `page.evaluate` because those callbacks
// are serialised into the browser and cannot close over module scope.

// --- The one entry point -----------------------------------------------------

/**
 * Emit a diagnostic on BOTH output paths (see the file header for why both).
 *
 * The console form is a single line on purpose: `gh run view <id> --log` renders one
 * timestamped line per emission, and a pretty-printed object becomes an unreadable
 * interleaved smear there. `JSON.stringify` escapes any embedded newline, so the
 * one-line guarantee holds for arbitrary values.
 */
export async function attachDiagnostics(
  testInfo: TestInfo,
  label: string,
  value: unknown,
): Promise<void> {
  await testInfo.attach(label, {
    body: JSON.stringify(value, null, 2),
    contentType: 'application/json',
  });
  // `no-console` is disabled HERE and nowhere else, deliberately: this single line is the
  // only diagnostic path that survives a run whose artifact upload does not happen. The
  // attachment above is gated behind `ci.yml:522`'s `if: failure()`, so on any run that
  // does not fail there is no artifact at all — `gh run view <id> --log | grep '[DIAG '`
  // is then the ONLY way to read a measurement. Removing this is not a lint cleanup.
  // eslint-disable-next-line no-console
  console.log('[DIAG ' + label + '] ' + JSON.stringify(value));
}

// --- Probe result shapes -----------------------------------------------------

export interface ViewportProbe {
  innerWidth: number;
  innerHeight: number;
  docClientWidth: number;
  docScrollWidth: number;
  docClientHeight: number;
  docScrollHeight: number;
  bodyScrollWidth: number;
  bodyScrollHeight: number;
  scrollingElementScrollTop: number | null;
  /** `docScrollWidth - docClientWidth`. Hypothesis C's decisive number: any positive
   *  value means the page is wider than the viewport, which shrinks the visual-viewport
   *  scale and therefore every `boundingBox()` reading proportionally. */
  horizontalOverflowPx: number;
  visualViewport:
    | { width: number; height: number; scale: number; offsetTop: number; pageTop: number }
    | null;
  devicePixelRatio: number;
}

export interface OverflowCulprit {
  tag: string;
  id: string;
  className: string;
  right: number;
  width: number;
}

export interface ClipAncestor {
  tag: string;
  className: string;
  overflow: string;
  overflowY: string;
  rect: { top: number; bottom: number; left: number; right: number; height: number };
  scrollTop: number;
  scrollHeight: number;
  clientHeight: number;
  /** Direct children, with heights — so an element that GROWS mid-gesture can be named
   *  rather than inferred from a moved rect. Capped at 12. */
  children: { tag: string; className: string; height: number; top: number }[];
}

export interface CellProbe {
  coord: string;
  row: number;
  col: number;
  cx: number;
  cy: number;
  top: number;
  bottom: number;
  height: number;
  /** What `document.elementFromPoint(cx, cy)` actually resolves to at this cell's own
   *  centre. `usePaintGesture` resolves paint targets through exactly this call (its
   *  injected `pointResolver`), so a cell whose `resolvesTo` is not its own coord is a
   *  cell the gesture CANNOT paint — whatever any rect says about it. */
  resolvesTo: string | null;
}

export interface SchedulerGeometryProbe {
  gridCount: number;
  scroller: {
    top: number;
    bottom: number;
    left: number;
    right: number;
    height: number;
    scrollTop: number;
    scrollHeight: number;
    clientHeight: number;
    maxHeight: string;
    overflowY: string;
  };
  /** Every ancestor between the scroller and <body> that clips. The modal's own
   *  `max-h-[90vh] overflow-hidden` box (`Modal.tsx:186`) shows up HERE as a measured
   *  rect instead of as a citation. */
  clipChain: ClipAncestor[];
  /** The scroller's rect intersected with every clipping ancestor AND the viewport —
   *  i.e. the band a finger can actually land in. */
  clippedVisibleBand: { top: number; bottom: number; height: number };
  /** What `gridGeometry` (`event-scheduler-touch.spec.ts:194-242`) computes for the same
   *  thing: `Math.max(sr.top, 0)` .. `Math.min(sr.bottom, window.innerHeight)` — the
   *  VIEWPORT, not the clipped box. Reported side by side so the divergence is one glance
   *  rather than an inference. */
  specVisibleBand: { top: number; bottom: number; height: number };
  /**
   * The scroller's top expressed in the FIRST clipping ancestor's own CONTENT space
   * (`scrollerRect.top - clipRect.top + clipScrollTop`), which is invariant under that
   * ancestor's scrolling. This is the discriminator for a grid that MOVES mid-gesture:
   *   - the scroller's viewport rect moves AND this number moves -> content above the grid
   *     GREW (look at `clipChain[0].children` for the grower)
   *   - the scroller's viewport rect moves and this number does NOT -> the modal body
   *     SCROLLED; nothing grew.
   * null when the scroller has no clipping ancestor.
   */
  contentOffsetTopInClip: number | null;
  cells: CellProbe[];
  /** Cells the spec helper counts as visible (its own band, its own rule). */
  specVisibleCount: number;
  /** Cells inside the CLIPPED band — the ones actually reachable. */
  clippedVisibleCount: number;
  /** Of the cells inside the clipped band, how many resolve to themselves. */
  resolvingInClippedBand: number;
}

export interface FooterOcclusionProbe {
  authFooterPresent: boolean;
  publicFooterPresent: boolean;
  loadingPlaceholderLikely: boolean;
  spacerPresent: boolean;
  spacerRect: { top: number; bottom: number; height: number } | null;
  barRect: { top: number; bottom: number; height: number } | null;
  privacyLinkRect: { top: number; bottom: number; height: number } | null;
  privacyHref: string | null;
  scrollTop: number;
  /** `scrollHeight - clientHeight` of the scrolling element. `scrollTop` short of this
   *  means `window.scrollTo(0, document.body.scrollHeight)` did NOT reach the bottom —
   *  which explains a link bottom below the bar's top far more cheaply than a missing
   *  56px spacer does. */
  maxScrollTop: number;
  documentScrollHeight: number;
  bodyScrollHeight: number;
  innerHeight: number;
}

// --- Probes ------------------------------------------------------------------

/** Viewport + document metrics. `docScrollWidth` vs `docClientWidth` is hypothesis C. */
export async function probeViewport(page: Page): Promise<ViewportProbe> {
  return page.evaluate(() => {
    const round = (n: number) => Math.round(n * 1000) / 1000;
    const de = document.documentElement;
    const vv = window.visualViewport;
    return {
      innerWidth: window.innerWidth,
      innerHeight: window.innerHeight,
      docClientWidth: de.clientWidth,
      docScrollWidth: de.scrollWidth,
      docClientHeight: de.clientHeight,
      docScrollHeight: de.scrollHeight,
      bodyScrollWidth: document.body.scrollWidth,
      bodyScrollHeight: document.body.scrollHeight,
      scrollingElementScrollTop: document.scrollingElement
        ? round(document.scrollingElement.scrollTop)
        : null,
      horizontalOverflowPx: de.scrollWidth - de.clientWidth,
      visualViewport: vv
        ? {
            width: round(vv.width),
            height: round(vv.height),
            scale: vv.scale,
            offsetTop: round(vv.offsetTop),
            pageTop: round(vv.pageTop),
          }
        : null,
      devicePixelRatio: window.devicePixelRatio,
    };
  });
}

/**
 * NAME the elements that overflow horizontally instead of inferring that some element
 * must. Any element whose rect right edge exceeds `documentElement.clientWidth + 0.5`,
 * widest ten first.
 */
export async function probeOverflowCulprits(page: Page): Promise<OverflowCulprit[]> {
  return page.evaluate(() => {
    const round = (n: number) => Math.round(n * 1000) / 1000;
    const limit = document.documentElement.clientWidth + 0.5;
    const hits: OverflowCulprit[] = [];
    for (const el of Array.from(document.querySelectorAll('*'))) {
      const r = el.getBoundingClientRect();
      if (r.width === 0 && r.height === 0) continue;
      if (r.right > limit) {
        hits.push({
          tag: el.tagName.toLowerCase(),
          id: el.id || '',
          className: (typeof el.className === 'string' ? el.className : '').slice(0, 80),
          right: round(r.right),
          width: round(r.width),
        });
      }
    }
    return hits.sort((a, b) => b.right - a.right).slice(0, 10);
  }) as Promise<OverflowCulprit[]>;
}

/**
 * The scheduler's real geometry, resolved under the SAME structural rule the spec helper
 * uses — the parent of the first `[role="grid"]` inside the open dialog
 * (`event-scheduler-touch.spec.ts:194-242`).
 *
 * DECISION Phase 88.1-19: this probe MIRRORS `gridGeometry`'s resolution rule rather than
 * switching to a class selector — chosen so the two numbers are directly comparable. A
 * class selector would be more robust in isolation and is rejected for exactly that
 * reason: the point of this probe is to report `gridGeometry`'s own band NEXT TO the
 * clipped one, and two bands resolved under different rules cannot be compared. The
 * dialog scope is parity with the helper, NOT disambiguation — there is exactly one
 * `role="grid"` on the page (`EventScheduler.tsx:1054-1064` is the sole `<WeekGrid>`
 * mount; `EventHeatmapBackground.js` uses plain `className="grid"` cells with no ARIA
 * grid, contrary to `gridGeometry`'s own comment, which plan 20 owns).
 */
export async function probeSchedulerGeometry(page: Page): Promise<SchedulerGeometryProbe | null> {
  return page.evaluate(() => {
    const round = (n: number) => Math.round(n * 1000) / 1000;
    const root = document.querySelector('[role="dialog"]');
    if (!root) return null;
    const grids = root.querySelectorAll('[role="grid"]');
    const grid = grids[0] as HTMLElement | undefined;
    const scroller = (grid?.parentElement ?? null) as HTMLElement | null;
    if (!grid || !scroller) return null;

    const sr = scroller.getBoundingClientRect();
    const sStyle = window.getComputedStyle(scroller);

    // Every clipping ancestor between the scroller and <body>.
    const clipChain: ClipAncestor[] = [];
    let node: HTMLElement | null = scroller.parentElement;
    while (node && node !== document.body) {
      const cs = window.getComputedStyle(node);
      if (cs.overflow !== 'visible' || cs.overflowY !== 'visible') {
        const r = node.getBoundingClientRect();
        clipChain.push({
          tag: node.tagName.toLowerCase(),
          className: (typeof node.className === 'string' ? node.className : '').slice(0, 80),
          overflow: cs.overflow,
          overflowY: cs.overflowY,
          rect: {
            top: round(r.top),
            bottom: round(r.bottom),
            left: round(r.left),
            right: round(r.right),
            height: round(r.height),
          },
          scrollTop: round(node.scrollTop),
          scrollHeight: node.scrollHeight,
          clientHeight: node.clientHeight,
          children: Array.from(node.children)
            .slice(0, 12)
            .map((child) => {
              const cr = child.getBoundingClientRect();
              return {
                tag: child.tagName.toLowerCase(),
                className: (typeof child.className === 'string' ? child.className : '').slice(0, 60),
                height: round(cr.height),
                top: round(cr.top),
              };
            }),
        });
      }
      node = node.parentElement;
    }

    // The band a finger can actually land in: scroller INTERSECT every clip INTERSECT viewport.
    let bandTop = Math.max(sr.top, 0);
    let bandBottom = Math.min(sr.bottom, window.innerHeight);
    for (const c of clipChain) {
      bandTop = Math.max(bandTop, c.rect.top);
      bandBottom = Math.min(bandBottom, c.rect.bottom);
    }

    // What the SPEC helper computes for the same thing — viewport-clamped only.
    const specTop = Math.max(sr.top, 0);
    const specBottom = Math.min(sr.bottom, window.innerHeight);

    const cells = Array.from(grid.querySelectorAll('[data-coord]')).map((el) => {
      const coord = el.getAttribute('data-coord') ?? '';
      const [row, col] = coord.split(':').map(Number);
      const r = (el as HTMLElement).getBoundingClientRect();
      const cx = r.left + r.width / 2;
      const cy = r.top + r.height / 2;
      const hit = document.elementFromPoint(cx, cy);
      return {
        coord,
        row,
        col,
        cx: round(cx),
        cy: round(cy),
        top: round(r.top),
        bottom: round(r.bottom),
        height: round(r.height),
        resolvesTo: hit ? hit.closest('[data-coord]')?.getAttribute('data-coord') ?? null : null,
      };
    });

    const inSpecBand = cells.filter(
      (c) => c.top >= specTop && c.bottom <= specBottom && c.cx > 0 && c.cx < window.innerWidth,
    );
    const inClippedBand = cells.filter(
      (c) => c.top >= bandTop && c.bottom <= bandBottom && c.cx > 0 && c.cx < window.innerWidth,
    );

    return {
      gridCount: grids.length,
      scroller: {
        top: round(sr.top),
        bottom: round(sr.bottom),
        left: round(sr.left),
        right: round(sr.right),
        height: round(sr.height),
        scrollTop: round(scroller.scrollTop),
        scrollHeight: scroller.scrollHeight,
        clientHeight: scroller.clientHeight,
        maxHeight: sStyle.maxHeight,
        overflowY: sStyle.overflowY,
      },
      clipChain,
      clippedVisibleBand: {
        top: round(bandTop),
        bottom: round(bandBottom),
        height: round(bandBottom - bandTop),
      },
      specVisibleBand: {
        top: round(specTop),
        bottom: round(specBottom),
        height: round(specBottom - specTop),
      },
      contentOffsetTopInClip:
        clipChain.length > 0
          ? round(sr.top - clipChain[0].rect.top + clipChain[0].scrollTop)
          : null,
      cells,
      specVisibleCount: inSpecBand.length,
      clippedVisibleCount: inClippedBand.length,
      resolvingInClippedBand: inClippedBand.filter((c) => c.resolvesTo === c.coord).length,
    };
  }) as Promise<SchedulerGeometryProbe | null>;
}

export interface PointResolution {
  x: number;
  y: number;
  /** Tag of whatever is topmost at this exact coordinate. */
  tag: string | null;
  /** The `data-coord` of the nearest ancestor cell, or null if the point is over
   *  something that is not a grid cell at all. */
  resolvesTo: string | null;
  /** First 80 chars of the topmost element's class list — what the point hit, named. */
  className: string;
}

/**
 * Resolve `document.elementFromPoint` at a LIST of coordinates — the exact per-step
 * pointer path a stepped drag drives the finger along.
 *
 * `usePaintGesture` paints through `document.elementFromPoint` (its injected
 * `pointResolver`, wired at `EventScheduler.tsx:700`), and the hook's document-level
 * listeners are `pointerup`/`pointercancel` ONLY (`usePaintGesture.ts:503-504`) — there is
 * no document-level `pointermove`. So a step whose `resolvesTo` is null is a step the
 * gesture never saw, and a run of nulls at the end of a path is the difference between
 * "the range machine is broken" and "the spec drove the finger somewhere unpaintable".
 * READ-ONLY: this moves no pointer, it only asks what is under one.
 */
export async function probePointPath(
  page: Page,
  points: { x: number; y: number }[],
): Promise<PointResolution[]> {
  return page.evaluate((pts: { x: number; y: number }[]) => {
    const round = (n: number) => Math.round(n * 1000) / 1000;
    return pts.map((p) => {
      const el = document.elementFromPoint(p.x, p.y);
      return {
        x: round(p.x),
        y: round(p.y),
        tag: el ? el.tagName.toLowerCase() : null,
        resolvesTo: el ? el.closest('[data-coord]')?.getAttribute('data-coord') ?? null : null,
        className: el && typeof el.className === 'string' ? el.className.slice(0, 80) : '',
      };
    });
  }, points);
}

/**
 * Footer / phone-bar occlusion state, plus the two things the recorded failure cannot be
 * read without: whether the page actually scrolled to the bottom (`scrollTop` vs
 * `maxScrollTop`), and which footer variant rendered.
 *
 * The auth/public discriminator is the Report Bug control, which `Footer.js:12-13`
 * records as auth-only — a STRUCTURAL signal, chosen over a class name so a Tailwind
 * change cannot silently invert the reading. `privacyHref` is READ, never written: the
 * capital P is load-bearing for Google auth (CLAUDE.md, `Footer.js:9-11`).
 */
export async function probeFooterOcclusion(page: Page): Promise<FooterOcclusionProbe> {
  return page.evaluate(() => {
    const round = (n: number) => Math.round(n * 1000) / 1000;
    const box = (el: Element | null) => {
      if (!el) return null;
      const r = el.getBoundingClientRect();
      return { top: round(r.top), bottom: round(r.bottom), height: round(r.height) };
    };

    const reportBug = document.querySelector('[aria-label="Report bug or suggest feature"]');
    const privacy = Array.from(document.querySelectorAll('a')).find(
      (a) => (a.textContent ?? '').trim() === 'Privacy',
    );
    const footerEl = document.querySelector('footer');
    const spacer = document.querySelector('[data-testid="phone-bottom-bar-spacer"]');
    const bar = document.querySelector('[aria-label^="Open upcoming events"]');

    const se = document.scrollingElement ?? document.documentElement;

    return {
      authFooterPresent: Boolean(reportBug),
      publicFooterPresent: Boolean(footerEl) && !reportBug,
      // The loading branch renders `<div className="h-12" />` and NO footer at all
      // (`Footer.js:43`) — so "no <footer>, no Report Bug" is the fingerprint of a page
      // whose auth state had not resolved when the probe fired.
      loadingPlaceholderLikely: !footerEl && !reportBug,
      spacerPresent: Boolean(spacer),
      spacerRect: box(spacer),
      barRect: box(bar),
      privacyLinkRect: box(privacy ?? null),
      privacyHref: privacy ? privacy.getAttribute('href') : null,
      scrollTop: round(se.scrollTop),
      maxScrollTop: round(se.scrollHeight - se.clientHeight),
      documentScrollHeight: se.scrollHeight,
      bodyScrollHeight: document.body.scrollHeight,
      innerHeight: window.innerHeight,
    };
  });
}

// --- Plan 19's unsettled question: WHICH element grows? -----------------------

export interface FormChildBox {
  index: number;
  tag: string;
  className: string;
  height: number;
  top: number;
  /** First 48 characters of visible text — enough to NAME the block ("Suggestions",
   *  "Add games to enable suggestions"), never enough to be a data dump. */
  text: string;
}

/**
 * Plan 88.1-19's "ten-line probe", implemented (owner ruling D-12, 2026-08-24).
 *
 * WHAT IT ANSWERS. Plan 19 measured the create-event form growing EXACTLY 62px above the
 * scheduler grid on both viewports, but `probeSchedulerGeometry` stops at `clipChain[0]`'s
 * direct children — which is the single `<form class="space-y-4">` — so it could attribute the
 * growth to the form and no further. 19's SUMMARY names the fix in its own words: "recurse one
 * more level and report each form child's height in the pre-drag and mid-drag samples; the child
 * whose height changes by 62 is the answer."
 *
 * WHY IT IS STILL WIRED AFTER THE SPEC FIX. Plan 20 ruled item A spec-only (D-12) and routed the
 * PRODUCT finding — content shifting the grid under a user's finger — to Phase 88.6. That entry
 * names `QuickSuggestions` BY INSPECTION, which the project's Evidence Rule does not accept as a
 * finding. This probe converts the inspection into a measurement so the 88.6 planner inherits a
 * number instead of a lead. It asserts nothing and can never fail a case.
 *
 * READ-ONLY, like every probe in this file: no scroll, no click, no style write. The text slice
 * is fixture copy from an open Create Event dialog — no cookies, storage, headers or `.auth/`
 * content, per threat T-88.1-60.
 */
export async function probeFormChildHeights(page: Page): Promise<FormChildBox[] | null> {
  return page.evaluate(() => {
    const round = (n: number) => Math.round(n * 1000) / 1000;
    const form = document.querySelector('[role="dialog"] form');
    if (!form) return null;
    return Array.from(form.children).map((child, index) => {
      const r = child.getBoundingClientRect();
      return {
        index,
        tag: child.tagName.toLowerCase(),
        className: (typeof child.className === 'string' ? child.className : '').slice(0, 60),
        height: round(r.height),
        top: round(r.top),
        text: (child.textContent ?? '').replace(/\s+/g, ' ').trim().slice(0, 48),
      };
    });
  }) as Promise<FormChildBox[] | null>;
}

/**
 * Per-child height delta between two `probeFormChildHeights` samples, matched by index.
 * Pure arithmetic in the test process — nothing is read from the page here.
 */
export function formChildDeltas(
  before: FormChildBox[] | null,
  after: FormChildBox[] | null,
): { index: number; tag: string; className: string; text: string; heightDelta: number; topDelta: number }[] {
  if (!before || !after) return [];
  return after
    .map((a) => {
      const b = before.find((x) => x.index === a.index);
      if (!b) return null;
      return {
        index: a.index,
        tag: a.tag,
        className: a.className,
        text: a.text || b.text,
        heightDelta: Math.round((a.height - b.height) * 1000) / 1000,
        topDelta: Math.round((a.top - b.top) * 1000) / 1000,
      };
    })
    .filter((d): d is NonNullable<typeof d> => d !== null);
}
