// Contract pins for the <Combobox> primitive (Req 5/8, UI-SPEC §8.5).
//
// The picker this replaces (`GameComboInput`) is a bare <input> plus a div of <button>s:
// no `combobox` role, no `listbox`, no `option`, no `aria-activedescendant`, and arrow keys
// do nothing at all. So these pins assert ROLES AND KEYBOARD first — a regression to styled
// buttons must fail here even if it looks pixel-identical.
//
//   1. AR R1-M19: the INPUT side carries the pattern — `role="combobox"`, `aria-expanded`
//      tracking open state, `aria-controls` resolving to the listbox. This is the phase's
//      only hand-rolled-ARIA widget; nothing else asserts it.
//   2. ArrowDown/ArrowUp traverse, Enter selects, Escape closes AND leaves focus on the input.
//   3. The text field is the `Input` primitive, so Req 1's 16px iOS-zoom floor is inherited,
//      never restated. The `text-base` pin fails if someone re-hand-rolls the control.
//   4. Options clear 44px; the surface is elevated + `shadow-theme-lg` + card radius (§8.5).
//   5. Semantic tokens only, `focus-visible` only, and no dependency drift back to the
//      shadcn CLI route rejected in OI-6.
//   6. axe-clean in the OPEN state (the closed state is trivially clean and proves nothing).
import * as React from 'react';
import { render, screen, cleanup, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { axe } from 'vitest-axe';

import { Combobox, type ComboboxItem } from './Combobox';

afterEach(cleanup);

const onSelectSpies = {
  catan: vi.fn(),
  brass: vi.fn(),
  gloom: vi.fn(),
};

function makeItems(overrides: Partial<ComboboxItem>[] = []): ComboboxItem[] {
  const base: ComboboxItem[] = [
    { key: 'catan', label: 'Catan', group: 'Your games', onSelect: onSelectSpies.catan },
    { key: 'brass', label: 'Brass', group: 'Your games', onSelect: onSelectSpies.brass },
    { key: 'gloom', label: 'Gloomhaven', group: 'BGG results', onSelect: onSelectSpies.gloom },
  ];
  return base.map((item, i) => ({ ...item, ...overrides[i] }));
}

function Harness({
  items = makeItems(),
  initialOpen = true,
  loading = false,
  trailing,
  ...rest
}: {
  items?: ComboboxItem[];
  initialOpen?: boolean;
  loading?: boolean;
  trailing?: React.ReactNode;
} & Record<string, unknown>) {
  const [value, setValue] = React.useState('cat');
  const [open, setOpen] = React.useState(initialOpen);
  return (
    <Combobox
      aria-label="Search for a game"
      items={items}
      value={value}
      onValueChange={setValue}
      open={open}
      onOpenChange={setOpen}
      loading={loading}
      trailing={trailing}
      {...rest}
    />
  );
}

const getInput = () => screen.getByRole('combobox', { name: 'Search for a game' });

describe('Combobox', () => {
  afterEach(() => {
    Object.values(onSelectSpies).forEach((spy) => spy.mockClear());
  });

  it('carries the combobox pattern on the INPUT side (AR R1-M19)', () => {
    render(<Harness />);
    const input = getInput();

    expect(input.tagName).toBe('INPUT');
    expect(input).toHaveAttribute('role', 'combobox');
    expect(input).toHaveAttribute('aria-expanded', 'true');

    const controls = input.getAttribute('aria-controls');
    expect(controls).toBeTruthy();
    expect(document.getElementById(controls as string)).toBe(
      screen.getByRole('listbox')
    );
  });

  it('reflects the closed state in aria-expanded and renders no listbox', () => {
    render(<Harness initialOpen={false} />);
    expect(getInput()).toHaveAttribute('aria-expanded', 'false');
    expect(screen.queryByRole('listbox')).not.toBeInTheDocument();
  });

  it('exposes listbox / option / group and no loose children in the listbox', () => {
    render(<Harness />);
    const listbox = screen.getByRole('listbox');

    expect(within(listbox).getAllByRole('option')).toHaveLength(3);
    const groups = within(listbox).getAllByRole('group');
    expect(groups).toHaveLength(2);
    expect(groups[0]).toHaveAccessibleName('Your games');
    expect(groups[1]).toHaveAccessibleName('BGG results');
  });

  it('traverses with ArrowDown/ArrowUp via aria-activedescendant', async () => {
    const user = userEvent.setup();
    render(<Harness />);
    const input = getInput();
    input.focus();

    expect(input).not.toHaveAttribute('aria-activedescendant');

    await user.keyboard('{ArrowDown}');
    const first = screen.getByRole('option', { name: 'Catan' });
    expect(input).toHaveAttribute('aria-activedescendant', first.id);
    expect(first).toHaveAttribute('aria-selected', 'true');

    await user.keyboard('{ArrowDown}');
    expect(screen.getByRole('option', { name: 'Brass' })).toHaveAttribute(
      'aria-selected',
      'true'
    );

    await user.keyboard('{ArrowUp}');
    expect(screen.getByRole('option', { name: 'Catan' })).toHaveAttribute(
      'aria-selected',
      'true'
    );

    // Focus never leaves the field — that is what makes typing keep working.
    expect(input).toHaveFocus();
  });

  it('selects the active option with Enter', async () => {
    const user = userEvent.setup();
    render(<Harness />);
    getInput().focus();

    await user.keyboard('{ArrowDown}{ArrowDown}{Enter}');
    expect(onSelectSpies.brass).toHaveBeenCalledTimes(1);
    expect(onSelectSpies.catan).not.toHaveBeenCalled();
  });

  it('selects the first enabled option when Enter is pressed with none active', async () => {
    const user = userEvent.setup();
    render(<Harness />);
    getInput().focus();

    await user.keyboard('{Enter}');
    expect(onSelectSpies.catan).toHaveBeenCalledTimes(1);
  });

  // 88-CODE-REVIEW MED#2: focus-opened full-list pickers (timezone) opt out of
  // select-first — Enter with nothing highlighted is inert, arrow-then-Enter works.
  it('selectFirstOnEnter={false}: bare Enter is inert; an arrowed option still commits', async () => {
    const user = userEvent.setup();
    render(<Harness selectFirstOnEnter={false} />);
    getInput().focus();

    await user.keyboard('{Enter}');
    expect(onSelectSpies.catan).not.toHaveBeenCalled();
    expect(onSelectSpies.brass).not.toHaveBeenCalled();

    await user.keyboard('{ArrowDown}{Enter}');
    expect(onSelectSpies.catan).toHaveBeenCalledTimes(1);
  });

  // 88-CODE-REVIEW MED#3: Enter while open ALWAYS absorbs — the deleted
  // GameComboInput handler preventDefaulted unconditionally while open, and losing
  // that let Enter during the loading/no-results window submit the host <form>
  // (createEvent, ScheduleForm, BallotOptionsEditor all wrap this in one).
  it('Enter during loading neither selects nor submits a wrapping form', async () => {
    const user = userEvent.setup();
    const onSubmit = vi.fn((e: React.FormEvent) => e.preventDefault());
    render(
      <form onSubmit={onSubmit}>
        <Harness items={[]} loading />
      </form>
    );
    getInput().focus();

    await user.keyboard('{Enter}');
    expect(onSubmit).not.toHaveBeenCalled();
    expect(onSelectSpies.catan).not.toHaveBeenCalled();

    // Same absorb with selectFirstOnEnter={false} and items present but none active.
    cleanup();
    onSubmit.mockClear();
    render(
      <form onSubmit={onSubmit}>
        <Harness selectFirstOnEnter={false} />
      </form>
    );
    getInput().focus();
    await user.keyboard('{Enter}');
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it('selects on click and never selects a disabled option', async () => {
    const user = userEvent.setup();
    render(<Harness items={makeItems([{}, {}, { disabled: true }])} />);

    await user.click(screen.getByRole('option', { name: 'Catan' }));
    expect(onSelectSpies.catan).toHaveBeenCalledTimes(1);

    await user.click(screen.getByRole('option', { name: 'Gloomhaven' }));
    expect(onSelectSpies.gloom).not.toHaveBeenCalled();
  });

  it('closes on Escape and leaves focus on the input', async () => {
    const user = userEvent.setup();
    render(<Harness />);
    const input = getInput();
    input.focus();

    await user.keyboard('{ArrowDown}');
    await user.keyboard('{Escape}');

    expect(screen.queryByRole('listbox')).not.toBeInTheDocument();
    expect(input).toHaveFocus();
    expect(input).toHaveAttribute('aria-expanded', 'false');
  });

  it('types through the field without losing the popup', async () => {
    const user = userEvent.setup();
    render(<Harness />);
    const input = getInput();

    await user.click(input);
    await user.keyboard('an');
    expect(input).toHaveValue('catan');
    expect(screen.getByRole('listbox')).toBeInTheDocument();
  });

  it('renders the field at 16px through the Input primitive, not a hand-rolled control', () => {
    render(<Harness />);
    const input = getInput();

    // Fingerprint of `Input`'s shared controlClass — if someone stops composing the
    // primitive, Req 1's single 16px source of truth is gone and this fails.
    expect(input).toHaveClass('text-base');
    expect(input).toHaveClass('bg-surface-input');
    expect(input).toHaveClass('rounded-btn');
    expect(input.className).not.toMatch(/text-(xs|sm)\b/);
    expect(input.className).not.toMatch(/\btext-base\b.*\bmd:text-/);
  });

  it('reserves field padding only when a trailing slot is supplied', () => {
    const { unmount } = render(<Harness />);
    expect(getInput().className).not.toMatch(/\bpr-11\b/);
    unmount();

    render(<Harness trailing={<button type="button">Clear</button>} />);
    expect(getInput()).toHaveClass('pr-11');
  });

  it('puts the listbox on the elevated surface with card radius and the large shadow', () => {
    render(<Harness />);
    const surface = screen.getByRole('listbox').parentElement as HTMLElement;

    expect(surface).toHaveClass('bg-surface-elevated');
    expect(surface).toHaveClass('shadow-theme-lg');
    expect(surface).toHaveClass('rounded-card');
  });

  it('clears the 44px touch floor on every option', () => {
    render(<Harness />);
    for (const option of screen.getAllByRole('option')) {
      expect(option).toHaveClass('min-h-11');
    }
  });

  it('announces the loading and empty rows outside the listbox', () => {
    const { unmount } = render(<Harness items={[]} loading />);
    expect(screen.getByRole('status')).toHaveTextContent('Searching');
    expect(within(screen.getByRole('listbox')).queryAllByRole('option')).toHaveLength(0);
    unmount();

    render(<Harness items={[]} />);
    expect(screen.getByRole('status')).toHaveTextContent('No results found');
  });

  it('uses focus-visible only and carries no raw palette classes', () => {
    render(<Harness />);
    const nodes = [
      getInput(),
      screen.getByRole('listbox'),
      screen.getByRole('listbox').parentElement as HTMLElement,
      ...screen.getAllByRole('option'),
    ];

    expect(getInput().className).toContain('focus-visible:ring-2');
    for (const node of nodes) {
      expect(node.className).not.toMatch(/(^|\s)focus:(ring|border|bg)/);
      expect(node.className).not.toMatch(
        /(red|green|amber|purple|warm|gray|slate)-[0-9]/
      );
    }
  });

  it('forwards the input ref so call sites can refocus the field', () => {
    const ref = React.createRef<HTMLInputElement>();
    render(
      <Combobox
        ref={ref}
        aria-label="Search for a game"
        items={makeItems()}
        value="cat"
        onValueChange={() => {}}
        open
        onOpenChange={() => {}}
      />
    );
    expect(ref.current).toBe(getInput());
  });

  it('stays on the already-installed positioning library (OI-6)', async () => {
    // Path is resolved from the vitest cwd (the app root); `import.meta.url` is an
    // http-scheme module URL under Vite and cannot be handed to `fs`.
    const source = await import('node:fs/promises').then((fs) =>
      fs.readFile('src/components/ui/Combobox.tsx', 'utf8')
    );

    expect(source).toContain("from '@floating-ui/react'");
    expect(source).toContain("from './Input'");
    // The two packages the rejected shadcn CLI route would add must not appear —
    // built from fragments so this assertion cannot trip the phase's own grep gate.
    expect(source).not.toContain(['cm', 'dk'].join(''));
    expect(source).not.toContain(['react-', 'popover'].join(''));
  });

  it('passes an axe audit with no violations in the open state', async () => {
    const { container } = render(<Harness />);
    expect(await axe(container)).toHaveNoViolations();
  });
});

// ---------------------------------------------------------------------------------------
// W38 (plan 88.6-37): the ONE always-mounted sr-only status region.
//
// The defect these pin: the loading/"No results" row carried `role="status"` INSIDE
// `{open && (` and `{status && (`, so the live region was created in the same commit as the
// text it carried. Screen readers announce CHANGES to a mounted region, not the conditional
// mount of a new one (`StatusRegion.tsx:9-12`), so those strings may never have announced.
//
// The fix is a TWO-NODE shape, and these assertions are written so the obvious wrong
// readings fail:
//   - hoisting the VISIBLE row out of `{open &&` would show "No results found" under every
//     CLOSED combobox on all five render paths -> the closed-is-silent arm fails;
//   - keeping `role="status"` on the visible row beside the new region would give the
//     primitive TWO live regions -> the one-region arm AND the pre-existing
//     "announces the loading and empty rows outside the listbox" pin (which uses
//     `getByRole('status')`, singular) both fail.
// ---------------------------------------------------------------------------------------
describe('Combobox — W38: exactly one always-mounted sr-only status region', () => {
  const region = () => screen.getByRole('status');
  // `Harness` holds `open` in its OWN state and reads `initialOpen` once, so it cannot drive
  // the open->closed transition. This one is fully controlled.
  function Controlled({
    items = makeItems(),
    open = true,
    ...rest
  }: { items?: ComboboxItem[]; open?: boolean } & Record<string, unknown>) {
    return (
      <Combobox
        aria-label="Search for a game"
        items={items}
        value="cat"
        onValueChange={() => {}}
        open={open}
        onOpenChange={() => {}}
        {...rest}
      />
    );
  }

  it('mounts the region EMPTY on first render (EMPTY-FIRST, StatusRegion.tsx:9-12)', () => {
    // FIRST RENDER IS THE CLOSED STATE FOR EVERY SHIPPED CONSUMER, measured not assumed:
    // `GameComboInput.js:34` is `useState(false)` and `userProfile/page.js:378` is
    // `useState(false)`, so both mount closed and the region's first commit is empty. That
    // is what makes the first real announcement a CHANGE to a mounted region rather than the
    // mount of a new one.
    //
    // THE RESIDUAL, stated rather than hidden by picking a friendly fixture: a caller that
    // mounts ALREADY OPEN with results would find the count in the region's initial DOM, and
    // that initial value does not announce. No shipped caller does this, and closing it would
    // need a first-render latch — i.e. exactly the `useState`/`useEffect` the source-shape
    // pin below forbids, to fix a state nothing produces.
    render(<Controlled open={false} />);
    expect(region()).toBeInTheDocument();
    expect(region()).toBeEmptyDOMElement();
  });

  it('is present and EMPTY while CLOSED, and renders no visible status text (DECISION 88-10 F-359)', () => {
    // The `open` gate is MANDATORY, not defensive: `userProfile/page.js:451` returns `[]`
    // when the picker is closed, so an `open`-ungated derivation would speak the empty
    // label every single time a user closes the picker.
    render(<Controlled open={false} items={[]} />);
    expect(region()).toBeInTheDocument();
    expect(region()).toBeEmptyDOMElement();
    expect(screen.queryByText('No results found')).toBeNull();
    expect(screen.queryByText('Searching…')).toBeNull();
  });

  it('keeps the SAME NODE across empty -> loading -> results -> closed', () => {
    // Node IDENTITY, not presence at each state. A region torn down and rebuilt between
    // states is the same defect wearing a passing presence check — this is the shape
    // `useConfirmAction.ts:162-180` records as REJECTED ALTERNATIVE 1.
    const { rerender } = render(<Controlled open={false} />);
    const node = region();
    expect(node).toBeEmptyDOMElement();

    rerender(<Controlled items={[]} loading />);
    expect(region()).toBe(node);
    expect(node).toHaveTextContent('Searching');

    rerender(<Controlled items={[]} />);
    expect(region()).toBe(node);
    expect(node).toHaveTextContent('No results found');

    rerender(<Controlled />);
    expect(region()).toBe(node);
    expect(node).toHaveTextContent('3 results available');

    rerender(<Controlled open={false} />);
    expect(region()).toBe(node);
    expect(node).toBeEmptyDOMElement();
  });

  it('announces the RESULT COUNT, which the visible popover never shows', () => {
    render(<Controlled />);
    expect(region()).toHaveTextContent('3 results available');
    // `Combobox.tsx`'s visible `status` still yields null at one-or-more results: the count
    // is the sr-only region's business alone. Asserted against the EXACT announcement, not
    // /result/i — the fixture's own group heading is literally "BGG results", so the loose
    // regex would red on correct code.
    const popover = screen.getByRole('listbox').parentElement as HTMLElement;
    expect(popover.textContent).not.toContain('3 results available');
    expect(popover.textContent).not.toMatch(/No results found|Searching/);
  });

  it('singularises the count (one result, not "1 results")', () => {
    render(<Controlled items={[makeItems()[0]]} />);
    expect(region()).toHaveTextContent('1 result available');
  });

  it('takes a caller-supplied count formatter (all strings are props with defaults)', () => {
    render(<Controlled countLabel={(n: number) => `${n} matches`} />);
    expect(region()).toHaveTextContent('3 matches');
  });

  it('renders exactly ONE live region in its own tree, and NONE inside the popover', () => {
    // Scoped to this component, NOT a global invariant: `userProfile/page.js` legitimately
    // renders two regions on its own host page.
    const { container } = render(<Controlled items={[]} />);
    expect(container.querySelectorAll('[role="status"], [role="alert"]')).toHaveLength(1);
    const popover = screen.getByRole('listbox').parentElement as HTMLElement;
    expect(popover.querySelectorAll('[role="status"], [role="alert"]')).toHaveLength(0);
  });

  it('the visible empty row survives as PLAIN TEXT inside the popover (not aria-hidden)', () => {
    // Removing the role must NOT hide the row from browse mode — that would regress the
    // sighted screen-reader user who can see it. Scoped with `within(popover)` because the
    // sr-only region carries the SAME string, which is the point: one node speaks it, the
    // other shows it.
    render(<Controlled items={[]} />);
    const popover = screen.getByRole('listbox').parentElement as HTMLElement;
    const row = within(popover).getByText('No results found');
    expect(row).not.toHaveAttribute('role');
    expect(row).not.toHaveAttribute('aria-live');
    expect(row.closest('[aria-hidden="true"]')).toBeNull();
  });

  it('derives the announcement INLINE — no new useState/useEffect in the source', async () => {
    // An ADDITION to the node-identity arm above, which it does not replace: identity
    // catches a region torn down and rebuilt; it does NOT catch a state-write that keeps
    // the node and doubles the render on every text change.
    const source = await import('node:fs/promises').then((fs) =>
      fs.readFile('src/components/ui/Combobox.tsx', 'utf8')
    );
    const stripped = source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
    expect(stripped.match(/useState/g) ?? []).toHaveLength(1); // the pre-existing activeIndex
    expect(stripped.match(/useEffect/g) ?? []).toHaveLength(0);
  });
});
