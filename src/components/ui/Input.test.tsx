// Contract pins for the <Input> / <Textarea> / <SelectControl> primitives
// (Req 1 — the iOS focus-zoom blocker, UI-SPEC §8.2).
//
// The pins here are about the CONTRACT the adoption plans depend on, not styling taste:
//   1. 16px (`text-base`) at EVERY breakpoint — never a smaller size, never a `md:` size
//      variant. Below 16px iOS Safari focus-zooms the page on tap; that is the whole
//      reason this primitive exists.
//   2. `focus-visible` ring only — a bare `focus:` ring fires on mouse/programmatic focus
//      too (UI-SPEC §7.2).
//   3. All three are `forwardRef` and spread unknown props onto the DOM node. This is
//      NON-NEGOTIABLE: `FormField` injects `id`/`aria-invalid`/`aria-describedby` via
//      `React.cloneElement`, so a component that swallowed props would silently drop the
//      whole label/error a11y contract.
//   4. Composition, not duplication — the label/error/aria wiring stays in `FormField`.
//   5. axe-clean inside `FormField`.
import * as React from 'react';
import { render, screen, cleanup } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { axe } from 'vitest-axe';
import { FormField } from '@/app/components/form/FormField';
import { Input, Textarea, SelectControl, controlClass } from './Input';

afterEach(cleanup);

describe('Input', () => {
  it('renders an <input> sized at 16px (text-base)', () => {
    render(<Input aria-label="Group name" />);
    const input = screen.getByLabelText('Group name');
    expect(input.tagName).toBe('INPUT');
    expect(input).toHaveClass('text-base');
  });

  it('never carries a smaller-than-16px size, and never a breakpoint size variant', () => {
    // A `md:text-*` variant would reintroduce the iOS zoom below `md`, which is
    // exactly the breakpoint where phones live.
    expect(controlClass).not.toMatch(/(^|[\s:])text-(xs|sm)\b/);
    expect(controlClass).not.toMatch(/\b(sm|md|lg|xl):text-/);
  });

  it('uses a focus-visible ring and no bare focus: ring/border/bg utility', () => {
    expect(controlClass).toContain('focus-visible:ring-2');
    expect(controlClass).toContain('focus-visible:ring-focus-ring');
    expect(controlClass).not.toMatch(/(^|\s)focus:(ring|border|bg)/);
  });

  it('carries the 44px touch floor at phone widths', () => {
    render(<Input aria-label="Group name" />);
    expect(screen.getByLabelText('Group name')).toHaveClass('max-md:min-h-11');
  });

  it('forwards a ref to the DOM node', () => {
    const ref = React.createRef<HTMLInputElement>();
    render(<Input aria-label="Group name" ref={ref} />);
    expect(ref.current).toBeInstanceOf(HTMLInputElement);
    expect(ref.current).toBe(screen.getByLabelText('Group name'));
  });

  it('spreads unknown props (id / aria-* / register()) onto the DOM node', () => {
    render(
      <Input
        aria-label="Group name"
        id="group-name"
        name="groupName"
        aria-invalid="true"
        aria-describedby="group-name-error"
        placeholder="Board Game Club"
      />
    );
    const input = screen.getByLabelText('Group name');
    expect(input).toHaveAttribute('id', 'group-name');
    expect(input).toHaveAttribute('name', 'groupName');
    expect(input).toHaveAttribute('aria-invalid', 'true');
    expect(input).toHaveAttribute('aria-describedby', 'group-name-error');
    expect(input).toHaveAttribute('placeholder', 'Board Game Club');
  });

  it('merges a caller className over the control classes', () => {
    render(<Input aria-label="Group name" className="w-full" />);
    expect(screen.getByLabelText('Group name')).toHaveClass('w-full');
  });

  it('renders ONLY the control — no label and no error node of its own', () => {
    const { container } = render(<Input aria-label="Group name" />);
    expect(container.querySelector('label')).toBeNull();
    expect(screen.queryByRole('alert')).toBeNull();
  });
});

describe('Textarea', () => {
  it('renders a <textarea> at 16px and forwards a ref', () => {
    const ref = React.createRef<HTMLTextAreaElement>();
    render(<Textarea aria-label="Notes" ref={ref} />);
    const el = screen.getByLabelText('Notes');
    expect(el.tagName).toBe('TEXTAREA');
    expect(el).toHaveClass('text-base');
    expect(ref.current).toBe(el);
  });
});

describe('SelectControl', () => {
  it('renders a <select> at 16px, forwards a ref, and renders its options', () => {
    const ref = React.createRef<HTMLSelectElement>();
    render(
      <SelectControl aria-label="Color" ref={ref} defaultValue="red">
        <option value="red">Red</option>
        <option value="blue">Blue</option>
      </SelectControl>
    );
    const el = screen.getByLabelText('Color');
    expect(el.tagName).toBe('SELECT');
    expect(el).toHaveClass('text-base');
    expect(ref.current).toBe(el);
    expect(screen.getByRole('option', { name: 'Red' })).toBeInTheDocument();
  });
});

describe('Input composed inside FormField', () => {
  it('receives the cloneElement-injected id so the visible label points at it', () => {
    render(
      <FormField label="Group name">
        <Input />
      </FormField>
    );
    const input = screen.getByLabelText('Group name');
    expect(input.tagName).toBe('INPUT');
    expect(input.id).toBeTruthy();
    expect(input).not.toHaveAttribute('aria-invalid');
  });

  it('receives the injected aria-invalid + aria-describedby pointing at the error node', () => {
    render(
      <FormField label="Group name" error="Group name is required">
        <Input />
      </FormField>
    );
    const input = screen.getByLabelText('Group name');
    expect(input).toHaveAttribute('aria-invalid', 'true');
    const alert = screen.getByRole('alert');
    expect(alert).toHaveTextContent('Group name is required');
    expect(alert.id).toBeTruthy();
    expect(input.getAttribute('aria-describedby')).toBe(alert.id);
  });

  it('keeps a caller-supplied aria-describedby alongside the injected error id', () => {
    render(
      <FormField label="Group name" error="Group name is required">
        <Input aria-describedby="group-name-hint" />
      </FormField>
    );
    const input = screen.getByLabelText('Group name');
    const alert = screen.getByRole('alert');
    expect(input.getAttribute('aria-describedby')).toBe(
      `group-name-hint ${alert.id}`
    );
  });

  it('passes an axe audit with a visible label', async () => {
    const { container } = render(
      <FormField label="Group name">
        <Input />
      </FormField>
    );
    expect(await axe(container)).toHaveNoViolations();
  });

  it('passes an axe audit in the errored state', async () => {
    const { container } = render(
      <FormField label="Group name" error="Group name is required">
        <Input />
      </FormField>
    );
    expect(await axe(container)).toHaveNoViolations();
  });
});

// ── W53 / Phase 88.6-30 — REOPENED 2026-09-21: the native date/time normalisation ──
//
// The defect (owner, iPhone): a date/time control overflows its cell on iOS Safari,
// which resolves `width: 100%` on the NATIVE control against the CONTENT box and then
// adds padding and border on top. The fix is a plain-CSS `@layer base` rule in
// `src/app/globals.css`, NOT a class on `controlClass` — see the DECISION marker in
// `Input.tsx` for why the class arm is not revivable.
//
// WHY THIS TEST LOOKS THE WAY IT DOES. Plan 30's first attempt shipped the
// normalisation as two ATTRIBUTE-GATED Tailwind utilities built by string
// interpolation. Tailwind v4 extracts candidates from RAW SOURCE TEXT, so the full
// candidate string appeared in no scanned file and the compiler emitted NOTHING for
// either one. The classes reached the DOM; the rules did not exist. Every gate in that
// plan was green: the class-string pins read the constant, jsdom performs no layout,
// and the EMISSION pin — the one written to catch exactly this — called
// `compiler.build()` with the already-RESOLVED strings, which bypasses the scanner and
// can only ever prove that the syntax compiles.
//
// So this replacement asserts the one thing that would have caught it: compile the REAL
// `src/app/globals.css` through the project's own installed engine, honouring the real
// `@source` tree (including its `@source not` test exclusions), and assert the selector
// is present in the OUTPUT. It was observed RED at `ee26eef` (the compiled stylesheet
// contained no date/time selector at all) and green once the rule landed.
//
// NO ENGINE INSTALLED ON THIS PROJECT RENDERS iOS SAFARI: the `phone` Playwright project
// is chromium-pinned by DECISION Phase 87.7 D-14, ci.yml installs chromium only, and
// Playwright ships no WebKit build for this macOS version. This test is therefore
// engine-INDEPENDENT by necessity — it proves the rule SHIPS, never that it FIXES.
// The reproduction is the owner's device check (plan 88.6-30 task 4).
//
// COST: the whole-tree compile takes roughly 2-4s (it scans every `@source` glob, the
// same work `next build` does). That is deliberate — scoping `@source` down to make it
// faster would stop it exercising the real scanner, which is the entire point.
const DATE_TIME_TYPES = ['date', 'time', 'datetime-local'] as const;
// The family the normalisation must NOT carry unconditionally. `appearance` is the
// dangerous one: `controlClass` declares no `background-image`, so an unconditional
// appearance reset would strip the UA dropdown indicator from all 19 `<SelectControl>`
// sites with nothing replacing it.
const NORMALISATION = ['appearance-none', 'min-w-0'] as const;

/** Compile the real stylesheet the app ships, through the real scanner. */
async function buildShippedCss(): Promise<{ css: string; candidates: string[] }> {
  const [{ readFileSync }, { default: path }] = await Promise.all([
    import('node:fs'),
    import('node:path'),
  ]);
  // Resolved from the vitest root (the frontend package dir) — see the note on
  // `fromRoot` in DangerZoneDeleteAccount.test.tsx for why not import.meta.url.
  const root = process.cwd();
  const { compile } = await import(
    /* @vite-ignore */ path.join(root, 'node_modules/@tailwindcss/node/dist/index.mjs')
  );
  const { Scanner } = await import(
    /* @vite-ignore */ path.join(root, 'node_modules/@tailwindcss/oxide/index.js')
  );
  const cssPath = path.resolve(root, 'src/app/globals.css');
  const compiler = await compile(readFileSync(cssPath, 'utf8'), {
    base: path.dirname(cssPath),
    onDependency: () => {},
  });
  // `compiler.sources` is what the `@source` / `@source not` directives resolved to —
  // reading it from the compiler rather than re-declaring globs here is what keeps the
  // test honest about the configuration the app actually builds with.
  const scanner = new Scanner({ sources: compiler.sources });
  const candidates: string[] = scanner.scan();
  return { css: compiler.build(candidates), candidates };
}

describe('W53 — the date/time normalisation is EMITTED (Phase 88.6-30, reopened)', () => {
  it('ships an input-qualified date/time appearance reset in the compiled stylesheet', async () => {
    const { css, candidates } = await buildShippedCss();

    // Scanner health, so a misconfigured compile cannot make the assertions below
    // vacuous by producing an empty or source-less build. `max-md:min-h-11` is written
    // as a plain literal in `controlClass`, so the scanner must find it.
    expect(candidates.length, 'the scanner found no candidates at all').toBeGreaterThan(0);
    expect(css).toMatch(/\.max-md\\:min-h-11/);

    // THE PIN. A rule whose selector carries the date type must exist in the OUTPUT.
    // Quote-tolerant: the emitted selector reproduces whatever quoting the source used.
    const rule = /(^|[\s}])((?:[^{}]*\[type=['"]?date['"]?\][^{}]*))\{([^}]*)\}/m.exec(css);
    expect(
      rule,
      'the compiled stylesheet contains NO date-typed selector — the normalisation was never emitted (this is the exact state at ee26eef)'
    ).not.toBeNull();

    const selector = rule![2].trim();
    const body = rule![3];

    // Both spellings ship: `-webkit-appearance` is unreachable from a Tailwind utility
    // and the unprefixed property alone is unproven on the owner's iOS.
    expect(body, `emitted rule has no -webkit-appearance reset: ${selector}`).toMatch(
      /-webkit-appearance:\s*none/
    );
    expect(body, `emitted rule has no appearance reset: ${selector}`).toMatch(
      /(^|[^-])appearance:\s*none/
    );

    // The whole family, not just `date`.
    for (const type of DATE_TIME_TYPES) {
      expect(selector, `the emitted selector omits type=${type}`).toMatch(
        new RegExp(`\\[type=['"]?${type}['"]?\\]`)
      );
    }

    // THE SCOPING HALF, and it is stronger than the class gate it replaced: every
    // selector in the list is `input`-qualified, so it cannot match a `<select>` or a
    // `<textarea>` BY CONSTRUCTION. That is the guarantee owner ruling AC-17
    // (2026-09-09) asked for — the 19 `<SelectControl>` sites keep their UA indicator.
    for (const part of selector.split(',')) {
      expect(
        part.trim(),
        `an unqualified date/time selector can reach a <select>: ${part.trim()}`
      ).toMatch(/^input\[type=/);
    }
  }, 60_000);

  // The preservation half: green before and after BY DESIGN, and labelled as such
  // rather than presented as a demonstrated fix. It catches the blast-radius failure
  // an executor could reintroduce at any time — an unconditional appearance reset on
  // the shared control class.
  it('carries NO member of the normalisation family on the shared controlClass, gated or not', () => {
    render(
      <>
        <Input aria-label="Group name" type="text" />
        <Textarea aria-label="Notes" />
        <SelectControl aria-label="Sort by">
          <option value="a">A</option>
        </SelectControl>
      </>
    );
    for (const name of ['Group name', 'Notes', 'Sort by']) {
      const classes = screen.getByLabelText(name).className.split(/\s+/);
      for (const utility of NORMALISATION) {
        expect(
          classes,
          `${name} carries ${utility} — the normalisation belongs in globals.css, not on the shared control class`
        ).not.toContain(utility);
      }
    }
    // An interpolated (or any) arbitrary variant here is the mechanism that failed:
    // the scanner cannot see a class this file composes at runtime.
    expect(
      controlClass,
      'controlClass carries an arbitrary variant — Tailwind cannot see one that is composed rather than written literally'
    ).not.toContain('[&');
  });
});
