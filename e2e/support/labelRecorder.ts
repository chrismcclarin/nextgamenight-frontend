import type { Locator, Page } from '@playwright/test';

/**
 * Plan 88.9-67 (X69 width, X67): records what one control PAINTS over time, inside the browser.
 *
 * A gated confirm changes its label once a second (Wait (3), Wait (2), Wait (1), then its
 * post-wait words). Reading that from the test process with one assertion per step loses a step
 * whenever a round trip takes longer than a second, so the sampler lives in the page: it reads on
 * every DOM mutation and on every animation frame, and keeps a sample each time the painted text,
 * the aria-label or a measure changes. Nothing is asserted here; a spec reads the samples back and
 * decides.
 *
 * WHAT A SAMPLE HOLDS:
 * - text: innerText, trimmed. innerText is the text that is painted: it leaves out text that is
 *   visibility-hidden and pseudo-element content, so a width reserve never shows up in it.
 * - name: the aria-label attribute, or null when the control is named by its content.
 * - width, height: the computed layout size in CSS px (fractions kept). Computed size, never
 *   getBoundingClientRect, which reads the transformed box and shrinks while a dialog zooms in
 *   (see settleAnimations in e2e/support/inFlight.ts).
 * - menuWidth: the computed width of the closest list ancestor (a KebabMenu paints its items in
 *   one ul), or null when the control is not in a list.
 */
export interface LabelSample {
  text: string;
  name: string | null;
  width: number;
  height: number;
  menuWidth: number | null;
}

interface RecorderWindow {
  __labelRecorder?: { samples: LabelSample[]; stop: () => void };
}

interface RecorderTarget {
  /** CSS selector of the containers to search, or null to record the element itself. */
  scope: string | null;
  /** Regular expression source matched against a button's trimmed innerText, or null. */
  label: string | null;
}

async function install(root: Locator, target: RecorderTarget): Promise<void> {
  await root.evaluate((rootEl, { scope, label }) => {
    const host = window as unknown as RecorderWindow;
    host.__labelRecorder?.stop();
    const pattern = label === null ? null : new RegExp(label);
    const samples: LabelSample[] = [];
    const find = (): HTMLElement | null => {
      if (scope === null || pattern === null) return rootEl as HTMLElement;
      // The LAST match in document order: a dialog stacked on another is portalled after it.
      const hits = Array.from(document.querySelectorAll<HTMLElement>(`${scope} button`)).filter((b) =>
        pattern.test(b.innerText.trim()),
      );
      return hits[hits.length - 1] ?? null;
    };
    const read = () => {
      const el = find();
      if (!el || !el.isConnected) return;
      const style = getComputedStyle(el);
      const menu = el.closest('ul');
      const sample: LabelSample = {
        text: el.innerText.trim(),
        name: el.getAttribute('aria-label'),
        width: parseFloat(style.width),
        height: parseFloat(style.height),
        menuWidth: menu ? parseFloat(getComputedStyle(menu).width) : null,
      };
      const last = samples[samples.length - 1];
      if (
        !last ||
        last.text !== sample.text ||
        last.name !== sample.name ||
        last.width !== sample.width ||
        last.height !== sample.height ||
        last.menuWidth !== sample.menuWidth
      ) {
        samples.push(sample);
      }
    };
    const observer = new MutationObserver(read);
    observer.observe(document.body, { subtree: true, childList: true, characterData: true, attributes: true });
    let frame = 0;
    const tick = () => {
      read();
      frame = requestAnimationFrame(tick);
    };
    tick();
    host.__labelRecorder = {
      samples,
      stop: () => {
        observer.disconnect();
        cancelAnimationFrame(frame);
      },
    };
  }, target);
}

/** Record a control that is already on screen. The element is fixed for the whole recording. */
export async function recordLabel(control: Locator): Promise<void> {
  await install(control, { scope: null, label: null });
}

/**
 * Record a button that does not exist yet (a dialog's confirm): on every read, the last button
 * inside `scope` whose painted text matches `label`. Install it BEFORE the tap that opens the
 * dialog, so the first painted step is never missed.
 */
export async function recordLabelWhenItAppears(page: Page, scope: string, label: RegExp): Promise<void> {
  await install(page.locator('body'), { scope, label: label.source });
}

/** Stop recording and hand the samples back, in the order they were painted. */
export async function stopLabelRecorder(page: Page): Promise<LabelSample[]> {
  return page.evaluate(() => {
    const host = window as unknown as RecorderWindow;
    const recorder = host.__labelRecorder;
    if (!recorder) return [];
    recorder.stop();
    delete host.__labelRecorder;
    return recorder.samples;
  });
}

/** The painted texts in order, each named once per run of equal texts. */
export function paintedTexts(samples: LabelSample[]): string[] {
  const texts: string[] = [];
  for (const sample of samples) {
    if (texts[texts.length - 1] !== sample.text) texts.push(sample.text);
  }
  return texts;
}

/** Every distinct value of one field among the samples that painted `text`. */
export function valuesAt<K extends keyof LabelSample>(samples: LabelSample[], text: string, key: K): LabelSample[K][] {
  return Array.from(new Set(samples.filter((sample) => sample.text === text).map((sample) => sample[key])));
}

/** Largest minus smallest of one numeric field among the samples whose text is in `texts`. */
export function spread(samples: LabelSample[], texts: readonly string[], key: 'width' | 'height' | 'menuWidth'): number {
  const values = samples
    .filter((sample) => texts.includes(sample.text))
    .map((sample) => sample[key])
    .filter((value): value is number => typeof value === 'number');
  if (values.length === 0) return Number.NaN;
  return Math.max(...values) - Math.min(...values);
}

/** A compact line for assertion messages: numbers and labels only, never personal data. */
export function describeSamples(samples: LabelSample[]): string {
  return samples
    .map((sample) => `${sample.text}=${sample.width}x${sample.height}${sample.menuWidth === null ? '' : ` menu ${sample.menuWidth}`}`)
    .join(' | ');
}
