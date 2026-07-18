// Behavioral proof for 87.4-05 (D-02): the schedule-edit member checkboxes must
// tolerate a selected_member_ids entry stored as EITHER the member's Auth0 sub
// (today's pre-backfill shape) OR their Users.id UUID (post PR-1-backfill shape),
// on both read (checked-state) and the uncheck write. Checking a member must keep
// emitting the member's sub during PR-1. A source grep is NOT sufficient proof:
// `member.id` already appears in the unmodified file, so these render-and-click
// assertions are the actual proof of fix (they fail against the buggy code).
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

// Each member carries BOTH keys, exactly as ScheduleForm feeds them (member
// objects with user_id=sub and id=UUID).
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

describe('MemberSelector — sub/UUID-tolerant schedule-edit checkboxes (87.4-05)', () => {
  it('renders a member CHECKED when selected_member_ids holds their UUID (post-backfill shape)', () => {
    render(<Harness initial={[ANN_UUID]} />);
    expect(screen.getByRole('checkbox', { name: 'Ann' })).toBeChecked();
    expect(screen.getByRole('checkbox', { name: 'Bob' })).not.toBeChecked();
  });

  it('still renders a member CHECKED when selected_member_ids holds their sub (today\'s shape)', () => {
    render(<Harness initial={[ANN_SUB]} />);
    expect(screen.getByRole('checkbox', { name: 'Ann' })).toBeChecked();
    expect(screen.getByRole('checkbox', { name: 'Bob' })).not.toBeChecked();
  });

  it('checking a previously-unchecked member emits their SUB (never their UUID) during PR-1', async () => {
    const user = userEvent.setup();
    render(<Harness initial={[]} />);
    await user.click(screen.getByRole('checkbox', { name: 'Bob' }));
    expect(emitted()).toContain(BOB_SUB);
    expect(emitted()).not.toContain(BOB_UUID);
  });

  it('unchecking a member whose selection is stored as a UUID removes the UUID entry and visually unchecks', async () => {
    const user = userEvent.setup();
    render(<Harness initial={[ANN_UUID]} />);
    const annBox = screen.getByRole('checkbox', { name: 'Ann' });
    expect(annBox).toBeChecked();

    await user.click(annBox);

    expect(emitted()).not.toContain(ANN_UUID);
    expect(screen.getByRole('checkbox', { name: 'Ann' })).not.toBeChecked();
  });
});
