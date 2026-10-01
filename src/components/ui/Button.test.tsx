// Contract pins for the <Button> primitive (PRIM-01 / D-01 elevation, D-02 variants).
//
// Button is imported by almost every later Phase-88 adoption plan, so the pins
// here are deliberately about the CONTRACT, not the styling taste:
//   1. it composes the legacy unlayered `.btn` (see the DECISION marker in
//      Button.tsx) rather than re-emitting its properties as utilities
//   2. D-01's elevation + focus ring live in the cva BASE, so every variant gets
//      them for free
//   3. `ghost` carries NO `.btn-*` background class — that is what makes it a
//      legitimate home for bare icon buttons
//   4. `size="icon"` is the 44x44 floor, delivered once instead of per-site
//   5. `asChild` hands rendering to the child (Radix Slot)
//   6. axe-clean with an accessible name
import fs from 'node:fs';
import path from 'node:path';

import * as React from 'react';
import { render, screen, cleanup } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { axe } from 'vitest-axe';
import type { VariantProps } from 'class-variance-authority';

import { withoutComments } from '../../test-utils/sourceScan';
import { Button, buttonVariants } from './Button';

afterEach(cleanup);

// =============================================================================
// 88.6-06 — ONE declared key list, derived from the source, for the whole suite.
//
// WHY A SOURCE SCAN AND NOT RUNTIME INTROSPECTION. Runtime introspection of
// `buttonVariants` is IMPOSSIBLE, and that is measured, not assumed. Against the
// installed `class-variance-authority@0.7.1` on 2026-09-15:
//     typeof buttonVariants                      -> 'function'
//     Object.keys(buttonVariants)                -> []
//     Object.getOwnPropertyNames(buttonVariants) -> ['length', 'name']
//     'config' in buttonVariants                 -> false
// `cva()` returns a bare function carrying no config, and `Button.tsx:287`
// exports only `{ Button, buttonVariants }` — there is no runtime surface
// holding the keys. So this is sanctioned mechanism (a) from the plan: the
// comment-stripped source scan, the same shape Gate A already uses on this file
// (`tokenContrast.test.ts:1641-1648`). Mechanism (b) — an additive named export
// of the key lists — was the alternative; (a) wins because it leaves
// `Button.tsx`'s export tail byte-identical, and that tail is cited by
// `cn.twMergeV3.test.ts`. "Simplifying" this back to `Object.keys` is not a
// cleanup: it silently yields an EMPTY matrix, and an empty matrix passes.
//
// The "cannot leave the count stale" property comes from the DERIVATION, not
// from the number 15 — 15 is asserted as a stated expectation beside it, so a
// rung added later is pinned automatically AND the arithmetic is still visible.
// =============================================================================

const BUTTON_SRC = withoutComments(
  fs.readFileSync(path.resolve(__dirname, 'Button.tsx'), 'utf8')
);

/** Brace-balanced body of `name: { … }`, comments already blanked by the caller. */
function objectBody(src: string, name: string): string {
  const at = src.indexOf(`${name}: {`);
  if (at === -1) return '';
  const open = src.indexOf('{', at);
  let depth = 0;
  for (let j = open; j < src.length; j += 1) {
    if (src[j] === '{') depth += 1;
    else if (src[j] === '}') {
      depth -= 1;
      if (depth === 0) return src.slice(open + 1, j);
    }
  }
  return '';
}

/** Top-level object keys of a body, with string literals neutralised first. */
function keysOf(body: string): string[] {
  const noStrings = body
    .replace(/'(?:[^'\\]|\\.)*'/g, "''")
    .replace(/"(?:[^"\\]|\\.)*"/g, '""');
  return [...`{${noStrings}`.matchAll(/[{,]\s*([A-Za-z_$][\w$]*)\s*:/g)].map(
    (m) => m[1]
  );
}

type ButtonVariant = NonNullable<VariantProps<typeof buttonVariants>['variant']>;
type ButtonSize = NonNullable<VariantProps<typeof buttonVariants>['size']>;

// The cast is the seam between the SOURCE (which is the source of truth for the
// key set) and the TYPE (which `tsc` derives from the same object literal). If
// they ever disagree, the assertions below fail on an `undefined` class string
// rather than passing quietly.
const VARIANT_KEYS = keysOf(
  objectBody(BUTTON_SRC, 'variant')
) as ButtonVariant[];
const SIZE_KEYS = keysOf(objectBody(BUTTON_SRC, 'size')) as ButtonSize[];

/** Whitespace-split token view. Exact tokens only — see the substring trap note. */
const tokensOf = (s: string): string[] => s.trim().split(/\s+/).filter(Boolean);

describe('Button', () => {
  it('renders a type="button" carrying btn + btn-primary by default', () => {
    render(<Button>Save</Button>);
    const btn = screen.getByRole('button', { name: 'Save' });
    expect(btn.tagName).toBe('BUTTON');
    expect(btn).toHaveAttribute('type', 'button');
    expect(btn).toHaveClass('btn');
    expect(btn).toHaveClass('btn-primary');
  });

  it('keeps the D-01 elevation and focus ring in the base, on every variant', () => {
    // TIGHTENED 88.6-06 (D10): the elevation half was a SUBSTRING check, and
    // `enabled-hover:shadow-theme-md` CONTAINS `hover:shadow-theme-md` — so it
    // passed identically before and after the hover narrowing and proved
    // nothing. It is now an EXACT-TOKEN pin. Variants are the DERIVED key list,
    // so a rung added later is covered without editing this line.
    for (const variant of VARIANT_KEYS) {
      const base = buttonVariants({ variant });
      const toks = tokensOf(base);
      expect(toks).toContain('btn');
      expect(toks).toContain('shadow-theme-sm');
      expect(
        toks,
        `88.6-06 D10 — variant=${variant}: the hover half of the elevation pair must be the exact token \`enabled-hover:shadow-theme-md\`, never a bare \`hover:\` one`
      ).toContain('enabled-hover:shadow-theme-md');
      expect(toks).toContain('focus-visible:ring-2');
      expect(toks).toContain('focus-visible:ring-focus-ring');
      expect(toks).toContain('focus-visible:ring-offset-2');
    }
  });

  it('maps secondary and danger to their legacy .btn-* classes', () => {
    const { rerender } = render(<Button variant="secondary">Cancel</Button>);
    expect(screen.getByRole('button')).toHaveClass('btn', 'btn-secondary');

    rerender(<Button variant="danger">Delete</Button>);
    expect(screen.getByRole('button')).toHaveClass('btn', 'btn-danger');
  });

  it('renders ghost with btn but no .btn-* background class', () => {
    render(<Button variant="ghost">Menu</Button>);
    const btn = screen.getByRole('button');
    expect(btn).toHaveClass('btn');
    expect(btn).not.toHaveClass('btn-primary');
    expect(btn).not.toHaveClass('btn-secondary');
    expect(btn).not.toHaveClass('btn-danger');
    expect(btn).toHaveClass('bg-transparent');
  });

  it('gives size="icon" a 44x44 floor', () => {
    render(
      <Button variant="ghost" size="icon" aria-label="Open menu">
        <span aria-hidden="true">x</span>
      </Button>
    );
    const btn = screen.getByRole('button', { name: 'Open menu' });
    expect(btn).toHaveClass('min-h-11');
    expect(btn).toHaveClass('min-w-11');
  });

  it('never emits a scale/transform press or hover (reference forbids it)', () => {
    const all = [
      buttonVariants(),
      buttonVariants({ variant: 'ghost', size: 'icon' }),
    ].join(' ');
    expect(all).not.toMatch(/scale-|transform/);
  });

  it('renders the child element instead of a <button> when asChild is set', () => {
    render(
      <Button asChild>
        <a href="/events">Browse events</a>
      </Button>
    );
    expect(screen.queryByRole('button')).toBeNull();
    const link = screen.getByRole('link', { name: 'Browse events' });
    expect(link).toHaveClass('btn', 'btn-primary');
  });

  it('merges a caller className over the variant classes', () => {
    render(<Button className="w-full">Save</Button>);
    expect(screen.getByRole('button')).toHaveClass('w-full');
  });

  it('passes an axe audit with no violations', async () => {
    render(<Button>Save</Button>);
    expect(await axe(screen.getByRole('button'))).toHaveNoViolations();
  });

  // ───────────────────────────────────────────────────────────────────────────
  // 88.6-06 (D-09 / C.1) — the two new rungs (`accent`, `sm`), the all-viewport
  // 44px floor on the cva BASE, the dead-class rule, and the enabled-only hover.
  //
  // WHY EVERY HOVER CHECK BELOW IS AN EXACT-TOKEN CHECK, never a substring one:
  // `enabled-hover:` CONTAINS `hover:`, so `toContain('hover:')` is satisfied by
  // BOTH the old (bare, ungated) and the new (gated) spelling and therefore
  // proves nothing. Each check splits the class string on whitespace first and
  // compares whole tokens.
  // ───────────────────────────────────────────────────────────────────────────
  describe('88.6-06 — accent + sm rungs, base 44px floor, enabled-only hover', () => {
    // The whole emitted surface, DERIVED from `Button.tsx` (see the module-level
    // note): 5 variants x 3 sizes = 15 combinations at the time of writing.
    // The 15 is a stated expectation; the DERIVATION is the source of truth.
    const ALL_VARIANTS = VARIANT_KEYS;
    const ALL_SIZES = SIZE_KEYS;

    it('variant="accent" emits btn-accent and paints no colour utility of its own', () => {
      render(<Button variant="accent">Create Event</Button>);
      const btn = screen.getByRole('button', { name: 'Create Event' });
      expect(btn).toHaveClass('btn');
      expect(btn).toHaveClass('btn-accent');
      // The amber is carried by `.btn-accent` (globals.css:2478-2481) over
      // `--color-btn-accent-bg` / `-text`. Re-emitting it as utilities would be
      // the SECOND expression of one value — exactly what the 88.3-18 marker
      // (globals.css:2389) exists to prevent.
      for (const tok of tokensOf(btn.className)) {
        expect(
          tok,
          `88.6-06 D-09 — \`accent\` must emit the CLASS, never the amber as utilities; found \`${tok}\``
        ).not.toMatch(/^(bg-|text-content-)/);
      }
    });

    it('size="sm" emits btn-sm and no padding or font-size utility (they would be DEAD)', () => {
      render(<Button size="sm">Invite guest</Button>);
      const btn = screen.getByRole('button', { name: 'Invite guest' });
      expect(btn).toHaveClass('btn');
      expect(btn).toHaveClass('btn-sm');
      for (const tok of tokensOf(btn.className)) {
        expect(
          tok,
          `88.6-06 D-09 — \`${tok}\` is DEAD on a \`.btn\` element: \`.btn\` declares \`padding: .5rem 1rem\` (globals.css:2202) and \`font-size: .875rem\` (:2201) UNLAYERED, and an unlayered author rule beats every \`@layer utilities\` rule. The compact padding comes from the unlayered \`.btn-sm\` rule (globals.css:2722-2725), never from a utility`
        ).not.toMatch(/^(p-|px-|py-|text-xs$|text-sm$|text-base$)/);
      }
    });

    it('size="icon" is a two-axis floor and emits no dead padding utility', () => {
      render(
        <Button variant="ghost" size="icon" aria-label="Close">
          <span aria-hidden="true">x</span>
        </Button>
      );
      const btn = screen.getByRole('button', { name: 'Close' });
      expect(btn).toHaveClass('min-h-11');
      expect(btn).toHaveClass('min-w-11');
      expect(
        tokensOf(btn.className),
        '88.6-06 C.1 — `p-0` was DEAD from the day it was written: `.btn` declares `padding: .5rem 1rem` UNLAYERED (globals.css:2202) and `@layer utilities` always loses. Re-adding it changes no rendered pixel and re-introduces a class the AC-3 dead-class rule forbids'
      ).not.toContain('p-0');
    });

    it('every variant x size emits the base min-h-11 floor, at every viewport width', () => {
      for (const variant of ALL_VARIANTS) {
        for (const size of ALL_SIZES) {
          const { container } = render(
            <Button variant={variant} size={size} aria-label="x">
              go
            </Button>
          );
          const cls = (container.firstElementChild as HTMLElement).className;
          expect(
            tokensOf(cls),
            `88.6-06 D-09 — the 44px floor lives on the cva BASE so it reaches every viewport width (variant=${variant} size=${size}). The phone-only \`.btn\` class rule (globals.css:2677-2681) is deliberately NOT widened — D-36 rejects an all-viewport floor on the CLASS, which square-by-design controls wear`
          ).toContain('min-h-11');
          cleanup();
        }
      }
    });

    it('no UNPREFIXED hover token survives in any emitted class string', () => {
      for (const variant of ALL_VARIANTS) {
        for (const size of ALL_SIZES) {
          for (const tok of tokensOf(buttonVariants({ variant, size }))) {
            expect(
              tok,
              `88.6-06 D10 — \`${tok}\` is an UNPREFIXED hover token (variant=${variant} size=${size}). It lifts or washes controls that are \`disabled\` or \`aria-disabled\` — exactly the controls the four legacy \`.btn-*:hover:not(:disabled):not([aria-disabled='true'])\` rules (globals.css:2383, :2483, :2633, :2643) deliberately exclude. Express it through the \`enabled-hover\` variant (globals.css:177-183)`
            ).not.toMatch(/^hover:/);
          }
        }
      }
    });

    it('the base elevation pair is a resting shadow plus an enabled-hover lift', () => {
      const base = tokensOf(buttonVariants({ variant: 'primary' }));
      expect(base).toContain('shadow-theme-sm');
      expect(
        base,
        '88.6-06 D10 — the hover half of the elevation pair must be gated by the `enabled-hover` variant so a disabled or aria-disabled control never lifts'
      ).toContain('enabled-hover:shadow-theme-md');
    });

    it('the ghost wash is enabled-hover-scoped and keeps its gated ink', () => {
      const ghost = tokensOf(buttonVariants({ variant: 'ghost' }));
      expect(ghost).toContain('bg-transparent');
      expect(ghost).toContain('text-content-secondary');
      expect(
        ghost,
        "88.6-06 D10 — a NATIVELY-disabled ghost washed on hover until this narrowing: the shipped `aria-disabled:hover:bg-transparent` override only ever reached the ARIA half"
      ).toContain('enabled-hover:bg-surface-hover');
      // Gate A test 53's pin (tokenContrast.test.ts:1647-1648) scans this same
      // string: the gated state is COLOUR, never element opacity.
      expect(ghost).toContain('aria-disabled:text-content-muted');
      expect(ghost.join(' ')).not.toMatch(/aria-disabled:opacity/);
    });

    it('the four shipped variants are otherwise unchanged — the rungs are ADDITIVE', () => {
      expect(buttonVariants({ variant: 'primary' })).toContain('btn-primary');
      expect(buttonVariants({ variant: 'secondary' })).toContain(
        'btn-secondary'
      );
      expect(buttonVariants({ variant: 'danger' })).toContain('btn-danger');
      for (const v of ['primary', 'secondary', 'danger'] as const) {
        const toks = tokensOf(buttonVariants({ variant: v }));
        expect(
          toks.filter((t) => t.startsWith('btn-')),
          `88.6-06 — \`${v}\` must still emit exactly its one legacy class`
        ).toEqual([`btn-${v}`]);
      }
    });

    it('a caller bg/text utility still beats the ghost variant string (twMerge, not absence)', () => {
      render(
        <Button variant="ghost" className="bg-surface-card text-content-primary">
          Menu
        </Button>
      );
      const btn = screen.getByRole('button', { name: 'Menu' });
      // The MECHANISM is `cn` = `twMerge(clsx(...))` (src/lib/cn.ts:34), NOT
      // "the base declares neither". The cva BASE declares no `bg-*` and no text
      // colour, but the GHOST VARIANT STRING declares BOTH `bg-transparent` and
      // `text-content-secondary` — the caller wins because tailwind-merge drops
      // the earlier conflicting tokens. A future editor who breaks this should
      // be sent to `cn`, not to the base.
      const toks = tokensOf(btn.className);
      expect(
        toks,
        '88.6-06 — tailwind-merge (src/lib/cn.ts) must drop the ghost string`s own bg-transparent for the caller`s bg-*'
      ).toContain('bg-surface-card');
      expect(toks).not.toContain('bg-transparent');
      expect(toks).toContain('text-content-primary');
      expect(toks).not.toContain('text-content-secondary');
    });

    it('asChild renders an <a> with the button classes and no type attribute', () => {
      render(
        <Button asChild variant="accent">
          <a href="/x">y</a>
        </Button>
      );
      const link = screen.getByRole('link', { name: 'y' });
      expect(link.tagName).toBe('A');
      expect(link).toHaveClass('btn', 'btn-accent');
      expect(link).not.toHaveAttribute('type');
    });

    it('the derived key list really is the whole 5 x 3 surface', () => {
      // A derivation that silently returns [] makes every matrix assertion
      // vacuous, so the anti-vacuity check comes first and names the mechanism.
      expect(
        ALL_VARIANTS,
        '88.6-06 — the variant key list came back EMPTY. The derivation is a comment-stripped source scan of `Button.tsx` (see the module-level note); runtime introspection of a `cva()` function returns no keys at all'
      ).not.toHaveLength(0);
      expect(ALL_SIZES).not.toHaveLength(0);
      expect([...ALL_VARIANTS].sort()).toEqual([
        'accent',
        'danger',
        'ghost',
        'primary',
        'secondary',
      ]);
      expect([...ALL_SIZES].sort()).toEqual(['default', 'icon', 'sm']);
      // The stated expectation, kept beside the derivation rather than instead
      // of it: 15 combinations after this plan.
      expect(ALL_VARIANTS.length * ALL_SIZES.length).toBe(15);
    });

    it('SOURCE SCAN: no unprefixed hover token in the cva base or the variant map', () => {
      // The same comment-stripped source-scan shape Gate A uses on this file
      // (`tokenContrast.test.ts:1641-1648`). It exists because the RENDERED
      // check above can only see what cva emits for the combinations it is
      // asked for; this one reads the authored strings directly, so a hover
      // token parked in an unreachable branch is still caught.
      //
      // BOUNDARY-AWARE IN BOTH DIRECTIONS: `enabled-hover:` CONTAINS `hover:`,
      // so the match must be anchored at a token boundary — a token START, not
      // a position preceded by `-`. A naive `/hover:/` reds on correct code.
      const offenders: string[] = [];
      for (const label of ['variant', 'size'] as const) {
        for (const tok of objectBody(BUTTON_SRC, label).split(/[\s'",]+/)) {
          if (/^hover:/.test(tok)) offenders.push(`${label} map: ${tok}`);
        }
      }
      const baseStart = BUTTON_SRC.indexOf('cva(');
      const baseEnd = BUTTON_SRC.indexOf(".join(' ')");
      expect(baseStart, 'LOCATOR failure: no `cva(` in Button.tsx').toBeGreaterThan(-1);
      expect(baseEnd, "LOCATOR failure: no `.join(' ')` in Button.tsx").toBeGreaterThan(baseStart);
      for (const tok of BUTTON_SRC.slice(baseStart, baseEnd).split(/[\s'",]+/)) {
        if (/^hover:/.test(tok)) offenders.push(`cva base: ${tok}`);
      }
      expect(
        offenders,
        `88.6-06 D10 — an UNPREFIXED hover token lifts or washes controls that are \`disabled\` or \`aria-disabled\`, which is exactly what the four legacy \`.btn-*:hover:not(:disabled):not([aria-disabled='true'])\` rules (globals.css:2383, :2483, :2633, :2643) withhold. Route it through the \`enabled-hover\` variant (globals.css:177-183). Offenders: ${offenders.join(' | ')}`
      ).toEqual([]);
    });

    it('UI-SPEC §9.3 E1 (source half): a long label has room to wrap and nothing can clip it', () => {
      // UI-SPEC §9.3 E1, SOURCE half. jsdom performs no layout and loads no
      // stylesheet, so the GEOMETRY half — `long.height > short.height`, no row
      // overflow measured against the PARENT, no clip — is plan 12's planted
      // phone arm. Nothing here reads a rendered height or width: with no layout
      // engine those read 0, and the assertion would be vacuous or falsely red.
      const base = tokensOf(buttonVariants({ variant: 'primary' }));
      expect(
        base,
        'UI-SPEC §9.3 E1 — the label needs vertical room to wrap into; the floor is what lets the control grow rather than squeeze'
      ).toContain('min-h-11');
      for (const clipper of [
        'truncate',
        'whitespace-nowrap',
        'overflow-hidden',
        'text-ellipsis',
      ]) {
        expect(
          base,
          `UI-SPEC §9.3 E1 — \`${clipper}\` in the cva base would clip or ellipsise a long label at 375px on EVERY migrated call site. The primitive never truncates`
        ).not.toContain(clipper);
      }
    });

    it('an icon-only Button with no name source is reported by axe as `button-name`', async () => {
      // This pins a property of the PRIMITIVE, not of any call site: `Button`
      // never synthesises an accessible name on a caller's behalf. It is the
      // NEGATIVE twin of the shipped positive audit above ("passes an axe audit
      // with no violations"), which asserts that a NAMED Button is clean.
      //
      // IT IS NOT THE MIGRATION GATE, and it cannot be: the fixture is one this
      // test wrote, so it can never red on a real call site. The real gate is
      // per-surface — each migration sweep suite queries its migrated icon
      // control by role AND name, and the composed axe audits red on
      // `button-name`. A source scanner cannot serve as the gate either: an
      // opening-tag reader cannot see an `sr-only` CHILD, and the only live
      // `size="icon"` today (`BottomSheet.tsx:234-238`) names itself exactly
      // that way, with its `sr-only` "Close" at `:237`; RESEARCH §Q4
      // (`88.6-RESEARCH.md:1063`) forbids scan-derived icon inventories outright.
      // Note also that axe (4.12.1, measured) ACCEPTS a bare `title` as a name,
      // which UI-SPEC §7.4 forbids — so axe alone is a floor, not the contract.
      const { container } = render(
        <Button variant="ghost" size="icon">
          <span aria-hidden="true">x</span>
        </Button>
      );
      const results = await axe(container.firstElementChild as HTMLElement);
      expect(
        (results.violations ?? []).map((v) => v.id),
        '88.6-06 T-88.6-12 — an unnamed icon-only Button must be REPORTED, not silently named by the primitive. The rule ID is asserted specifically: "some violation" would pass on an unrelated finding'
      ).toContain('button-name');
    });
  });
});
