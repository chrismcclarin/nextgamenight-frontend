// Behavioral proof for 87.4-10 (PR-2, D-02): the schedule-edit member checkboxes
// are now UUID-only. selected_member_ids stores the member's Users.id UUID
// (member.id) exclusively on both read (checked-state) and write (check emits
// member.id). A source grep is NOT sufficient proof: `member.id` already appears
// in the unmodified file, so these render-and-click assertions are the actual
// proof of the collapse (they fail against the PR-1 dual-key code).
//
// HISTORICAL (PR-1, 87.4-05): before this collapse the checkbox TOLERATED a
// selected_member_ids entry stored as EITHER the member's Auth0 sub (pre-backfill
// shape) OR their Users.id UUID (post-backfill shape), and checking a member
// emitted the SUB. That dual-key tolerance was Plan 05's PR-1 bridge so either
// BE/FE deploy order was safe during the backfill. PR-2 (this plan) collapses it
// to UUID-only now that the BE backfill is complete and emissions are UUID: a
// sub-stored selection no longer renders checked (test below), and the write
// emits member.id, never the sub.
import { describe, it, expect, afterEach } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useForm } from 'react-hook-form';
import type { ComponentType } from 'react';
import MemberSelectorDefault from './MemberSelector';

// MemberSelector is a JS component; cast to a permissive type so the harness can
// pass just the props it exercises.
const MemberSelector = MemberSelectorDefault as unknown as ComponentType<{
  members: Array<Record<string, unknown>>;
  control: unknown;
  selectedMemberIds: string[];
  onSelectAllMembers: (checked: boolean) => void;
  error?: string | null;
}>;

const ANN_SUB = 'auth0|ann';
const ANN_UUID = '11111111-1111-1111-1111-111111111111';
const BOB_SUB = 'auth0|bob';
const BOB_UUID = '22222222-2222-2222-2222-222222222222';

// Each member still carries BOTH keys, exactly as ScheduleForm feeds them (member
// objects with user_id=sub and id=UUID) -- so a passing test proves the read/write
// use ONLY member.id and never fall back to the sub.
const members = [
  { user_id: ANN_SUB, id: ANN_UUID, display_name: 'Ann' },
  { user_id: BOB_SUB, id: BOB_UUID, display_name: 'Bob' },
];

// Harness: real react-hook-form control seeded with a given selected_member_ids
// value, plus a live JSON readout of the field so tests can assert the emitted
// (written) value after a click.
function Harness({ initial }: { initial: string[] }) {
  const { control, watch } = useForm<{ selected_member_ids: string[] }>({
    defaultValues: { selected_member_ids: initial },
  });
  const selectedMemberIds = watch('selected_member_ids') || [];
  return (
    <>
      <MemberSelector
        members={members}
        control={control}
        selectedMemberIds={selectedMemberIds}
        onSelectAllMembers={() => {}}
      />
      <div data-testid="emitted">{JSON.stringify(selectedMemberIds)}</div>
    </>
  );
}

function emitted(): string[] {
  return JSON.parse(screen.getByTestId('emitted').textContent || '[]');
}

afterEach(cleanup);

describe('MemberSelector — UUID-only schedule-edit checkboxes (87.4-10 PR-2)', () => {
  it('renders a member CHECKED when selected_member_ids holds their UUID (member.id)', () => {
    render(<Harness initial={[ANN_UUID]} />);
    expect(screen.getByRole('checkbox', { name: 'Ann' })).toBeChecked();
    expect(screen.getByRole('checkbox', { name: 'Bob' })).not.toBeChecked();
  });

  it('does NOT render checked when selected_member_ids holds only their sub (PR-1 tolerance collapsed)', () => {
    // PR-1 rendered this CHECKED (sub-tolerant). PR-2 is UUID-only: a sub-stored
    // selection no longer matches member.id, so the box is unchecked.
    render(<Harness initial={[ANN_SUB]} />);
    expect(screen.getByRole('checkbox', { name: 'Ann' })).not.toBeChecked();
    expect(screen.getByRole('checkbox', { name: 'Bob' })).not.toBeChecked();
  });

  it('checking a previously-unchecked member emits their UUID (member.id), never their sub', async () => {
    const user = userEvent.setup();
    render(<Harness initial={[]} />);
    await user.click(screen.getByRole('checkbox', { name: 'Bob' }));
    expect(emitted()).toContain(BOB_UUID);
    expect(emitted()).not.toContain(BOB_SUB);
  });

  it('unchecking a member stored as a UUID removes the UUID entry and visually unchecks', async () => {
    const user = userEvent.setup();
    render(<Harness initial={[ANN_UUID]} />);
    const annBox = screen.getByRole('checkbox', { name: 'Ann' });
    expect(annBox).toBeChecked();

    await user.click(annBox);

    expect(emitted()).not.toContain(ANN_UUID);
    expect(screen.getByRole('checkbox', { name: 'Ann' })).not.toBeChecked();
  });
});

// 87.4 review PR2-L5: a member with no display_name/username/email must render
// the literal 'Member' label, NEVER their raw UUID (or any raw identifier).
describe('MemberSelector — label fallback never renders a raw identifier (PR2-L5)', () => {
  const CARL_UUID = '33333333-3333-3333-3333-333333333333';

  function NamelessHarness() {
    const { control, watch } = useForm<{ selected_member_ids: string[] }>({
      defaultValues: { selected_member_ids: [] },
    });
    const selectedMemberIds = watch('selected_member_ids') || [];
    return (
      <MemberSelector
        members={[
          { user_id: 'auth0|carl', id: CARL_UUID, display_name: null, username: null, email: null },
        ]}
        control={control}
        selectedMemberIds={selectedMemberIds}
        onSelectAllMembers={() => {}}
      />
    );
  }

  it("renders 'Member' for a member with null display_name/username/email — not their UUID", () => {
    render(<NamelessHarness />);
    expect(screen.getByRole('checkbox', { name: 'Member' })).toBeInTheDocument();
    expect(screen.queryByText(CARL_UUID)).not.toBeInTheDocument();
    expect(screen.queryByText('auth0|carl')).not.toBeInTheDocument();
  });
});
