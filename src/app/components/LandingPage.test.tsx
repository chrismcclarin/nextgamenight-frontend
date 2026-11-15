// Phase 88.9-33 — the landing hero, class and token pins (owner picks O01a, L1b, B4a).
//
// Sites: src/app/components/LandingPage.js ("DECISION Phase 88.9-33 L1b") and
// src/app/globals.css ("DECISION Phase 88.9-33 (O01a + B4a)").
// Measured basis (88.9-RESEARCH-ROUND2.md, the LandingPage.js block): the shipped light hero
// painted the dark nav surface, Get Started's light focus band read 13.85 (white halo on the
// nav ground) and its dark band 1.22 (card halo on the nav ground), and the Google CTA was the
// larger of the pair (18px text, 32px x 16px padding).
//
// jsdom paints nothing, so these pin the class tokens and the token declarations. The rendered
// proofs are on CI: Gate C's OI-7 test (both themes, plus the light hero ground equal to the
// card token) and plan 20's 'halo (88.9 R2): landing hero Get Started ring band' pin.
import fs from 'node:fs';
import path from 'node:path';

import * as React from 'react';
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';

import LandingPage from './LandingPage';

afterEach(cleanup);

const tokensOf = (el: Element): string[] => (el.getAttribute('class') ?? '').split(/\s+/).filter(Boolean);

// globals.css with its block comments removed (CSS has no line comments; a line-comment strip
// would also eat the double slash inside any url()).
const GLOBALS = fs
  .readFileSync(path.join(__dirname, '..', 'globals.css'), 'utf8')
  .replace(/\/\*[\s\S]*?\*\//g, '');

const countOf = (haystack: string, needle: string): number => haystack.split(needle).length - 1;

// The rule block that encloses the character at idx: its selector text and its body.
function enclosingBlock(css: string, idx: number): { selector: string; body: string } {
  let depth = 0;
  let open = -1;
  for (let i = idx; i >= 0; i -= 1) {
    if (css[i] === '}') depth += 1;
    else if (css[i] === '{') {
      if (depth === 0) {
        open = i;
        break;
      }
      depth -= 1;
    }
  }
  if (open < 0) return { selector: '', body: '' };
  const selStart = Math.max(css.lastIndexOf('}', open), css.lastIndexOf('{', open - 1)) + 1;
  let close = open + 1;
  for (let d = 1; close < css.length && d > 0; close += 1) {
    if (css[close] === '{') d += 1;
    else if (css[close] === '}') d -= 1;
  }
  return { selector: css.slice(selStart, open).trim(), body: css.slice(open + 1, close - 1) };
}

function renderHero() {
  render(<LandingPage />);
  const h1 = screen.getByRole('heading', { level: 1 });
  const root = h1.parentElement?.parentElement;
  if (!root) throw new Error('the hero root (the h1 second ancestor) is missing');
  const lede = screen.getByText('Find the night your whole group is free. In one glance.');
  const getStarted = screen.getByRole('link', { name: 'Get Started' });
  const google = screen.getByRole('link', { name: 'Sign in with Google' });
  return { h1, root, lede, getStarted, google };
}

describe('Phase 88.9-33 — the landing hero (O01a, L1b, B4a)', () => {
  it('O01a light hero on bg-card, primary/secondary inks', () => {
    const { h1, root, lede } = renderHero();
    const rootTokens = tokensOf(root);
    expect(rootTokens).toContain('bg-surface-hero');
    expect(rootTokens).not.toContain('bg-surface-nav');
    expect(tokensOf(h1)).toEqual(expect.arrayContaining(['text-content-primary', 'dark:text-white']));
    expect(tokensOf(h1)).not.toContain('text-white');
    expect(tokensOf(lede)).toEqual(expect.arrayContaining(['text-content-secondary', 'dark:text-white/70']));
    expect(tokensOf(lede)).not.toContain('text-white/70');

    // The token pair: ONE theme key, a card value in light and a nav value in dark.
    expect(countOf(GLOBALS, '--color-surface-hero: var(--color-bg-hero);')).toBe(1);
    expect(countOf(GLOBALS, '--color-bg-hero: var(--color-bg-card);')).toBe(1);
    expect(countOf(GLOBALS, '--color-bg-hero: var(--color-bg-nav);')).toBe(1);
    // Each value sits in the same block as that theme's nav declaration.
    expect(countOf(GLOBALS, '--color-bg-nav: var(--purple-900);')).toBe(1);
    expect(countOf(GLOBALS, '--color-bg-nav: var(--purple-950);')).toBe(1);
    const light = enclosingBlock(GLOBALS, GLOBALS.indexOf('--color-bg-nav: var(--purple-900);'));
    const dark = enclosingBlock(GLOBALS, GLOBALS.indexOf('--color-bg-nav: var(--purple-950);'));
    expect(dark.selector).toBe('.dark');
    expect(light.selector).not.toContain('.dark');
    expect(light.body).toContain('--color-bg-hero: var(--color-bg-card);');
    expect(dark.body).toContain('--color-bg-hero: var(--color-bg-nav);');
  });

  it("L1b: both hero CTAs at the Button primitive's size, up to 320px each from 640px", () => {
    const { getStarted, google } = renderHero();
    for (const link of [getStarted, google]) {
      expect(tokensOf(link)).toEqual(expect.arrayContaining(['w-full', 'sm:w-80', 'min-h-11']));
      expect(tokensOf(link)).not.toContain('sm:w-auto');
    }
    const g = tokensOf(google);
    expect(g).toEqual(expect.arrayContaining(['text-sm', 'font-semibold', 'px-4', 'py-2', 'gap-2']));
    for (const gone of ['text-lg', 'px-8', 'py-4', 'gap-3']) {
      expect(g).not.toContain(gone);
    }
  });

  it('B4a: the amber ring is dark-only on the hero root; Get Started takes the hero halo; Google drops its own re-point', () => {
    const { root, getStarted, google } = renderHero();
    expect(tokensOf(root)).toContain('dark:[--ring:var(--amber-400)]');
    expect(tokensOf(root)).not.toContain('[--ring:var(--amber-400)]');
    const gs = tokensOf(getStarted);
    expect(gs).toContain('focus-visible:ring-offset-surface-hero');
    expect(gs).not.toContain('focus-visible:ring-offset-surface-card');
    const g = tokensOf(google);
    expect(g).not.toContain('[--ring:var(--amber-400)]');
    expect(g).toEqual(
      expect.arrayContaining([
        'bg-btn-secondary',
        'text-btn-secondary-text',
        'border-line-control',
        'dark:bg-white/20',
        'dark:text-white',
      ]),
    );
    expect(getStarted.getAttribute('href')).toBe('/api/auth/login');
    expect(google.getAttribute('href')).toBe('/api/auth/login?connection=google-oauth2');
  });
});
