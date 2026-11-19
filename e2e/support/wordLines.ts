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
 * `words` is the exact list of words expected under the element, in order.
 */
export function expectWholeWords(read: WordLinesRead, words: string[], tag: string, options: WholeWordsOptions = {}): void {
  const line = JSON.stringify(read);
  expect(read.words.map((w) => w.word), `${tag}: the words on screen are not the expected ones (${line})`).toEqual(words);
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
    const boxes = parts.map((p) => p.getBoundingClientRect()).filter((r) => r.width > 0 && r.height > 0);
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
