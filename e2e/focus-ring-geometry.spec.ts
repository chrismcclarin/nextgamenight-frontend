import { writeFile } from 'node:fs/promises';

import { test, expect, type Locator, type Page, type Route, type TestInfo } from '@playwright/test';

import { assertTheme, C40_BAND, describeRing, focusByKeyboard, focusRingMeasurement, forceLightMode, type RingMeasurement } from './support/contrast';
import { E2E_FAKE_GAME_ID, E2E_GAME_PATH, routeFakeGameSuccess } from './support/fakeGame';
import { openGroupSettings } from './support/groupSettings';
import { expectNoApiWrites, holdWrites, settleAnimations, type WriteHold } from './support/inFlight';
import { answerPromptSettings } from './support/largeTextSurfaces/dialogs';
import { ALL_ROWS, sweepWriteGuard, type SweepHold } from './support/largeTextSurfaces/index';
import { readRingClip, readRingRoom, type RingClip, type SideRoom } from './support/ringGeometry';
import { scrubbedFetch } from './support/scrubbedFetch';
import { setTextMode, type TextMode } from './support/wordLines';

// Phase 88.9 plan 66 (X61, owner remarks at round-2 row N22) — keyboard focus rings as NUMBERS.
//
// THE REMARKS. At the keyboard-ring pictures the owner said the ring sits too close to the text on
// the right of several text controls, too far from one name, runs below the Requests tab and
// crosses the line under it, and asked why some rings have round corners and others square ones.
// This spec does not judge those looks. It records, per focused control, the numbers a ruling
// needs, in both projects (375 and 1280) and both themes:
//   - the control's border box and its ink box (a Range over each painted text node, plus every
//     svg and img inside it), so "too close" and "too far" are a gap in pixels per side;
//   - its border radius, which is what a box-shadow ring follows;
//   - every box-shadow layer the browser painted (spread and colour), the ring's outward reach,
//     and the halo band between control and ring;
//   - for a tab, how far the ring's bottom edge reaches past the top of the strip's bottom line.
// The numbers go to the run as an attachment named ring-geometry and are printed to the job log.
//
// WHAT IT ASSERTS, and only this: the house ring rule. A control that paints an OFFSET ring must
// paint a 4px ring over a 2px halo, the halo must read as the surface under the control (ratio at
// most 1.01, the floor the contrast gate uses), and the ring must not be cut off by an ancestor
// that clips its overflow or by the screen edge. A ring with no offset has no halo and is recorded
// only. Padding, radius and box size are looks: recorded, never asserted, so this spec cannot turn
// an unruled look into a red build.
// AMENDED Phase 89.6-14 (O-1 B): the house ring is 2 + 2, an outline over a fixed inner band; the
// halo-equals-surface clause is replaced by C40 separation. "House ring" is decided by the shared
// reader (focusRingMeasurement in e2e/support/contrast.ts) resolving: an outset ring is a 2px outline
// at offset 2 over a 2px band, an inset ring a transparent outline at -2 over inset bands of 2 and
// 4, and the two bands are at least C40_BAND (9:1) apart. Every number comes from the reader's band
// layer, never from the first or only shadow of the list. The ring's reach (how far it paints
// outside the box) is the reader's, so the clip check measures the outline, not the box-shadow.
// AMENDED Phase 88.9-52 (A-03): ONE more assertion, for every measured control, house ring or not:
// SOME focus indicator is painted — a box-shadow layer with a spread, or an outline with a width,
// in a colour that is not fully transparent (paintsIndicator below). Whether a focused control
// shows anything at all is WCAG 2.4.7, not a look. An ordinary drop shadow has no spread and does
// not count; the transparent 2px outline that the outline-hidden utility leaves for forced-colours
// mode does not count either. The Friends test proves the check can fail: it strips the indicator
// from one control with an injected style and reads the check as false.
//
// NOTHING IS WRITTEN. Writes are held in the browser (support/inFlight.ts); the friend and request
// rows are made-up rows answered in the browser; no test presses a control that writes. Selecting
// a group in the Invite to Group select sends one read. Focus is given by keyboard modality plus a
// programmatic focus, which presses nothing.
//
// CI ONLY: both projects need the signed-in storage state, which does not exist locally.
//
// Phase 88.9 plan 69 (X61 beyond Friends) adds four surfaces the same remarks named, on the same
// helpers and under the same rule (recorded, and only the house ring asserted): the Home small
// notice's Retry, the event view's group breadcrumb link and its Retry, a name in the RSVP list of
// the game page's upcoming event card and the Plan Game Session Retry (a fifth, the group page's
// Loading group gate Retry, left with that notice in 88.9-52 P1: the page shows its full banner). Each small notice is staged by answering the self-identity read with a 500 in the
// browser (the state the captured frames were in); the game page's upcoming night and its two
// replies are made up and answered in the browser. Nothing is written and no control is pressed.
//
// Phase 89.6 plan 31 (the ring census rows) adds the second describe, '89.6-31 ring census rows':
// rows HELD to owner pick O-1 B (2026-11-22) plus outline rule 10 (G1 a rounded corner of at least
// 4px, G2 side room round a standalone text control, and a ring no container cuts), read by
// measureRow through the shared ring reader, readRingRoom and the one clip read, readRingClip. Its
// cells come from the project: phone runs 320 x 568 at 200% text and 375 x 667 at 100%, journeys
// runs 1280 x 800 at 100%, both themes in each. It runs under the sweep's write guard and never
// calls unrouteAll.


const RING_FRIEND = { id: 'e2e-friends-x61-f', friend: { id: '88966a61-0000-4000-8000-0000000000d1', username: 'E2E Ring Friend' } };
const RING_REQUEST = {
  id: 'e2e-friends-x61-r',
  status: 'pending',
  Requester: { id: '88966a61-0000-4000-8000-0000000000d2', username: 'E2E Ring Requester' },
};

interface Edges {
  left: number;
  top: number;
  right: number;
  bottom: number;
}

interface ShadowLayer {
  inset: boolean;
  spread: number;
  colour: string;
}

interface RingRead {
  label: string;
  focusVisible: boolean;
  box: Edges;
  width: number;
  height: number;
  ink: Edges | null;
  /** Ink edge to the control's own edge, per side (negative: the ink pokes out of the box). */
  inkToBox: Edges | null;

  borderRadius: string;
  boxShadow: string;
  /** The outline as computed: its style, its width in px and its colour (A-03). */
  outlineStyle: string;
  outlineWidth: number;
  outlineColour: string;
  layers: ShadowLayer[];
  /**
   * How far the ring reaches outside the box: the reader's reach when the house ring resolved,
   * otherwise the widest outward spread or a painted outline's offset plus width.
   */
  outward: number;
  /** The first containing ancestor (or the screen edge) that cuts the ring, with how far it is cut per side (readRingClip). */
  clippedBy: RingClip | null;
  /** Tabs only: the ring's bottom edge minus the top of the strip's bottom line. */
  pastStripLine: number | null;
}

interface RingRecord extends RingRead {
  project: string;
  theme: 'dark' | 'light';
  viewport: number;
  houseRing: boolean;
  /** Ink edge to the inner edge of the outer ring, per side (89.6-14: the box gap plus the outline offset, or less the inset band). */
  inkToRing: Edges | null;
  /** From the shared reader when the house ring resolved (89.6-14), else null. */
  ringKind: 'offset' | 'inset' | null;
  outer: string | null;
  inner: string | null;
  outlineOffset: number | null;
  bandWidth: number | null;
  reach: number | null;
  bandRatio: number | null;
  /** The reader's throw when it did not resolve. */
  notHouse: string | null;
}

// One evaluate per control, after it holds a keyboard focus and its animations have settled.
// reach: the shared reader's reach when the house ring resolved (89.6-14); null reads it here.
async function readRing(control: Locator, reach: number | null = null): Promise<RingRead> {
  const read: Omit<RingRead, 'clippedBy'> = await control.evaluate((el, readerReach) => {
    const round = (n: number) => Math.round(n * 100) / 100;
    const cs = getComputedStyle(el);

    // Split on commas outside parentheses: rgb() and oklch() colours carry their own commas.
    const parts: string[] = [];
    let depth = 0;
    let current = '';
    for (const ch of cs.boxShadow) {
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
    const layers =
      cs.boxShadow === 'none'
        ? []
        : parts.map((part) => {
            const colour = (part.match(/[a-z-]+\([^)]*\)/i) ?? [''])[0];
            // Lengths only: strip the colour function first so its numbers are not read.
            const lengths = Array.from(part.replace(/[a-z-]+\([^)]*\)/gi, ' ').matchAll(/(-?\d*\.?\d+)px/g)).map((m) => Number(m[1]));
            return { inset: /\binset\b/.test(part), spread: lengths[3] ?? 0, colour };
          });
    const outside = layers.filter((l) => !l.inset && l.spread > 0).map((l) => l.spread).sort((a, b) => a - b);
    // An outline paints outside the box by its offset plus its width when it shows (89.6-14).
    const outlineShows = cs.outlineStyle !== 'none' && !/^rgba\([^)]*,\s*0\)$/.test(cs.outlineColor) && cs.outlineColor !== 'transparent';
    const outlineReach = outlineShows ? (parseFloat(cs.outlineOffset) || 0) + (parseFloat(cs.outlineWidth) || 0) : 0;
    const outward = readerReach ?? Math.max(0, outlineReach, outside.length ? outside[outside.length - 1] : 0);

    const rect = el.getBoundingClientRect();
    const box = { left: round(rect.left), top: round(rect.top), right: round(rect.right), bottom: round(rect.bottom) };

    // The ink: every painted text node (a Range gives its glyph run, not the element box) and every
    // svg or img. Screen-reader-only text is a clipped 1px box and paints nothing, so it is skipped.
    const inkRects: DOMRect[] = [];
    const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
    for (let node = walker.nextNode(); node; node = walker.nextNode()) {
      if (!(node.textContent ?? '').trim()) continue;
      const parent = node.parentElement;
      if (!parent) continue;
      const ps = getComputedStyle(parent);
      if (ps.visibility === 'hidden' || ps.display === 'none') continue;
      if (ps.position === 'absolute' && parent.getBoundingClientRect().width <= 1) continue;
      const range = document.createRange();
      range.selectNodeContents(node);
      for (const r of Array.from(range.getClientRects())) if (r.width > 0 && r.height > 0) inkRects.push(r);
    }
    for (const graphic of Array.from(el.querySelectorAll('svg, img'))) {
      const r = graphic.getBoundingClientRect();
      if (r.width > 0 && r.height > 0) inkRects.push(r);
    }
    const ink = inkRects.length
      ? {
          left: round(Math.min(...inkRects.map((r) => r.left))),
          top: round(Math.min(...inkRects.map((r) => r.top))),
          right: round(Math.max(...inkRects.map((r) => r.right))),
          bottom: round(Math.max(...inkRects.map((r) => r.bottom))),
        }
      : null;
    const inkToBox = ink
      ? {
          left: round(ink.left - box.left),
          top: round(ink.top - box.top),
          right: round(box.right - ink.right),
          bottom: round(box.bottom - ink.bottom),
        }
      : null;

    // The ring box, for the tab line below. Whether the ring is cut is read after this evaluate, by the
    // one clip read (e2e/support/ringGeometry.ts ("export async function readRingClip(")).
    const ring = { left: rect.left - outward, top: rect.top - outward, right: rect.right + outward, bottom: rect.bottom + outward };

    // A tab: the first ancestor that draws a bottom border is the strip; its line starts at the
    // bottom of its padding box.
    let pastStripLine: number | null = null;
    if (el.hasAttribute('aria-current') || el.parentElement?.querySelector('[aria-current]')) {
      for (let up = el.parentElement; up && up !== document.body; up = up.parentElement) {
        const us = getComputedStyle(up);
        const line = parseFloat(us.borderBottomWidth);
        if (line > 0) {
          pastStripLine = round(ring.bottom - (up.getBoundingClientRect().bottom - line));
          break;
        }
      }
    }

    const named = el.getAttribute('aria-label') ?? (el.tagName === 'SELECT' ? '' : (el.textContent ?? '').trim());
    const label = `${el.tagName.toLowerCase()}${el.id ? `#${el.id}` : ''} "${named.replace(/\s+/g, ' ').slice(0, 40)}"`;

    return {
      label,
      focusVisible: el.matches(':focus-visible'),
      box,
      width: round(rect.width),
      height: round(rect.height),
      ink,
      inkToBox,
      borderRadius: cs.borderRadius,
      boxShadow: cs.boxShadow,
      outlineStyle: cs.outlineStyle,
      outlineWidth: parseFloat(cs.outlineWidth) || 0,
      outlineColour: cs.outlineColor,
      layers: layers.filter((l) => l.spread > 0),
      outward,
      pastStripLine,
    };
  }, reach);
  return { ...read, clippedBy: await readRingClip(control, read.outward) };
}

// A colour that paints nothing: the keyword, a zero FOURTH value in the comma form
// (rgba(0, 0, 0, 0); never the three-value rgb(0, 0, 0), which is opaque black) or a zero alpha in
// the slash form (oklch(0.5 0.1 20 / 0), color(srgb 0 0 0 / 0)).
function isTransparent(colour: string): boolean {
  const c = colour.trim().toLowerCase();
  return c === 'transparent' || /^rgba\([^,]+,[^,]+,[^,]+,\s*0(\.0+)?\s*\)$/.test(c) || /\/\s*0(\.0+)?%?\s*\)$/.test(c);
}

// A-03: does the focused control paint ANY focus indicator? A box-shadow layer with a spread (the
// layers readRing keeps, inset or not) or an outline with a width, in a colour that shows. A layer
// whose colour could not be read is taken as showing.
function paintsIndicator(read: RingRead): boolean {
  const shadow = read.layers.some((layer) => !isTransparent(layer.colour));
  const outline = read.outlineStyle !== 'none' && read.outlineWidth > 0 && !isTransparent(read.outlineColour);
  return shadow || outline;
}

interface Context {
  page: Page;
  testInfo: TestInfo;
  theme: 'dark' | 'light';
  records: RingRecord[];
}

// Focus one control by keyboard, record it, and hold it to the house ring rule when it paints an
// offset ring. `mustBeHouse` names the controls this spec was written about: for those, painting
// no offset ring at all is itself a failure, so the test cannot pass by measuring nothing.
async function measure(ctx: Context, control: Locator, what: string, mustBeHouse: boolean): Promise<void> {
  const { page, testInfo, theme, records } = ctx;
  const where = `${what} (${theme}, ${testInfo.project.name})`;
  // The house ring is decided by the shared reader resolving (89.6-14); it focuses by keyboard and
  // waits for the control's transitions. Its throw names the shape it found.
  let m: RingMeasurement | null = null;
  let notHouse: string | null = null;
  try {
    m = await focusRingMeasurement(page, control, where);
  } catch (error) {
    notHouse = error instanceof Error ? error.message : String(error);
    await focusByKeyboard(page, control);
  }
  await settleAnimations(control);
  const read = await readRing(control, m ? m.reach : null);
  const houseRing = m !== null;
  // Ink to the outer ring's inner edge: the outline offset outside the box, or the inset band's spread inside it.
  const shift = m ? (m.ringGroundKind === 'offset' ? m.outlineOffset : -m.bandWidth) : 0;
  const inkToRing = read.inkToBox
    ? {
        left: Math.round((read.inkToBox.left + shift) * 100) / 100,
        top: Math.round((read.inkToBox.top + shift) * 100) / 100,
        right: Math.round((read.inkToBox.right + shift) * 100) / 100,
        bottom: Math.round((read.inkToBox.bottom + shift) * 100) / 100,
      }
    : null;
  const record: RingRecord = {
    ...read,
    label: `${what}: ${read.label}`,
    project: testInfo.project.name,
    theme,
    viewport: page.viewportSize()?.width ?? 0,
    houseRing,
    inkToRing,
    ringKind: m ? m.ringGroundKind : null,
    outer: m ? m.outer : null,
    inner: m ? m.inner : null,
    outlineOffset: m ? m.outlineOffset : null,
    bandWidth: m ? m.bandWidth : null,
    reach: m ? m.reach : null,
    bandRatio: m ? Math.round(m.bandRatio * 1000) / 1000 : null,
    notHouse,
  };
  records.push(record);

  expect.soft(read.focusVisible, `${where}: the control never matched :focus-visible`).toBe(true);
  expect
    .soft(
      paintsIndicator(read),
      `${where}: no focus indicator is painted (box-shadow: ${read.boxShadow}; outline: ${read.outlineWidth}px ${read.outlineStyle} ${read.outlineColour})`,
    )
    .toBe(true);
  if (mustBeHouse) {
    expect.soft(houseRing, `${where}: the house ring is not painted: ${notHouse}`).toBe(true);
  }
  if (!m) return;
  const ring = describeRing(where, m);
  const inset = m.ringGroundKind === 'inset';
  expect.soft(m.outlineWidth, `${where}: the outline is ${m.outlineWidth}px, the house ring 2px. ${ring}`).toBe(2);
  expect.soft(m.outlineOffset, `${where}: the outline sits at ${m.outlineOffset}px, the house ring ${inset ? -2 : 2}px. ${ring}`).toBe(inset ? -2 : 2);
  expect.soft(m.bandWidth, `${where}: the inner band is ${m.bandWidth}px, the house ring ${inset ? 4 : 2}px. ${ring}`).toBe(inset ? 4 : 2);
  expect.soft(m.reach, `${where}: the ring reaches ${m.reach}px outside the control, the house ring ${inset ? 0 : 4}px. ${ring}`).toBe(inset ? 0 : 4);
  expect.soft(m.bandRatio, `${where}: the two bands are not C40-apart. ${ring}`).toBeGreaterThanOrEqual(C40_BAND);
  expect
    .soft(
      read.clippedBy,
      `${where}: the ring is cut off by ${read.clippedBy?.by} (per side: ${JSON.stringify(read.clippedBy?.over)})`,
    )
    .toBeNull();
}

// The numbers leave the run two ways: the attachment (kept with the test's output) and one line
// per control in the job log, which is where a green run's numbers can be read from.
async function publish(testInfo: TestInfo, records: RingRecord[], census: CensusRecord[] = []): Promise<void> {
  expect(records.length + census.length, 'no control was measured, so there is nothing to record').toBeGreaterThan(0);
  const file = testInfo.outputPath('ring-geometry.json');
  await writeFile(file, JSON.stringify([...records, ...census], null, 1));
  await testInfo.attach('ring-geometry', { path: file, contentType: 'application/json' });
  for (const r of records) {
    const line = {
      project: r.project,
      theme: r.theme,
      viewport: r.viewport,
      what: r.label,
      size: [r.width, r.height],
      radius: r.borderRadius,
      ring: r.outward,
      kind: r.ringKind,
      outer: r.outer,
      inner: r.inner,
      outlineWidth: r.outlineWidth,
      outlineOffset: r.outlineOffset,
      bandWidth: r.bandWidth,
      reach: r.reach,
      bandRatio: r.bandRatio,
      inkToBox: r.inkToBox,
      inkToRing: r.inkToRing,
      pastStripLine: r.pastStripLine,
      clippedBy: r.clippedBy,
    };
    // eslint-disable-next-line no-console -- the measured ring numbers are this spec's product; plan 88.9-66's table reads them out of the CI log
    console.log(`[88.9-66 X61 ring] ${JSON.stringify(line)}`);
  }
  // The census rows (Phase 89.6-31): one line per record, the row id first.
  for (const c of census) {
    // eslint-disable-next-line no-console -- the census numbers are this spec's product; a green CI run prints nothing else per row
    console.log(`[89.6-31 census] ${c.row} ${JSON.stringify(c)}`);
  }
}

// ---- Phase 89.6-31: the ring census rows ----
//
// The rows owner pick O-1 B (2026-11-22, "Two-colour ring, 2px") left at risk: the Modal close, the
// sites plan 89.6-13 moved 2px outside their box, and the rows no earlier census reached. Unlike the
// X61 tests above, which record looks and assert only the house ring, a census row is HELD to the
// rule: the house ring resolves (the shared reader), its two bands are C40-apart, its corner is at
// least 4px (outline rule 10, G1), a standalone text control keeps side room (G2), and no container
// cuts it (the one clip read). The whole-tree census (every ring string in the tree) is plan 89.6-45.

/** One census row: a control the pick left at risk. */
interface CensusRow {
  id: string;
  /** 'house': held to the house ring. 'checkbox': the browser's own ring, a written exception (pick O-1b c). */
  kind: 'house' | 'checkbox';
  /** A standalone text control: G2 asks for room between its words and the ring, left and right. */
  textControl?: boolean;
  note?: string;
  /** The row has no production mount: it is measured at unit level and never reached here (the cite says where). */
  noConsumer?: string;
  /** The control draws nothing of its own (a transparent hit zone): its box stands in for its ink. */
  noInk?: boolean;
}

const EDGE_ROWS: readonly CensusRow[] = [
  { id: 'E-01', kind: 'house', note: 'the Modal close (every house dialog), read in Customize Group' },
  { id: 'E-02', kind: 'house', note: 'the Share Game QR close: the shared Modal close since plan 89.6-28' },
  { id: 'E-03', kind: 'house', note: 'the invite panel close: renders MODAL_CLOSE_CLASS since plan 89.6-10' },
  { id: 'E-04', kind: 'house', note: 'Clear game selection, in the Create Event game field' },
  { id: 'E-05', kind: 'house', noInk: true, note: 'the left half-star hit zone' },
  { id: 'E-06', kind: 'house', noInk: true, note: 'the right half-star hit zone' },
  { id: 'E-07', kind: 'house', textControl: true, note: 'Undo, after a participant is removed in Create Event' },
  { id: 'E-08', kind: 'house', textControl: true, note: 'Dismiss undo, beside it' },
  { id: 'E-09', kind: 'house', noConsumer: 'src/app/components/form/FormField.tsx ("which has no production consumer yet"): read at unit level in FormField.test.tsx' },
  { id: 'E-10', kind: 'house', textControl: true, note: 'Remove on a Friends row' },
  { id: 'E-11', kind: 'house', textControl: true, note: 'the Profile phone Remove (a made-up verified number staged in the browser)' },
  { id: 'E-12', kind: 'house', textControl: true, note: 'the Profile schedule Delete' },
  { id: 'E-13', kind: 'house', textControl: true, note: 'the Profile override Delete' },
  { id: 'E-14', kind: 'house', note: 'the first revealed collection title, focused by the page after Show all: a focus target, not a text control, so G2 does not apply' },
  { id: 'E-15', kind: 'house', textControl: true, note: 'Remove on a Profile collection card' },
  { id: 'E-16', kind: 'house', noInk: true, note: 'the shared Input, read on an empty Score input in Create Event' },
  { id: 'E-17', kind: 'house', note: 'the shared tab panel (TabsContent), read on the Profile availability tabs' },
];

// The Profile row staging (E-11, E-14, E-15). A phone number in the range reserved for fiction
// (555-0100 to 555-0199): no person has it. Eight made-up games, so the collection overflows at
// every width (three cards show on a phone, six from md). All of it exists only in the browser.
const CENSUS_PHONE = '+12025550143';
const CENSUS_GAMES = Array.from({ length: 8 }, (_, index) => ({
  id: `8963a031-0000-4000-8000-00000000000${index + 1}`,
  name: `E2E Census Game ${index + 1}`,
  image_url: null,
}));

// The self read: a path ending in /users/<id> (the exact path, never a prefix: the Profile writes
// are its siblings one segment below).
const isSelfRead = (url: URL): boolean => /\/users\/[^/]+$/.test(url.pathname);

// One read answered from the real answer, changed in the browser. GET only: any other method falls
// back to the write hold. The real answer is fetched without the self read's timezone parameter (so
// the backend's time zone backfill cannot run) through scrubbedFetch, never a bare route.fetch.
// Register it after the guard, so it runs first.
async function transformRead(page: Page, match: (url: URL) => boolean, change: (body: unknown) => unknown): Promise<void> {
  await page.route(match, async (route) => {
    if (route.request().method() !== 'GET') {
      await route.fallback();
      return;
    }
    const url = new URL(route.request().url());
    url.searchParams.delete('timezone');
    const response = await scrubbedFetch(route, { url: url.toString() });
    const body = (await response.json().catch(() => null)) as unknown;
    await route.fulfill({ response, json: change(body) });
  });
}

function censusRow(rows: readonly CensusRow[], id: string): CensusRow {
  const row = rows.find((candidate) => candidate.id === id);
  if (!row) throw new Error(`no census row ${id}`);
  return row;
}

interface CensusCell {
  width: number;
  height: number;
  mode: TextMode;
}

// DECISION Phase 89.6-31 (census-cells): the census cells split by project (phone: 320 / 200 and 375 / 100; journeys: 1280) OVER every cell in both projects (each cell measured twice per run, and the 1280 cell under touch emulation). Changing this is a decision, not a cleanup.
// The project is read by name and the test branches on it; it never skips (the house convention:
// e2e/profile-look-fixes.spec.ts ("branches on the project name, it never skips")).
const PHONE_CELLS: readonly CensusCell[] = [
  { width: 320, height: 568, mode: '200' },
  { width: 375, height: 667, mode: '100' },
];
const DESKTOP_CELLS: readonly CensusCell[] = [{ width: 1280, height: 800, mode: '100' }];
const censusCells = (testInfo: TestInfo): readonly CensusCell[] => (testInfo.project.name === 'phone' ? PHONE_CELLS : DESKTOP_CELLS);

interface CensusRecord {
  row: string;
  what: string;
  project: string;
  theme: 'dark' | 'light';
  textMode: TextMode;
  viewport: { width: number; height: number };
  kind: 'house' | 'checkbox';
  note?: string;
  // A house row: the shared reader's numbers, the ring room and the clip read.
  ringKind?: 'offset' | 'inset';
  outer?: string;
  inner?: string;
  outlineWidth?: number;
  outlineOffset?: number;
  bandWidth?: number;
  reach?: number;
  bandRatio?: number;
  ratio?: number;
  /** The control's smallest corner radius, px. */
  radius?: number;
  /** The ring's outer corner: radius + outlineOffset + outlineWidth. */
  ringRadius?: number;
  inkToRing?: SideRoom;
  box?: SideRoom;
  clippedBy?: RingClip | null;
  /** The shared reader's throw when the house ring did not resolve. */
  notHouse?: string;
  // A checkbox row: the browser's own ring.
  outlineStyle?: string;
  boxShadow?: string;
}

interface CensusContext {
  page: Page;
  testInfo: TestInfo;
  theme: 'dark' | 'light';
  cell: CensusCell;
  census: CensusRecord[];
}

const two = (n: number): number => Math.round(n * 100) / 100;

// G1: the house corner is at least 4px. G2: 4px of padding plus the ring's 2px offset is 6px of
// room; 0.5px is subpixel slack (the numbers of e2e/chrome-ring-geometry.spec.ts ("const MIN_SIDE_ROOM = 5.5;")).
const CENSUS_MIN_RADIUS = 4;
const CENSUS_MIN_SIDE_ROOM = 5.5;

// DECISION Phase 89.6-31 (census-record): every census row is held to owner pick O-1 B (2026-11-22) plus G1 and a whole ring, and overlap is recorded, never asserted OVER an overlap check — the owner: "There is no issue with B."; a ring cut by its container is the defect. Changing this is a decision, not a cleanup.
//
// Focus one census control by keyboard, record it, and hold it to its row's rule. It branches on
// the row's kind FIRST: the shared reader throws on the browser's own outline, so it never runs
// for a checkbox except to prove that throw.
async function measureRow(ctx: CensusContext, row: CensusRow, control: Locator, what = ''): Promise<void> {
  const { page, testInfo, theme, cell, census } = ctx;
  const where = `${row.id}${what ? ` ${what}` : ''} (${theme}, ${cell.width} x ${cell.height}, ${cell.mode}% text, ${testInfo.project.name})`;
  const base = {
    row: row.id,
    what,
    project: testInfo.project.name,
    theme,
    textMode: cell.mode,
    viewport: page.viewportSize() ?? { width: 0, height: 0 },
    kind: row.kind,
    ...(row.note ? { note: row.note } : {}),
  };

  if (row.kind === 'checkbox') {
    await focusByKeyboard(page, control);
    await settleAnimations(control);
    const read = await control.evaluate((el) => {
      const cs = getComputedStyle(el);
      return { focusVisible: el.matches(':focus-visible'), outlineStyle: cs.outlineStyle, boxShadow: cs.boxShadow };
    });
    census.push({ ...base, outlineStyle: read.outlineStyle, boxShadow: read.boxShadow });
    expect.soft(read.focusVisible, `${where}: the checkbox never matched :focus-visible`).toBe(true);
    expect.soft(read.outlineStyle, `${where}: the checkbox does not draw the browser's own ring (outline-style ${read.outlineStyle})`).toBe('auto');
    // No house band: neither the outset band (a 2px spread) nor the inset pair (2px and 4px).
    expect
      .soft(/\b0px 0px 0px [24]px\b/.test(read.boxShadow), `${where}: the checkbox carries a house band layer (box-shadow: ${read.boxShadow})`)
      .toBe(false);
    // The written exception is pinned by the reader itself: it refuses the browser's own outline.
    await expect(focusRingMeasurement(page, control, where), `${where}: the shared reader read the browser's ring as the house ring`).rejects.toThrow(
      /the browser's own outline, not the house ring/,
    );
    return;
  }

  let m: RingMeasurement;
  try {
    m = await focusRingMeasurement(page, control, where);
  } catch (error) {
    const notHouse = error instanceof Error ? error.message : String(error);
    census.push({ ...base, notHouse });
    expect.soft(false, `${where}: the house ring is not painted: ${notHouse}`).toBe(true);
    return;
  }
  const room = await readRingRoom(page, control, where, { allowNoInk: row.noInk === true });
  const clippedBy = await readRingClip(control, m.reach);
  const ringRadius = room.radius + m.outlineOffset + m.outlineWidth;
  census.push({
    ...base,
    ringKind: m.ringGroundKind,
    outer: m.outer,
    inner: m.inner,
    outlineWidth: m.outlineWidth,
    outlineOffset: m.outlineOffset,
    bandWidth: m.bandWidth,
    reach: m.reach,
    bandRatio: Math.round(m.bandRatio * 1000) / 1000,
    ratio: Math.round(m.ratio * 1000) / 1000,
    radius: two(room.radius),
    ringRadius: two(ringRadius),
    inkToRing: { left: two(room.inkToRing.left), right: two(room.inkToRing.right), top: two(room.inkToRing.top), bottom: two(room.inkToRing.bottom) },
    box: { left: two(room.box.left), right: two(room.box.right), top: two(room.box.top), bottom: two(room.box.bottom) },
    clippedBy,
  });

  const ring = describeRing(where, m);
  const inset = m.ringGroundKind === 'inset';
  expect.soft(m.outlineWidth, `${where}: the outline is ${m.outlineWidth}px, the house ring 2px. ${ring}`).toBe(2);
  expect.soft(m.outlineOffset, `${where}: the outline sits at ${m.outlineOffset}px, the house ring ${inset ? -2 : 2}px. ${ring}`).toBe(inset ? -2 : 2);
  expect.soft(m.bandWidth, `${where}: the inner band is ${m.bandWidth}px, the house ring ${inset ? 4 : 2}px. ${ring}`).toBe(inset ? 4 : 2);
  expect.soft(m.bandRatio, `${where}: the two bands are not C40-apart. ${ring}`).toBeGreaterThanOrEqual(C40_BAND);
  expect.soft(m.ratio, `${where}: neither band is 3:1 against the ground and the fill. ${ring}`).toBeGreaterThanOrEqual(3);
  expect.soft(room.radius, `${where}: G1 the ring corner is ${two(room.radius)}px, under ${CENSUS_MIN_RADIUS} (${room.summary})`).toBeGreaterThanOrEqual(CENSUS_MIN_RADIUS);
  expect
    .soft(clippedBy, `${where}: the ring is cut off by ${clippedBy?.by} (per side: ${JSON.stringify(clippedBy?.over)})`)
    .toBeNull();
  if (row.textControl) {
    expect
      .soft(
        Math.min(room.inkToRing.left, room.inkToRing.right),
        `${where}: G2 ink to ring is ${two(room.inkToRing.left)}px left and ${two(room.inkToRing.right)}px right, under 6 (${room.summary})`,
      )
      .toBeGreaterThanOrEqual(CENSUS_MIN_SIDE_ROOM);
  }
}

// The clip read can fail, and reads only what CSS lets clip (run once, on the open Customize Group
// dialog): (1) a header that clips at its own edge cuts the close's ring and is named; (2) an
// absolutely positioned control outside a clipping wrapper that is NOT its containing block is not
// cut, and is once the wrapper is positioned; (3) under the dialog's scroll lock, body's overflow
// is hidden while html's is visible, and body clips nothing.
async function proveClipRead(page: Page, dialog: Locator, close: Locator): Promise<void> {
  const { reach } = await focusRingMeasurement(page, close, 'clip self-proof: the Modal close');
  expect(await readRingClip(close, reach), 'clip self-proof: the close ring reads cut before anything is staged').toBeNull();

  // (1) The header clips at its own edge.
  const header = close.locator('xpath=..');
  await header.evaluate((el) => el.setAttribute('id', 'e2e-ring-clip-proof'));
  const clipping = await page.addStyleTag({ content: '#e2e-ring-clip-proof { overflow: hidden !important; padding: 0 !important; }' });
  const cut = await readRingClip(close, reach);
  expect(cut?.by ?? 'null', 'clip self-proof (1): a header clipping at its own edge is not named').toContain('#e2e-ring-clip-proof');
  expect(cut?.over.right ?? 0, `clip self-proof (1): the close ring passes the header's right edge by its reach (${JSON.stringify(cut?.over)})`).toBeGreaterThan(reach - 0.5);
  await clipping.evaluate((el) => el.parentNode?.removeChild(el));
  await header.evaluate((el) => el.removeAttribute('id'));
  expect(await readRingClip(close, reach), 'clip self-proof (1): the read did not recover once the staged style left').toBeNull();

  // (2) A clipping wrapper that is not the control's containing block clips nothing.
  await page.evaluate(() => {
    const wrap = document.createElement('div');
    wrap.id = 'e2e-ring-clip-wrap';
    wrap.setAttribute('style', 'overflow: hidden; width: 40px; height: 40px;');
    const button = document.createElement('button');
    button.id = 'e2e-ring-clip-abs';
    button.type = 'button';
    button.textContent = 'x';
    button.setAttribute('style', 'position: absolute; left: 100px; top: 200px; width: 44px; height: 44px;');
    wrap.appendChild(button);
    document.body.appendChild(wrap);
  });
  const fixture = page.locator('#e2e-ring-clip-abs');
  expect(await readRingClip(fixture, reach), 'clip self-proof (2): a wrapper that is not the containing block was read as cutting').toBeNull();
  await page.evaluate(() => document.getElementById('e2e-ring-clip-wrap')?.style.setProperty('position', 'relative'));
  const contained = await readRingClip(fixture, reach);
  expect(contained?.by ?? 'null', 'clip self-proof (2): the wrapper, once positioned, is not named').toContain('#e2e-ring-clip-wrap');
  await page.evaluate(() => document.getElementById('e2e-ring-clip-wrap')?.remove());

  // (3) The scroll lock: body's overflow is hidden, html's is visible, the page is made shorter
  // than the screen, and the dialog's last control lies outside body's box.
  const last = dialog.locator('button, a[href], input, select, textarea').last();
  await last.focus();
  const lock = await page.evaluate(() => {
    const body = getComputedStyle(document.body);
    const html = getComputedStyle(document.documentElement);
    return { body: `${body.overflowX} ${body.overflowY}`, html: `${html.overflowX} ${html.overflowY}` };
  });
  expect(lock.body, 'clip self-proof (3): the open dialog did not lock the page scroll on body').toBe('hidden hidden');
  expect(lock.html, "clip self-proof (3): html's overflow is not visible, so body's is its own").toBe('visible visible');
  await page.evaluate(() => document.body.style.setProperty('height', '10px', 'important'));
  const outside = await last.evaluate((el) => el.getBoundingClientRect().top > document.body.getBoundingClientRect().bottom);
  expect(outside, "clip self-proof (3): the dialog's last control is not outside body's box").toBe(true);
  expect(await readRingClip(last, reach), "clip self-proof (3): body's scroll-lock overflow was read as cutting the dialog's last control").toBeNull();
  await page.evaluate(() => document.body.style.removeProperty('height'));
}

const isFriendshipList = (url: URL, key: 'status' | 'direction', value: string) =>
  url.pathname.endsWith('/friendships') && url.searchParams.get(key) === value;

// One made-up friend and one made-up request, answered in the browser.
async function answerFriendsLists(page: Page) {
  await page.route(
    (url) => isFriendshipList(url, 'status', 'accepted') || isFriendshipList(url, 'direction', 'received'),
    async (route) => {
      if (route.request().method() !== 'GET') {
        await route.fallback();
        return;
      }
      const received = new URL(route.request().url()).searchParams.get('direction') === 'received';
      await route.fulfill({ status: 200, json: received ? [RING_REQUEST] : [RING_FRIEND] });
    },
  );
}

function brandLink(page: Page): Locator {
  // Matched by a pattern from when the logo carried a label of its own (decoration since 88.9-52; the pattern still holds).
  return page.getByRole('navigation', { name: 'Main', exact: true }).getByRole('link', { name: /Next Game Night/ });
}

async function openInTheme(page: Page, path: string, theme: 'dark' | 'light') {
  if (theme === 'light') await forceLightMode(page);
  await page.goto(path);
  await assertTheme(page, theme);
}

const THEMES = ['dark', 'light'] as const;

// ---- Plan 88.9-69: the four surfaces outside Friends ----

// Seeded fixtures minted by the backend's scripts/e2e-fixtures.js in CI (the padding-budget idiom).
const E2E_GROUP_ID = process.env.E2E_GROUP_ID ?? '1';
const E2E_EVENT_DETAIL_PATH = process.env.E2E_EVENT_DETAIL_PATH ?? `/gameDetail?event_id=1&group_id=${E2E_GROUP_ID}`;
const GROUP_EVENTS_PATH = new RegExp(`^/api/events/group/${E2E_GROUP_ID}$`);

// The self-identity read: GET /api/users/<one segment> (the read e2e/support/viewerRsvp.ts passes through).
const isIdentityRead = (url: URL) => /\/api\/users\/[^/]+$/.test(url.pathname);

// A made-up upcoming night of the fake custom game, with two made-up replies. Every id is synthetic.
const RING_NIGHT_ID = '0e2e0000-0000-4000-8000-000000000069';
const RING_REPLY_NAME = 'E2E Ring Reply';
const RING_REPLIES = {
  rsvps: [
    {
      id: '0e2e0000-0000-4000-8000-0000000069c1',
      status: 'yes',
      note: null,
      user_id: '0e2e0000-0000-4000-8000-0000000069d1',
      User: { id: '0e2e0000-0000-4000-8000-0000000069d1', username: RING_REPLY_NAME },
    },
    {
      id: '0e2e0000-0000-4000-8000-0000000069c2',
      status: 'maybe',
      note: null,
      user_id: '0e2e0000-0000-4000-8000-0000000069d2',
      User: { id: '0e2e0000-0000-4000-8000-0000000069d2', username: 'E2E Ring Maybe' },
    },
  ],
  summary: { yes: 1, maybe: 1, no: 0 },
};
const DAY_MS = 24 * 60 * 60 * 1000;

// An answer made up in the browser names the asking origin, so it is readable whether the page
// reaches the API on its own origin or on the backend's.
function allowOrigin(route: Route): Record<string, string> {
  const origin = route.request().headers()['origin'];
  return origin ? { 'access-control-allow-origin': origin, 'access-control-allow-credentials': 'true' } : {};
}

// Answers the self-identity read with a 500 while `failing()` holds; every other request, and every
// request once it stops holding, falls back unchanged. With no identity a page shows the shared
// small notice ("Some personal controls are unavailable.") with its Retry. No write follows.
async function failIdentityRead(page: Page, failing: () => boolean = () => true): Promise<void> {
  await page.route(isIdentityRead, async (route) => {
    if (route.request().method() !== 'GET' || !failing()) {
      await route.fallback();
      return;
    }
    await route.fulfill({ status: 500, json: { error: 'e2e forced failure (88.9-69 X61)' }, headers: allowOrigin(route) });
  });
}

// Measures every visible small-notice Retry on the page. A page can mount the notice more than
// once at a width (Home at 1280: the Your Groups panel and the desktop column beside it), so each
// one is measured and the caller is told whether it sat inside the Your Groups panel, which is the
// one ancestor carrying the phone-flat surface class.
async function measureVisibleRetries(ctx: Context, surface: string, nameMount?: (inGroupsPanel: boolean) => string): Promise<boolean[]> {
  const { page, theme } = ctx;
  const retries = page.getByRole('button', { name: 'Retry', exact: true }).filter({ visible: true });
  await expect(retries.first(), `X61 (${theme}): ${surface}: the small notice with Retry never rendered`).toBeVisible({ timeout: 30_000 });
  const total = await retries.count();
  const mounts: boolean[] = [];
  for (let i = 0; i < total; i += 1) {
    const retry = retries.nth(i);
    const inGroupsPanel = await retry.evaluate((el) => el.closest('[class*="surface-flat-phone"]') !== null);
    mounts.push(inGroupsPanel);
    const mount = nameMount ? `, ${nameMount(inGroupsPanel)}` : total > 1 ? `, ${i + 1} of ${total}` : '';
    await measure(ctx, retry, `${surface}: the Retry${mount}`, true);
  }
  return mounts;
}

test.describe('focus ring geometry, measured (plan 88.9-66, X61)', () => {
  let hold: WriteHold | undefined;
  test.beforeEach(async ({ page }) => {
    hold = await holdWrites(page);
  });
  test.afterEach(async ({ page }) => {
    expectNoApiWrites(hold);
    hold = undefined;
    await page.unrouteAll({ behavior: 'ignoreErrors' });
  });

  test('X61 (88.9): Friends — the header logo, the Requests tab, Search and every visible control record their ring against their ink', async ({
    page,
  }, testInfo) => {
    const records: RingRecord[] = [];
    await answerFriendsLists(page);

    for (const theme of THEMES) {
      const ctx: Context = { page, testInfo, theme, records };
      await openInTheme(page, '/friends', theme);
      const email = page.getByLabel("Friend's email address");
      await expect(email, `X61 (${theme}): the Add Friend card never rendered`).toBeVisible({ timeout: 15_000 });
      const friendRow = page.locator(`[data-friend-row="${RING_FRIEND.id}"]`);
      await expect(friendRow, `X61 (${theme}): the friend row never rendered`).toBeVisible({ timeout: 15_000 });

      // Search is natively disabled while the field is empty; an address in the field enables it.
      // Nothing is submitted.
      await email.fill('ring@nextgamenighte2e.invalid');
      // The friend's checkbox is natively disabled until a group is chosen. Choosing one sends one
      // read. A signed-in person who administers no group has no select; the row controls are
      // still measured.
      const groupSelect = page.getByRole('combobox', { name: /invite to group/i });
      if ((await groupSelect.count()) > 0) {
        const membersLoaded = page.waitForResponse(
          (response) => /\/groups\/[^/]+\/users/.test(response.url()) && response.request().method() === 'GET',
        );
        await groupSelect.selectOption({ index: 1 });
        await membersLoaded;
      }

      await measure(ctx, brandLink(page), 'the header logo', true);
      // AMENDED Phase 88.9-52 (R11, owner 2026-11-17: Centred): the Friends tabs paint their ring
      // INSIDE the tab, so the Requests tab is no longer held to the offset house ring here (it was
      // measured with mustBeHouse true). It is still recorded and still must paint an indicator;
      // what R11 ruled is asserted just below. The marker is at
      // src/app/friends/page.js ("AMENDED Phase 88.9-52 (R11, owner 2026-11-17: Centred").
      const requestsTab = page.getByRole('button', { name: /^Requests(\s*\d+)?$/ });
      await measure(ctx, requestsTab, 'the Requests tab', false);
      // Still focused: measure() leaves the focus where it put it.
      const tabRing = await readRing(requestsTab);
      const tabWhere = `the Requests tab (${theme}, ${testInfo.project.name})`;
      expect
        .soft(
          tabRing.layers.some((layer) => layer.inset && layer.spread === 2 && !isTransparent(layer.colour)),
          `${tabWhere}: no 2px inset ring is painted (box-shadow: ${tabRing.boxShadow})`,
        )
        .toBe(true);
      expect.soft(tabRing.outward, `${tabWhere}: the ring reaches ${tabRing.outward}px outside the tab; R11 puts it inside`).toBe(0);
      expect
        .soft(tabRing.pastStripLine, `${tabWhere}: the ring crosses the strip line by ${tabRing.pastStripLine}px`)
        .toBeLessThanOrEqual(0.5);
      await measure(ctx, page.getByRole('button', { name: 'Search', exact: true }), 'Search', true);

      // Every other visible, enabled control in the page body, in document order.
      const controls = page.locator('main').locator('a[href], button, input, select, textarea, [role="button"], [tabindex="0"]');
      const total = await controls.count();
      let measured = 0;
      for (let i = 0; i < total; i += 1) {
        const control = controls.nth(i);
        if (!(await control.isVisible())) continue;
        // Natively disabled controls cannot take focus. A control gated with aria-disabled can, and is measured.
        if (await control.evaluate((el) => (el as HTMLButtonElement).disabled === true)) continue;
        const name = (await control.getAttribute('aria-label')) ?? (await control.innerText().catch(() => ''));
        if (/^Search$|^Requests(\s*\d+)?$/.test(name.trim())) continue;
        await measure(ctx, control, 'Friends control', false);
        measured += 1;
      }
      expect(measured, `X61 (${theme}): only ${measured} other Friends controls were measured`).toBeGreaterThanOrEqual(4);

      // The request row's controls sit on the Requests tab. Opening a tab writes nothing.
      await page.getByRole('button', { name: /^Requests(\s*\d+)?$/ }).click();
      const requestRow = page.locator(`[data-request-row="${RING_REQUEST.id}"]`);
      await expect(requestRow, `X61 (${theme}): the request row never rendered`).toBeVisible({ timeout: 15_000 });
      await measure(ctx, requestRow.getByRole('button', { name: 'Accept', exact: true }), 'Accept on its row', true);
      const decline = requestRow.getByRole('button', { name: 'Decline', exact: true });
      await measure(ctx, decline, 'Decline on its row', true);

      // A-03 control: the "some indicator is painted" check can fail. With the ring and the outline
      // stripped from this one focused control by an injected style, the check reads false; with the
      // style removed it reads true again. Nothing is pressed.
      const stripped = await page.addStyleTag({
        content: `[data-request-row="${RING_REQUEST.id}"] button:focus-visible { box-shadow: none !important; outline: none !important; }`,
      });
      await focusByKeyboard(page, decline);
      await settleAnimations(decline);
      expect(paintsIndicator(await readRing(decline)), `X61 (${theme}): the indicator check still passed on a control with no ring and no outline`).toBe(false);
      await stripped.evaluate((el) => el.parentNode?.removeChild(el));
      await settleAnimations(decline);
      expect(paintsIndicator(await readRing(decline)), `X61 (${theme}): the indicator check did not recover once the injected style left`).toBe(true);
    }
    await publish(testInfo, records);
  });

  test('X61 (88.9): the shared Retry records its ring against its ink', async ({ page }, testInfo) => {
    const records: RingRecord[] = [];
    await answerFriendsLists(page);
    // The groups read feeds only the Invite to Group bar. Failing it shows the small notice with
    // the shared Retry above an intact friends list (the captured frame's state), with no write.
    await page.route(
      (url) => /\/groups\/user\/[^/]+$/.test(url.pathname),
      async (route) => {
        if (route.request().method() !== 'GET') {
          await route.fallback();
          return;
        }
        await route.fulfill({ status: 500, json: {} });
      },
    );

    for (const theme of THEMES) {
      const ctx: Context = { page, testInfo, theme, records };
      await openInTheme(page, '/friends', theme);
      const retry = page.locator('main').getByRole('button', { name: 'Retry', exact: true });
      await expect(retry, `X61 (${theme}): the small notice with Retry never rendered`).toBeVisible({ timeout: 30_000 });
      await expect(retry).toHaveCount(1);
      await measure(ctx, retry, 'the shared Retry', true);
    }
    await publish(testInfo, records);
  });

  test('X61 (88.9): Home — the group card title records its ring against its name', async ({ page }, testInfo) => {
    const records: RingRecord[] = [];

    for (const theme of THEMES) {
      const ctx: Context = { page, testInfo, theme, records };
      await openInTheme(page, '/', theme);
      const cards = page.getByTestId('group-card');
      await expect(cards.first(), `X61 (${theme}): no group card rendered`).toBeVisible({ timeout: 15_000 });
      const fixtureCard = cards.filter({ has: page.getByText('Weekend Warriors', { exact: true }) }).filter({ visible: true });
      await expect(fixtureCard).toHaveCount(1);
      // The title is a button named by the group name alone.
      const title = fixtureCard.getByRole('button', { name: 'Weekend Warriors', exact: true });
      await expect(title).toHaveCount(1);
      await measure(ctx, title, 'the group card title', true);
    }
    await publish(testInfo, records);
  });

  test('X61 (88.9-69): Home — the Your Groups Retry records its ring against its ink', async ({ page, isMobile }, testInfo) => {
    const records: RingRecord[] = [];
    await failIdentityRead(page);

    for (const theme of THEMES) {
      const ctx: Context = { page, testInfo, theme, records };
      await openInTheme(page, '/', theme);
      const mounts = await measureVisibleRetries(ctx, 'Home', (inGroupsPanel) =>
        inGroupsPanel ? 'the Your Groups notice' : 'the desktop column notice',
      );
      if (isMobile) {
        // At 375 the one visible notice is the Your Groups one; the desktop column is not shown.
        expect(mounts, `X61 (${theme}): Home at 375 shows one small notice, in Your Groups`).toEqual([true]);
      } else {
        // At 1280 the desktop column beside the calendar shows its own copy of the notice.
        expect(mounts, `X61 (${theme}): Home at 1280 never showed the desktop column notice`).toContain(false);
      }
    }
    await publish(testInfo, records);
  });

  test('X61 (88.9-69): event view — the group breadcrumb and the Retry record their rings against their ink', async ({ page }, testInfo) => {
    const records: RingRecord[] = [];
    // Two loads per theme. With no identity the page cannot tell the viewer is a member and shows
    // the group's name as plain text, not a link; so the breadcrumb link is read on a normal load
    // and the Retry on a load whose identity read fails.
    let failing = false;
    await failIdentityRead(page, () => failing);

    for (const theme of THEMES) {
      const ctx: Context = { page, testInfo, theme, records };
      failing = false;
      await openInTheme(page, E2E_EVENT_DETAIL_PATH, theme);
      const crumb = page.getByRole('navigation', { name: 'Breadcrumb' }).locator('a[href^="/groupHomePage"]');
      await expect(crumb, `X61 (${theme}): the event view never rendered its group breadcrumb link`).toBeVisible({ timeout: 20_000 });
      await expect(crumb).toHaveCount(1);
      await measure(ctx, crumb, 'event view: the group breadcrumb link', true);

      failing = true;
      await openInTheme(page, E2E_EVENT_DETAIL_PATH, theme);
      await measureVisibleRetries(ctx, 'event view');
    }
    await publish(testInfo, records);
  });

  test("X61 (88.9-69): game page — a name in the upcoming event card's RSVP list records its ring against its ink", async ({ page }, testInfo) => {
    const records: RingRecord[] = [];
    await routeFakeGameSuccess(page);
    // The group's events read answers one made-up night a week ahead, so the game page shows one
    // upcoming event card; its RSVP list read answers two made-up replies.
    await page.route('**/api/events/group/**', async (route) => {
      const request = route.request();
      if (request.method() === 'GET' && GROUP_EVENTS_PATH.test(new URL(request.url()).pathname)) {
        await route.fulfill({
          json: [
            {
              id: RING_NIGHT_ID,
              game_id: E2E_FAKE_GAME_ID,
              group_id: E2E_GROUP_ID,
              start_date: new Date(Date.now() + 7 * DAY_MS).toISOString(),
              duration_minutes: 90,
              status: 'scheduled',
              comments: 'E2E staged night (88.9-69 X61)',
              EventParticipations: [],
            },
          ],
          headers: allowOrigin(route),
        });
        return;
      }
      await route.fallback();
    });
    await page.route('**/api/rsvp/event/**', async (route) => {
      const request = route.request();
      if (request.method() === 'GET' && new URL(request.url()).pathname.endsWith(`/rsvp/event/${RING_NIGHT_ID}`)) {
        await route.fulfill({ json: RING_REPLIES, headers: allowOrigin(route) });
        return;
      }
      await route.fallback();
    });

    for (const theme of THEMES) {
      const ctx: Context = { page, testInfo, theme, records };
      await openInTheme(page, E2E_GAME_PATH, theme);
      // The name is a control (role button, named by the name alone) once the viewer's identity and
      // friendships have loaded; until then it is plain text, which this wait outlasts.
      const name = page.getByRole('main').getByRole('button', { name: RING_REPLY_NAME, exact: true });
      await expect(name, `X61 (${theme}): the staged reply's name never became a control in the upcoming event card`).toBeVisible({
        timeout: 30_000,
      });
      await expect(name).toHaveCount(1);
      await measure(ctx, name, "game page: a name in the upcoming event card's RSVP list", true);
    }
    await publish(testInfo, records);
  });

  test('X61 (88.9-69): Plan Game Session — the Retry records its ring against its ink', async ({ page }, testInfo) => {
    const records: RingRecord[] = [];
    await failIdentityRead(page);

    for (const theme of THEMES) {
      const ctx: Context = { page, testInfo, theme, records };
      await openInTheme(page, `/groupPlanning?group_id=${E2E_GROUP_ID}`, theme);
      await measureVisibleRetries(ctx, 'Plan Game Session');
    }
    await publish(testInfo, records);
  });
});

// Scrolls every scroll area of a dialog (the shell, and the Body where it scrolls by itself) to its
// end; returns how far the furthest one moved, so a caller can tell that something scrolled.
async function scrollDialogToEnd(dialog: Locator): Promise<number> {
  return dialog.evaluate((shell) => {
    let moved = 0;
    for (const el of [shell, ...Array.from(shell.querySelectorAll('*'))]) {
      if (el.scrollHeight <= el.clientHeight + 1) continue;
      const overflowY = getComputedStyle(el).overflowY;
      if (overflowY !== 'auto' && overflowY !== 'scroll') continue;
      const before = el.scrollTop;
      el.scrollTop = el.scrollHeight;
      moved = Math.max(moved, el.scrollTop - before);
    }
    return moved;
  });
}

test.describe('89.6-31 ring census rows', () => {
  // The sweep's write guard (holdWrites first; the self read sent on without its timezone
  // parameter; a GET that writes held unless the test answers it), registered before the first
  // navigation: e2e/support/largeTextSurfaces/index.ts ("export async function sweepWriteGuard").
  // A test sets `answers` before it navigates. No unrouteAll: turning interception off resumes the
  // requests the hold is holding.
  let hold: SweepHold | undefined;
  let answers: (url: URL) => unknown = () => undefined;
  test.beforeEach(async ({ page }) => {
    answers = () => undefined;
    hold = await sweepWriteGuard(page, { answers: (url) => answers(url) });
  });
  test.afterEach(() => {
    expectNoApiWrites(hold);
    expect(hold?.writeGets ?? [], 'a GET that writes was held with no answer').toEqual([]);
    hold = undefined;
  });

  test('E-01 (89.6-31): the Modal close draws a rounded, whole house ring, at rest and after the shell scrolls', async ({ page }, testInfo) => {
    const census: CensusRecord[] = [];
    const row = censusRow(EDGE_ROWS, 'E-01');
    let proved = false;
    // Customize Group mounts the check-in schedule summary; its settings read is a GET that writes.
    answers = answerPromptSettings;

    for (const theme of THEMES) {
      if (theme === 'light') await forceLightMode(page);
      await openGroupSettings(page);
      await assertTheme(page, theme);
      const dialog = page.getByRole('dialog', { name: /customize group/i });
      const close = dialog.locator('[data-modal-close]');
      await expect(close, `E-01 (${theme}): Customize Group has no header close`).toHaveCount(1);
      // The dialog's 200ms opening animation: a read inside it measures a transformed box.
      await settleAnimations(dialog);
      await page.evaluate(() => document.fonts.ready.then(() => undefined));
      if (!proved) {
        await proveClipRead(page, dialog, close);
        proved = true;
      }

      for (const cell of censusCells(testInfo)) {
        const ctx: CensusContext = { page, testInfo, theme, cell, census };
        const at = `E-01 (${theme}, ${cell.width} x ${cell.height}, ${cell.mode}% text)`;
        await page.setViewportSize({ width: cell.width, height: cell.height });
        await setTextMode(page, cell.mode, at);
        await settleAnimations(dialog);
        await dialog.evaluate((shell) => {
          for (const el of [shell, ...Array.from(shell.querySelectorAll('*'))]) el.scrollTop = 0;
        });
        await measureRow(ctx, row, close, 'the Modal close, at rest');

        // After the shell is scrolled to its end, Shift+Tab from the first control under the header
        // brings the keyboard back to the close, and the browser scrolls it into view.
        await close.focus();
        await page.keyboard.press('Tab');
        await expect(close, `${at}: Tab did not leave the close`).not.toBeFocused();
        const moved = await scrollDialogToEnd(dialog);
        if (cell.width === 320) {
          expect(moved, `${at}: nothing in Customize Group scrolled, so the after-scroll read measures the resting state again`).toBeGreaterThan(0);
        }
        await page.keyboard.press('Shift+Tab');
        await expect(close, `${at}: Shift+Tab did not return the keyboard to the close`).toBeFocused();
        await measureRow(ctx, row, close, `the Modal close, after the shell scrolls to its end (${Math.round(moved)}px)`);
      }
    }
    await publish(testInfo, [], census);
  });

  // A sweep row's staging, reused by import: its answers go to the write guard and its reach opens
  // the surface (e2e/support/largeTextSurfaces/index.ts ("export const ALL_ROWS")). No reach here
  // presses a control that saves; the sweep runs the same reaches under the same guard.
  const reachSweepRow = async (page: Page, id: string): Promise<{ root: Locator; dialog?: Locator }> => {
    const row = ALL_ROWS.find((candidate) => candidate.id === id);
    if (!row?.reach) throw new Error(`sweep row ${id} has no reach to reuse`);
    const rowAnswers = row.answers;
    if (rowAnswers) {
      const mine = answers;
      answers = (url) => rowAnswers(url) ?? mine(url);
    }
    return row.reach(page);
  };

  // One surface through its project's cells, both themes: `open` navigates and stages (it runs once
  // per theme, at normal text) and returns the element whose animations are settled before each
  // cell's read; `read` measures the surface's rows in one cell.
  const censusSurface = async (
    page: Page,
    testInfo: TestInfo,
    label: string,
    open: () => Promise<Locator>,
    read: (ctx: CensusContext) => Promise<void>,
  ): Promise<void> => {
    const census: CensusRecord[] = [];
    for (const theme of THEMES) {
      if (theme === 'light') await forceLightMode(page);
      const settled = await open();
      await assertTheme(page, theme);
      await page.evaluate(() => document.fonts.ready.then(() => undefined));
      for (const cell of censusCells(testInfo)) {
        await page.setViewportSize({ width: cell.width, height: cell.height });
        await setTextMode(page, cell.mode, `${label} (${theme}, ${cell.width} x ${cell.height})`);
        await settleAnimations(settled);
        await read({ page, testInfo, theme, cell, census });
      }
    }
    await publish(testInfo, [], census);
  };

  test('E-02 (89.6-31): Share Game QR, the header close', async ({ page }, testInfo) => {
    let dialog: Locator | undefined;
    await censusSurface(
      page,
      testInfo,
      'E-02',
      async () => {
        dialog = (await reachSweepRow(page, 'D06')).root;
        return dialog;
      },
      async (ctx) => {
        const close = (dialog as Locator).locator('[data-modal-close]');
        await expect(close, 'E-02: the QR box has no header close').toHaveCount(1);
        await measureRow(ctx, censusRow(EDGE_ROWS, 'E-02'), close, 'the QR box close');
      },
    );
  });

  test('E-03 (89.6-31): Invite Members, the panel close', async ({ page }, testInfo) => {
    let dialog: Locator | undefined;
    await censusSurface(
      page,
      testInfo,
      'E-03',
      async () => {
        dialog = (await reachSweepRow(page, 'D02')).root;
        return dialog;
      },
      async (ctx) => {
        const close = (dialog as Locator).getByRole('button', { name: 'Close', exact: true });
        await expect(close, 'E-03: Invite Members has not exactly one Close').toHaveCount(1);
        await measureRow(ctx, censusRow(EDGE_ROWS, 'E-03'), close, 'the invite panel close');
      },
    );
  });

  test('E-04, E-07, E-08, E-16 (89.6-31): Create Event, Clear game selection, Undo, Dismiss undo and a Score input', async ({ page }, testInfo) => {
    let dialog: Locator | undefined;
    await censusSurface(
      page,
      testInfo,
      'Create Event',
      async () => {
        const reached = await reachSweepRow(page, 'D21-readonly');
        dialog = reached.dialog as Locator;
        // Local state only, nothing is sent to save: a typed game name shows Clear game selection,
        // and removing the first staged member shows the Undo bar.
        await dialog.getByPlaceholder('Search for a game or type a name').fill('E2E census game');
        await reached.root.getByRole('button', { name: 'Remove', exact: true }).first().click();
        await expect(dialog.getByRole('button', { name: 'Undo', exact: true }), 'Create Event: removing a participant showed no Undo').toBeVisible({ timeout: 15_000 });
        return dialog;
      },
      async (ctx) => {
        const box = dialog as Locator;
        await measureRow(ctx, censusRow(EDGE_ROWS, 'E-04'), box.getByRole('button', { name: 'Clear game selection', exact: true }), 'Clear game selection');
        await measureRow(ctx, censusRow(EDGE_ROWS, 'E-07'), box.getByRole('button', { name: 'Undo', exact: true }), 'Undo');
        await measureRow(ctx, censusRow(EDGE_ROWS, 'E-08'), box.getByRole('button', { name: /^Dismiss undo for / }), 'Dismiss undo');
        await measureRow(ctx, censusRow(EDGE_ROWS, 'E-16'), box.getByRole('group', { name: 'Participants (required)', exact: true }).locator('input[type="number"]').first(), 'the first Score input');
      },
    );
  });

  test('E-05, E-06 (89.6-31): Write a Review, the half-star hit zones', async ({ page }, testInfo) => {
    let dialog: Locator | undefined;
    await censusSurface(
      page,
      testInfo,
      'Write a Review',
      async () => {
        dialog = (await reachSweepRow(page, 'D29')).root;
        return dialog;
      },
      async (ctx) => {
        const box = dialog as Locator;
        await measureRow(ctx, censusRow(EDGE_ROWS, 'E-05'), box.getByRole('radio', { name: '0.5 stars', exact: true }), 'the left half of the first star');
        await measureRow(ctx, censusRow(EDGE_ROWS, 'E-06'), box.getByRole('radio', { name: '1 stars', exact: true }), 'the right half of the first star');
        await measureRow(ctx, censusRow(EDGE_ROWS, 'E-06'), box.getByRole('radio', { name: '5 stars', exact: true }), 'the right half of the last star');
      },
    );
  });

  test('E-10 (89.6-31): Friends, Remove on a friend row', async ({ page }, testInfo) => {
    await censusSurface(
      page,
      testInfo,
      'Friends',
      async () => (await reachSweepRow(page, 'R04')).root,
      async (ctx) => {
        const remove = page.locator('[data-friend-row]').first().getByRole('button', { name: /^Remove/ });
        await expect(remove, 'E-10: the first friend row has not exactly one Remove').toHaveCount(1);
        await measureRow(ctx, censusRow(EDGE_ROWS, 'E-10'), remove, 'Remove on the first friend row');
      },
    );
  });

  test('E-11 to E-15, E-17 (89.6-31): Profile, the phone Remove, both Deletes, the revealed collection title, a collection Remove and the tab panel', async ({ page }, testInfo) => {
    // Staged in the browser (the seeds hold none of these states): a made-up phone number in the
    // reserved 555-01xx fiction range on the self read, marked verified, with the SMS entitlement
    // the phone block is gated on (an admin-set flag), so the phone Remove draws;
    // the patterns read answered as the sweep's availability row answers it (one weekly schedule and
    // one override); the collection read answered with eight made-up games, so it overflows.
    const patterns = ALL_ROWS.find((candidate) => candidate.id === 'R16-availability')?.answers;
    if (!patterns) throw new Error('sweep row R16-availability has no answers to reuse');
    answers = (url) => patterns(url) ?? (/\/user-games\/user\/[^/]+$/.test(url.pathname) ? CENSUS_GAMES : undefined);
    await transformRead(page, isSelfRead, (body) =>
      body && typeof body === 'object' && !Array.isArray(body) ? { ...(body as object), sms_enabled: true, phone: CENSUS_PHONE, phone_verified: true } : body,
    );
    const main = page.getByRole('main');
    const tab = (name: string): Locator => page.getByRole('tab', { name, exact: true });

    await censusSurface(
      page,
      testInfo,
      'Profile',
      async () => {
        await page.goto('/userProfile');
        await expect(main.getByRole('button', { name: 'Delete Wednesday schedule', exact: true }), 'Profile: the staged weekly schedule never rendered').toBeVisible({ timeout: 20_000 });
        await expect(main.getByRole('button', { name: `Show all ${CENSUS_GAMES.length} games`, exact: true }), 'Profile: the staged collection does not overflow').toBeVisible({ timeout: 20_000 });
        return main;
      },
      async (ctx) => {
        // At rest the phone Remove is named by its word alone; a collection Remove carries its game's name.
        const phoneRemove = main.getByRole('button', { name: 'Remove', exact: true });
        await expect(phoneRemove, 'E-11: the phone Remove did not render for the staged verified number').toHaveCount(1);
        await measureRow(ctx, censusRow(EDGE_ROWS, 'E-11'), phoneRemove, 'the phone Remove');

        await measureRow(ctx, censusRow(EDGE_ROWS, 'E-12'), main.getByRole('button', { name: 'Delete Wednesday schedule', exact: true }), 'the schedule Delete');
        await measureRow(ctx, censusRow(EDGE_ROWS, 'E-17'), main.getByRole('tabpanel'), 'the Schedules tab panel');
        // Opening a tab writes nothing.
        await tab('Specific Dates').click();
        const overrideDelete = main.getByRole('button', { name: /^Delete .* override$/ });
        await expect(overrideDelete, 'E-13: the staged override row never rendered').toHaveCount(1);
        await measureRow(ctx, censusRow(EDGE_ROWS, 'E-13'), overrideDelete, 'the override Delete');
        await tab('Schedules').click();

        await measureRow(ctx, censusRow(EDGE_ROWS, 'E-15'), main.getByRole('button', { name: `Remove ${CENSUS_GAMES[0].name}`, exact: true }), 'Remove on the first collection card');

        // E-14 as a keyboard user reaches it: Enter on Show all (local state, no request) and the
        // page puts the focus on the first revealed card's title.
        const showAll = main.getByRole('button', { name: `Show all ${CENSUS_GAMES.length} games`, exact: true });
        await focusByKeyboard(page, showAll);
        await page.keyboard.press('Enter');
        const revealed = main.getByRole('heading', { level: 3 }).and(main.locator('[tabindex="-1"]'));
        await expect(revealed, 'E-14: Show all did not put the focus on the first revealed title').toBeFocused({ timeout: 15_000 });
        await measureRow(ctx, censusRow(EDGE_ROWS, 'E-14'), revealed, 'the first revealed collection title');
        const showFewer = main.getByRole('button', { name: 'Show fewer', exact: true });
        await focusByKeyboard(page, showFewer);
        await page.keyboard.press('Enter');
        await expect(showAll, 'E-14: Show fewer did not close the collection again').toBeVisible({ timeout: 15_000 });
      },
    );
  });
});
