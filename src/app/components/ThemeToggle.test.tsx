// Phase 88.9-57 — 52-X15 (owner pick N03 B, 2026-11-11): the header theme toggle hovers like the
// bell beside it, and the phone menu row rests its dark sun white (owner ruling 2026-11-14,
// question A: "A white").
//
// Site: src/app/components/ThemeToggle.js ("AMENDED Phase 88.9-57 (owner pick N03 B").
// jsdom paints nothing, so these pin the class tokens; the rendered proof is on CI, the two
// header-main-nav tests titled "X15 (88.9-57): the desktop theme toggle hovers like the bell".
// The row arm also computes the white glyph against the row grounds from the globals.css tokens,
// with the WCAG formula of src/lib/wcag.ts ("export function contrastRatio(").
import fs from 'node:fs';
import path from 'node:path';

import * as React from 'react';
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { contrastRatio } from '../../lib/wcag';

const theme = vi.hoisted(() => ({ resolved: 'dark' as 'dark' | 'light' }));

vi.mock('next-themes', () => ({
  useTheme: () => ({ setTheme: vi.fn(), resolvedTheme: theme.resolved }),
}));

import ThemeToggleJs from './ThemeToggle';

// ThemeToggle.js is untyped, so tsc infers its undefaulted label prop as required; every prop is optional at run time.
const ThemeToggle = ThemeToggleJs as React.ComponentType<{ className?: string; variant?: string; label?: string }>;

afterEach(cleanup);

const tokensOf = (el: Element): string[] => (el.getAttribute('class') ?? '').split(/\s+/).filter(Boolean);

// A text colour utility of any variant: text-white, hover:text-amber-400, dark:text-content-muted.
// Size utilities (text-sm, text-left) are not colours and are not what this reads.
const TEXT_SIZE_OR_ALIGN = /^text-(xs|sm|base|lg|xl|[2-9]xl|left|right|center|justify)$/;
const colourTokens = (el: Element): string[] =>
  tokensOf(el).filter((t) => {
    const base = t.split(':').pop() ?? '';
    return base.startsWith('text-') && !TEXT_SIZE_OR_ALIGN.test(base);
  });

function glyphOf(button: HTMLElement): SVGElement {
  const svg = button.querySelector('svg');
  if (!svg) throw new Error('the toggle renders no glyph');
  return svg;
}

// globals.css with its block comments removed.
const GLOBALS = fs
  .readFileSync(path.join(__dirname, '..', 'globals.css'), 'utf8')
  .replace(/\/\*[\s\S]*?\*\//g, '');

// TRUE when the character at idx sits inside the top-level .dark block.
function inDarkBlock(idx: number): boolean {
  const open = GLOBALS.lastIndexOf('\n.dark {', idx);
  return open >= 0 && GLOBALS.indexOf('\n}', open) > idx;
}

// A warm-palette step's hex, read from its one declaration.
function paletteHex(step: string): string {
  const found = new RegExp(`--${step}:\\s*(#[0-9a-fA-F]{6});`).exec(GLOBALS);
  if (!found) throw new Error(`palette step --${step} is not declared as a six-digit hex`);
  return found[1];
}

// The hex a header ground token resolves to in each theme (each is one var() onto the warm palette).
function headerGround(token: string): { light: string; dark: string } {
  const out: { light?: string; dark?: string } = {};
  const decl = new RegExp(`${token}:\\s*var\\(--(warm-\\d+)\\);`, 'g');
  for (let m = decl.exec(GLOBALS); m; m = decl.exec(GLOBALS)) {
    out[inDarkBlock(m.index) ? 'dark' : 'light'] = paletteHex(m[1]);
  }
  if (!out.light || !out.dark) throw new Error(`${token} is not declared once per theme on the warm palette`);
  return { light: out.light, dark: out.dark };
}

const NON_TEXT = 3;

describe('ThemeToggle — 52-X15 header hover (88.9-57)', () => {
  it("X15 (88.9-57): the desktop icon toggle takes the bell's ink, no wash (dark sun)", () => {
    theme.resolved = 'dark';
    render(<ThemeToggle />);
    const button = screen.getByRole('button', { name: 'Switch to light mode' });
    const tokens = tokensOf(button);
    expect(tokens).toEqual(expect.arrayContaining(['text-white', 'hover:text-amber-400']));
    expect(tokens).not.toContain('hover:bg-white/10');
    // The glyph carries no colour of its own, so it takes the button's ink at rest and on hover.
    expect(colourTokens(glyphOf(button))).toEqual([]);
  });

  it("X15 (88.9-57): the desktop icon toggle takes the bell's ink, no wash (light moon)", () => {
    theme.resolved = 'light';
    render(<ThemeToggle />);
    const button = screen.getByRole('button', { name: 'Switch to dark mode' });
    const tokens = tokensOf(button);
    expect(tokens).toEqual(expect.arrayContaining(['text-white', 'hover:text-amber-400']));
    expect(tokens).not.toContain('hover:bg-white/10');
    expect(colourTokens(glyphOf(button))).toEqual([]);
  });

  it('X15 (88.9-57): the phone row variant rests its dark sun white like the desktop toggle, and keeps its white moon', () => {
    for (const resolved of ['dark', 'light'] as const) {
      theme.resolved = resolved;
      render(<ThemeToggle variant="row" label="Theme" />);
      const row = screen.getByRole('button', { name: resolved === 'dark' ? 'Switch to light mode' : 'Switch to dark mode' });
      // ONE shared glyph: no colour class on it, so it is the row's own white ink in both themes.
      const glyph = glyphOf(row);
      expect(tokensOf(glyph)).not.toContain('text-amber-400');
      expect(colourTokens(glyph)).toEqual([]);
      // The row's ink is white at rest and it gains no hover ink (the row hovers by its ground).
      expect(colourTokens(row)).toEqual(['text-white']);
      // The row layout is unchanged.
      expect(tokensOf(row)).toEqual(expect.arrayContaining(['w-full', 'px-4', 'py-3', 'hover:bg-surface-header-hover']));
      cleanup();
    }

    // The white glyph against the row's two grounds, both themes, on the 3:1 non-text floor.
    // Arithmetic from the tokens (the phone panel paints the header ground, and the row hovers
    // to the header hover ground): 15.03 / 17.97 at rest, 10.48 / 15.03 hovered.
    const rest = headerGround('--color-bg-header');
    const hover = headerGround('--color-bg-header-hover');
    for (const [label, ground] of [
      ['rest, light', rest.light],
      ['rest, dark', rest.dark],
      ['hover, light', hover.light],
      ['hover, dark', hover.dark],
    ] as const) {
      const ratio = contrastRatio('#ffffff', ground);
      expect(ratio, `white glyph on the row ground (${label}) ${ground}`).not.toBeNull();
      expect(ratio!, `white glyph on the row ground (${label}) ${ground}: ${ratio}`).toBeGreaterThanOrEqual(NON_TEXT);
    }
    expect(contrastRatio('#ffffff', rest.light)!).toBeCloseTo(15.03, 2);
    expect(contrastRatio('#ffffff', rest.dark)!).toBeCloseTo(17.97, 2);
  });
});
