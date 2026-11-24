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
  /** One entry per word drawn on more than one line although it fits its row on one. */
  split: string[];
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
}

interface LargeTextPageResult extends LargeTextCellRead {
  /** The A8 read's losses; empty when the read was not asked for. */
  lost: string[];
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
      const range = document.createRange();
      range.setStart(node, match.index ?? 0);
      range.setEnd(node, (match.index ?? 0) + match[0].length);
      const rects = Array.from(range.getClientRects()).filter((r) => r.width > 0 && r.height > 0);
      if (!rects.length) continue;
      drawn = true;
      words.push({ text: match[0], el, rects, lines: new Set(rects.map((r) => Math.round(r.top))).size });
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
    if (px(getComputedStyle(el).fontSize) < 0.75 * rootFontSize - 0.01) addCut('shrunk', el);
    const rects = words.filter((w) => w.el === el).flatMap((w) => w.rects);
    if (clippedBy(el, rects, 'x') || clippedBy(el, rects, 'y')) addCut('hidden', el);
  }

  // ---- split -----------------------------------------------------------------------------------
  // DECISION Phase 89.6-02 (split-row), AMENDED 2026-11-24 twice (orchestrator fix R3, then its
  // repair batch after scoped check 1): ONE walk finds a word's row, chosen OVER two climbs with
  // two rules. The first rule (the text's own box, climbing only while the parent was a flex or
  // grid container) stopped at a paragraph inside a wrapper and compared a squeezed word with its
  // own narrow box. R3's first build (the nearest row, then that old climb) still stopped at a row
  // INSIDE the squeezed item, went up through column containers, and went above the root.
  //
  // THE ROW. Walk from the word up to the root of the read, and never above it:
  //   - an element marked [data-room] is the row, at once. The mark is an explicit row, named by
  //     the caller, and it wins over the rules below (the nearest mark; one above the root is not
  //     seen). The edges between the word and a marked row come off the room like any other row's;
  //   - otherwise every container met from the text's own box up to the root, the root included,
  //     that lays its children out SIDE BY SIDE is a candidate: a row-direction flex container, a
  //     grid with more than one column, a table row (a table-row box, and whatever holds a table
  //     cell: the browser builds the row around cells). The row is the OUTERMOST candidate;
  //   - with no candidate the row is the text's own box: plain block flow, where a word wider
  //     than its container may break.
  // The OUTERMOST, chosen OVER the nearest: the owner's governing rule, src/app/globals.css ("DECISION Phase 89.6-02 (bb-row)"),
  // says a row stays a row while everything in it fits whole, and when it does not, items stack;
  // nothing is broken to avoid stacking. So if stacking ANY row above the word would let it fit
  // whole, breaking it is the defect. The nearest row is often a row of the word's own inside the
  // squeezed item, exactly as narrow as the word. A deliberately fixed narrow column inside a row
  // is therefore reported: it is an exception to name at the sweep, not a blind spot of this read.
  // A column-direction flex container and a grid of one column are NEVER candidates, chosen OVER
  // counting every flex or grid container: they stack their items already and squeeze nothing
  // sideways, and counting them makes every page-level column the row of each card in it.
  //
  // THE ROOM is the row's content width LESS, for every box between the word and the row, its left
  // and right padding, border and margin: the inline boxes that hold the word, the text's own box,
  // and each box above it. The row's own padding is off already, once. An AUTOMATIC margin is not
  // taken off: it is the row's free space, not an edge of the box (getComputedStyle gives its
  // used px, so the computed value is read from computedStyleMap). An inline box ABOVE the text's
  // own box and a display: contents element take nothing: neither narrows a block inside it.
  // Text inside .bb-breakable is not read here (emails and links may break anywhere).
  //
  // Each part has a case that goes red when that part alone is taken out: e2e/large-text-blocks.spec.ts ("THE SPLIT CONTROLS").
  // Changing a part is a decision, not a cleanup.
  const sideBySide = (container: Element, child: Element | null): boolean => {
    const cs = getComputedStyle(container);
    if (/flex/.test(cs.display)) return !cs.flexDirection.startsWith('column');
    if (/grid/.test(cs.display)) {
      // The used track list, one size per column, with the line names taken out.
      const columns = cs.gridTemplateColumns.replace(/\[[^\]]*\]/g, ' ').split(/\s+/).filter((track) => track && track !== 'none');
      return columns.length > 1;
    }
    if (cs.display === 'table-row') return true;
    return child !== null && getComputedStyle(child).display === 'table-cell';
  };
  const rowOf = (el: Element): Element => {
    // With no candidate, the text's own box. The inline boxes under it are never candidates: an
    // inline box is no flex, grid or table-row box and holds no table cell.
    let row = boxOf(el);
    let child: Element | null = null;
    for (let a: Element | null = el; a; child = a, a = a.parentElement) {
      if (a.hasAttribute('data-room')) return a;
      if (sideBySide(a, child)) row = a;
      if (a === rootEl) break;
    }
    return row;
  };
  const contentWidth = (el: Element) => {
    const cs = getComputedStyle(el);
    return el.clientWidth - px(cs.paddingLeft) - px(cs.paddingRight);
  };
  /** A side margin in px, or 0 when it is automatic (the computed value, not the used one). */
  const sideMargin = (el: Element, property: 'margin-left' | 'margin-right', used: string): number => {
    const computed = el.computedStyleMap().get(property);
    return computed instanceof CSSKeywordValue && computed.value === 'auto' ? 0 : px(used);
  };
  /** What a box takes from the line of the word inside it: side padding, border and margin. */
  const sideEdges = (el: Element, holdsTheWordInline: boolean): number => {
    const cs = getComputedStyle(el);
    if (cs.display === 'contents') return 0;
    if (cs.display === 'inline' && !holdsTheWordInline) return 0;
    return (
      px(cs.paddingLeft) + px(cs.paddingRight) + px(cs.borderLeftWidth) + px(cs.borderRightWidth) + sideMargin(el, 'margin-left', cs.marginLeft) + sideMargin(el, 'margin-right', cs.marginRight)
    );
  };
  const roomOf = (el: Element): number => {
    const row = rowOf(el);
    const own = boxOf(el);
    let room = contentWidth(row);
    // Every box from the word's element up to the row, the row left out. Below the text's own box
    // they are the inline boxes that hold the word.
    let belowOwnBox = true;
    for (let a: Element | null = el; a && a !== row; a = a.parentElement) {
      if (a === own) belowOwnBox = false;
      room -= sideEdges(a, belowOwnBox);
    }
    return room;
  };
  const split: string[] = [];
  for (const w of words) {
    if (w.lines <= 1 || w.el.closest('.bb-breakable')) continue;
    const room = roomOf(w.el);
    const natural = naturalWidth(w.text, w.el);
    if (natural <= room + 0.5) split.push(`"${w.text}" ${w.lines} lines, ${round(natural)}px fits its row ${round(room)}px`);
  }

  // ---- spill -----------------------------------------------------------------------------------
  // A word's box is the nearest element, from the text's own element up, that has a fill (a
  // background colour that is not transparent), a left or right border, or is a control. A word
  // with any rect more than 1px past that box's left or right edge paints outside it: no page
  // scroll, no cut and no split see that (research M F4, "Member" 4px out of Invite Member).
  const CONTROL = 'button, a[href], select, input, textarea, label, [role="button"]';
  const transparent = (colour: string) => colour === 'transparent' || /,\s*0\)$/.test(colour) || /\/\s*0\)$/.test(colour);
  const spillBoxOf = (el: Element): Element | null => {
    for (let a: Element | null = el; a && a !== doc; a = a.parentElement) {
      const cs = getComputedStyle(a);
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
    const whyUnreachable = (rects: DOMRect[], climbFrom: Element | null): string | null => {
      if (Math.min(...rects.map((r) => r.left)) + window.scrollX < -0.5) return 'starts left of the page';
      if (Math.min(...rects.map((r) => r.top)) + window.scrollY < -0.5) return 'starts above the page';
      const clipper = climbFrom ? (clippedBy(climbFrom, rects, 'x') ?? clippedBy(climbFrom, rects, 'y')) : null;
      return clipper ? `is clipped by its ${clipper.tagName.toLowerCase()}` : null;
    };
    const REACHED = 'button, a[href], input, select, textarea, [role="button"], [tabindex]:not([tabindex="-1"])';
    const controls = Array.from(rootEl.querySelectorAll(REACHED)).filter((c) => {
      const r = c.getBoundingClientRect();
      return !drawsNothing(c) && r.width > 0 && r.height > 0;
    });
    for (const control of controls) {
      const why = whyUnreachable([control.getBoundingClientRect()], control.parentElement);
      if (!why) continue;
      unreachable.add(control);
      lost.push(`unreachable: ${named(control)} ${why}`);
    }
    for (const el of textElements) {
      if (Array.from(unreachable).some((u) => u.contains(el))) continue;
      const why = whyUnreachable(words.filter((w) => w.el === el).flatMap((w) => w.rects), el);
      if (!why) continue;
      unreachable.add(el);
      lost.push(`unreachable: ${named(el)} ${why}`);
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
    const controlParts = controls.map((control) => ({ control, part: drawnPart(control.parentElement, control.getBoundingClientRect()) }));
    for (let i = 0; i < controlParts.length; i += 1) {
      for (let j = i + 1; j < controlParts.length; j += 1) {
        const p = controlParts[i];
        const q = controlParts[j];
        if (!p.part || !q.part || !apart(p.control, q.control) || !crosses(p.part, q.part)) continue;
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

  ruler.remove();
  return { rootFontSize, window: doc.clientWidth, pageSideways, dialogSideways, cut, split, spill, selectCut, lost };
}

/**
 * Read one cell: every large-text check under `root`, in one page read. Name the open dialog's
 * content box to read its sideways scroll too, and pass the exceptions list as selectors.
 */
export async function readLargeTextCell(root: Locator, options: LargeTextReadOptions = {}): Promise<LargeTextCellRead> {
  const dialogEl = options.dialog ? await options.dialog.elementHandle() : null;
  const read = await root.evaluate(largeTextPageRead, { dialogEl, exceptions: [...(options.exceptions ?? [])], zoom: false });
  return {
    rootFontSize: read.rootFontSize,
    window: read.window,
    pageSideways: read.pageSideways,
    dialogSideways: read.dialogSideways,
    cut: read.cut,
    split: read.split,
    spill: read.spill,
    selectCut: read.selectCut,
  };
}

/** Expect a cell read to hold every large-text check. */
export function expectLargeTextCell(read: LargeTextCellRead, tag: string): void {
  const line = JSON.stringify(read);
  expect(read.pageSideways, `${tag}: the page scrolls sideways by ${read.pageSideways}px (${line})`).toBeLessThanOrEqual(0);
  if (read.dialogSideways !== null) {
    expect(read.dialogSideways, `${tag}: the dialog's content box scrolls sideways by ${read.dialogSideways}px (${line})`).toBeLessThanOrEqual(0);
  }
  expect(read.cut, `${tag}: text is capped, shrunk or cut (${line})`).toEqual([]);
  expect(read.split, `${tag}: a word is split inside itself although it fits its row (${line})`).toEqual([]);
  expect(read.spill, `${tag}: text paints outside its own box (${line})`).toEqual([]);
  expect(read.selectCut, `${tag}: a select's chosen value is cut (${line})`).toEqual([]);
}

// ---------------------------------------------------------------------------------------------
// DECISION Phase 89.6-02 (A8): at the page-zoom widths (215 and 187 at normal text, SPEC A8) the
// read fails only on lost content or function: unreachable, cut with no way to reach it,
// overlapping into unusable; everything else is recorded, not failed, chosen OVER the full five
// checks there (WCAG Reflow does not cover a viewport under 320; Resize Text still asks for no
// loss). Changing this is a decision, not a cleanup.
// ---------------------------------------------------------------------------------------------

export interface PageZoomRead {
  /** Lost content or function: unreachable, cut with no way to reach it, or overlapping. These fail. */
  lost: string[];
  /** Seen and written down, never failed: the page's sideways scroll, splits and spills. */
  recorded: string[];
}

/** Read one page-zoom cell under `root`: what is lost, and what is only recorded. */
export async function readPageZoomCell(root: Locator, options: LargeTextReadOptions = {}): Promise<PageZoomRead> {
  const dialogEl = options.dialog ? await options.dialog.elementHandle() : null;
  const read = await root.evaluate(largeTextPageRead, { dialogEl, exceptions: [...(options.exceptions ?? [])], zoom: true });
  const recorded = [...(read.pageSideways > 0 ? [`the page scrolls sideways by ${read.pageSideways}px`] : []), ...read.split.map((s) => `split: ${s}`), ...read.spill.map((s) => `spill: ${s}`)];
  return { lost: read.lost, recorded };
}

/** Expect a page-zoom cell to have lost no content and no function. */
export function expectPageZoomUsable(read: PageZoomRead, tag: string): void {
  expect(read.lost, `${tag}: content or function is lost at this page-zoom width (${JSON.stringify(read)})`).toEqual([]);
}
