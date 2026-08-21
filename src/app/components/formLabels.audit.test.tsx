// 88-33 Task 8 (WI-F8, fork 5 house rule) — render-audit, NOT a grep.
//
// The owner's DevTools census (UAT row ~482, 2026-08-10) found ~19 sightings in
// three classes: broken label[for] (red-tag), unassociated visible labels, and
// missing id/name (the autofill heuristic). Fork 5 RULED the house rule:
// id + name + an associated label on every form field; aria-label alone only
// where a visible label genuinely can't exist. This suite renders the census
// surfaces that mount cheaply and audits every actual form control in the DOM —
// so a regression fails here as "this control lost its name/id", not as a stale
// regex. The heavier surfaces (createEvent, GroupSettings, ManageMembers,
// FriendInvitePanel, userProfile, friends) carry the same fixes; their own
// suites + 88.6's composed axe audits are the recurrence backstop there.
import * as React from 'react';
import { render, cleanup } from '@testing-library/react';
import { useForm } from 'react-hook-form';
import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn() }),
  useSearchParams: () => new URLSearchParams(''),
}));

vi.mock('@/lib/api', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/api')>();
  return {
    ...actual,
    groupsAPI: {
      ...actual.groupsAPI,
      getGroupLibrary: vi.fn().mockResolvedValue({
        games: [{ id: 'g1', name: 'Catan', min_players: 3, max_players: 4, playing_time: 60 }],
        members: [],
      }),
    },
    suggestionsAPI: {
      ...actual.suggestionsAPI,
      getGroupSuggestions: vi.fn().mockResolvedValue({ suggestions: [] }),
      getEventSuggestions: vi.fn().mockResolvedValue({ suggestions: [] }),
    },
  };
});

import GroupGamesListJs from './GroupGamesList';
import GroupLibrary from './GroupLibrary';
import BrowseMoreModalJs from './BrowseMoreModal';
import StartPollModalJs from './StartPollModal';
import MemberSelector from './MemberSelector';
import ParticipantRow from './ParticipantRow';

// JS components: inferred prop types mark every prop required / mis-shaped.
// Cast so the harness passes only what the audit exercises (createGroup.test idiom).
type AnyComponent = React.ComponentType<Record<string, unknown>>;
const GroupGamesList = GroupGamesListJs as unknown as AnyComponent;
const BrowseMoreModal = BrowseMoreModalJs as unknown as AnyComponent;
const StartPollModal = StartPollModalJs as unknown as AnyComponent;

afterEach(cleanup);

/**
 * The fork-5 audit: every rendered, non-hidden form control must carry
 * (a) an `id`, (b) a `name`, and (c) an accessible-name source — a `label[for]`
 * pointing at it, a wrapping <label>, `aria-label`, or `aria-labelledby`.
 */
function auditFormControls(root: HTMLElement) {
  const controls = Array.from(
    root.querySelectorAll<HTMLElement>('input, select, textarea')
  ).filter((el) => (el as HTMLInputElement).type !== 'hidden');
  expect(controls.length).toBeGreaterThan(0); // an empty audit proves nothing

  const failures: string[] = [];
  for (const el of controls) {
    const describe = `${el.tagName.toLowerCase()}#${el.id || '?'}[name=${el.getAttribute('name') || '?'}]`;
    if (!el.id) failures.push(`${describe}: missing id`);
    if (!el.getAttribute('name')) failures.push(`${describe}: missing name attribute`);
    const labelled =
      el.getAttribute('aria-label') ||
      el.getAttribute('aria-labelledby') ||
      el.closest('label') ||
      (el.id && root.querySelector(`label[for="${CSS.escape(el.id)}"]`));
    if (!labelled) failures.push(`${describe}: no associated label`);
  }
  expect(failures).toEqual([]);
}

/** No label[for] may point at a NON-form element or a missing id (census class B). */
function auditLabelTargets(root: HTMLElement) {
  const labels = Array.from(root.querySelectorAll<HTMLLabelElement>('label[for]'));
  const broken = labels
    .filter((label) => {
      const target = root.querySelector(`#${CSS.escape(label.htmlFor)}`);
      return !target || !/^(INPUT|SELECT|TEXTAREA)$/.test(target.tagName);
    })
    .map((label) => `label[for=${label.htmlFor}] "${label.textContent?.trim()}"`);
  expect(broken).toEqual([]);
}

const GAMES = [
  {
    id: 'g1',
    name: 'Catan',
    Events: [
      {
        id: 'e1',
        start_date: '2026-01-01T18:00:00Z',
        Winner: { id: 'u1', username: 'Alice' },
        PickedBy: { id: 'u2', username: 'Bob' },
        EventParticipations: [],
      },
    ],
  },
];

describe('fork-5 form-label audit (id + name + associated label)', () => {
  // Anti-vacuity probe (the phase's probe-every-gate rule, permanent): the
  // auditor MUST go red on a planted violation, or every green above is noise.
  it('the auditor itself catches a nameless control and a broken label[for]', () => {
    const bad = render(<input type="text" />);
    expect(() => auditFormControls(bad.container)).toThrow();
    cleanup();
    const orphan = render(<label htmlFor="does-not-exist">Ghost</label>);
    expect(() => auditLabelTargets(orphan.container)).toThrow();
  });

  it('GroupGamesList toolbar + filters', async () => {
    const { container, findByRole } = render(
      <GroupGamesList games={GAMES} groupId="grp" onAddEvent={() => {}} userRole="owner" members={[]} />
    );
    // Open the filter panel so its two selects are audited too.
    (await findByRole('button', { name: /Filter/ })).click();
    auditFormControls(container);
    auditLabelTargets(container);
  });

  it('GroupLibrary search + sort', async () => {
    const { container, findByLabelText } = render(<GroupLibrary groupId="grp" />);
    await findByLabelText('Search games'); // library fetch settled
    auditFormControls(container);
    auditLabelTargets(container);
  });

  it('BrowseMoreModal player count + sort', async () => {
    render(
      <BrowseMoreModal open groupId="grp" onClose={() => {}} defaultPlayerCount={4} onSelectGame={() => {}} />
    );
    // Radix portals the dialog to body — audit the whole document body.
    auditFormControls(document.body);
    auditLabelTargets(document.body);
  });

  it('StartPollModal check-in form', () => {
    render(
      <StartPollModal
        groupId="grp"
        group={{ games: [{ id: 'g1', name: 'Catan' }] }}
        isOpen
        onClose={() => {}}
        onSuccess={() => {}}
      />
    );
    auditFormControls(document.body);
    auditLabelTargets(document.body);
  });

  it('MemberSelector (the "send to members" section title is a group, not an orphan label)', () => {
    function Harness() {
      const { control } = useForm({ defaultValues: { selected_member_ids: [] } });
      return (
        <MemberSelector
          members={[{ id: 'u1', username: 'Alice' }]}
          selectedMemberIds={[]}
          onSelectAllMembers={() => {}}
          control={control}
        />
      );
    }
    const { container, getByRole } = render(<Harness />);
    auditFormControls(container);
    auditLabelTargets(container);
    expect(getByRole('group', { name: 'Send to Members' })).toBeInTheDocument();
  });

  it('ParticipantRow — member rows carry NO label[for] at a nonexistent control (census class B)', () => {
    const { container } = render(
      <ParticipantRow
        participant={{ user_id: 'u1', username: 'Alice', isFromGroup: true }}
        index={0}
        groupMembers={[]}
        onParticipantChange={() => {}}
        onToggleParticipant={() => {}}
      />
    );
    auditLabelTargets(container);
    auditFormControls(container);
  });

  it('ParticipantRow — custom rows keep the real label association', () => {
    const { container, getByLabelText } = render(
      <ParticipantRow
        participant={{ user_id: '', username: '', isFromGroup: false }}
        index={0}
        groupMembers={[]}
        onParticipantChange={() => {}}
        onToggleParticipant={() => {}}
      />
    );
    expect(getByLabelText('Participant Name')).toBeInTheDocument();
    auditLabelTargets(container);
    auditFormControls(container);
  });
});
