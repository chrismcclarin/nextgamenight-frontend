import { expect, type Locator, type Page } from '@playwright/test';

// The ONE whole-word read for e2e specs (88.9-52 R4 D2 / R4-E, owner 2026-11-18: a name wraps, with
// no line limit, and it keeps its room; his worry was a name broken into letter-stacks,
// We/eke/nd W/arr/iors). A word that is broken inside itself is drawn on more than one line box, so
// the read counts the line boxes of every word of a name. It also reads the cut (ellipsis, nowrap,
// line clamp) and the page's sideways scroll, because the three failures of a long name are a cut,
// a letter-stack and a page that scrolls sideways.
//
// THE RULE IT HOLDS (the owner's two parts): a word is on ONE line, except when that one word is
// wider than the whole row, and then only after the name has been given the whole row (nothing sits
// beside it any more). So the read also takes each word's own unbroken width and, when the caller
// names the row, the room that row can give the name. A proof that only said "one line per word"
// would go red on a word that honestly cannot fit a 320px screen at 200% text; a proof that allowed
// any break would pass a letter-stack.
//
// DECISION Phase 88.9-52 (R4-E): one shared read, chosen OVER a copy in each of the specs that prove
// a D2 site (the first two proofs, in e2e/friends-page.spec.ts and
// e2e/group-planning-role-failure.spec.ts, each carry their own; six more copies was the
// alternative). Changing this is a decision, not a cleanup.

/** The two-word name the owner used; every D2 proof answers it in the browser. */
export const TWO_WORD_NAME = 'Weekend Warriors';

/** 320 CSS px wide with the root text at 200% (32px), the size every D2 proof reads at. */
export async function setNarrowLargeText(page: Page, tag: string): Promise<void> {
  const height = page.viewportSize()?.height ?? 667;
  await page.setViewportSize({ width: 320, height });
  await page.addStyleTag({ content: 'html { font-size: 200% !important; }' });
  await expect
    .poll(() => page.evaluate(() => getComputedStyle(document.documentElement).fontSize), {
      message: `${tag}: the root font size did not become 32px after the 200% style tag`,
    })
    .toBe('32px');
  await expect
    .poll(() => page.evaluate(() => document.documentElement.clientWidth), {
      message: `${tag}: the window did not become 320px wide`,
    })
    .toBe(320);
}

export interface WordRead {
  word: string;
  /** How many line boxes the word is drawn on; more than 1 means it is broken inside itself. */
  lines: number;
  left: number;
  right: number;
  /** The word's own width on one line, in the name's font. */
  natural: number;
}

export interface WordLinesRead {
  text: string;
  words: WordRead[];
  whiteSpace: string;
  textOverflow: string;
  lineClamp: string;
  /** The element's own box; contentWidth is the room its text has on a line. */
  box: { left: number; right: number; width: number; contentWidth: number };
  /** The widest the row can make the name's text line (the row's content width less every box edge between the two); null when no row was named. */
  rowRoom: number | null;
  window: number;
  /** scrollWidth minus clientWidth of the document: above 0 the page scrolls sideways. */
  pageSideways: number;
}

/**
 * Read every word under `locator` (all of its text nodes) and how many line boxes each is on.
 * `row` is the container the name's neighbours move out of: the name may break a word only once
 * its text line is as wide as that row can make it.
 */
export async function readWordLines(locator: Locator, row?: Locator): Promise<WordLinesRead> {
  const rowHandle = row ? await row.elementHandle() : null;
  return locator.evaluate((el, rowEl) => {
    const px = (value: string) => Number.parseFloat(value) || 0;
    const edges = (node: Element, withBorder: boolean) => {
      const c = getComputedStyle(node);
      return px(c.paddingLeft) + px(c.paddingRight) + (withBorder ? px(c.borderLeftWidth) + px(c.borderRightWidth) : 0);
    };
    const ruler = document.createElement('span');
    const own = getComputedStyle(el);
    ruler.style.cssText = 'position:absolute;visibility:hidden;white-space:nowrap;left:-9999px;top:0;';
    ruler.style.font = own.font;
    ruler.style.letterSpacing = own.letterSpacing;
    document.body.appendChild(ruler);
    const naturalWidth = (word: string) => {
      ruler.textContent = word;
      return ruler.getBoundingClientRect().width;
    };
    const words: Array<{ word: string; lines: number; left: number; right: number; natural: number }> = [];
    const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
    let text = '';
    for (let node = walker.nextNode(); node; node = walker.nextNode()) {
      const content = node.textContent ?? '';
      text += content;
      for (const match of content.matchAll(/\S+/g)) {
        const range = document.createRange();
        range.setStart(node, match.index ?? 0);
        range.setEnd(node, (match.index ?? 0) + match[0].length);
        const rects = Array.from(range.getClientRects()).filter((r) => r.width > 0);
        words.push({
          word: match[0],
          lines: new Set(rects.map((r) => Math.round(r.top))).size,
          left: Math.min(...rects.map((r) => r.left)),
          right: Math.max(...rects.map((r) => r.right)),
          natural: naturalWidth(match[0]),
        });
      }
    }
    ruler.remove();
    const cs = getComputedStyle(el);
    const box = el.getBoundingClientRect();
    const doc = document.documentElement;
    let rowRoom: number | null = null;
    if (rowEl) {
      rowRoom = (rowEl as HTMLElement).clientWidth - edges(rowEl as Element, false);
      for (let a = el.parentElement; a && a !== rowEl; a = a.parentElement) rowRoom -= edges(a, true);
      rowRoom -= edges(el, true);
    }
    return {
      text,
      words,
      whiteSpace: cs.whiteSpace,
      textOverflow: cs.textOverflow,
      lineClamp: cs.getPropertyValue('-webkit-line-clamp') || 'none',
      box: { left: box.left, right: box.right, width: box.width, contentWidth: box.width - edges(el, true) },
      rowRoom,
      window: doc.clientWidth,
      pageSideways: doc.scrollWidth - doc.clientWidth,
    };
  }, rowHandle);
}

export interface WholeWordsOptions {
  /** Assert that the page does not scroll sideways (the default). False records it only. */
  pageSideways?: boolean;
}

/**
 * Expect the name to be shown whole and uncut, inside the window, with each word on a single line.
 * The one exception is the rule's own: a word wider than the whole row may break, and only when
 * the name's text line is already as wide as the row can make it (the read must have named a row).
 * `words` is the exact list of words expected under the element, in order; null takes whatever
 * words are there (a label the page composes), which must still be at least one.
 */
export function expectWholeWords(read: WordLinesRead, words: string[] | null, tag: string, options: WholeWordsOptions = {}): void {
  const line = JSON.stringify(read);
  if (words) expect(read.words.map((w) => w.word), `${tag}: the words on screen are not the expected ones (${line})`).toEqual(words);
  else expect(read.words.length, `${tag}: no word was read (${line})`).toBeGreaterThan(0);
  for (const w of read.words) {
    if (w.lines !== 1) {
      // Broken inside itself: allowed only for a word that cannot fit the widest line the row can give.
      expect(read.rowRoom, `${tag}: the word ${w.word} is drawn on ${w.lines} lines and no row was named to excuse it (${line})`).not.toBeNull();
      expect(
        read.box.contentWidth,
        `${tag}: the word ${w.word} is broken inside itself while the name has only ${read.box.contentWidth}px of the ${read.rowRoom}px its row could give: a neighbour is still squeezing it (${line})`,
      ).toBeGreaterThanOrEqual((read.rowRoom ?? 0) - 1);
      expect(
        w.natural,
        `${tag}: the word ${w.word} (${w.natural}px) is broken inside itself although it fits its ${read.box.contentWidth}px line (${line})`,
      ).toBeGreaterThan(read.box.contentWidth - 0.5);
      expect(w.lines, `${tag}: the word ${w.word} is on ${w.lines} lines, more than a word of ${w.natural}px needs on ${read.box.contentWidth}px lines (${line})`).toBeLessThanOrEqual(
        Math.ceil(w.natural / Math.max(read.box.contentWidth, 1)) + 1,
      );
    }
    expect(w.left, `${tag}: the word ${w.word} starts left of the window (${line})`).toBeGreaterThanOrEqual(-0.5);
    expect(w.right, `${tag}: the word ${w.word} ends right of the window (${line})`).toBeLessThanOrEqual(read.window + 0.5);
  }
  expect(read.textOverflow, `${tag}: the text is still cut with an ellipsis (${line})`).not.toBe('ellipsis');
  expect(read.whiteSpace, `${tag}: the text cannot wrap (${line})`).not.toMatch(/nowrap/);
  expect(read.lineClamp, `${tag}: the text still has a line limit (${line})`).toBe('none');
  if (options.pageSideways !== false) {
    expect(read.pageSideways, `${tag}: the page scrolls sideways by ${read.pageSideways}px (${line})`).toBeLessThanOrEqual(0);
  }
}

/** Expect a neighbouring control to be whole inside the window, and at least 44px tall and wide when it is a button. */
export async function expectNeighbourWhole(locator: Locator, label: string, options: { button?: boolean } = {}): Promise<void> {
  const read = await locator.evaluate((el) => {
    const r = el.getBoundingClientRect();
    return { left: r.left, right: r.right, width: r.width, height: r.height, window: document.documentElement.clientWidth };
  });
  const line = JSON.stringify(read);
  expect(read.left, `${label}: starts left of the window (${line})`).toBeGreaterThanOrEqual(-0.5);
  expect(read.right, `${label}: ends right of the window (${line})`).toBeLessThanOrEqual(read.window + 0.5);
  if (options.button) {
    expect(Math.round(read.width * 100) / 100, `${label}: narrower than 44px (${line})`).toBeGreaterThanOrEqual(44);
    expect(Math.round(read.height * 100) / 100, `${label}: shorter than 44px (${line})`).toBeGreaterThanOrEqual(44);
  }
}

/**
 * Expect a card (or row) to hold its parts at the current size: it is inside the window, nothing
 * in it is wider than it (its own scrollWidth), and every descendant's box ends inside it. The
 * page's own sideways scroll is returned for the log; a caller on a page that is known to be clean
 * at this size asserts it, the others record it (the rest of the page is not the site's subject).
 */
export async function expectHeldInside(card: Locator, tag: string): Promise<{ pageSideways: number }> {
  const read = await card.evaluate((el) => {
    const box = el.getBoundingClientRect();
    const parts = Array.from(el.querySelectorAll('*')) as HTMLElement[];
    // A screen-reader-only part (the house sr-only: a 1px by 1px box with a -1px margin) draws nothing,
    // so it is not a part that can stick out; CI run at FE 23226f4 read one 1px left of the strip.
    const boxes = parts.map((p) => p.getBoundingClientRect()).filter((r) => r.width > 1 && r.height > 1);
    const doc = document.documentElement;
    return {
      left: box.left,
      right: box.right,
      ownSideways: el.scrollWidth - el.clientWidth,
      rightmost: boxes.length ? Math.max(...boxes.map((r) => r.right)) : box.right,
      leftmost: boxes.length ? Math.min(...boxes.map((r) => r.left)) : box.left,
      window: doc.clientWidth,
      pageSideways: doc.scrollWidth - doc.clientWidth,
    };
  });
  const line = JSON.stringify(read);
  expect(read.left, `${tag}: the card starts left of the window (${line})`).toBeGreaterThanOrEqual(-0.5);
  expect(read.right, `${tag}: the card ends right of the window (${line})`).toBeLessThanOrEqual(read.window + 0.5);
  expect(read.ownSideways, `${tag}: something in the card is wider than the card (${line})`).toBeLessThanOrEqual(0);
  expect(read.rightmost, `${tag}: a part of the card ends right of the card (${line})`).toBeLessThanOrEqual(read.right + 0.5);
  expect(read.leftmost, `${tag}: a part of the card starts left of the card (${line})`).toBeGreaterThanOrEqual(read.left - 0.5);
  return { pageSideways: read.pageSideways };
}

// ---------------------------------------------------------------------------------------------
// THE LARGE-TEXT CHECKS (Phase 89.6).
//
// DECISION Phase 89.6-02 (checks): the large-text checks are page reads in this ONE shared file
// (sideways on the page and inside an open dialog's content box; cut; split; then spill and
// select-fit), chosen OVER a read per spec and OVER the three SPEC R4 checks alone (text spilling
// out of its control and a cut select value pass all three: research M F4). DECISION Phase 88.9-52
// (R4-E) above stands: these extend the one shared read. Changing this is a decision, not a cleanup.
// The second 200% mode is Chromium's default font size, used for the 768 cells because media
// queries keep the initial size under the style tag (research M1).
//
// HOW A CELL IS READ. One in-page read under a root element, after the layout has settled. Text
// that draws nothing is not read: a text node whose element is visibility hidden, or whose element
// (or an ancestor) draws a box of 1px by 1px or less, which is the house sr-only.
// ---------------------------------------------------------------------------------------------

/** The 30-letter word with no space (UI-SPEC content case "One 30-letter word"). */
export const THIRTY_LETTER_WORD = 'Grandmasterboardgamecollective';

/** The owner's two-word name plus one emoji, the game die (UI-SPEC content case "Name with an emoji"). */
export const EMOJI_NAME = `${TWO_WORD_NAME} \u{1F3B2}`;

/**
 * How the root text size of a cell is produced. '100' adds nothing; '150' and '200' are a style
 * tag on the root; 'font32' is Chromium's default font size set to 32px, the setting a person
 * changes in the browser, under which a rem in a media query doubles too.
 */
export type TextMode = '100' | '150' | '200' | 'font32';

/** Every style tag setTextMode adds carries this attribute, so the next call can take it away. */
const TEXT_MODE_ATTRIBUTE = 'data-lt-text-mode';

/** The pages put in font32. It is a page setting, so it outlives every setContent on that page. */
const FONT32_PAGES = new WeakMap<Page, true>();

/**
 * Put the page in a text mode. A style-tag mode can be set from any earlier style-tag mode on the
 * same page: every call first removes the style tag an earlier call added. The 200% tag has the
 * same content setNarrowLargeText uses; that helper and its callers are not changed.
 *
 * font32 is ONE-WAY on a page. The first 'font32' call makes the one CDP call; a later 'font32'
 * call on that page makes no second one and only waits for the root to read 32px again (the render
 * helper calls this for every content case). A later call for any other mode throws: a page is
 * never taken out of font32, so a caller that needs a style-tag mode again uses a fresh page.
 */
export async function setTextMode(page: Page, mode: TextMode, tag: string): Promise<void> {
  const rootBecomes = (expected: string) =>
    expect
      .poll(() => page.evaluate(() => getComputedStyle(document.documentElement).fontSize), {
        message: `${tag}: the root font size did not become ${expected} in text mode ${mode}`,
      })
      .toBe(expected);
  if (FONT32_PAGES.has(page)) {
    if (mode !== 'font32') throw new Error(`${tag}: font32 is one-way: use a fresh page`);
    await rootBecomes('32px');
    return;
  }
  await page.evaluate((attribute) => {
    for (const style of Array.from(document.querySelectorAll(`style[${attribute}]`))) style.remove();
  }, TEXT_MODE_ATTRIBUTE);
  if (mode === 'font32') {
    const cdp = await page.context().newCDPSession(page);
    await cdp.send('Page.setFontSizes', { fontSizes: { standard: 32 } });
    FONT32_PAGES.set(page, true);
    await rootBecomes('32px');
    // Proof that the mode is the real setting and not a style tag: a rem in a media query doubled.
    const read = await page.evaluate(() => ({ window: document.documentElement.clientWidth, media: matchMedia('(min-width: 48rem)').matches }));
    if (read.window >= 768) {
      expect(read.media, `${tag}: the 48rem media query still matches at ${read.window}px wide, so the default font size did not change`).toBe(false);
    }
    return;
  }
  if (mode === '150' || mode === '200') {
    const handle = await page.addStyleTag({ content: `html { font-size: ${mode}% !important; }` });
    await handle.evaluate((style, set) => (style as Element).setAttribute(set.attribute, set.value), { attribute: TEXT_MODE_ATTRIBUTE, value: mode });
  }
  await rootBecomes(mode === '200' ? '32px' : mode === '150' ? '24px' : '16px');
}

export interface LargeTextReadOptions {
  /** An open dialog's content box: its own sideways scroll is read as well as the page's. */
  dialog?: Locator;
  /** Selectors of the exceptions list (SPEC A3 / A10): the cut check skips text in or under them. */
  exceptions?: readonly string[];
  /**
   * Page-zoom read only: the selectors of the surfaces another phase owns (SPEC A3 (2) to (4)). A
   * text clipped by a box, where the text and that box both match one of them, is that surface's
   * own clamp: it is listed in cleared, not lost (orchestrator ruling D27, plan 89.6-40).
   */
  surfaceClamps?: readonly string[];
}

export interface LargeTextCellRead {
  rootFontSize: number;
  window: number;
  /** scrollWidth minus clientWidth of the document: above 0 the page scrolls sideways. */
  pageSideways: number;
  /** The same for the dialog content box that was named; null when none was. */
  dialogSideways: number | null;
  /** One entry per hit, written kind: "first 30 characters"; kinds ellipsis, clamp, nowrap, hidden, shrunk. */
  cut: string[];
  /**
   * Defects. One entry per word drawn on more than one line that would be whole if the rows above
   * it stacked, or that is glued to what precedes it on its line. The read also says here when it
   * could not measure (COULD NOT STACK) and when it could not put the page back (NOT RESTORED).
   */
  split: string[];
  /** One entry per broken word held narrow by a box with a width of its own, or by a positioned box; the entry names the box and what makes it that wide. */
  held: string[];
  /** One entry per broken word that is wider than its whole room, that only wraps where the browser breaks anyway (measured, not read from its characters), or that no box holds narrower than its parent offers. Written down for the reader, never failed. */
  wide: string[];
  /** One entry per word that paints outside its nearest box with a fill, a side border or a control. */
  spill: string[];
  /** One entry per select whose chosen option is wider than the room the closed select has for it. */
  selectCut: string[];
}

interface LargeTextPageArg {
  dialogEl: Element | null;
  exceptions: string[];
  /** Also work out what is lost at a page-zoom width (the A8 read below). */
  zoom: boolean;
  /** The surfaces whose own clamp is no loss (LargeTextReadOptions surfaceClamps). */
  surfaceClamps: string[];
}

interface LargeTextPageResult extends LargeTextCellRead {
  /** The A8 read's losses; empty when the read was not asked for. */
  lost: string[];
  /** Losses that are a surface's own clamp (surfaceClamps), listed instead of lost. */
  ownClamp: string[];
}

// The ONE in-page read behind every large-text check. It runs in the browser, so it uses nothing
// from this file: every helper it needs is declared inside it.
function largeTextPageRead(rootEl: Element, arg: LargeTextPageArg): LargeTextPageResult {
  const doc = document.documentElement;
  const px = (value: string) => Number.parseFloat(value) || 0;
  const round = (value: number) => Math.round(value * 100) / 100;
  const rootFontSize = px(getComputedStyle(doc).fontSize);
  // Read before the ruler below joins the page.
  const pageSideways = doc.scrollWidth - doc.clientWidth;
  const dialogSideways = arg.dialogEl ? arg.dialogEl.scrollWidth - arg.dialogEl.clientWidth : null;

  const excepted = (el: Element) => arg.exceptions.some((selector) => el.closest(selector) !== null);
  const first30 = (el: Element) => (el.textContent ?? '').replace(/\s+/g, ' ').trim().slice(0, 30);

  // Text that draws nothing: visibility hidden on its element, or a box of 1px by 1px or less on
  // the element or an ancestor (the house sr-only). A display: contents element has no box of its own.
  const drawsNothingMemo = new Map<Element, boolean>();
  const drawsNothing = (el: Element): boolean => {
    const known = drawsNothingMemo.get(el);
    if (known !== undefined) return known;
    let nothing = getComputedStyle(el).visibility === 'hidden';
    for (let a: Element | null = el; a && !nothing; a = a.parentElement) {
      const display = getComputedStyle(a).display;
      if (display === 'none') nothing = true;
      else if (display !== 'contents') {
        const r = a.getBoundingClientRect();
        if (r.width <= 1 && r.height <= 1) nothing = true;
      }
    }
    drawsNothingMemo.set(el, nothing);
    return nothing;
  };

  // The nearest element that is a box of its own (not inline, not display: contents).
  const boxOf = (el: Element): Element => {
    let a = el;
    while (a.parentElement && ['inline', 'contents'].includes(getComputedStyle(a).display)) a = a.parentElement;
    return a;
  };

  const ruler = document.createElement('span');
  ruler.style.cssText = 'position:absolute;visibility:hidden;white-space:nowrap;left:-9999px;top:0;';
  document.body.appendChild(ruler);
  // The read's one touch of the DOM. Whatever happens below, it is taken out again.
  try {
    /** The word's own width on one line, in the font of the element that holds it. */
    const naturalWidth = (word: string, el: Element) => {
      const own = getComputedStyle(el);
      ruler.style.font = own.font;
      ruler.style.letterSpacing = own.letterSpacing;
      ruler.style.textTransform = own.textTransform;
      ruler.textContent = word;
      return ruler.getBoundingClientRect().width;
    };

    interface Word {
      text: string;
      el: Element;
      /** The text node that holds the word, and the word's offsets in it: the split check reads the word again. */
      node: Node;
      start: number;
      end: number;
      rects: DOMRect[];
      lines: number;
    }
    const words: Word[] = [];
    const textElements: Element[] = [];
    const walker = document.createTreeWalker(rootEl, NodeFilter.SHOW_TEXT);
    for (let node = walker.nextNode(); node; node = walker.nextNode()) {
      const el = node.parentElement;
      const content = node.textContent ?? '';
      if (!el || !/\S/.test(content)) continue;
      if (el.closest('script, style, noscript, template')) continue;
      if (drawsNothing(el)) continue;
      let drawn = false;
      for (const match of content.matchAll(/\S+/g)) {
        const start = match.index ?? 0;
        const end = start + match[0].length;
        const range = document.createRange();
        range.setStart(node, start);
        range.setEnd(node, end);
        const rects = Array.from(range.getClientRects()).filter((r) => r.width > 0 && r.height > 0);
        if (!rects.length) continue;
        drawn = true;
        words.push({ text: match[0], el, node, start, end, rects, lines: new Set(rects.map((r) => Math.round(r.top))).size });
      }
      if (drawn && !textElements.includes(el)) textElements.push(el);
    }

    // ---- cut -------------------------------------------------------------------------------------
    const cut: string[] = [];
    const cutHits: Array<{ kind: string; el: Element }> = [];
    const cutSeen = new Map<Element, Set<string>>();
    const addCut = (kind: string, el: Element) => {
      const kinds = cutSeen.get(el) ?? new Set<string>();
      if (kinds.has(kind)) return;
      kinds.add(kind);
      cutSeen.set(el, kinds);
      cutHits.push({ kind, el });
      cut.push(`${kind}: "${first30(el)}"`);
    };

    // The hidden kind, judged per axis. A text rect is cut when it lies more than 1px past, in that
    // axis, the padding box of an element whose overflow in that axis is hidden or clip, among the
    // elements met climbing from the text's own element toward the root element of the page. The
    // climb in an axis STOPS at the first element whose overflow in that axis is auto or scroll:
    // content past a scroller is reachable by scrolling, so a hidden ancestor above the scroller
    // (the house Modal's content box around its scrolling body) never makes scrolled-away text a cut.
    type Axis = 'x' | 'y';
    const clippedBy = (el: Element, rects: DOMRect[], axis: Axis): Element | null => {
      for (let a: Element | null = el; a && a !== doc; a = a.parentElement) {
        const cs = getComputedStyle(a);
        const overflow = axis === 'x' ? cs.overflowX : cs.overflowY;
        if (overflow === 'auto' || overflow === 'scroll') return null;
        if (overflow !== 'hidden' && overflow !== 'clip') continue;
        const box = a.getBoundingClientRect();
        const start = axis === 'x' ? box.left + px(cs.borderLeftWidth) : box.top + px(cs.borderTopWidth);
        const end = axis === 'x' ? box.right - px(cs.borderRightWidth) : box.bottom - px(cs.borderBottomWidth);
        for (const r of rects) {
          const from = axis === 'x' ? r.left : r.top;
          const to = axis === 'x' ? r.right : r.bottom;
          if (from < start - 1 || to > end + 1) return a;
        }
      }
      return null;
    };

    // DECISION Phase 89.6-40 (D29, orchestrator-ruled change to plan 02's read): an SVG text is
    // measured at its DRAWN size, its font size times its vertical screen scale (getScreenCTM),
    // chosen OVER the computed font size, which is in user units an icon's viewBox scales (the
    // landing logo's letter, 15 units in an 80px icon of a 40-unit viewBox, is drawn at 30px and
    // read as 15px, shrunk), and OVER a sixth exception (a read that measures the wrong size would
    // mislead on every SVG text). Every other text is read exactly as before. Changing this is a
    // decision, not a cleanup.
    const drawnFontSize = (el: Element): number => {
      const size = px(getComputedStyle(el).fontSize);
      if (!(el instanceof SVGGraphicsElement)) return size;
      const m = el.getScreenCTM();
      return m ? size * Math.hypot(m.c, m.d) : size;
    };
    for (const el of textElements) {
      if (excepted(el)) continue;
      const box = boxOf(el);
      const boxStyle = getComputedStyle(box);
      const wider = box.scrollWidth > box.clientWidth + 1;
      if (boxStyle.textOverflow === 'ellipsis' && wider) addCut('ellipsis', box);
      if ((boxStyle.whiteSpace === 'nowrap' || boxStyle.whiteSpace === 'pre') && wider) addCut('nowrap', box);
      for (let a: Element | null = el; a; a = a === rootEl ? null : a.parentElement) {
        const clamp = getComputedStyle(a).getPropertyValue('-webkit-line-clamp');
        if (clamp && clamp !== 'none') {
          addCut('clamp', a);
          break;
        }
      }
      if (drawnFontSize(el) < 0.75 * rootFontSize - 0.01) addCut('shrunk', el);
      const rects = words.filter((w) => w.el === el).flatMap((w) => w.rects);
      if (clippedBy(el, rects, 'x') || clippedBy(el, rects, 'y')) addCut('hidden', el);
    }

    // ---- split -----------------------------------------------------------------------------------
    // DECISION Phase 89.6-02 (split-row), REPLACED 2026-11-24 (R6): an orchestrator change, after
    // two amendments the same day, REPAIRED the same day after its scoped check, and amended once
    // more by the owner-ruled last batch (R9, the same day). The read MEASURES whether a broken
    // word would be whole if the rows above it stacked, and whether its breaks are forced, chosen
    // OVER working either out from the page's structure, from its characters or from line counts.
    // AMENDED 2026-11-25 by the owner's ruling on question D, his words "a" (a break at a hyphen is
    // fine; orchestrator change R12): step 0 below, a word whose every break falls where the browser
    // breaks anyway is ordinary wrapping BEFORE stacking is asked, chosen OVER asking first whether
    // stacking would make it whole (which listed a name broken only at its hyphen beside a box, a
    // dialog title's long name beside the close, as split). A forced break is judged as before.
    //
    // WHAT IT DOES, for each word drawn on more than one line (text inside .bb-breakable is not read
    // here: emails and links may break anywhere):
    //   0. FIRST, with nothing stacked (R12): the breaks of the word in the page as it is are
    //      sorted as step 6 sorts them. When none is forced the word is ORDINARY WRAPPING, written
    //      into the wide list (as wider than its whole room when step 5 says so), and steps 1 to
    //      10 are not taken: whether stacking would make it whole is not asked. A word with a
    //      forced break anywhere (letter-stacked, or broken inside one half of a hyphenated name)
    //      goes on to step 1.
    //   1. THE BOUND is the nearest ancestor marked [data-room], WHEREVER it is, above the root of
    //      the read too (plan 89.6-22 marks a row above its read root); with no mark, the root.
    //   2. THE STACK SET is every element from the word's own element up to the bound, the bound
    //      included, that lays its children out side by side: a flex container whose direction is
    //      a row; a grid of more than one column; a table (met at its row, or at the box that holds
    //      the cell the word is in: the WHOLE table is stacked, its row groups, rows and cells, so
    //      that a row is not left bound to the first column); a multi-column box. A column-direction
    //      flex container and a grid of one column are never in it: they stack their items already.
    //   3. ONE constructed stylesheet, added to a COPY of document.adoptedStyleSheets, lays each of
    //      them out as a stack, its items stretched to its width, every declaration important. The
    //      read then checks that every declaration took on each container, and that the computed
    //      align-self of the item that holds the word reads stretch (the declaration took; the
    //      item's width is not looked at). One that did not (an important declaration on the
    //      element itself, or inside a cascade layer, wins) is said so in the split list as COULD
    //      NOT STACK: nothing was measured, and guessing would be silent.
    //   4. SPLIT when the word is now on one line AND inside every box from its own up to the
    //      bound. Whole only by spilling out of a box is not room. INSIDE a box means inside its
    //      content box, widened on a side by the negative margin of its child on the word's path
    //      (a box pulled into its parent's padding by its own margin was placed there; a box that
    //      overflows because its content is too wide was not). The widening is CARRIED UP, side by
    //      side, through every box on the path that has no padding and no border of its own on
    //      that side: a full-bleed row inside a plain wrapper sits in the padding of the card
    //      around the wrapper, and was placed there the same way (R9). A box with an edge hands
    //      nothing up, chosen OVER a running total carried through every box: with that, a row
    //      pulled out of its card altogether would read as inside the page around the card. At a
    //      box that scrolls sideways the word is placed in that box's own scroll coordinates, the
    //      whole scrollable width counts, and the boxes above it are not looked at: scrolling
    //      moves the word, it does not spill it.
    //   5. Otherwise WIDE when the word's own one-line width is greater than the bound's content
    //      width: such a word may break (SPEC R4), whatever its breaks are and whatever its rows do.
    //   6. A word still on more than one line has its breaks sorted by WHERE they fall (R9). The
    //      places the browser breaks the word anyway are measured once: the word is laid out in
    //      the measuring span with no room at all and with overflow-wrap, word-break and
    //      line-break at their normal values, and every line start there is such a place
    //      (measured here: after a hyphen, a soft hyphen and an en dash; not after a slash
    //      between two words). A break of the word in the page that falls anywhere else is
    //      FORCED. Counting lines with forced breaks off, as this step did before R9, missed a
    //      forced break that left the count as it was ("Weekend-Go" broken inside "Weekend" is
    //      on two lines, and so is its wrap at the hyphen). The word is also read in place with
    //      the same three properties switched off, on the word's OWN element only, through one
    //      more temporary sheet (step 8 uses that read); a declaration that did not take is said
    //      as COULD NOT UNWRAP.
    //   7. When no break is forced once stacked: step 0 saw a forced break in the page AS IT IS,
    //      so stacking took it away, and that is SPLIT (the word was broken inside itself only
    //      because of the row). Before R12 this step also wrote ordinary wrapping, for a word
    //      with no forced break; step 0 now takes that word before anything is stacked.
    //   8. When a forced break is left: SPLIT, as glued, when the word unbroken would fit a line
    //      of its own block: with its forced breaks off it is on ONE line, and its width there,
    //      plus the side padding, border and margin of every inline box that holds only this
    //      word, is at most the block's content width. The browser breaks a word only when its
    //      line has no earlier place to wrap, so this word was glued to what stands before it.
    //      What stands before it is not read (an element, generated content, nothing).
    //   9. Otherwise HELD by the first box, from its own up to the bound (the bound left out), that
    //      is narrower than what it is offered less its own side margins (an automatic margin is free
    //      space, not an edge): its parent's content width, or, for a box positioned absolute or
    //      fixed, its containing block's padding box (amended by ruling D14, plan 89.6-16: a
    //      positioned box was held unconditionally, and a list filling its relative parent read
    //      held). The entry names the box.
    //  10. Otherwise WIDE: the edges between the word and its bound take the room.
    //  11. The sheet list and every scroll offset are put back after each temporary sheet, in a
    //      finally (a throw part-way leaves nothing behind), and at the end the layout (the root's
    //      box and every word's boxes), the length of the sheet list and the scroll offsets are
    //      compared with what they were. A difference is said in the split list as NOT RESTORED.
    // Steps 5 to 10 are read while the stack is still on (step 7's look at the page as it is
    // apart): what stacking could not change is what holds the word.
    //
    // WHAT THE APP CAN SEE OF A READ. No app node is written to: every change is a stylesheet of
    // the read's own. The ONE touch of the DOM is the measuring span (the ruler above): appended to
    // body when the read starts and removed in a finally when it ends, and a MutationObserver on
    // body sees both. No ResizeObserver fires and no transition starts (measured in the research).
    //
    // WHAT WAS REJECTED. (a) The structural walk this replaces: find the outermost row above the
    // word, take every padding, border and margin between the two off its content width, compare
    // with the word's width. On 92 judged words it gave 15 wrong verdicts against 1 for this method,
    // and it had no held list: planning:.planning/phases/89.6-large-text-200-method-test-ci-coverage-audit-inserted-2026-1/execute/R4-RESEARCH.md ("2. Answer in short").
    // Two scoped checks each found shapes its arithmetic had not thought of (a pop-up, a fixed
    // label, a middle word of a padded inline box, a subgrid, text columns). (b) Intrinsic sizes
    // read from hidden clones: 30 wrong, mostly real squeezes read as wide, and every clone is a DOM
    // insert the app can see. (c) The same measurement through inline styles saved and put back: the
    // app's own MutationObservers see it, and an inline style put back wrong stays wrong. (d) A
    // stacked item left centred (no stretch): on real screens it hid every squeezed word that shared
    // an item with one genuinely wide word, 8 silent misses. (e) This method's first two judgement
    // rules, which inferred: a list of characters for a natural break (it knew the hyphen only, so
    // a soft hyphen and an en dash read as split), and a reading of what stands before the word for
    // glue (an icon positioned in a label's padding read as glue; generated content did not):
    // planning:.planning/phases/89.6-large-text-200-method-test-ci-coverage-audit-inserted-2026-1/execute/R6-SCOPED-CHECK-1.md ("Findings").
    // (f) Three parts of the repaired method (R9): forced breaks told by a count of lines, the
    // widening of step 4 for a box's direct child only, and line-break left on while forced
    // breaks are off:
    // planning:.planning/phases/89.6-large-text-200-method-test-ci-coverage-audit-inserted-2026-1/execute/R6-SCOPED-CHECK-2.md ("New findings").
    //
    // WHAT IT CANNOT SEE (measured, or named as not measured): planning:.planning/phases/89.6-large-text-200-method-test-ci-coverage-audit-inserted-2026-1/execute/R4-RESEARCH.md ("6. What each method cannot see, measured").
    //   - an item whose width of 0 exists only to share its row (w-0 with flex-1) reads HELD, where
    //     a person could say split. It is surfaced, never silent; the app has no such item;
    //   - a row it cannot stack, and a word whose forced breaks it cannot switch off, are not
    //     judged at all (COULD NOT STACK, COULD NOT UNWRAP);
    //   - the first or last word of an inline box that holds several words carries that box's
    //     side padding on its line; step 8 does not count it (only a box that holds the one word);
    //   - a box moved by a transform or by relative positioning is not a box placed by its margin;
    //   - a pull carried up through a plain wrapper is not made smaller by that wrapper's own
    //     positive side margin, and stops at the first box with padding or a border, however thin;
    //   - the places the browser breaks anyway are measured in the measuring span, which takes
    //     the word's own hyphens value and nothing else of its style: a word hyphenated by a
    //     language set below the document root is not laid out in that language;
    //   - text inside a shadow tree or a frame is not reached by the stylesheet (not measured);
    //   - a pop-up that hangs outside its anchor's box and is whole only when stacked may fail the
    //     inside check and read HELD (not built, none found in src).
    //
    // CHROMIUM ONLY, as every Playwright project here is: constructed stylesheets in
    // document.adoptedStyleSheets (which hands back the SAME live array every time, so the list is
    // copied before it is changed: putting back the array itself restores nothing), and
    // computedStyleMap with CSSKeywordValue (the computed value of a width or margin, where
    // getComputedStyle gives used px).
    //
    // Each part has a case that goes red when that part alone is taken out: e2e/large-text-blocks.spec.ts ("THE SPLIT CONTROLS").
    // The governing rule is the owner's: src/app/globals.css ("DECISION Phase 89.6-02 (bb-row)").
    // Changing a part is a decision, not a cleanup.
    const parentBoxOf = (el: Element): Element | null => (el.parentElement ? boxOf(el.parentElement) : null);
    const nameOf = (el: Element) => `${el.tagName.toLowerCase()}${Array.from(el.classList).slice(0, 3).map((token) => `.${token}`).join('')}`;
    const contentWidth = (el: Element) => {
      const cs = getComputedStyle(el);
      return el.clientWidth - px(cs.paddingLeft) - px(cs.paddingRight);
    };
    /**
     * The width a positioned box is offered: the padding box of its containing block, the nearest ancestor
     * that is positioned (for an absolute box) or that transforms, filters or contains its layout or paint
     * (for either kind), else the viewport.
     */
    const containingWidthOf = (el: Element, position: string): number => {
      for (let a = el.parentElement; a; a = a.parentElement) {
        const cs = getComputedStyle(a);
        if (cs.display === 'contents') continue;
        const forms =
          (position === 'absolute' && cs.position !== 'static') ||
          [cs.transform, cs.translate, cs.rotate, cs.scale, cs.perspective, cs.filter, cs.backdropFilter].some((value) => value !== '' && value !== 'none') ||
          /\b(layout|paint|strict|content)\b/.test(cs.contain) ||
          cs.containerType !== 'normal' ||
          /\b(transform|translate|rotate|scale|perspective|filter)\b/.test(cs.willChange);
        if (!forms) continue;
        if (cs.display !== 'inline') return a.clientWidth;
        return a.getBoundingClientRect().width - px(cs.borderLeftWidth) - px(cs.borderRightWidth);
      }
      return document.documentElement.clientWidth;
    };
    /** A side margin in px, or 0 when it is automatic (the computed value, not the used one). */
    const sideMargin = (el: Element, property: 'margin-left' | 'margin-right', used: string): number => {
      const computed = el.computedStyleMap().get(property);
      return computed instanceof CSSKeywordValue && computed.value === 'auto' ? 0 : px(used);
    };
    /** How many columns a grid lays its items out in. */
    const gridColumns = (cs: CSSStyleDeclaration): number => {
      const list = cs.gridTemplateColumns;
      // A subgrid's computed list holds no track size: the keyword, then one bracket group per LINE.
      if (/^subgrid\b/.test(list)) return (list.match(/\[/g) ?? []).length - 1;
      // Any other grid: the used track list, one size per column, with the line names taken out.
      return list
        .replace(/\[[^\]]*\]/g, ' ')
        .split(/\s+/)
        .filter((track) => track && track !== 'none').length;
    };
    const rangeOf = (w: Word): Range => {
      const range = document.createRange();
      range.setStart(w.node, w.start);
      range.setEnd(w.node, w.end);
      return range;
    };
    const drawnRects = (range: Range) => Array.from(range.getClientRects()).filter((r) => r.width > 0 && r.height > 0);
    const lineCount = (rects: DOMRect[]) => new Set(rects.map((r) => Math.round(r.top))).size;

    interface Stack {
      /** The temporary declarations, per element. */
      changes: Map<Element, Record<string, string>>;
      /** The stacked containers whose items are stretched across them, each with its item that holds the word (null when the word is the container's own text). */
      stretched: Map<Element, Element | null>;
      /** The side-by-side containers, nearest the word first. */
      rows: Element[];
    }
    const stackOf = (from: Element, bound: Element): Stack => {
      const stack: Stack = { changes: new Map(), stretched: new Map(), rows: [] };
      const change = (el: Element, declarations: Record<string, string>) => stack.changes.set(el, { ...stack.changes.get(el), ...declarations });
      /** A table box and every row group, row and cell of it (not of a table inside one of its cells) become blocks. */
      const blockTable = (el: Element): void => {
        change(el, { display: 'block' });
        for (const part of Array.from(el.children)) {
          const display = getComputedStyle(part).display;
          if (display === 'table-cell') change(part, { display: 'block' });
          else if (/^table-(row|row-group|header-group|footer-group)$/.test(display)) blockTable(part);
        }
      };
      let child: Element | null = null;
      for (let a: Element | null = from; a; child = a, a = a.parentElement) {
        const cs = getComputedStyle(a);
        const display = cs.display;
        const flex = /flex/.test(display);
        const grid = /grid/.test(display);
        if (flex && !cs.flexDirection.startsWith('column')) {
          change(a, { 'flex-direction': 'column', 'flex-wrap': 'nowrap', 'align-items': 'stretch' });
          stack.stretched.set(a, child);
          stack.rows.push(a);
        } else if (grid && gridColumns(cs) > 1) {
          change(a, { display: display === 'inline-grid' ? 'inline-flex' : 'flex', 'flex-direction': 'column', 'flex-wrap': 'nowrap', 'align-items': 'stretch' });
          stack.stretched.set(a, child);
          stack.rows.push(a);
        } else if (display === 'table-row' || (child !== null && getComputedStyle(child).display === 'table-cell')) {
          // A table-row box, or whatever holds the cell the word is in (the browser builds the row
          // around cells). Its table is the nearest table box reached through table boxes only, at
          // or under the bound; with none (a bare row, cells in a plain block) it is this box.
          let table: Element = a;
          for (let t: Element | null = a; t; t = t === bound ? null : t.parentElement) {
            const boxDisplay = getComputedStyle(t).display;
            if (boxDisplay === 'table' || boxDisplay === 'inline-table') {
              table = t;
              break;
            }
            if (t !== a && !boxDisplay.startsWith('table-')) break;
          }
          blockTable(table);
          if (!stack.rows.includes(table)) stack.rows.push(table);
        }
        // The column properties do nothing on a flex or grid container, so those are not text columns.
        if (!flex && !grid && (cs.columnCount !== 'auto' || cs.columnWidth !== 'auto')) {
          change(a, { 'column-count': 'auto', 'column-width': 'auto' });
          if (!stack.rows.includes(a)) stack.rows.push(a);
        }
        if (a === bound) break;
      }
      return stack;
    };
    /** A selector for one element: its position among its siblings, at every level from the root. */
    const pathOf = (el: Element): string => {
      const steps: string[] = [];
      for (let a: Element | null = el; a && a !== doc; a = a.parentElement) {
        steps.unshift(`:nth-child(${Array.prototype.indexOf.call(a.parentElement?.children ?? [], a) + 1})`);
      }
      return [':root', ...steps].join(' > ');
    };
    const sheetTextOf = (stack: Stack): string => {
      const rules: string[] = [];
      for (const [el, declarations] of stack.changes) {
        const path = pathOf(el);
        rules.push(`${path} { ${Object.entries(declarations).map(([property, value]) => `${property}: ${value} !important;`).join(' ')} }`);
        if (stack.stretched.has(el)) rules.push(`${path} > * { align-self: stretch !important; }`);
      }
      return rules.join('\n');
    };
    /**
     * The elements of a stack on which a temporary declaration did not take: a stacked container,
     * or the item of it that holds the word when that item's computed align-self does not read
     * stretch. Only that item is looked at: a box beside it that keeps its own alignment takes
     * nothing from the word.
     */
    const notStacked = (stack: Stack): Element[] => {
      const missed: Element[] = [];
      for (const [el, declarations] of stack.changes) {
        const cs = getComputedStyle(el);
        if (!Object.entries(declarations).every(([property, value]) => cs.getPropertyValue(property) === value)) missed.push(el);
        const item = stack.stretched.get(el);
        if (item && getComputedStyle(item).alignSelf !== 'stretch') missed.push(item);
      }
      return missed;
    };
    /** What makes a box as wide as it is by its own style, for the held entry. */
    const whyOf = (el: Element): string => {
      const computed = el.computedStyleMap();
      const position = getComputedStyle(el).position;
      const isKeyword = (property: string, keyword: string) => {
        const value = computed.get(property);
        return value instanceof CSSKeywordValue && value.value === keyword;
      };
      const parts: string[] = [];
      if (position === 'absolute' || position === 'fixed') parts.push(`position ${position}`);
      if (!isKeyword('width', 'auto')) parts.push(`width ${String(computed.get('width'))}`);
      if (!isKeyword('max-width', 'none')) parts.push(`max-width ${String(computed.get('max-width'))}`);
      const basis = computed.get('flex-basis');
      if (basis !== undefined && !(basis instanceof CSSKeywordValue)) parts.push(`flex-basis ${String(basis)}`);
      return parts.join(', ') || 'no width of its own';
    };

    /** Every scroll offset that is not 0: what a temporary layout may clamp. */
    const scrollOf = () =>
      Array.from(document.querySelectorAll('*'))
        .filter((el) => el.scrollTop !== 0 || el.scrollLeft !== 0)
        .map((el) => ({ el, top: el.scrollTop, left: el.scrollLeft }));
    let scrollBefore: ReturnType<typeof scrollOf> = [];
    /**
     * Run `read` with one more temporary stylesheet adopted, then put the sheet list and the scroll
     * offsets back, whatever `read` did: a throw too. Nested calls put back what they found.
     */
    const withSheet = <T>(text: string, read: () => T): T => {
      const sheet = new CSSStyleSheet();
      sheet.replaceSync(text);
      // A COPY of the list (see the marker above): the array itself is live.
      const sheetsBefore = [...document.adoptedStyleSheets];
      document.adoptedStyleSheets = [...sheetsBefore, sheet];
      try {
        return read();
      } finally {
        try {
          document.adoptedStyleSheets = sheetsBefore;
        } finally {
          for (const s of scrollBefore) {
            if (s.el.scrollTop !== s.top) s.el.scrollTop = s.top;
            if (s.el.scrollLeft !== s.left) s.el.scrollLeft = s.left;
          }
        }
      }
    };

    /** Step 4's inside: see the marker. `word` is the word's box, read in the layout as it stands. */
    const insideEveryBox = (word: DOMRect, own: Element, boundBox: Element): boolean => {
      let child: Element | null = null;
      // How far the boxes below were pulled out of the content of the box being looked at, per side.
      let pulledLeft = 0;
      let pulledRight = 0;
      for (let a: Element | null = own; a; child = a, a = a === boundBox ? null : parentBoxOf(a)) {
        const cs = getComputedStyle(a);
        const box = a.getBoundingClientRect();
        if (child) {
          // A child pulled out of this box's content by its own negative margin was placed there.
          // What was pulled out of the child itself comes up with it only when the child has no
          // padding and no border of its own on that side: a plain wrapper is no edge to spill out
          // of. A child with an edge hands nothing up, so a box pulled out of a card altogether
          // is outside the box above the card, as it was before the pull was carried at all.
          const childStyle = getComputedStyle(child);
          const plainLeft = px(childStyle.paddingLeft) + px(childStyle.borderLeftWidth) === 0;
          const plainRight = px(childStyle.paddingRight) + px(childStyle.borderRightWidth) === 0;
          pulledLeft = Math.max(0, -px(childStyle.marginLeft)) + (plainLeft ? pulledLeft : 0);
          pulledRight = Math.max(0, -px(childStyle.marginRight)) + (plainRight ? pulledRight : 0);
        }
        if (cs.overflowX === 'auto' || cs.overflowX === 'scroll') {
          // In this box's own scroll coordinates, the same at every scroll offset; all of its
          // scrollable width counts, and nothing above a scrolling box can be spilled out of.
          const x = word.left - (box.left + px(cs.borderLeftWidth)) + a.scrollLeft;
          const from = px(cs.paddingLeft) - pulledLeft;
          const to = a.scrollWidth > a.clientWidth ? a.scrollWidth : a.clientWidth - px(cs.paddingRight) + pulledRight;
          return x >= from - 0.5 && x + word.width <= to + 0.5;
        }
        const left = box.left + px(cs.borderLeftWidth) + px(cs.paddingLeft) - pulledLeft;
        const right = box.right - px(cs.borderRightWidth) - px(cs.paddingRight) + pulledRight;
        if (word.left < left - 0.5 || word.right > right + 0.5) return false;
      }
      return true;
    };

    interface Unwrapped {
      /** The declarations that switch forced breaks off took on the word's own element. */
      took: boolean;
      /** How many lines the word is on with forced breaks off. */
      lines: number;
      /** On one line: its unbroken width, plus the side edges of every inline box that holds only this word. */
      needs: number;
    }
    /**
     * Step 6: the word read again with its forced breaks switched off, in the layout as it stands.
     * The three properties are set on the word's OWN element and nowhere else: they are inherited,
     * and a text breaks by the values of the element that holds it, so a rule on that element is
     * all the word needs. The boxes around it keep their wrapping, and so does the text beside it.
     */
    const unwrapped = (w: Word, own: Element): Unwrapped => {
      return withSheet(`${pathOf(w.el)} { overflow-wrap: normal !important; word-break: normal !important; line-break: auto !important; }`, () => {
        const cs = getComputedStyle(w.el);
        const range = rangeOf(w);
        let needs = range.getBoundingClientRect().width;
        for (let a: Element | null = w.el; a && a !== own; a = a.parentElement) {
          const edge = getComputedStyle(a);
          if (edge.display !== 'inline' || (a.textContent ?? '').trim() !== w.text) continue;
          needs += px(edge.paddingLeft) + px(edge.paddingRight) + px(edge.borderLeftWidth) + px(edge.borderRightWidth) + px(edge.marginLeft) + px(edge.marginRight);
        }
        return { took: cs.overflowWrap === 'normal' && cs.wordBreak === 'normal' && cs.lineBreak === 'auto', lines: lineCount(drawnRects(range)), needs };
      });
    };

    /** Where a new line starts inside a run of text: the offset, counted from `start`, of every character drawn on another line than the character drawn before it. */
    const lineStartsIn = (node: Node, start: number, end: number): number[] => {
      const range = document.createRange();
      const starts: number[] = [];
      let line: number | null = null;
      for (let at = start; at < end; at += 1) {
        range.setStart(node, at);
        range.setEnd(node, at + 1);
        // A character that draws nothing (a soft hyphen the line did not break at) is on no line.
        const drawn = drawnRects(range)[0];
        if (!drawn) continue;
        const top = Math.round(drawn.top);
        if (line !== null && top !== line) starts.push(at - start);
        line = top;
      }
      return starts;
    };
    /**
     * The places the browser breaks the word anyway: the word laid out in the measuring span with
     * no room at all and forced breaks off. With no room every place it may break is taken, so
     * each line start is one of them. Where a word may break does not depend on its font, so the
     * span keeps whatever font it has; it takes the word's own hyphens value (a soft hyphen is no
     * such place under hyphens: none) and none of the page's wrapping, which it would inherit
     * from body. Its style is put back for the width measurements that follow.
     */
    const naturalBreaksOf = (w: Word): Set<number> => {
      const styleBefore = ruler.style.cssText;
      try {
        ruler.style.hyphens = getComputedStyle(w.el).hyphens;
        ruler.style.whiteSpace = 'normal';
        ruler.style.width = '0';
        ruler.style.overflowWrap = 'normal';
        ruler.style.wordBreak = 'normal';
        ruler.style.lineBreak = 'auto';
        ruler.textContent = w.text;
        return new Set(ruler.firstChild ? lineStartsIn(ruler.firstChild, 0, w.text.length) : []);
      } finally {
        ruler.style.cssText = styleBefore;
      }
    };

    type Verdict = 'split' | 'held' | 'wide';
    interface Found {
      verdict: Verdict;
      text: string;
    }
    /** Steps 1 to 10 for one word. */
    const judge = (w: Word): Found => {
      const quoted = `"${w.text}"`;
      const bound = w.el.closest('[data-room]') ?? rootEl;
      // The bound as a box: a mark on an element with no box of its own stands for the nearest box around it.
      const boundBox = boxOf(bound);
      const own = boxOf(w.el);
      const stack = stackOf(w.el, bound);
      const rows = stack.rows;
      const stacking = `${rows.length} ${rows.length === 1 ? 'row stacks' : 'rows stack'}: ${rows.map(nameOf).join(', ')}`;
      const couldNotUnwrap: Found = { verdict: 'split', text: `${quoted} COULD NOT UNWRAP ${nameOf(w.el)}: its forced breaks could not be switched off, nothing measured` };
      const ordinary = (ending: string): Found => ({
        verdict: 'wide',
        text: `${quoted} wraps only where the browser breaks anyway (measured with no room and no forced breaks, not read from its characters), ${ending}: ordinary wrapping`,
      });
      let natural: Set<number> | null = null;
      /** Step 6: a break of the word, in the layout as it stands, that falls anywhere but at a place the browser breaks it anyway. */
      const hasForcedBreak = (): boolean => {
        natural ??= naturalBreaksOf(w);
        const places = natural;
        return lineStartsIn(w.node, w.start, w.end).some((at) => !places.has(at));
      };
      /** Step 5: a word wider than its whole room may break, whatever its breaks are and whatever its rows do. */
      const widerThanItsRoom = (): Found | null => {
        const natural = naturalWidth(w.text, w.el);
        const room = contentWidth(boundBox);
        return natural > room + 0.5 ? { verdict: 'wide', text: `${quoted} ${round(natural)}px is wider than its whole room, ${round(room)}px (${nameOf(boundBox)})` } : null;
      };
      /** Steps 9 and 10: what holds a word that no line of its block would hold. */
      const heldOrWide = (): Found => {
        const natural = naturalWidth(w.text, w.el);
        for (let a: Element | null = own; a && a !== boundBox; a = parentBoxOf(a)) {
          const cs = getComputedStyle(a);
          // DECISION Phase 89.6-16 D14 (positioned): a positioned box holds a word only when it is narrower than
          // its containing block's padding box offers, chosen OVER naming every positioned box as the holder (a
          // list that fills its relative parent, Home's stacked groups list, read held: a false red) and OVER its
          // DOM parent's content box (the T1 pop-up under a padded anchor then read wide). Changing it is a decision.
          const positioned = cs.position === 'absolute' || cs.position === 'fixed';
          const parent = parentBoxOf(a);
          if (!positioned && !parent) break;
          const room = positioned ? containingWidthOf(a, cs.position) : contentWidth(parent as Element);
          const offered = room - sideMargin(a, 'margin-left', cs.marginLeft) - sideMargin(a, 'margin-right', cs.marginRight);
          const used = a.getBoundingClientRect().width;
          if (used < offered - 0.5) {
            return { verdict: 'held', text: `${quoted} ${w.lines} lines, held narrow by ${nameOf(a)} (${whyOf(a)}): ${round(used)}px of the ${round(offered)}px ${positioned ? 'its containing block' : 'its parent'} offers` };
          }
        }
        return { verdict: 'wide', text: `${quoted} ${round(natural)}px: no box between it and ${nameOf(boundBox)} is narrower than its parent offers; the edges between them take the room` };
      };
      /** Steps 3 to 10 in the layout as it stands (the stack is on). Null: only step 7's second read is left, and it is made with the stack off. */
      const stacked = (): Found | null => {
        const missed = notStacked(stack);
        if (missed.length > 0) return { verdict: 'split', text: `${quoted} COULD NOT STACK ${missed.map(nameOf).join(', ')}: nothing measured` };
        const range = rangeOf(w);
        const lines = lineCount(drawnRects(range));
        if (lines === 1) {
          if (rows.length > 0 && insideEveryBox(range.getBoundingClientRect(), own, boundBox)) return { verdict: 'split', text: `${quoted} ${w.lines} lines, whole on one line when ${stacking}` };
          // Whole only by spilling out of a box, which is not room.
          return widerThanItsRoom() ?? heldOrWide();
        }
        const tooWide = widerThanItsRoom();
        if (tooWide) return tooWide;
        const ownRoom = contentWidth(own);
        const free = unwrapped(w, own);
        if (!free.took) return couldNotUnwrap;
        // Step 0 saw a forced break in the page as it is; none left once stacked is step 7's split.
        if (!hasForcedBreak()) return null;
        // A forced break is left.
        if (free.lines === 1 && free.needs <= ownRoom + 0.5) {
          return { verdict: 'split', text: `${quoted} ${w.lines} lines: a line of its own block would hold it (${round(free.needs)}px of ${round(ownRoom)}px), so it is glued to what stands before it` };
        }
        return heldOrWide();
      };
      // Step 0, the owner's ruling on question D (2026-11-25, "a": a break at a hyphen is fine): with nothing stacked,
      // a word whose every break falls where the browser breaks anyway is ordinary wrapping. Stacking is not asked.
      if (!hasForcedBreak()) return widerThanItsRoom() ?? ordinary(rows.length === 0 ? 'and nothing above it stacks' : 'whether or not stacking would make it whole (the owner, 2026-11-25)');
      const found = stack.changes.size === 0 ? stacked() : withSheet(sheetTextOf(stack), stacked);
      if (found) return found;
      // Step 7, rows stacked: the word has a forced break in the page as it is (step 0), and stacking took every one away.
      return { verdict: 'split', text: `${quoted} ${w.lines} lines: its forced breaks go when ${stacking}, and what is left is an ordinary wrap` };
    };

    const split: string[] = [];
    const held: string[] = [];
    const wide: string[] = [];
    const judged = words.filter((w) => w.lines > 1 && !w.el.closest('.bb-breakable'));
    if (judged.length > 0) {
      const layoutOf = () => JSON.stringify([rootEl.getBoundingClientRect(), ...words.map((w) => Array.from(rangeOf(w).getClientRects()).map((r) => [r.left, r.top, r.width]))]);
      const layoutBefore = layoutOf();
      scrollBefore = scrollOf();
      const sheetCountBefore = document.adoptedStyleSheets.length;
      const lists: Record<Verdict, string[]> = { split, held, wide };
      for (const w of judged) {
        const found = judge(w);
        lists[found.verdict].push(found.text);
      }
      // The put-back proof. Each line fails the cell: a read that leaves the page changed spoils every check after it.
      const scrollAfter = scrollOf();
      const scrollMoved = scrollAfter.length !== scrollBefore.length || scrollBefore.some((s, i) => scrollAfter[i].el !== s.el || scrollAfter[i].top !== s.top || scrollAfter[i].left !== s.left);
      if (document.adoptedStyleSheets.length !== sheetCountBefore) split.push(`NOT RESTORED: the page has ${document.adoptedStyleSheets.length} adopted stylesheets after the read, ${sheetCountBefore} before it`);
      if (scrollMoved) split.push('NOT RESTORED: a scroll offset moved during the read');
      if (layoutOf() !== layoutBefore) split.push('NOT RESTORED: the layout differs after the read');
    }

    // ---- spill -----------------------------------------------------------------------------------
    // A word's box is the nearest element, from the text's own element up, that has a fill (a
    // background colour that is not transparent), a left or right border, or is a control. A word
    // with any rect more than 1px past that box's left or right edge paints outside it: no page
    // scroll, no cut and no split see that (research M F4, "Member" 4px out of Invite Member).
    // DECISION Phase 89.6-02 R13 (orchestrator decision D20, 2026-11-25): the search STOPS at the first
    // element, from the text's own up, whose overflow-x is not visible (auto, scroll, hidden, clip), and a
    // word past that box's edge is no spill, chosen OVER climbing past it to the next filled box: content
    // past a box that scrolls or clips sideways is clipped by it and reachable by scrolling, it paints
    // nowhere outside the card (the availability grid's day headers read as spilling up to 972px at
    // 768 / 200%). Clipped text is judged by the cut check's hidden kind and the page-zoom reach.
    // Changing this is a decision, not a cleanup.
    const CONTROL = 'button, a[href], select, input, textarea, label, [role="button"]';
    const transparent = (colour: string) => colour === 'transparent' || /,\s*0\)$/.test(colour) || /\/\s*0\)$/.test(colour);
    const spillBoxOf = (el: Element): Element | null => {
      for (let a: Element | null = el; a && a !== doc; a = a.parentElement) {
        const cs = getComputedStyle(a);
        if (cs.overflowX !== 'visible') return null;
        if (!transparent(cs.backgroundColor) || px(cs.borderLeftWidth) > 0 || px(cs.borderRightWidth) > 0 || a.matches(CONTROL)) return a;
      }
      return null;
    };
    const spill: string[] = [];
    for (const w of words) {
      const box = spillBoxOf(w.el);
      if (!box) continue;
      const edge = box.getBoundingClientRect();
      const past = Math.max(...w.rects.map((r) => Math.max(edge.left - r.left, r.right - edge.right)));
      if (past > 1) spill.push(`"${w.text}" spills ${round(past)}px out of its ${box.tagName.toLowerCase()}`);
    }

    // ---- select-fit ------------------------------------------------------------------------------
    // A closed select shows its chosen option on one line and cuts what does not fit. The room is
    // the select's inside width less its side padding, less 20px for the native arrow unless the
    // select has dropped its native appearance.
    const selectCut: string[] = [];
    for (const select of Array.from(rootEl.querySelectorAll('select'))) {
      if (drawsNothing(select)) continue;
      const chosen = select.selectedOptions[0]?.text ?? '';
      if (!chosen.trim()) continue;
      const cs = getComputedStyle(select);
      const native = cs.appearance !== 'none' && cs.getPropertyValue('-webkit-appearance') !== 'none';
      const room = select.clientWidth - px(cs.paddingLeft) - px(cs.paddingRight) - (native ? 20 : 0);
      const needs = naturalWidth(chosen, select);
      if (needs > room + 1) selectCut.push(`select value cut: "${chosen}" needs ${round(needs)}px, has ${round(room)}px`);
    }

    // ---- lost (the A8 read) ----------------------------------------------------------------------
    const lost: string[] = [];
    const ownClamp: string[] = [];
    if (arg.zoom) {
      const named = (el: Element) => `${el.tagName.toLowerCase()} "${first30(el) || (el.getAttribute('aria-label') ?? '').slice(0, 30)}"`;
      // The first overflow that is not visible, climbing from the element itself in one axis.
      const firstOverflow = (el: Element, axis: Axis): 'scroll' | 'clip' | null => {
        for (let a: Element | null = el; a && a !== doc; a = a.parentElement) {
          const cs = getComputedStyle(a);
          const overflow = axis === 'x' ? cs.overflowX : cs.overflowY;
          if (overflow === 'auto' || overflow === 'scroll') return 'scroll';
          if (overflow === 'hidden' || overflow === 'clip') return 'clip';
        }
        return null;
      };

      // (a) unreachable: a control, or text, that starts left of or above the page's origin (no
      // scroll goes there), or that lies past the padding box of a hidden or clip ancestor, with the
      // same per-axis climb as the hidden kind above (a scroller met first makes it reachable).
      const unreachable = new Set<Element>();
      // DECISION Phase 89.6-40 (D27, orchestrator-ruled): a clip is a surface's own clamp, and so no
      // loss, only when the clipped element AND the box that clips it both match ONE surface
      // selector (SPEC A3 (3): the calendar list-row titles' clamp is Phase 88.9.2's, and the cut
      // check already skips it), chosen OVER clearing every clip under a surface (a title cut by a
      // parent box, or by anything but its own clamp, is still lost) and OVER a sixth exception.
      // Listed in ownClamp, never dropped. Changing this is a decision, not a cleanup.
      const whyUnreachable = (rects: DOMRect[], climbFrom: Element | null): { why: string; clipper: Element | null } | null => {
        if (Math.min(...rects.map((r) => r.left)) + window.scrollX < -0.5) return { why: 'starts left of the page', clipper: null };
        if (Math.min(...rects.map((r) => r.top)) + window.scrollY < -0.5) return { why: 'starts above the page', clipper: null };
        const clipper = climbFrom ? (clippedBy(climbFrom, rects, 'x') ?? clippedBy(climbFrom, rects, 'y')) : null;
        return clipper ? { why: `is clipped by its ${clipper.tagName.toLowerCase()}`, clipper } : null;
      };
      const isOwnClamp = (el: Element, clipper: Element | null): boolean =>
        clipper !== null && arg.surfaceClamps.some((selector) => clipper.matches(selector) && el.closest(selector) !== null);
      const REACHED = 'button, a[href], input, select, textarea, [role="button"], [tabindex]:not([tabindex="-1"])';
      const controls = Array.from(rootEl.querySelectorAll(REACHED)).filter((c) => {
        const r = c.getBoundingClientRect();
        return !drawsNothing(c) && r.width > 0 && r.height > 0;
      });
      for (const control of controls) {
        const hit = whyUnreachable([control.getBoundingClientRect()], control.parentElement);
        if (!hit) continue;
        unreachable.add(control);
        (isOwnClamp(control, hit.clipper) ? ownClamp : lost).push(`unreachable: ${named(control)} ${hit.why}`);
      }
      for (const el of textElements) {
        if (Array.from(unreachable).some((u) => u.contains(el))) continue;
        const hit = whyUnreachable(words.filter((w) => w.el === el).flatMap((w) => w.rects), el);
        if (!hit) continue;
        unreachable.add(el);
        (isOwnClamp(el, hit.clipper) ? ownClamp : lost).push(`unreachable: ${named(el)} ${hit.why}`);
      }

      // (b) cut with no way to reach it: the ellipsis, clamp and nowrap kinds above (the exceptions
      // list already honoured), unless a scroller is the first overflow met climbing from the cut
      // element itself, sideways for ellipsis and nowrap, downward for clamp.
      for (const hit of cutHits) {
        if (!['ellipsis', 'clamp', 'nowrap'].includes(hit.kind)) continue;
        if (firstOverflow(hit.el, hit.kind === 'clamp' ? 'y' : 'x') === 'scroll') continue;
        lost.push(`cut: ${hit.kind} ${named(hit.el)}`);
      }

      // (c) overlap: two controls whose boxes cross by more than 1px in both directions, or the
      // text of two elements crossing the same way, where neither element contains the other.
      // Only the DRAWN part of a box counts: what is left of it after every ancestor that does not
      // show its overflow (hidden, clip, auto or scroll) has cut it to its padding box. Text scrolled
      // out of a scrolling body is laid out over whatever sits under that body, and draws nothing there.
      interface Part {
        left: number;
        top: number;
        right: number;
        bottom: number;
      }
      const drawnPart = (from: Element | null, r: DOMRect): Part | null => {
        const part: Part = { left: r.left, top: r.top, right: r.right, bottom: r.bottom };
        for (let a: Element | null = from; a && a !== doc; a = a.parentElement) {
          const cs = getComputedStyle(a);
          if (cs.overflowX === 'visible' && cs.overflowY === 'visible') continue;
          const box = a.getBoundingClientRect();
          if (cs.overflowX !== 'visible') {
            part.left = Math.max(part.left, box.left + px(cs.borderLeftWidth));
            part.right = Math.min(part.right, box.right - px(cs.borderRightWidth));
          }
          if (cs.overflowY !== 'visible') {
            part.top = Math.max(part.top, box.top + px(cs.borderTopWidth));
            part.bottom = Math.min(part.bottom, box.bottom - px(cs.borderBottomWidth));
          }
          if (part.right - part.left <= 0 || part.bottom - part.top <= 0) return null;
        }
        return part;
      };
      const crosses = (p: Part, q: Part) => Math.min(p.right, q.right) - Math.max(p.left, q.left) > 1 && Math.min(p.bottom, q.bottom) - Math.max(p.top, q.top) > 1;
      // DECISION Phase 89.6-02 (A8-text-overlap): two texts cross only when their rects meet by more
      // than 1px sideways AND, top to bottom, by more than a third of the shorter rect, chosen OVER
      // the controls' rule of 1px in both directions. A text rect is the font's whole ascent-plus-
      // descent box, taller than its line when the line height is tight, so two stacked tight lines
      // meet by a few px with no ink touching (measured: 2.7px between a 24px and a 12px line at a
      // line height of 1; the zoom-good twin of the checks harness holds that pair). Lowering the
      // third back to 1px is a decision, not a cleanup: it fails pages for their line height.
      const textCrosses = (p: Part, q: Part) => crosses(p, q) && Math.min(p.bottom, q.bottom) - Math.max(p.top, q.top) > Math.min(p.bottom - p.top, q.bottom - q.top) / 3;
      const apart = (p: Element, q: Element) => !p.contains(q) && !q.contains(p);
      const overlapping: Array<[Element, Element]> = [];
      // An inline control (a link in running text) is compared by its line fragments, one per line
      // it sits on; any other control by its one box. See the A8 marker below, amendment 89.6-19.
      const boxesOf = (control: Element): DOMRect[] =>
        getComputedStyle(control).display === 'inline' ? Array.from(control.getClientRects()).filter((r) => r.width > 0 && r.height > 0) : [control.getBoundingClientRect()];
      const controlParts = controls.map((control) => ({
        control,
        parts: boxesOf(control)
          .map((r) => drawnPart(control.parentElement, r))
          .filter((part): part is Part => part !== null),
      }));
      for (let i = 0; i < controlParts.length; i += 1) {
        for (let j = i + 1; j < controlParts.length; j += 1) {
          const p = controlParts[i];
          const q = controlParts[j];
          if (!apart(p.control, q.control) || !p.parts.some((r) => q.parts.some((s) => crosses(r, s)))) continue;
          overlapping.push([p.control, q.control]);
          lost.push(`overlap: ${named(p.control)} and ${named(q.control)}`);
        }
      }
      const textRects = textElements.map((el) => ({
        el,
        rects: words
          .filter((w) => w.el === el)
          .flatMap((w) => w.rects)
          .map((r) => drawnPart(el, r))
          .filter((part): part is Part => part !== null),
      }));
      for (let i = 0; i < textRects.length; i += 1) {
        for (let j = i + 1; j < textRects.length; j += 1) {
          const p = textRects[i];
          const q = textRects[j];
          if (!apart(p.el, q.el)) continue;
          // Text inside two controls that were already reported as overlapping is the same finding.
          if (overlapping.some(([m, n]) => (m.contains(p.el) && n.contains(q.el)) || (m.contains(q.el) && n.contains(p.el)))) continue;
          if (p.rects.some((r) => q.rects.some((s) => textCrosses(r, s)))) lost.push(`overlap: the text of ${named(p.el)} and ${named(q.el)}`);
        }
      }
    }

    return { rootFontSize, window: doc.clientWidth, pageSideways, dialogSideways, cut, split, held, wide, spill, selectCut, lost, ownClamp };
  } finally {
    ruler.remove();
  }
}

/**
 * Read one cell: every large-text check under `root`, in one page read. Name the open dialog's
 * content box to read its sideways scroll too, and pass the exceptions list as selectors.
 */
export async function readLargeTextCell(root: Locator, options: LargeTextReadOptions = {}): Promise<LargeTextCellRead> {
  const dialogEl = options.dialog ? await options.dialog.elementHandle() : null;
  const read = await root.evaluate(largeTextPageRead, { dialogEl, exceptions: [...(options.exceptions ?? [])], zoom: false, surfaceClamps: [] });
  return {
    rootFontSize: read.rootFontSize,
    window: read.window,
    pageSideways: read.pageSideways,
    dialogSideways: read.dialogSideways,
    cut: read.cut,
    split: read.split,
    held: read.held,
    wide: read.wide,
    spill: read.spill,
    selectCut: read.selectCut,
  };
}

// DECISION Phase 89.6-02 (held-policy), orchestrator change R6, 2026-11-24: a word held narrow by
// a box with a width of its own FAILS the cell, and the entry names the box, chosen OVER listing
// held words without failing and OVER allowing them silently. This is SPEC R4 read literally: a
// word may break only when it is "wider than its whole row", and a held word is not. Nothing then
// passes without someone deciding: each held box is either fixed or named as an exception.
// The owner's ruling is PENDING (question Q1): planning:.planning/phases/89.6-large-text-200-method-test-ci-coverage-audit-inserted-2026-1/execute/R4-RESEARCH.md ("11. The owner question for answer (c)").
// Until he rules, this default stands, and changing this one constant is the whole change: false
// keeps the held list in the read (so in every attachment) and stops failing on it.
const HELD_WORD_FAILS_THE_CELL = true;

/** Expect a cell read to hold every large-text check. The wide list is never looked at: it is written down only. */
export function expectLargeTextCell(read: LargeTextCellRead, tag: string): void {
  const line = JSON.stringify(read);
  expect(read.pageSideways, `${tag}: the page scrolls sideways by ${read.pageSideways}px (${line})`).toBeLessThanOrEqual(0);
  if (read.dialogSideways !== null) {
    expect(read.dialogSideways, `${tag}: the dialog's content box scrolls sideways by ${read.dialogSideways}px (${line})`).toBeLessThanOrEqual(0);
  }
  expect(read.cut, `${tag}: text is capped, shrunk or cut (${line})`).toEqual([]);
  expect(read.split, `${tag}: a word is split inside itself although it would be whole if the rows above it stacked, or it is glued to what precedes it (${line})`).toEqual([]);
  if (HELD_WORD_FAILS_THE_CELL) {
    expect(read.held, `${tag}: a word is split inside itself in a box with a width of its own, which the entry names (${line})`).toEqual([]);
  }
  expect(read.spill, `${tag}: text paints outside its own box (${line})`).toEqual([]);
  expect(read.selectCut, `${tag}: a select's chosen value is cut (${line})`).toEqual([]);
}

// ---------------------------------------------------------------------------------------------
// DECISION Phase 89.6-02 (A8): at the page-zoom widths (215 and 187 at normal text, SPEC A8) the
// read fails only on lost content or function: unreachable, cut with no way to reach it,
// overlapping into unusable; everything else is recorded, not failed, chosen OVER the full five
// checks there (WCAG Reflow does not cover a viewport under 320; Resize Text still asks for no
// loss). Changing this is a decision, not a cleanup.
//
// AMENDED 2026-11-24 (R9, owner-ruled): ONE kind of recorded entry fails there too, the read
// saying that it failed itself: a word it could not measure (COULD NOT STACK, COULD NOT UNWRAP)
// or a page it did not put back (NOT RESTORED). Chosen OVER recording those like any split: a
// read that could not measure has no finding to record, and one that left the page changed has
// spoiled every read after it. A split or held word that WAS measured is still only recorded.
//
// AMENDED Phase 89.6-19 (orchestrator ruling D17, 2026-11-25): the overlap of two controls compares
// an INLINE control's line fragments (its client rects, each cut to its drawn part), chosen OVER its
// one bounding box, which for a link wrapping over two lines spans both full lines and so covered a
// neighbour none of its letters touch. Measured in the checks harness, twin zoom-links, at 215 wide:
// the wrapped link's box ran 16 to 162 by 19 to 60 and held the Home link (16 to 59 by 19 to 36),
// while its two fragments ran 72 to 139 on the first line and 16 to 162 on the second; the old read
// listed that pair as lost, as it did three times on the night page (the breadcrumb, the Bringing
// links, a name beside its add-friend button). Two controls overlap when any fragment of one crosses
// any fragment of the other; a control that is not inline keeps its one box. Restoring the one box
// is a decision, not a cleanup: it fails a page for wrapping a link.
// ---------------------------------------------------------------------------------------------

export interface PageZoomRead {
  /** Lost content or function: unreachable, cut with no way to reach it, or overlapping. These fail. */
  lost: string[];
  /** Seen and written down: the page's sideways scroll, splits, held words and spills. Never failed, but for a split entry that says the read itself failed (the amendment above). */
  recorded: string[];
  /** Clips that are a surface's own clamp (surfaceClamps, ruling D27); present only when there are some. */
  ownClamp?: string[];
}

/** Read one page-zoom cell under `root`: what is lost, and what is only recorded. */
export async function readPageZoomCell(root: Locator, options: LargeTextReadOptions = {}): Promise<PageZoomRead> {
  const dialogEl = options.dialog ? await options.dialog.elementHandle() : null;
  const read = await root.evaluate(largeTextPageRead, { dialogEl, exceptions: [...(options.exceptions ?? [])], zoom: true, surfaceClamps: [...(options.surfaceClamps ?? [])] });
  const recorded = [...(read.pageSideways > 0 ? [`the page scrolls sideways by ${read.pageSideways}px`] : []), ...read.split.map((s) => `split: ${s}`), ...read.held.map((s) => `held: ${s}`), ...read.spill.map((s) => `spill: ${s}`)];
  return { lost: read.lost, recorded, ...(read.ownClamp.length > 0 ? { ownClamp: read.ownClamp } : {}) };
}

/**
 * A recorded split entry that says the read itself failed: a word it could not measure, or a page
 * it did not put back. The page read writes these three texts itself (it runs in the browser and
 * can use nothing from this file), and every entry about a word starts with that word in quotes.
 */
const READ_FAILED = /^split: (NOT RESTORED\b|"\S+" COULD NOT (STACK|UNWRAP)\b)/;

/** Expect a page-zoom cell to have lost no content and no function, and its read to have measured what it recorded. */
export function expectPageZoomUsable(read: PageZoomRead, tag: string): void {
  expect(read.lost, `${tag}: content or function is lost at this page-zoom width (${JSON.stringify(read)})`).toEqual([]);
  expect(
    read.recorded.filter((entry) => READ_FAILED.test(entry)),
    `${tag}: the read could not measure a word, or could not put the page back, at this page-zoom width (${JSON.stringify(read)})`,
  ).toEqual([]);
}
