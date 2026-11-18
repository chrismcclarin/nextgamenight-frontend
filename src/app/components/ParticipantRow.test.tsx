// Phase 88-33 Task 2 (WI-F2) — ParticipantRow's own contract.
//
// The M5 clobber had TWO halves: a stale-closure parent AND a row that fired two
// updates in one tick. createEvent.participants.test.tsx pins the user-visible
// outcome; this file pins the row's half of the mechanism directly, so a future
// refactor that re-splits the atomic patch fails HERE with a precise message
// rather than as a mysterious typing bug two files away.
import * as React from 'react';
import { render, screen, cleanup, fireEvent, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import ParticipantRow from './ParticipantRow';

const MEMBERS = [
  { id: 'uuid-alice', username: 'Alice', email: 'alice@example.com' },
  { id: 'uuid-bob', username: 'Bob', email: 'bob@example.com' },
];

function renderRow(overrides: Record<string, unknown> = {}) {
  const onParticipantChange = vi.fn();
  const onToggleParticipant = vi.fn();
  render(
    <ParticipantRow
      participant={{ user_id: '', username: '', score: null, faction: '', isFromGroup: false }}
      index={2}
      groupMembers={MEMBERS}
      onParticipantChange={onParticipantChange}
      onToggleParticipant={onToggleParticipant}
      {...overrides}
    />
  );
  return { onParticipantChange, onToggleParticipant };
}

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe('name edits are ONE atomic patch (M5 mechanism)', () => {
  it('emits a single call carrying username AND the resolved user_id on a member match', () => {
    const { onParticipantChange } = renderRow();
    fireEvent.change(screen.getByLabelText('Participant Name'), { target: { value: 'Alice' } });

    expect(onParticipantChange).toHaveBeenCalledTimes(1);
    expect(onParticipantChange).toHaveBeenCalledWith(2, {
      username: 'Alice',
      user_id: 'uuid-alice',
    });
  });

  it('also emits a SINGLE call on the no-match branch (it double-fired too)', () => {
    const { onParticipantChange } = renderRow({
      participant: { user_id: 'uuid-alice', username: 'Alice', isFromGroup: false },
    });
    fireEvent.change(screen.getByLabelText('Participant Name'), { target: { value: 'Alice1' } });

    expect(onParticipantChange).toHaveBeenCalledTimes(1);
    expect(onParticipantChange).toHaveBeenCalledWith(2, { username: 'Alice1', user_id: '' });
  });

  it('still emits field-shaped calls for the other controls', () => {
    const { onParticipantChange } = renderRow();
    fireEvent.change(screen.getByLabelText('Score'), { target: { value: '7' } });
    expect(onParticipantChange).toHaveBeenCalledWith(2, 'score', '7');
  });
});

describe('duplicate-name hint (triage A1)', () => {
  it('renders the hint and wires it as the input description', () => {
    renderRow({
      participant: { user_id: '', username: 'Gary', isFromGroup: false },
      duplicateOfName: 'Gary',
    });
    const hint = screen.getByText("Heads up: there's already a participant named Gary.");
    expect(hint).toBeInTheDocument();
    expect(screen.getByLabelText('Participant Name')).toHaveAttribute(
      'aria-describedby',
      hint.id
    );
  });

  it('keeps the live region mounted-but-empty when there is no duplicate', () => {
    renderRow();
    // Empty-first contract (StatusRegion.tsx): a region that mounts WITH its
    // message announces nothing.
    expect(screen.getByRole('status')).toHaveTextContent('');
    expect(screen.getByLabelText('Participant Name')).not.toHaveAttribute('aria-describedby');
    // D-22 (Phase 88.6.1-06): the empty hint is sr-only, so its mt-1 (the spacing
    // WHEN SHOWN) reserves no 4px under the name line of every custom row.
    expect(screen.getByRole('status')).toHaveClass('sr-only');
    expect(screen.getByRole('status')).toHaveClass('mt-1');
  });

  it('D-22: the hint is shown and hidden on the SAME node, and stays the input description while shown', () => {
    // duplicateOfName rides a Record spread, as in renderRow: the JS component's
    // inferred prop type pins it to its null default.
    const row = (dup: string | null) => (
      <ParticipantRow
        participant={{ user_id: '', username: 'Gary', isFromGroup: false }}
        index={2}
        groupMembers={MEMBERS}
        onParticipantChange={vi.fn()}
        onToggleParticipant={vi.fn()}
        {...({ duplicateOfName: dup } as Record<string, unknown>)}
      />
    );
    const { rerender } = render(row(null));
    const hint = screen.getByRole('status');
    expect(hint).toHaveClass('sr-only');
    expect(hint).toHaveTextContent('');

    rerender(row('Gary'));
    expect(screen.getByRole('status')).toBe(hint);
    expect(hint).not.toHaveClass('sr-only');
    expect(hint).toHaveClass('mt-1');
    expect(hint).toHaveTextContent("Heads up: there's already a participant named Gary.");
    expect(screen.getByLabelText('Participant Name')).toHaveAttribute('aria-describedby', hint.id);

    rerender(row(null));
    expect(screen.getByRole('status')).toBe(hint);
    expect(hint).toHaveClass('sr-only');
    expect(hint).toHaveTextContent('');
  });
});

describe('the dead invite affordance is gone (step 4b disposition)', () => {
  it('renders no Invite-to-group control even for a guest row', () => {
    renderRow({
      participant: { user_id: '', username: 'Gina', is_guest: true, isFromGroup: false },
    });
    expect(screen.queryByRole('button', { name: /invite/i })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Remove' })).toBeInTheDocument();
  });
});

// 88-33 Task 6 (fork 2, RULED 2026-08-17): entry-time cap + wrap-not-truncate layout.
describe('name cap + long-name layout (WI-F6)', () => {
  const FIFTY = 'A'.repeat(50);

  it('caps the participant name input at 50 characters (fork 2 — person cap)', () => {
    renderRow();
    expect(screen.getByLabelText('Participant Name')).toHaveAttribute('maxlength', '50');
  });

  it('renders a max-length member name in FULL — inline flow, no truncation class', () => {
    renderRow({
      participant: {
        user_id: 'uuid-alice',
        username: FIFTY,
        is_guest: true,
        isFromGroup: true,
      },
    });
    const nameNode = screen.getByText(FIFTY, { exact: false });
    // Wrap-in-full, never truncate: the display container breaks words and
    // carries NO truncate/ellipsis class anywhere up the chain.
    const container = nameNode.closest('div')!;
    expect(container.className).toContain('break-words');
    expect(container.className).not.toContain('truncate');
    // Inline flow (not flex): the Guest pill is a text-flow sibling that rides
    // after the last word instead of dropping to its own flex line.
    expect(container.className).not.toContain('flex');
    const pill = screen.getByText('Guest');
    expect(pill.parentElement).toBe(container);
    expect(pill.className).toContain('align-middle');
  });

  it('the action cluster meets the 44px floor (min-h-11 — same-plan consistency with Task 5)', () => {
    renderRow();
    expect(screen.getByRole('button', { name: 'Remove' }).className).toContain('min-h-11');
  });
});

// Phase 88.6-29 task 3 — the R2 / §4.5 sweep outcomes for this row, pinned so a later
// "consistency" pass cannot quietly put them back.
describe('Phase 88.6-29 — the type/weight sweep outcomes', () => {
  it("the read-only participant NAME is the row's ONE primary string at Body 16", () => {
    renderRow({
      participant: { user_id: 'uuid-alice', username: 'Alice', isFromGroup: true },
    });
    const container = screen.getByText('Alice', { exact: false }).closest('div')!;
    // §4.3's primary-string clause, and the convergence argument: the EDITABLE twin is the
    // `Input` primitive, which authors no size utility and therefore already renders at body
    // size, so a member row and a custom row printed the same name at two sizes before this.
    expect(container.className).toContain('text-base');
    expect(container.className).not.toContain('text-sm');
  });

  it('the Guest chip carries the 700 pill/chip ink on BOTH branches, at Caption 12', () => {
    renderRow({
      participant: { user_id: 'uuid-alice', username: 'Alice', isFromGroup: true, is_guest: true },
    });
    const memberPill = screen.getByText('Guest');
    // §4.5's pill/chip row: 400 is REJECTED for a filled chip (the fill/ink pairing needs the
    // weight); 12px stays, because badge labels are an enumerated Caption role.
    expect(memberPill.className).toContain('font-bold');
    expect(memberPill.className).not.toContain('font-medium');
    expect(memberPill.className).toContain('text-xs');
    cleanup();

    renderRow({
      participant: { user_id: '', username: 'Casey', isFromGroup: false, is_guest: true },
    });
    const customPill = screen.getByText('Guest');
    expect(customPill.className).toContain('font-bold');
    expect(customPill.className).not.toContain('font-medium');
    expect(customPill.className).toContain('text-xs');
  });
});

// Phase 88.9-34 (owner pick C5a, 88.9-PICKS-B2.json item C5): the row's form labels
// (Participant Name as span or label, New Player, Score, Faction) step up
// from Caption 12 to Label 14 with their shipped inks unchanged. The two Guest badges and the
// duplicate-name hint stay Caption 12 (the test above pins the badges). The one-line geometry
// at 375 is pinned in e2e/participant-row-one-line.spec.ts.
// AMENDED Phase 88.9-65 (X40): New Player renders ONCE per row now (the from-sm twin is gone), so a
// row holds four labels, not five; the title follows.
describe('C5a (88.9) — the form labels on Label 14', () => {
  it('C5a (88.9): the four form labels are 14px', () => {
    const labelTexts = ['Participant Name', 'New Player', 'Score', 'Faction'];
    const readLabels = () => labelTexts.flatMap((text) => screen.getAllByText(text, { exact: true }));

    // A member row: Participant Name is a span; New Player is one span inside its label.
    renderRow({
      participant: { user_id: 'uuid-alice', username: 'Alice', isFromGroup: true },
    });
    const memberLabels = readLabels();
    expect(memberLabels).toHaveLength(4);
    for (const el of memberLabels) {
      expect(el.className.split(/\s+/), el.textContent ?? '').toContain('text-sm');
      expect(el.className.split(/\s+/), el.textContent ?? '').not.toContain('text-xs');
    }
    cleanup();

    // A custom row: Participant Name is a label tied to the editable name input.
    renderRow();
    const customLabels = readLabels();
    expect(customLabels).toHaveLength(4);
    for (const el of customLabels) {
      expect(el.className.split(/\s+/), el.textContent ?? '').toContain('text-sm');
      expect(el.className.split(/\s+/), el.textContent ?? '').not.toContain('text-xs');
    }
  });
});

// Phase 88.9-65 (owner fix rows 52-X40 with its addendum, and 52-X43).
// X40, owner at N32: "What do you think of putting the new player text and the box on the same
// line as participant name, but right justified?" The row used to hold TWO checkboxes for one
// value, each hidden at one width; the phone one measured 90 by 20 at 375, under the 24px floor.
// There is now ONE, on the Participant Name line at every width, and its label is a real 44px box.
// X43, owner: "'participant name' is a different color than 'Score' 'Faction' and 'new player'".
// All four labels read the primary ink, the one UI-SPEC row R2-14 measured for this row.
// jsdom lays nothing out: the 44 by 44 box and the shared line at 375 are the phone spec's.
// AMENDED Phase 88.9-52 (R15b, owner 2026-11-17): the 44px box is kept BELOW md only (max-md:min-h-11
// / max-md:min-w-11); from md up the label is compact so the line is one text line. Still ONE checkbox.
// AMENDED Phase 88.9-52 (R4 D6, owner page pick G6 = C, 2026-11-18): the one-line layout starts at sm
// (640px), so the 44px box is kept below sm (max-sm:min-h-11 / max-sm:min-w-11) and the label is
// compact from sm.
describe('X40 + X43 (88.9-65) — one New Player box, one label ink', () => {
  it('X40 + X43 (88.9-65): one New Player checkbox per row with no width-gated twin, its label a 44px box below sm on the Participant Name line, and the four labels share text-content-primary', () => {
    const tokensOf = (el: Element) => (el.getAttribute('class') ?? '').split(/\s+/).filter((token) => token.length > 0);
    const rows: Array<[string, Record<string, unknown>]> = [
      ['a member row', { participant: { user_id: 'uuid-alice', username: 'Alice', isFromGroup: true } }],
      ['a custom row', {}],
    ];
    for (const [what, overrides] of rows) {
      const { onParticipantChange } = renderRow(overrides);

      // ONE checkbox, named by its label.
      const boxes = screen.getAllByRole('checkbox');
      expect(boxes, `${what}: one checkbox in the row`).toHaveLength(1);
      const box = screen.getByRole('checkbox', { name: 'New Player' });
      expect(box).toBe(boxes[0]);
      expect(box.id, `${what}: the surviving box carries the row's own new-player id`).toMatch(/-new-player$/);

      // No width-gated twin: nothing from the box up to the row hides or shows by breakpoint.
      for (let el: Element | null = box; el; el = el.parentElement) {
        const gated = tokensOf(el).filter((token) => token === 'hidden' || /^(sm|md|lg|xl):(hidden|flex|block|inline-flex)$/.test(token));
        expect(gated, `${what}: ${el.tagName.toLowerCase()} carries a width-gated visibility class`).toEqual([]);
        if (tokensOf(el).includes('border-line-strong')) break;
      }

      // Its label is a real box (the house 44px floor), on the Participant Name line.
      const label = box.closest('label');
      expect(label, `${what}: the checkbox sits inside its label`).not.toBeNull();
      expect(tokensOf(label as Element)).toEqual(expect.arrayContaining(['inline-flex', 'items-center', 'max-sm:min-h-11', 'max-sm:min-w-11', 'gap-2', 'sm:gap-1.5']));
      // R15b, then D6: compact from sm up, so no unconditional floor and no md-gated one may survive on the label.
      expect(tokensOf(label as Element).filter((token) => /^(max-)?md:/.test(token))).toEqual([]);
      expect(tokensOf(label as Element)).not.toContain('min-h-11');
      expect(tokensOf(label as Element)).not.toContain('min-w-11');
      const line = (label as Element).parentElement as HTMLElement;
      expect(tokensOf(line)).toEqual(expect.arrayContaining(['flex', 'items-center', 'justify-between', 'mb-1']));
      const nameLabel = screen.getByText('Participant Name', { exact: true });
      expect(nameLabel.parentElement, `${what}: New Player shares the Participant Name line`).toBe(line);

      // One ink on the four labels.
      for (const text of ['Participant Name', 'New Player', 'Score', 'Faction']) {
        const found = screen.getAllByText(text, { exact: true });
        expect(found, `${what}: ${text} renders once`).toHaveLength(1);
        expect(tokensOf(found[0]), `${what}: ${text}`).toContain('text-content-primary');
        expect(tokensOf(found[0]), `${what}: ${text}`).not.toContain('text-content-secondary');
      }

      // It still writes the one value.
      fireEvent.click(box);
      expect(onParticipantChange).toHaveBeenCalledWith(2, 'is_new_player', true);
      cleanup();
    }
  });
});

// Phase 88.9-52, R15c (owner pick "Field", 2026-11-17): the three boxes of the row share the type-in
// field look, the house Input's (rounded-btn, border-input, bg-surface-input, p-2). Score and Faction
// drop their p-1 override; the read-only member name box takes the same look and stays a plain div.
// jsdom lays nothing out: the 42px heights are computed from the classes (16px text at 1.5 = 24, plus
// 16 padding, plus 2 border), not measured here.
describe('R15c (88.9-52) — the three boxes take the type-in field look', () => {
  const tokensOf = (el: Element) => (el.getAttribute('class') ?? '').split(/\s+/).filter((token) => token.length > 0);
  const FIELD_LOOK = ['p-2', 'rounded-btn', 'border', 'border-input', 'bg-surface-input', 'text-base', 'text-content-primary'];

  it('R15c (88.9-52): Score and Faction are the house Input with its own padding, no p-1 override', () => {
    renderRow();
    for (const name of ['Score', 'Faction']) {
      const tokens = tokensOf(screen.getByLabelText(name));
      expect(tokens, name).toEqual(expect.arrayContaining(FIELD_LOOK));
      expect(tokens, name).not.toContain('p-1');
    }
    expect(tokensOf(screen.getByLabelText('Score'))).toContain('w-16');
  });

  it('R15c (88.9-52): the read-only member name box wears the same look and is still not a control', () => {
    renderRow({ participant: { user_id: 'uuid-alice', username: 'Alice', isFromGroup: true } });
    const box = screen.getByText('Alice', { exact: false }).closest('div')!;
    const tokens = tokensOf(box);
    expect(tokens).toEqual(expect.arrayContaining(FIELD_LOOK));
    for (const old of ['border-line', 'rounded-sm', 'bg-surface-elevated']) {
      expect(tokens, old).not.toContain(old);
    }
    expect(box.tagName).toBe('DIV');
    expect(box).not.toHaveAttribute('tabindex');
    expect(box).not.toHaveAttribute('role');
    expect(screen.queryByRole('textbox', { name: 'Participant Name' })).toBeNull();
  });

  // R4 D9 (88.9-52, owner pick Lock, an INTERIM, 2026-11-18): the read-only member name box and
  // the editable hand-typed one looked the same. The read-only box now carries a small lock at
  // its right inside edge, in the muted ink, decorative (no new visible or spoken string). The
  // name keeps 2rem on that side so a long name never runs under the icon. The editable box is
  // unchanged. The marker is at src/app/components/ParticipantRow.js ("DECISION Phase 88.9-52 (R15c, owner 2026-11-18): a lock icon").
  it('R4 D9 (88.9-52): the read-only member name box carries a decorative lock at its right inside edge; the editable name box does not', () => {
    renderRow({ participant: { user_id: 'uuid-alice', username: 'Alice', isFromGroup: true } });
    const box = screen.getByText('Alice', { exact: false }).closest('div')!;
    expect(tokensOf(box)).toEqual(expect.arrayContaining(['relative', 'pr-8', ...FIELD_LOOK]));
    const locks = box.querySelectorAll('svg');
    expect(locks).toHaveLength(1);
    const lock = locks[0];
    expect(lock).toHaveAttribute('aria-hidden', 'true');
    expect(lock).not.toHaveAttribute('role');
    expect(lock).not.toHaveAttribute('aria-label');
    expect(lock.querySelector('title')).toBeNull();
    expect((lock.getAttribute('class') ?? '').split(/\s+/)).toEqual(
      expect.arrayContaining(['lucide-lock', 'absolute', 'right-2', 'top-1/2', '-translate-y-1/2', 'w-4', 'h-4', 'text-content-muted', 'pointer-events-none']),
    );
    // Nothing new is read or shown: the box's words are the name alone, and it is still no control.
    expect(box.textContent).toBe('Alice');
    expect(box).not.toHaveAttribute('tabindex');
    expect(within(box).queryByRole('button')).toBeNull();
    expect(within(box).queryByRole('img')).toBeNull();
    cleanup();

    // The hand-typed row: a real text box, no lock anywhere in the name column.
    renderRow({ participant: { user_id: '', username: 'Sam', isFromGroup: false } });
    const input = screen.getByRole('textbox', { name: 'Participant Name' });
    expect(tokensOf(input)).not.toContain('pr-8');
    const row = input.closest('.border-line-strong') as HTMLElement;
    expect(row.querySelectorAll('svg')).toHaveLength(0);
  });
});

// Phase 88.9-52, R15b (owner pick "As is", 2026-11-17; mock one-line-remove-as-is, and phone-two-line).
// From md up: Participant Name, Score and Faction on ONE line, every label a block 4px above its box
// (mb-1), the columns top-aligned so the three boxes sit level (same 20px label line, same 42px box),
// Remove left at 44px and bottom-aligned with Score and Faction. Below md the row keeps two lines.
// jsdom lays nothing out, so these are class pins; the measured sizes are the capture's (report j, row E).
// AMENDED Phase 88.9-52 (R4 D6, owner page pick G6 = C, 2026-11-18): the one-line layout is taken from
// sm (640px) in place of md. The capture's mock at 700 measured the name box about 335px, Score 64px,
// Faction 96px, Remove 44px tall, rows 83px, labels 4px above the boxes, box bottoms level with
// Remove. Every md: class on the row became sm:, and the three type-in boxes drop the Input's phone
// floor from sm (42px, level with the read-only name box) and keep it below sm (44px).
describe('R15b (88.9-52) — one line from sm up (R4 D6; from md until then), labels 4px above their boxes', () => {
  const tokensOf = (el: Element) => (el.getAttribute('class') ?? '').split(/\s+/).filter((token) => token.length > 0);

  it('R15b + R4 D6 (88.9-52): the row is one line from sm, two lines below it, and nothing is gated at md', () => {
    for (const overrides of [{}, { participant: { user_id: 'uuid-alice', username: 'Alice', isFromGroup: true } }]) {
      renderRow(overrides);
      const remove = screen.getByRole('button', { name: 'Remove' });
      const row = remove.closest('.border-line-strong') as HTMLElement;
      expect(tokensOf(row)).toEqual(expect.arrayContaining(['flex', 'flex-col', 'sm:flex-row', 'sm:items-start', 'gap-2', 'sm:gap-4']));
      // Nothing in the row is left on the md breakpoint, in either direction, except the Input
      // primitive's own phone floor, which each box switches off again (read below).
      const mdGated = [row, ...Array.from(row.querySelectorAll('*'))].flatMap((el) =>
        tokensOf(el).filter((token) => /^(max-)?md:/.test(token)),
      );
      expect(mdGated.filter((token) => token !== 'max-md:min-h-0')).toEqual([]);
      // The type-in boxes: 44px below sm, the Input's own 42px from sm (level with the read-only name box).
      for (const input of Array.from(row.querySelectorAll('input:not([type="checkbox"])'))) {
        expect(tokensOf(input), input.id).toEqual(expect.arrayContaining(['max-md:min-h-0', 'max-sm:min-h-11']));
        expect(tokensOf(input), input.id).not.toContain('max-md:min-h-11');
      }
      const name = row.firstElementChild as HTMLElement;
      expect(tokensOf(name)).toEqual(['sm:flex-1', 'sm:min-w-0']);

      const score = screen.getByLabelText('Score');
      const controls = score.parentElement!.parentElement as HTMLElement;
      expect(controls.parentElement).toBe(row);
      expect(tokensOf(controls)).toEqual(expect.arrayContaining(['flex', 'flex-wrap', 'sm:flex-nowrap', 'items-end', 'gap-2', 'sm:gap-4']));
      const faction = screen.getByLabelText('Faction');
      expect(tokensOf(faction)).toEqual(expect.arrayContaining(['w-full', 'sm:w-24']));
      expect(tokensOf(faction.parentElement as HTMLElement)).toEqual(['flex-1', 'min-w-24', 'sm:flex-none']);
      expect(tokensOf(remove.parentElement as HTMLElement)).toEqual(['flex', 'gap-2', 'ml-auto', 'sm:ml-0']);
      expect(controls.contains(remove)).toBe(true);
      // Remove is left as it is: the 44px floor at every width.
      expect(tokensOf(remove)).toContain('min-h-11');
      cleanup();
    }
  });

  it('R15b (88.9-52): Score and Faction labels are blocks 4px above their boxes at every width', () => {
    renderRow();
    for (const text of ['Score', 'Faction']) {
      const label = screen.getByText(text, { exact: true });
      expect(label.tagName).toBe('LABEL');
      expect(tokensOf(label), text).toEqual(expect.arrayContaining(['block', 'mb-1']));
    }
  });
});
