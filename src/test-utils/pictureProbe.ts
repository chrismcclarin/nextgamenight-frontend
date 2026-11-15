// Test helpers for the picture-load probe pins (plan 88.9-60, X6).
//
// installFakeImage: a controllable stand-in for the browser's Image constructor. jsdom builds an
// image element that never loads and never errors, so a picture-load probe would stay pending for
// ever. This fake records every probe and settles it only when the test says so: a URL holding the
// word fail errors, any other URL loads. Install it with vi.stubGlobal before the first render and
// call vi.unstubAllGlobals afterwards.
import { vi } from 'vitest';

type Handler = (() => void) | null;

interface Probe {
  src: string;
  onload: Handler;
  onerror: Handler;
  settled: boolean;
}

export interface FakeImageControl {
  /** Every URL handed to a probe so far, in construction order. */
  srcs: () => string[];
  /** Settle each pending probe: error when its URL holds the word fail, load otherwise. */
  settleAll: () => void;
  /** Settle only the pending probes for one URL. */
  settle: (src: string) => void;
  /** How many probes still hold a load or error handler. */
  liveHandlers: () => number;
}

export function installFakeImage(): FakeImageControl {
  const probes: Probe[] = [];

  class FakeImage implements Probe {
    src = '';
    onload: Handler = null;
    onerror: Handler = null;
    settled = false;
    constructor() {
      probes.push(this);
    }
  }

  const finish = (probe: Probe): void => {
    if (probe.settled) return;
    probe.settled = true;
    if (probe.src.includes('fail')) probe.onerror?.();
    else probe.onload?.();
  };

  vi.stubGlobal('Image', FakeImage);

  return {
    srcs: () => probes.map((p) => p.src),
    settleAll: () => {
      for (const probe of [...probes]) finish(probe);
    },
    settle: (src) => {
      for (const probe of [...probes]) if (probe.src === src) finish(probe);
    },
    liveHandlers: () => probes.filter((p) => p.onload !== null || p.onerror !== null).length,
  };
}

/**
 * Markup normalised for a PAINT comparison between two renders of one surface. Three things differ
 * between renders that paint the same pixels: Radix mints a fresh id per mount; React appends a
 * style property it adds on an update to the END of the declaration list, where a fresh mount
 * writes it in object order; and an attribute added on an update lands after the ones the mount
 * wrote. So the markup is re-read as a tree and written back with ids collapsed, each element's
 * attributes sorted and each inline style's declarations sorted. Nothing else is touched.
 */
export function paintMarkup(html: string): string {
  const template = document.createElement('template');
  template.innerHTML = html;
  const canonical = (node: Node): string => {
    if (node.nodeType === Node.TEXT_NODE) return node.textContent ?? '';
    if (node.nodeType !== Node.ELEMENT_NODE) return '';
    const el = node as Element;
    const tag = el.tagName.toLowerCase();
    const attributes = Array.from(el.attributes)
      .map(({ name, value }) => {
        const shown =
          name === 'style'
            ? value
                .split(';')
                .map((declaration) => declaration.trim())
                .filter(Boolean)
                .sort()
                .join('; ')
            : value.replace(/:r[0-9a-z]+:/g, ':rN:');
        return `${name}="${shown}"`;
      })
      .sort();
    return `<${[tag, ...attributes].join(' ')}>${Array.from(el.childNodes).map(canonical).join('')}</${tag}>`;
  };
  return Array.from(template.content.childNodes).map(canonical).join('');
}

/** Where two markups first differ, with a little context, for an assertion message. */
export function firstDifference(actual: string, expected: string): string {
  if (actual === expected) return 'no difference';
  let at = 0;
  while (at < actual.length && at < expected.length && actual[at] === expected[at]) at += 1;
  const from = Math.max(0, at - 80);
  return `first difference at ${at}: got …${actual.slice(from, at + 120)}… expected …${expected.slice(from, at + 120)}…`;
}
