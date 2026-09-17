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

// ── W53 / Phase 88.6-30: the native date/time normalisation ──────────────────
//
// The defect (owner, iPhone, 2026-08-28): `<Input type="date">` overflows its cell
// on iOS Safari, because the native control keeps its INTRINSIC width and `w-full`
// cannot shrink it. The fix lives in `controlClass` so it reaches Input, Textarea
// AND SelectControl, but every class it adds is ATTRIBUTE-GATED to the native
// date/time family — so the other ~85 control usages (19 of them `<SelectControl>`,
// which have no `background-image` to fall back on if `appearance` is reset) are
// untouched BY CONSTRUCTION rather than by assertion.
//
// NO ENGINE INSTALLED ON THIS PROJECT REPRODUCES THE DEFECT: the `phone` Playwright
// project is chromium-pinned by DECISION Phase 87.7 D-14 and ci.yml installs chromium
// only. So these pins deliberately assert things that are engine-INDEPENDENT — the
// class is present, the class is gated, and Tailwind actually EMITS a rule for it —
// and the reproduction itself is the owner's device check (plan 88.6-30 task 4).
const DATE_TIME_GATE = '[&:is([type=date],[type=time],[type=datetime-local])]';
// The MINIMAL set, established by testing rather than applied by reflex (the plan's
// instruction). `appearance-none` releases the UA intrinsic sizing; `min-w-0` removes
// the intrinsic minimum width so `w-full` can actually shrink the box. A third member
// was considered and REJECTED on evidence: start-aligning the value pseudo-element is
// already shipped by Tailwind's own preflight — `::-webkit-date-and-time-value
// { text-align: inherit }` at `node_modules/tailwindcss/preflight.css:324-327`, under
// the comment "Ensure text alignment can be changed on date/time inputs in iOS Safari"
// — so adding `[…::-webkit-date-and-time-value]:text-left` would be a no-op dressed as
// a fix.
const NORMALISATION = ['appearance-none', 'min-w-0'] as const;

describe('W53 — date/time normalisation (Phase 88.6-30)', () => {
  it('carries every normalisation class, and carries each of them ATTRIBUTE-GATED', () => {
    for (const utility of NORMALISATION) {
      expect(controlClass).toContain(`${DATE_TIME_GATE}:${utility}`);
    }
  });

  // The class reaches all three exported controls because it lives in the shared
  // `controlClass` — asserted on the RENDERED nodes, not only on the constant, so a
  // future export that stops composing `controlClass` reds here.
  it('lands the gated normalisation on all THREE exported controls', () => {
    render(
      <>
        <Input aria-label="From date" type="date" />
        <Textarea aria-label="Notes" />
        <SelectControl aria-label="Sort by">
          <option value="a">A</option>
        </SelectControl>
      </>
    );
    for (const name of ['From date', 'Notes', 'Sort by']) {
      const el = screen.getByLabelText(name);
      for (const utility of NORMALISATION) {
        expect(
          el.className.split(/\s+/),
          `${name} is missing ${DATE_TIME_GATE}:${utility}`
        ).toContain(`${DATE_TIME_GATE}:${utility}`);
      }
    }
  });

  // THE SCOPING PIN — the preservation half, green before and after by design.
  // It replaces an earlier wording ("assert they render unchanged"), which could
  // never fail for two independent reasons: the class is on all three by
  // construction, and a class-string assertion in jsdom cannot observe a layout
  // change at all, because jsdom performs no layout.
  //
  // What this CAN catch is the real blast-radius failure: an UNCONDITIONAL
  // `appearance-none` in `controlClass` would strip the UA dropdown indicator from
  // all 19 `<SelectControl>` sites with nothing replacing it — `controlClass`
  // declares no `background-image`.
  it('carries NO UNCONDITIONAL member of the normalisation family, on any of the three', () => {
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
          `${name} carries a BARE ${utility} — the normalisation must be attribute-gated`
        ).not.toContain(utility);
      }
    }
  });

  // THE EMISSION PIN. `grep -rn '\[&' src` returned 0 before this plan, so the gated
  // utility is the repo's FIRST arbitrary variant, on `tailwindcss ^4.3.3`, with
  // nothing in the tree proving the syntax compiles here. Every other gate in this
  // plan is blind to "Tailwind emitted no rule at all": the two pins above read class
  // STRINGS, and jsdom performs no layout. Without this, a silently-never-emitted
  // rule is green on every CI-side gate and the defect ships.
  //
  // This compiles with the project's OWN installed Tailwind, so it is engine-
  // independent and runs in CI — unlike the browser-side `min-width` probe in
  // `e2e/input-date-phone.spec.ts`, which needs an authenticated phone-project run.
  it('emits a real CSS rule for each gated utility, SCOPED to the date/time family', async () => {
    const [{ readFileSync }, { default: path }] = await Promise.all([
      import('node:fs'),
      import('node:path'),
    ]);
    // Resolved from the vitest root (the frontend package dir) — see the note on
    // `fromRoot` in DangerZoneDeleteAccount.test.tsx for why not import.meta.url.
    const twDir = path.resolve(process.cwd(), 'node_modules/tailwindcss');
    const { compile } = await import(
      /* @vite-ignore */ path.join(twDir, 'dist/lib.mjs')
    );

    // Drive the candidate list off `controlClass` itself, so a fix that never made
    // it into the primitive reds here too rather than compiling a hard-coded string.
    const gated = controlClass
      .split(/\s+/)
      .filter((c) => c.startsWith(`${DATE_TIME_GATE}:`));
    expect(
      gated.length,
      'controlClass carries no attribute-gated normalisation class to compile'
    ).toBe(NORMALISATION.length);

    const compiler = await compile('@import "tailwindcss";', {
      base: process.cwd(),
      loadStylesheet: async (id: string, base: string) => {
        const p =
          id === 'tailwindcss'
            ? path.join(twDir, 'index.css')
            : path.resolve(base, id);
        return { path: p, base: path.dirname(p), content: readFileSync(p, 'utf8') };
      },
    });
    const css: string = compiler.build([...gated, ...NORMALISATION]);

    for (const utility of NORMALISATION) {
      // The gated rule exists AND its selector really is narrowed to the family.
      const gatedSelector = new RegExp(
        `\\.\\\\\\[[^\\n{]*${utility}[^\\n{]*:is\\(\\s*\\[type=date\\]`
      );
      expect(css, `no emitted rule scoped to the date/time family for ${utility}`).toMatch(
        gatedSelector
      );
      // …and the BARE utility, compiled beside it, is NOT scoped — which is what
      // proves the scoping above came from the gate and not from the utility itself.
      expect(css).toMatch(new RegExp(`^\\s*\\.${utility}\\s*\\{`, 'm'));
    }
  });
});
