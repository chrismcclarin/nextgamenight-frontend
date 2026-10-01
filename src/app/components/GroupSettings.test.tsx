// Phase 88.2 plan 09 — component-level net over the rewritten Danger Zone.
// Phase 88-13 (D-04) updated SPEC-REQ-6's pins in place: the typed gate now runs
// on the shared `typed` tier and the stacked native prompt behind it is gone.
//
// Pins three things that are easy to break silently:
//   SPEC-REQ-5  the real blast radius renders, sourced from the dedicated
//               endpoint (D-06), with a route to the transfer flow;
//   SPEC-REQ-6  the type-the-group-name gate is behaviorally unchanged (still
//               exact-match-or-disabled), NO new gate exists, and NOTHING is
//               stacked behind it — one prompt, once (88-13 / D-04);
//   SPEC-REQ-7  nothing in the flow claims the delete is permanent — including
//               on the degraded path where the impact fetch failed.
//
// `.tsx` is mandatory: vitest.config.mts only includes `.ts`/`.tsx`, and the
// config's jsx-in-js transform hook handles the `.js` component under test.
import * as React from 'react';
import { render, screen, fireEvent, waitFor, cleanup, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { axe } from 'vitest-axe';

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn() }),
}));

vi.mock('sonner', () => ({ toast: { error: vi.fn(), success: vi.fn() } }));
// M2/M3 (code review round 2): the F1 guard's Sentry event is part of its contract —
// it is the ONLY record from which a wiped colour can be restored by hand — so the
// channel and the fields are pinned, not just the toast.
vi.mock('@/lib/logger', () => ({ logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn() } }));

// Read-only schedule panel does its own fetching and is irrelevant here.
vi.mock('@/app/components/PromptScheduleReadOnly', () => ({ default: () => null }));

vi.mock('@/lib/api', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/api')>();
  return {
    ...actual,
    groupsAPI: {
      getGroupMembers: vi.fn(),
      getDeletionImpact: vi.fn(),
      deleteGroup: vi.fn(),
      leaveGroup: vi.fn(),
      updateGroupSettings: vi.fn(),
    },
  };
});

import GroupSettings from './GroupSettings';
import { groupsAPI, ApiError } from '@/lib/api';
// Phase 88.6-20 (R1): the ratified copy is read through its ONE reader rather than copied into
// this file as a literal, so the assertions cannot drift from the register.
import { getFetchErrorMessage } from '@/components/ui/useFetchErrorState';
import { toast } from 'sonner';
import { logger } from '@/lib/logger';

type Mock = ReturnType<typeof vi.fn>;

const GROUP_ID = '11111111-1111-4111-8111-111111111111';
const GROUP_NAME = 'Tuesday Night Crew';

// Three members so `isOnlyMember` is false and the owner sees the normal
// (non-degenerate) Leave/Danger sections.
const ROSTER = [
  { id: 'a', user_id: 'auth0|owner', username: 'Owner', UserGroup: { role: 'owner' } },
  { id: 'b', user_id: 'auth0|b', username: 'Bee', UserGroup: { role: 'member' } },
  { id: 'c', user_id: 'auth0|c', username: 'Cee', UserGroup: { role: 'member' } },
];

const IMPACT = { member_count: 6, event_count: 37, recovery_window_days: 30 };

/** The three strings SPEC-REQ-7 forbids anywhere in the group-delete flow. */
const FORBIDDEN = ['cannot be undone', 'permanently remove', 'permanently delete'];

function renderSettings(
  overrides: Record<string, unknown> = {},
  group: Record<string, unknown> = { id: GROUP_ID, name: GROUP_NAME }
) {
  return render(
    <GroupSettings
      group={group}
      user={{ sub: 'auth0|owner' }}
      userRole="owner"
      onClose={vi.fn()}
      onUpdate={vi.fn()}
      onGroupDeleted={vi.fn()}
      onOpenManageMembers={vi.fn()}
      {...overrides}
    />
  );
}

/** The Danger Zone section element (the heading's containing block). */
function dangerZone(): HTMLElement {
  return screen.getByRole('heading', { name: 'Danger Zone' }).parentElement as HTMLElement;
}

/**
 * The delete confirmation dialog, addressed BY ITS ACCESSIBLE NAME rather than
 * `getByRole('dialog')`. Two dialogs are on screen once the settings surface
 * itself is hosted on <Modal> (88-13 task 2), so an unnamed role query is
 * ambiguous by construction.
 */
function deleteDialog(): HTMLElement {
  return screen.getByRole('dialog', { name: `Delete ${GROUP_NAME}?` });
}

/** Open the typed gate. Returns the dialog. */
async function openDeleteGate(): Promise<HTMLElement> {
  fireEvent.click(await screen.findByRole('button', { name: 'Delete Group' }));
  return await screen.findByRole('dialog', { name: `Delete ${GROUP_NAME}?` });
}

let confirmSpy: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  vi.clearAllMocks();
  (groupsAPI.getGroupMembers as Mock).mockResolvedValue(ROSTER);
  (groupsAPI.getDeletionImpact as Mock).mockResolvedValue(IMPACT);
  (groupsAPI.deleteGroup as Mock).mockResolvedValue({});
  confirmSpy = vi.spyOn(window, 'confirm').mockReturnValue(true);
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe('Phase 88-13 — the settings surface is on the shared Modal, and saving is audible', () => {
  it('renders as a labelled dialog with no hand-rolled backdrop', async () => {
    const { container } = renderSettings();
    const dialog = await screen.findByRole('dialog', { name: 'Customize Group' });
    expect(dialog).toBeInTheDocument();
    // The hand-rolled overlay/backdrop pair is gone, not re-created inside.
    expect(container.querySelector('.modal-overlay')).toBeNull();
    expect(document.querySelector('.modal-overlay')).toBeNull();
  });

  it('fires the Settings saved receipt, in that exact register (Req 12 / §6.2)', async () => {
    (groupsAPI.updateGroupSettings as Mock).mockResolvedValue({});
    const onClose = vi.fn();
    renderSettings({ onClose });

    fireEvent.click(await screen.findByRole('button', { name: 'Save Changes' }));
    await waitFor(() => expect(toast.success as Mock).toHaveBeenCalledWith('Settings saved'));
    // No exclamation, no "successfully" — and it must be fired BEFORE the
    // unmount, or Sonner never shows it.
    await waitFor(() => expect(onClose).toHaveBeenCalled());
    const successOrder = (toast.success as Mock).mock.invocationCallOrder[0];
    expect(successOrder).toBeLessThan(onClose.mock.invocationCallOrder[0]);
  });

  it('does not claim success when the save fails', async () => {
    (groupsAPI.updateGroupSettings as Mock).mockRejectedValue(new Error('nope'));
    renderSettings();
    fireEvent.click(await screen.findByRole('button', { name: 'Save Changes' }));
    await waitFor(() => expect(toast.error as Mock).toHaveBeenCalled());
    expect(toast.success as Mock).not.toHaveBeenCalled();
  });

  it('R1: a 403 on settings-save renders MESSAGE_BY_CODE.forbidden, not a generic failure', async () => {
    /*
     * NEW Phase 88.6-20 (R1 / UI-SPEC §6.2 permission row). This is the site plan 88.6-21's
     * acceptance criterion depends on — no other plan in the phase touches this catch.
     *
     * A 403 here is genuinely reachable, not theoretical: an owner or admin whose role was
     * changed server-side after this modal rendered still has the Save button in front of them,
     * and `isOwnerOrAdmin` refuses the write. Before this plan the catch authored
     * "Failed to update group settings. Please try again." unconditionally, which reports a
     * permission refusal as a transient glitch and invites the user to retry forever.
     *
     * Asserted BEHAVIOURALLY against the shipped register rather than against a copied string:
     * `MESSAGE_BY_CODE` has exactly one reader (`getFetchErrorMessage`), so this reads the
     * ratified copy through that reader and cannot drift from it.
     */
    (groupsAPI.updateGroupSettings as Mock).mockRejectedValue(
      new ApiError('Forbidden', 'forbidden', 403)
    );
    renderSettings();
    fireEvent.click(await screen.findByRole('button', { name: 'Save Changes' }));

    await waitFor(() => expect(toast.error as Mock).toHaveBeenCalled());
    const said = (toast.error as Mock).mock.calls[0][0];
    expect(said).toBe(getFetchErrorMessage(new ApiError('Forbidden', 'forbidden', 403)));
    // the ratified forbidden line, and specifically NOT the retired ad-hoc sentence
    expect(said).toContain("You don't have access to this");
    expect(said).not.toContain('Failed to update group settings');
    expect(toast.success as Mock).not.toHaveBeenCalled();
  });

  it('R1: a generic save failure reads the ratified register, and never the raw upstream message', async () => {
    // The counterpart to the 403 arm: a failure carrying no `ApiError.code` resolves through
    // `unknown`, so no copy is authored here either. The raw `error.message` must not surface —
    // that is the R1 defect, and an upstream string is exactly what used to reach the user.
    (groupsAPI.updateGroupSettings as Mock).mockRejectedValue(
      new Error('ECONNRESET: upstream socket hang up')
    );
    renderSettings();
    fireEvent.click(await screen.findByRole('button', { name: 'Save Changes' }));

    await waitFor(() => expect(toast.error as Mock).toHaveBeenCalled());
    const said = (toast.error as Mock).mock.calls[0][0];
    expect(said).not.toContain('ECONNRESET');
    expect(said).toBe(getFetchErrorMessage(new Error('x')));
  });
});

describe('SPEC-REQ-5 — the Danger Zone states the real blast radius', () => {
  it('renders the endpoint-supplied member count, event count and recovery window', async () => {
    renderSettings();
    await waitFor(() => expect(dangerZone().textContent).toContain('6'));
    const text = dangerZone().textContent ?? '';
    expect(text).toContain('6');
    expect(text).toContain('37');
    expect(text).toContain('30 days');
  });

  it('offers transfer as the better path and routes to the transfer flow', async () => {
    const onOpenManageMembers = vi.fn();
    renderSettings({ onOpenManageMembers });
    const transfer = await within(dangerZone()).findByRole('button', {
      name: /transfer ownership instead/i,
    });
    fireEvent.click(transfer);
    // NOTE: this proves the COMPONENT, not the wiring. It passes even when a
    // call site forgets the prop — the call-site enumeration is task 2b's
    // criterion, not this test's. Do not read this green as coverage of it.
    expect(onOpenManageMembers).toHaveBeenCalledTimes(1);
  });

  it('degrades without the numbers when the impact fetch fails, but never disables delete', async () => {
    (groupsAPI.getDeletionImpact as Mock).mockRejectedValue(new Error('boom'));
    renderSettings();
    const deleteBtn = await screen.findByRole('button', { name: 'Delete Group' });

    const text = dangerZone().textContent ?? '';
    expect(text).not.toMatch(/undefined|NaN/);
    expect(deleteBtn).toBeEnabled();

    // The recoverability half is UNCONDITIONAL. If the copy is written as one
    // block gated on the fetch, the degraded owner is told neither that the
    // delete is final nor that it is recoverable — and asserting only the
    // absence of undefined/NaN would let exactly that ship.
    expect(text).toContain('30 days');
    expect(text).toMatch(/change your mind/i);
    expect(text).toMatch(/emailed a link/i);
  });
});

describe('SPEC-REQ-7 — no permanence claim survives', () => {
  it('the rendered Danger Zone and the confirmation dialog make no permanence claim', async () => {
    renderSettings();
    await waitFor(() => expect(dangerZone().textContent).toContain('37'));
    const text = (dangerZone().textContent ?? '').toLowerCase();
    for (const phrase of FORBIDDEN) expect(text).not.toContain(phrase);

    // 88-13: the copy the old native prompt carried now renders in the dialog
    // body, so the SPEC-REQ-7 sweep follows it there.
    const dialog = await openDeleteGate();
    const dialogText = (dialog.textContent ?? '').toLowerCase();
    for (const phrase of FORBIDDEN) expect(dialogText).not.toContain(phrase);
    expect(dialogText).toMatch(/take it over/);
    expect(dialogText).toContain('30 days');
  });

  it('M-5 — a sole-member group is told plainly the delete is final, with no false promise', async () => {
    (groupsAPI.getGroupMembers as Mock).mockResolvedValue([ROSTER[0]]);
    (groupsAPI.getDeletionImpact as Mock).mockResolvedValue({
      member_count: 1,
      event_count: 2,
      recovery_window_days: 30,
    });
    renderSettings();
    await waitFor(() => expect(dangerZone().textContent).toMatch(/only member/i));

    // The member-claim-back promise must NOT render — there are no other
    // members to claim it back, so "change your mind" would be a lie here.
    const text = (dangerZone().textContent ?? '').toLowerCase();
    expect(text).not.toMatch(/change your mind/);
    expect(text).not.toMatch(/emailed a link to take over/);
    expect(text).toMatch(/final/);
    for (const phrase of FORBIDDEN) expect(text).not.toContain(phrase);

    // The dialog body branches the same way the retired prompt string did.
    const dialog = await openDeleteGate();
    const dialogText = (dialog.textContent ?? '').toLowerCase();
    expect(dialogText).toContain('only member');
    expect(dialogText).toMatch(/final/);
    expect(dialogText).not.toMatch(/emails them a link/);
    for (const phrase of FORBIDDEN) expect(dialogText).not.toContain(phrase);
  });

  it('the DEGRADED path is also clean, and still makes a recoverability claim', async () => {
    (groupsAPI.getDeletionImpact as Mock).mockRejectedValue(new Error('boom'));
    renderSettings();
    await screen.findByRole('button', { name: 'Delete Group' });

    const text = (dangerZone().textContent ?? '').toLowerCase();
    for (const phrase of FORBIDDEN) expect(text).not.toContain(phrase);
    // Silent on BOTH permanence and recoverability is the failure mode here.
    expect(text).toMatch(/change your mind|bring it all back|take over the group/);
  });
});

describe('D-06 — counts come from the endpoint, once, and only for the owner', () => {
  it('fetches exactly once on render for an owner, and survives a re-render', async () => {
    const { rerender } = renderSettings();
    await waitFor(() => expect(groupsAPI.getDeletionImpact as Mock).toHaveBeenCalledTimes(1));
    expect(groupsAPI.getDeletionImpact as Mock).toHaveBeenCalledWith(GROUP_ID);

    // A FRESH object identity with the SAME id — what a parent re-render
    // produces. A `[group, userRole]` dependency array refetches here; a
    // `[group?.id, userRole]` one does not.
    rerender(
      <GroupSettings
        group={{ id: GROUP_ID, name: GROUP_NAME }}
        user={{ sub: 'auth0|owner' }}
        userRole="owner"
        onClose={vi.fn()}
        onUpdate={vi.fn()}
        onGroupDeleted={vi.fn()}
        onOpenManageMembers={vi.fn()}
      />
    );
    await waitFor(() => expect(screen.getByRole('heading', { name: 'Danger Zone' })).toBeInTheDocument());
    expect(groupsAPI.getDeletionImpact as Mock).toHaveBeenCalledTimes(1);
  });

  it('never fetches for a member — the Danger Zone does not render at all', async () => {
    renderSettings({ userRole: 'member' });
    await waitFor(() => expect(groupsAPI.getGroupMembers as Mock).toHaveBeenCalled());
    expect(screen.queryByRole('heading', { name: 'Danger Zone' })).toBeNull();
    expect(groupsAPI.getDeletionImpact as Mock).not.toHaveBeenCalled();
  });
});

describe('SPEC-REQ-6 / 88-13 D-04 — one gate, at full strength, with nothing stacked', () => {
  it('the confirm button unlocks only on an exact group-name match', async () => {
    renderSettings();
    await waitFor(() => expect(dangerZone().textContent).toContain('37'));
    const dialog = await openDeleteGate();

    const input = within(dialog).getByRole('textbox');
    const confirmBtn = within(dialog).getByRole('button', { name: 'Delete' });

    expect(confirmBtn).toBeDisabled(); // empty
    fireEvent.change(input, { target: { value: 'Tuesday Night Crw' } });
    expect(confirmBtn).toBeDisabled(); // near miss
    fireEvent.change(input, { target: { value: `${GROUP_NAME} ` } });
    expect(confirmBtn).toBeDisabled(); // trailing space — exact equality, not trim
    fireEvent.change(input, { target: { value: GROUP_NAME } });
    expect(confirmBtn).toBeEnabled(); // exact
  });

  it('confirming deletes exactly once, with NO second prompt behind it (D-04)', async () => {
    renderSettings();
    await waitFor(() => expect(dangerZone().textContent).toContain('37'));
    const dialog = await openDeleteGate();

    fireEvent.change(within(dialog).getByRole('textbox'), { target: { value: GROUP_NAME } });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Delete' }));

    await waitFor(() => expect(groupsAPI.deleteGroup as Mock).toHaveBeenCalledWith(GROUP_ID));
    expect(groupsAPI.deleteGroup as Mock).toHaveBeenCalledTimes(1);
    // The stacked native prompt 88.2 shipped is GONE. This assertion is the
    // regression net for it: re-adding one is a decision (see the DECISION
    // marker in GroupSettings.js), and this line fails loudly if it happens.
    expect(confirmSpy).not.toHaveBeenCalled();
  });

  it('cancel aborts — nothing is deleted', async () => {
    renderSettings();
    await waitFor(() => expect(dangerZone().textContent).toContain('37'));
    const dialog = await openDeleteGate();

    fireEvent.change(within(dialog).getByRole('textbox'), { target: { value: GROUP_NAME } });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Cancel' }));

    await waitFor(() =>
      expect(screen.queryByRole('dialog', { name: `Delete ${GROUP_NAME}?` })).toBeNull()
    );
    expect(groupsAPI.deleteGroup as Mock).not.toHaveBeenCalled();
    expect(confirmSpy).not.toHaveBeenCalled();
  });

  it('#33: a REJECTED delete leaves the confirm dialog OPEN, and the reason reads the ratified register', async () => {
    /*
     * NEW Phase 88.6-20. `performDeleteGroup` re-throws after its toast, and that `throw error`
     * plus its justification comment are BYTE-UNCHANGED by this plan. This test is what stops a
     * later reader deleting it as a stray: `useConfirmAction`'s contract is that the gate stays
     * OPEN on failure, so dropping the re-throw closes the dialog as though the delete had
     * SUCCEEDED while the group still exists — the owner would be looking at a dismissed
     * confirmation with no indication anything went wrong.
     *
     * The second half is the R1 arm for the same catch: the raw `error.message` read is gone.
     */
    (groupsAPI.deleteGroup as Mock).mockRejectedValue(
      new Error('violates foreign key constraint "events_group_id_fkey"')
    );
    renderSettings();
    await waitFor(() => expect(dangerZone().textContent).toContain('37'));
    const dialog = await openDeleteGate();

    fireEvent.change(within(dialog).getByRole('textbox'), { target: { value: GROUP_NAME } });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Delete' }));

    await waitFor(() => expect(groupsAPI.deleteGroup as Mock).toHaveBeenCalled());
    // the gate stays OPEN — this is the property the re-throw buys
    await waitFor(() =>
      expect(screen.getByRole('dialog', { name: `Delete ${GROUP_NAME}?` })).toBeInTheDocument()
    );
    // …and the reason is the ratified copy, not the upstream Postgres string
    const said = (toast.error as Mock).mock.calls[0][0];
    expect(said).not.toContain('foreign key');
    expect(said).toBe(getFetchErrorMessage(new Error('x')));
  });

  it('a many-member group needs no extra acknowledgement step', async () => {
    (groupsAPI.getDeletionImpact as Mock).mockResolvedValue({
      member_count: 50,
      event_count: 12,
      recovery_window_days: 30,
    });
    renderSettings();
    await waitFor(() => expect(dangerZone().textContent).toContain('50'));
    const dialog = await openDeleteGate();

    // Exactly one input (the name field) and no checkbox / extra acknowledgement.
    expect(within(dialog).getAllByRole('textbox')).toHaveLength(1);
    expect(within(dialog).queryAllByRole('checkbox')).toHaveLength(0);
    // D-06's counts ride ABOVE the input rather than behind another click.
    expect(dialog.textContent).toContain('50');
    expect(dialog.textContent).toContain('12');

    fireEvent.change(within(dialog).getByRole('textbox'), { target: { value: GROUP_NAME } });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Delete' }));
    await waitFor(() => expect(groupsAPI.deleteGroup as Mock).toHaveBeenCalledWith(GROUP_ID));
  });

  it('never withholds the confirm control — the backend stays the authority (88.2)', async () => {
    (groupsAPI.getDeletionImpact as Mock).mockRejectedValue(new Error('boom'));
    renderSettings();
    const dialog = await openDeleteGate();

    // No blocker panel means no counts, but the gate is still completable: 88.2
    // forbids this surface adding a refusal of its own.
    fireEvent.change(within(dialog).getByRole('textbox'), { target: { value: GROUP_NAME } });
    expect(within(dialog).getByRole('button', { name: 'Delete' })).toBeEnabled();
  });
});

// ---------------------------------------------------------------------------
// Phase 88.3.1 plan 07 — the colour picker: toggle-off (CONTEXT D-06) and the
// two-column save payload (CONTEXT D-01).
//
// AMENDMENT H (Defect 6 / M29): these are REAL behavioural tests on the shipped
// component, not a source grep plus a browser note. `groupColourRendering.test.ts`
// is a SOURCE scanner — it can prove the payload is not built from a rendered
// value, and it cannot prove that clicking a swatch twice clears it. This file
// already existed (88-13 / 88.2 era) and is extended rather than duplicated.
// ---------------------------------------------------------------------------
describe('Phase 88.3.1 D-06 / D-01 — the eight-preset picker', () => {

  it('passes an axe audit — the sibling-modal floor this picker shipped without (round-3 #34)', async () => {
    renderSettings();
    const group = await screen.findByRole('group', { name: 'Choose a default color:' });
    expect(await axe(group)).toHaveNoViolations();
  });

  /** The live preview card — the element carrying the "Preview" caption. */
  const preview = (): HTMLElement =>
    screen.getByText('Preview').parentElement as HTMLElement;

  /** The single `settings` object handed to the API on save.
   *
   *  The mock echoes a row that CARRIES `color_preset`, because that is what the
   *  real route returns (`routes/groups.js` -> `res.json(group)`), and because the
   *  F1 capability guard added 2026-08-30 reads exactly that key. The previous
   *  `{}` stand-in would now drive the preset cases down the guard's failure arm
   *  and quietly stop exercising the success path these tests exist to pin. */
  async function saveAndCapture(): Promise<Record<string, unknown>> {
    (groupsAPI.updateGroupSettings as Mock).mockImplementation(
      async (_id: string, sent: Record<string, unknown>) => ({
        id: GROUP_ID,
        name: GROUP_NAME,
        color_preset: sent.color_preset ?? null,
        background_color: sent.background_color ?? null,
      }),
    );
    fireEvent.click(await screen.findByRole('button', { name: 'Save Changes' }));
    await waitFor(() => expect(groupsAPI.updateGroupSettings as Mock).toHaveBeenCalled());
    return (groupsAPI.updateGroupSettings as Mock).mock.calls[0][1];
  }

  /*
   * F1 (code review 88.3.1, owner ruling 2026-08-30). The old backend's response is
   * modelled as a row with NO `color_preset` KEY AT ALL — not the key set to null.
   * That distinction is the whole guard: `null` is a legitimate saved value (a
   * cleared group), so only key ABSENCE can mean "this server does not have the
   * column". A test that used `{ color_preset: null }` here would pass while
   * proving nothing.
   */
  const OLD_BACKEND_ROW = { id: GROUP_ID, name: GROUP_NAME, background_color: null };

  it('F1: a PRESET save against a backend with no color_preset column does NOT report success', async () => {
    (groupsAPI.updateGroupSettings as Mock).mockResolvedValue(OLD_BACKEND_ROW);
    const onClose = vi.fn();
    const onUpdate = vi.fn();
    renderSettings({ onClose, onUpdate });

    const group = await screen.findByRole('group', { name: 'Choose a default color:' });
    fireEvent.click(within(group).getByRole('button', { name: 'Teal' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Save Changes' }));

    await waitFor(() => expect(toast.error as Mock).toHaveBeenCalled());
    // The three things that made the wipe silent, each asserted on its own line.
    expect(toast.success as Mock).not.toHaveBeenCalled();
    expect(onClose).not.toHaveBeenCalled();   // modal stays open, pending edits survive
    expect(onUpdate).not.toHaveBeenCalled();  // no refetch claiming a good write
  });

  it('F1/M2/M3: the guard reports through the CONTEXT channel, carrying the authoritative colour', async () => {
    // The round-1 version called `logger.error(msg, ctxObject)`. `logger.error(msg, err)`
    // is `Sentry.captureException(err ?? new Error(msg))`, so a plain object was captured
    // as a non-Error — Sentry renders "Object captured as exception with keys: …" and the
    // message lands in `extra.msg`. `warn(msg, ctx)` is `captureMessage` with `ctx` as
    // `extra`, which keeps the recovery fields queryable.
    (groupsAPI.updateGroupSettings as Mock).mockResolvedValue(OLD_BACKEND_ROW);
    // A group whose authoritative colour is the PRESET column — the case where logging
    // `background_color` alone (M3) recorded the wrong value.
    renderSettings({}, { id: GROUP_ID, name: GROUP_NAME, color_preset: 'teal', background_color: null });

    const group = await screen.findByRole('group', { name: 'Choose a default color:' });
    fireEvent.click(within(group).getByRole('button', { name: 'Blue' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Save Changes' }));

    await waitFor(() => expect(logger.warn as Mock).toHaveBeenCalled());
    // The error channel is NOT used — that is the M2 defect, asserted as a negative.
    expect(logger.error as Mock).not.toHaveBeenCalled();

    const [msg, ctx] = (logger.warn as Mock).mock.calls.at(-1)!;
    expect(msg).toContain('no color_preset column');
    expect(ctx).toMatchObject({ group_id: GROUP_ID, attempted_preset: 'blue' });
    // M3: the AUTHORITATIVE stored colour, not the legacy column (which is null here).
    expect(ctx.previous_stored_colour).toBe('teal');
  });

  it('F1: a LEGACY-HEX save against that same old backend still succeeds — the expand window must keep working', async () => {
    (groupsAPI.updateGroupSettings as Mock).mockResolvedValue(OLD_BACKEND_ROW);
    const onClose = vi.fn();
    renderSettings({ onClose }, { id: GROUP_ID, name: GROUP_NAME, background_color: '#1e1e2e' });

    fireEvent.click(await screen.findByRole('button', { name: 'Save Changes' }));

    await waitFor(() => expect(toast.success as Mock).toHaveBeenCalledWith('Settings saved'));
    expect(toast.error as Mock).not.toHaveBeenCalled();
    await waitFor(() => expect(onClose).toHaveBeenCalled());
    // …and it really did take the non-preset arm, or the case proves nothing.
    expect((groupsAPI.updateGroupSettings as Mock).mock.calls[0][1].color_preset).toBeNull();
  });

  const LABELS = ['Red', 'Orange', 'Amber', 'Green', 'Teal', 'Blue', 'Violet', 'Rose'];

  it('renders exactly eight swatches, each with its hue name VISIBLE (AMENDMENT G2)', async () => {
    renderSettings();
    const group = await screen.findByRole('group', { name: 'Choose a default color:' });
    const buttons = within(group).getAllByRole('button');
    expect(buttons).toHaveLength(8);

    for (const label of LABELS) {
      // announced once: the button carries the aria-label …
      expect(within(group).getByRole('button', { name: label })).toBeInTheDocument();
      // … and the caption is visible text that screen readers skip.
      const caption = within(group).getByText(label, { selector: 'span' });
      expect(caption).toBeInTheDocument();
      expect(caption).toHaveAttribute('aria-hidden', 'true');
    }
  });

  it('W76: the caption is INSIDE its own tap target, and clicking the caption selects the swatch', async () => {
    /*
     * NEW Phase 88.6-20 (W76). The caption used to be a SIBLING of the button, so tapping the
     * visible word — the easiest thing to hit on a phone, and the only thing that NAMES the
     * colour (AMENDMENT G2) — did nothing at all.
     *
     * The BEHAVIOURAL half is the click: it fires on the caption, not on the chip, and the
     * swatch must become pressed. A containment assertion alone would pass on a `span onClick`
     * shim, which is the arm this plan REJECTS.
     */
    renderSettings();
    const group = await screen.findByRole('group', { name: 'Choose a default color:' });
    const teal = within(group).getByRole('button', { name: 'Teal' });
    const caption = within(group).getByText('Teal', { selector: 'span' });

    // containment — the caption is a descendant of the control, not a sibling of it
    expect(teal.contains(caption)).toBe(true);
    expect(caption).toHaveAttribute('aria-hidden', 'true');
    // …and there is still exactly ONE accessible name on the control
    expect(teal).toHaveAttribute('aria-label', 'Teal');
    expect(teal).not.toHaveAttribute('title');

    // behaviour — a click on the CAPTION activates the swatch
    expect(teal).toHaveAttribute('aria-pressed', 'false');
    fireEvent.click(caption);
    expect(teal).toHaveAttribute('aria-pressed', 'true');
  });

  it('W76: the hover treatment survives on the element that carries the border, as a group-hover rule', async () => {
    /*
     * NEW Phase 88.6-20 (W76). `hover:border-content-primary` had a DECISION comment
     * (hover is a BORDER treatment, not whole-element opacity — round-3 #32, WCAG 1.4.11) and
     * exactly ONE grep hit across `src` and `e2e`: its own source line. Nothing pinned it, so
     * losing it during the flex-column move would have been completely silent.
     *
     * It must be `group-hover:` and it must be on the BORDER-CARRYING element, because after
     * the move the pointer is over the button while the border is on the inner chip. The chip
     * is located by its `border-2`, not by a tag name.
     */
    renderSettings();
    const group = await screen.findByRole('group', { name: 'Choose a default color:' });
    const teal = within(group).getByRole('button', { name: 'Teal' });

    const chip = [...teal.querySelectorAll('span')].find((s) => s.className.includes('border-2'));
    expect(chip, 'no element inside the swatch carries border-2').toBeDefined();
    // the hover rule rides the same element as the border…
    expect(chip!.className).toContain('group-hover:border-content-primary');
    // …and the `group` marker that arms it is on the button. Without this the rule is inert,
    // which is the silent-loss shape the DECISION comment warns about.
    expect(teal.className.split(/\s+/)).toContain('group');
    // the plain `hover:` form is gone — it would target an element the pointer is never over
    expect(chip!.className).not.toMatch(/(^|\s)hover:border-content-primary/);

    // the focus ring stays on the FOCUSABLE, not on the chip (CR-14's two affordances)
    expect(teal.className).toContain('focus-visible:ring-focus-ring');
    expect(chip!.className).not.toContain('focus-visible:ring-');
  });

  it('D-06: tapping the SELECTED swatch de-selects it and the preview falls back', async () => {
    renderSettings();
    const group = await screen.findByRole('group', { name: 'Choose a default color:' });
    const blue = within(group).getByRole('button', { name: 'Blue' });

    // nothing chosen to begin with
    for (const label of LABELS) {
      expect(within(group).getByRole('button', { name: label })).toHaveAttribute(
        'aria-pressed',
        'false',
      );
    }
    expect(preview().className).toContain('bg-surface-card');

    fireEvent.click(blue);
    expect(blue).toHaveAttribute('aria-pressed', 'true');
    expect(preview().className).toContain('bg-[var(--group-ground-light)]');

    // the second tap on the SAME swatch clears — this is the whole of D-06
    fireEvent.click(blue);
    for (const label of LABELS) {
      expect(within(group).getByRole('button', { name: label })).toHaveAttribute(
        'aria-pressed',
        'false',
      );
    }
    expect(preview().className).toContain('bg-surface-card');
  });

  it('D-01 shape 1 — a chosen preset saves the id and NULLS the legacy column', async () => {
    renderSettings();
    const group = await screen.findByRole('group', { name: 'Choose a default color:' });
    fireEvent.click(within(group).getByRole('button', { name: 'Teal' }));

    const settings = await saveAndCapture();
    expect(settings.color_preset).toBe('teal');
    expect(settings.background_color).toBeNull();
    // no RENDERED value may ever enter the payload (UI-SPEC 4.1) — not a ground,
    // not an ink. The teal ground/ink hexes are the concrete instance of that.
    const json = JSON.stringify(settings);
    for (const rendered of ['#003538', '#94edf0', '#6cd9dd', '#014548']) {
      expect(json).not.toContain(rendered);
    }
  });

  it('D-01 shape 2 — cleared saves BOTH columns null', async () => {
    renderSettings();
    const group = await screen.findByRole('group', { name: 'Choose a default color:' });
    const rose = within(group).getByRole('button', { name: 'Rose' });
    fireEvent.click(rose);
    fireEvent.click(rose); // toggle back off

    const settings = await saveAndCapture();
    expect(settings.color_preset).toBeNull();
    expect(settings.background_color).toBeNull();
  });

  /*
   * The save-path filter (code review #8/#12/#15). Each case is a value the picker
   * can legitimately be SEEDED with — `storedGroupColour` reads whatever the two
   * columns hold — and each used to be forwarded to the backend verbatim.
   */
  it('#8: a group storing the model default #ffffff does NOT re-persist it', async () => {
    renderSettings({}, { id: GROUP_ID, name: GROUP_NAME, background_color: '#ffffff' });
    const settings = await saveAndCapture();
    // White is the column's model default, not a chosen colour. Re-persisting it on
    // every unrelated save is the mechanism that manufactured the D-28 white cards.
    expect(settings.background_color).toBeNull();
    expect(settings.color_preset).toBeNull();
  });

  it('#12: a non-canonical preset id normalises instead of 400-ing the whole save', async () => {
    renderSettings({}, { id: GROUP_ID, name: GROUP_NAME, color_preset: 'Blue' });
    const settings = await saveAndCapture();
    // `resolveGroupGround` lower-cases before the palette lookup, so 'Blue' RENDERS.
    // The save path now agrees, instead of forwarding it to background_color where
    // the backend's six-hex-digit rule rejects it and blocks every other setting.
    expect(settings.color_preset).toBe('blue');
    expect(settings.background_color).toBeNull();
  });

  it('#15/M1: an unknown preset id (BE-first skew) is PRESERVED — neither sent nor nulled', async () => {
    renderSettings({}, { id: GROUP_ID, name: GROUP_NAME, color_preset: 'lime' });
    const settings = await saveAndCapture();

    /*
     * CORRECTED 2026-08-31 (code review round 2, M1). This case previously asserted
     * `color_preset === null` and `background_color === null` — i.e. it PINNED THE
     * WIPE. The round-1 fix nulled an unrecognised colour to stop it 400-ing, and this
     * test locked that in. It was worse than the bug: the 400 blocked the save but kept
     * the value; nulling destroys it behind a success toast.
     *
     * The keys must be ABSENT, not null. Absence is what makes the route's
     * `if (x !== undefined)` destructure leave both columns untouched; `null` is a
     * value and would be written. `toBeNull()` cannot tell those apart, which is
     * exactly how the wrong behaviour passed review the first time.
     */
    expect(settings).not.toHaveProperty('color_preset');
    expect(settings).not.toHaveProperty('background_color');
    // …and the rest of the form still saves, which is the whole point of not 400-ing.
    expect(settings).toHaveProperty('profile_picture_url');
    expect(settings).toHaveProperty('background_image_url');
    // The unrecognised value is never echoed back to the server in any field.
    expect(JSON.stringify(settings)).not.toContain('lime');
  });

  it('#15/M1: the D-06 clear still sends explicit nulls — preservation must not swallow it', async () => {
    // The guard must distinguish "a value I do not understand" from "the user cleared
    // the colour". An empty form state is the D-06 clear and MUST write both columns
    // null; if the preserve branch caught it, tapping a swatch off would silently do
    // nothing and the cleared state would be unreachable again.
    renderSettings({}, { id: GROUP_ID, name: GROUP_NAME, color_preset: 'rose' });
    const group = await screen.findByRole('group', { name: 'Choose a default color:' });
    fireEvent.click(within(group).getByRole('button', { name: 'Rose' })); // toggles OFF

    const settings = await saveAndCapture();
    expect(settings.color_preset).toBeNull();
    expect(settings.background_color).toBeNull();
  });

  it('D-01 shape 3 — a legacy hex group still saves the HEX, with no preset id', async () => {
    renderSettings({}, { id: GROUP_ID, name: GROUP_NAME, background_color: '#1e1e2e' });
    await screen.findByRole('group', { name: 'Choose a default color:' });

    const settings = await saveAndCapture();
    expect(settings.background_color).toBe('#1e1e2e');
    expect(settings.color_preset).toBeNull();
  });

  it('AMENDMENT E (Defect 1) — saving an unrelated field does NOT wipe a migrated group\'s colour', async () => {
    // The data-loss head. After plan 88.3.1-05 a migrated group carries
    // `color_preset` with `background_color` NULL. A seed that read only the
    // legacy column would open the picker showing NO colour, and this save would
    // then send both columns null — silently erasing the group's colour.
    renderSettings({}, { id: GROUP_ID, name: GROUP_NAME, color_preset: 'blue', background_color: null });
    const group = await screen.findByRole('group', { name: 'Choose a default color:' });

    // the picker opens ALREADY showing the stored preset …
    expect(within(group).getByRole('button', { name: 'Blue' })).toHaveAttribute(
      'aria-pressed',
      'true',
    );

    // … the owner changes something else entirely …
    fireEvent.click(screen.getByTitle('Dice'));

    // … and the colour survives the save.
    const settings = await saveAndCapture();
    expect(settings.color_preset).toBe('blue');
    expect(settings.background_color).toBeNull();
    expect(settings.profile_picture_url).toBe('\u{1F3B2}');
  });
});

describe('Phase 88.6-20 — the leave-group failure is ANNOUNCED (R1 third arm / WCAG 4.1.3)', () => {
  /*
   * MATCHED PAIR with plan 88.6-19's shipped arm for `ManageMembers.js`'s leave-confirm flow:
   * same markup shape, same flow, different surface. One phase must not ship two standards for
   * one shape, least of all with the weaker one on the destructive path.
   *
   * The FAILING half of the old behaviour was not that the message was wrong — it was that a
   * bare conditional error `<p>` is never announced at all, so a screen-reader user who
   * confirmed Leave Group and hit a failure got a section that stayed open and no reason.
   */
  const asMember = { userRole: 'member' as const };

  async function openLeaveConfirm() {
    renderSettings(asMember);
    fireEvent.click(await screen.findByRole('button', { name: 'Leave Group' }));
    return await screen.findByRole('button', { name: 'Confirm Leave' });
  }

  it('the live region is mounted BEFORE the failure, empty, and the Confirm control names it', async () => {
    // THE EMPTY-FIRST MOUNT IS THE MECHANISM. Screen readers announce CHANGES to a live region,
    // not the conditional mount of a new one — so `{leaveError && <StatusRegion …>}` would be
    // the same defect wearing the primitive's name. This is the PRESERVATION half of the pair:
    // it asserts the region exists while nothing has gone wrong yet.
    const confirm = await openLeaveConfirm();

    const describedBy = confirm.getAttribute('aria-describedby');
    expect(describedBy, 'the Confirm control does not name a description').toBeTruthy();
    const region = document.getElementById(describedBy as string);
    expect(region, 'aria-describedby points at nothing').not.toBeNull();
    expect(region).toHaveAttribute('role', 'status');
    expect(region).toHaveAttribute('aria-live', 'polite');
    expect(region).toHaveAttribute('aria-atomic', 'true');
    expect(region!.textContent).toBe('');
  });

  it('a failed leave puts the RATIFIED reason into that same region, and logs to the error channel', async () => {
    (groupsAPI.leaveGroup as Mock).mockRejectedValue(
      new Error('ETIMEDOUT: upstream took too long')
    );
    const confirm = await openLeaveConfirm();
    const region = document.getElementById(confirm.getAttribute('aria-describedby') as string)!;

    fireEvent.click(confirm);

    // Settle on the branch under test — the region CARRYING text — rather than on its absence,
    // which is satisfied on the first tick and never observes the state (the 88.6-15 trap).
    await waitFor(() => expect(region.textContent).not.toBe(''));

    // it is the SAME node that was mounted empty, so the text change is what announces
    expect(document.getElementById(confirm.getAttribute('aria-describedby') as string)).toBe(region);
    // the ratified register, not the upstream string
    expect(region.textContent).not.toContain('ETIMEDOUT');
    expect(region.textContent).toBe(getFetchErrorMessage(new Error('x')));
    // the section stays OPEN — a toast would have been the wrong treatment here
    expect(screen.getByRole('button', { name: 'Confirm Leave' })).toBeInTheDocument();

    // #101: the handler had NO logging channel at all before this plan. `logger.error` and not
    // `logger.info` — a NET-NEW error channel on an irreversible path, not a channel move.
    expect(logger.error as Mock).toHaveBeenCalled();
    expect((logger.error as Mock).mock.calls[0][0]).toContain('leaving group');
  });
});
