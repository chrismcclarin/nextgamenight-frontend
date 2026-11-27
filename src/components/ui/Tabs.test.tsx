// Contract pins for the <Tabs> compound primitive (Req 5, UI-SPEC §8.4).
//
// The hand-rolled availability tab strip this replaces (`userProfile/page.js`) is two
// styled <button>s and a ternary: no `tablist`, no `tab`, no `aria-selected`, no
// `tabpanel`, and no roving tabindex. So these pins assert ROLES AND KEYBOARD, not
// classes, wherever possible — a regression to styled buttons must fail here even if it
// looks pixel-identical.
//
//   1. `tablist` / `tab` + `aria-selected` / `tabpanel` come from Radix; no app ARIA.
//   2. Arrow keys move selection (Radix roving tabindex — the thing everyone hand-rolls
//      wrong, or more often omits entirely).
//   3. Selection is carried by COLOUR + a 2px underline, never a font-weight bump: 600 is
//      Button-only (§4.2) and a weight change re-measures every trigger, jiggling the
//      strip. The `font-semibold` pin exists so a later phase cannot quietly add one.
//   4. The strip scrolls at 375px and never wraps; triggers clear the 44px phone floor.
//   5. axe-clean.
import * as React from 'react';
import { render, screen, cleanup } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it } from 'vitest';
import { axe } from 'vitest-axe';
import { Tabs, TabsList, TabsTrigger, TabsContent } from './Tabs';
import { expectFocusRing, expectFocusRingInset } from '@/test-utils/focusRingAssert';

afterEach(cleanup);

function renderTabs() {
  return render(
    <Tabs defaultValue="recurring">
      <TabsList aria-label="Availability settings">
        <TabsTrigger value="recurring">Schedules</TabsTrigger>
        <TabsTrigger value="specific">Specific Dates</TabsTrigger>
      </TabsList>
      <TabsContent value="recurring">Availability Schedules</TabsContent>
      <TabsContent value="specific">Specific Dates panel</TabsContent>
    </Tabs>
  );
}

describe('Tabs', () => {
  it('exposes tablist / tab / aria-selected / tabpanel', () => {
    renderTabs();

    expect(screen.getByRole('tablist')).toBeInTheDocument();
    const tabs = screen.getAllByRole('tab');
    expect(tabs).toHaveLength(2);
    expect(tabs[0]).toHaveAttribute('aria-selected', 'true');
    expect(tabs[1]).toHaveAttribute('aria-selected', 'false');
    expect(screen.getByRole('tabpanel')).toHaveTextContent(
      'Availability Schedules'
    );
  });

  it('moves selection with arrow keys (roving tabindex)', async () => {
    const user = userEvent.setup();
    renderTabs();
    const [first, second] = screen.getAllByRole('tab');

    await user.tab();
    expect(first).toHaveFocus();

    await user.keyboard('{ArrowRight}');
    expect(second).toHaveFocus();
    expect(second).toHaveAttribute('aria-selected', 'true');
    expect(first).toHaveAttribute('aria-selected', 'false');
    expect(screen.getByRole('tabpanel')).toHaveTextContent(
      'Specific Dates panel'
    );

    await user.keyboard('{ArrowLeft}');
    expect(first).toHaveFocus();
    expect(first).toHaveAttribute('aria-selected', 'true');
  });

  it('selects on click', async () => {
    const user = userEvent.setup();
    renderTabs();
    await user.click(screen.getByRole('tab', { name: 'Specific Dates' }));
    expect(screen.getByRole('tab', { name: 'Specific Dates' })).toHaveAttribute(
      'aria-selected',
      'true'
    );
  });

  it('marks the active tab with colour + an underline, never a weight bump', () => {
    renderTabs();
    const [active, inactive] = screen.getAllByRole('tab');

    // Same class string on both — the difference is resolved by `data-[state=active]:`,
    // so the pin is that the ACTIVE treatment is colour + border, not weight.
    expect(active.className).toContain('data-[state=active]:text-content-primary');
    expect(active.className).toContain('data-[state=active]:border-line-accent');
    expect(active.className).toContain('border-b-2');
    expect(inactive.className).toContain('text-content-secondary');

    for (const tab of [active, inactive]) {
      expect(tab.className).not.toMatch(/font-(semibold|bold|medium)/);
      expect(tab.className).toContain('font-normal');
    }
  });

  it('scrolls horizontally at phone width and never wraps', () => {
    renderTabs();
    const list = screen.getByRole('tablist');
    expect(list).toHaveClass('overflow-x-auto');
    expect(list.className).not.toMatch(/flex-wrap/);
    expect(screen.getAllByRole('tab')[0].className).toMatch(/whitespace-nowrap/);
  });

  // 88.9-68 (X54, owner at N37: a scroll bar on the strip that cannot scroll). A box that scrolls
  // sideways scrolls vertically too, so the strip must hold nothing taller than itself: the
  // baseline is drawn inside the list's own box and the triggers carry no negative margin. The
  // same box clips an outset focus ring, so the trigger's ring is inset.
  it("X54 (88.9-68): the strip draws its baseline inside the list, triggers carry no negative bottom margin, overflow-x-auto stays (scroll, never wrap), and the trigger's focus ring is inset", () => {
    renderTabs();
    const list = screen.getByRole('tablist');
    const listClasses = list.className.split(/\s+/);
    expect(listClasses).toContain('overflow-x-auto');
    expect(list.className).not.toMatch(/flex-wrap/);
    // No border of its own: the baseline is an inset shadow on the line token, never a raw value.
    expect(listClasses.filter((c) => c === 'border-b' || c.startsWith('border-'))).toEqual([]);
    const baseline = listClasses.filter((c) => c.startsWith('inset-shadow-'));
    expect(baseline).toHaveLength(1);
    expect(baseline[0]).toContain('var(--color-border)');
    expect(baseline[0]).not.toMatch(/#[0-9a-fA-F]{3,8}|rgb/);

    for (const tab of screen.getAllByRole('tab')) {
      const classes = tab.className.split(/\s+/);
      expect(classes).not.toContain('-mb-px');
      expect(classes.filter((c) => /^-?m[tby]?-/.test(c))).toEqual([]);
      expect(classes).toContain('border-b-2');
      expect(classes).toContain('shrink-0');
      expect(classes).toContain('whitespace-nowrap');
      expectFocusRingInset(classes, tab.textContent ?? '');
      expect(classes.filter((c) => c.startsWith('focus-visible:ring-offset-'))).toEqual([]);
    }
  });

  it('clears the 44px phone touch floor on every trigger', () => {
    renderTabs();
    for (const tab of screen.getAllByRole('tab')) {
      expect(tab).toHaveClass('min-h-11');
    }
  });

  it('uses a focus-visible ring and no bare focus: ring utility', () => {
    renderTabs();
    const tab = screen.getAllByRole('tab')[0];
    expectFocusRingInset(tab, 'the first tab');
    expect(tab.className).not.toMatch(/(^|\s)focus:(ring|border|bg)/);
  });

  it('carries no raw palette classes (semantic tokens only in ui/)', () => {
    renderTabs();
    const nodes = [
      screen.getByRole('tablist'),
      ...screen.getAllByRole('tab'),
      screen.getByRole('tabpanel'),
    ];
    for (const node of nodes) {
      expect(node.className).not.toMatch(
        /(red|green|amber|purple|warm|gray|slate)-[0-9]/
      );
    }
  });

  it('forwards refs and merges consumer classes on every part', () => {
    const listRef = React.createRef<HTMLDivElement>();
    const triggerRef = React.createRef<HTMLButtonElement>();
    const contentRef = React.createRef<HTMLDivElement>();

    render(
      <Tabs defaultValue="a">
        <TabsList ref={listRef} aria-label="Sections" className="mb-4">
          <TabsTrigger ref={triggerRef} value="a" className="px-6">
            A
          </TabsTrigger>
        </TabsList>
        <TabsContent ref={contentRef} value="a" className="pt-2">
          Panel A
        </TabsContent>
      </Tabs>
    );

    expect(listRef.current).toBe(screen.getByRole('tablist'));
    expect(triggerRef.current).toBe(screen.getByRole('tab'));
    expect(contentRef.current).toBe(screen.getByRole('tabpanel'));
    expect(listRef.current).toHaveClass('mb-4');
    expect(listRef.current).toHaveClass('overflow-x-auto');
    expect(triggerRef.current).toHaveClass('px-6');
    expect(contentRef.current).toHaveClass('pt-2');
  });

  // Phase 89.6-31, census row E-17 (outline rule 10, G1): the panel takes keyboard focus and paints
  // no fill, so its corner shows only as the corner of its ring. The rendered ring is read on the
  // Profile availability panel by e2e/focus-ring-geometry.spec.ts ("the Schedules tab panel").
  it('89.6-31 E-17: the panel carries the outset house ring and one radius class', () => {
    renderTabs();
    const panel = screen.getByRole('tabpanel');
    expectFocusRing(panel, 'the tab panel');
    const tokens = (panel.getAttribute('class') ?? '').split(/\s+/);
    expect(tokens.filter((token) => /^rounded(-|$)/.test(token))).toEqual(['rounded-sm']);
  });

  it('passes an axe audit with no violations', async () => {
    const { container } = renderTabs();
    expect(await axe(container)).toHaveNoViolations();
  });
});
