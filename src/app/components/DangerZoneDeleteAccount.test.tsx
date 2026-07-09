// Behavioral coverage for the account-deletion flow (Phase 87.2-07). The
// destructive path gets automated coverage of the pieces that must not regress:
//   (a) the fixed-phrase type-to-confirm gate (button disabled until exact),
//   (b) the blocked-state links read from the NESTED 409 envelope seam,
//   (c) the three-way DELETE outcome split — success + definitive-500 branches.
// usersAPI is mocked; ApiError + getEnvelopeDetails stay REAL so the nested
// err.details.details unwrap is exercised end-to-end, not stubbed.
import * as React from 'react';
import { render, screen, cleanup, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { ApiError } from '@/lib/api';
import DangerZoneDeleteAccount, {
  classifyDeleteError,
} from './DangerZoneDeleteAccount';

// Keep ApiError + getEnvelopeDetails REAL; mock only the network calls.
vi.mock('@/lib/api', async () => {
  const actual = await vi.importActual<typeof import('@/lib/api')>('@/lib/api');
  return {
    ...actual,
    usersAPI: {
      getDeletionBlockers: vi.fn(),
      deleteAccount: vi.fn(),
    },
  };
});

// Re-import the mocked object so tests can program per-case behavior.
import { usersAPI } from '@/lib/api';
const mockGetBlockers = usersAPI.getDeletionBlockers as ReturnType<typeof vi.fn>;
const mockDeleteAccount = usersAPI.deleteAccount as ReturnType<typeof vi.fn>;

// Deterministic navigation seam: replace window.location with a spy-able stub.
let assignSpy: ReturnType<typeof vi.fn>;

beforeEach(() => {
  vi.clearAllMocks();
  assignSpy = vi.fn();
  Object.defineProperty(window, 'location', {
    configurable: true,
    value: { assign: assignSpy, href: '' },
    writable: true,
  });
});

afterEach(cleanup);

/** Open the modal and wait for the pre-flight to settle (input enabled). */
async function openAndSettle(user: ReturnType<typeof userEvent.setup>) {
  await user.click(screen.getByRole('button', { name: /delete my account/i }));
  await waitFor(() =>
    expect(screen.getByPlaceholderText('delete my account')).not.toBeDisabled()
  );
}

describe('DangerZoneDeleteAccount — type-to-confirm gate', () => {
  it('keeps the confirm button disabled until the input exactly equals the phrase', async () => {
    mockGetBlockers.mockResolvedValue({ groups: [] });
    const user = userEvent.setup();
    render(<DangerZoneDeleteAccount />);
    await openAndSettle(user);

    const confirmBtn = screen.getByRole('button', { name: 'Delete my account' });
    expect(confirmBtn).toBeDisabled();

    const input = screen.getByPlaceholderText('delete my account');
    await user.type(input, 'delete my');
    expect(confirmBtn).toBeDisabled();

    await user.type(input, ' account');
    expect(confirmBtn).toBeEnabled();
  });

  it('does not issue the DELETE when the pre-flight returns non-empty groups', async () => {
    mockGetBlockers.mockResolvedValue({
      groups: [{ id: 'g1', name: 'Catan Crew', memberCount: 4 }],
    });
    const user = userEvent.setup();
    render(<DangerZoneDeleteAccount />);
    await user.click(
      screen.getByRole('button', { name: /delete my account/i })
    );

    const link = await screen.findByRole('link', { name: 'Catan Crew' });
    expect(link).toHaveAttribute('href', '/groupHomePage?id=g1');
    // Blocked state never enables the destructive action.
    expect(
      screen.queryByRole('button', { name: 'Delete my account' })
    ).not.toBeInTheDocument();
    expect(mockDeleteAccount).not.toHaveBeenCalled();
  });
});

describe('DangerZoneDeleteAccount — DELETE outcome split', () => {
  it('renders named blocked-state links from a NESTED owner_of_active_groups 409', async () => {
    mockGetBlockers.mockResolvedValue({ groups: [] });
    // The whole error body lands in ApiError.details, so the groups list is
    // nested at err.details.details.groups (getEnvelopeDetails unwraps it).
    mockDeleteAccount.mockRejectedValue(
      new ApiError('You still own active groups', 'owner_of_active_groups', 409, {
        code: 'owner_of_active_groups',
        message: 'You still own active groups',
        details: {
          groups: [
            { id: 'g7', name: 'Wingspan Wing', memberCount: 3 },
            { id: 'g9', name: 'Root Rulers', memberCount: 5 },
          ],
        },
        error: 'You still own active groups',
      })
    );

    const user = userEvent.setup();
    render(<DangerZoneDeleteAccount />);
    await openAndSettle(user);
    await user.type(
      screen.getByPlaceholderText('delete my account'),
      'delete my account'
    );
    await user.click(screen.getByRole('button', { name: 'Delete my account' }));

    const link1 = await screen.findByRole('link', { name: 'Wingspan Wing' });
    expect(link1).toHaveAttribute('href', '/groupHomePage?id=g7');
    expect(screen.getByRole('link', { name: 'Root Rulers' })).toHaveAttribute(
      'href',
      '/groupHomePage?id=g9'
    );
    // Blocked — the flow stays open, no logout navigation.
    expect(assignSpy).not.toHaveBeenCalled();
  });

  it('shows a generic blocked failure message when the 409 envelope has no renderable groups (WR-05)', async () => {
    mockGetBlockers.mockResolvedValue({ groups: [] });
    // Contract drift / stripped body: blocked outcome with EMPTY details.groups.
    // Must NOT silently no-op — the failure-message slot gets a generic
    // blocked explanation, the session survives, and no navigation fires.
    mockDeleteAccount.mockRejectedValue(
      new ApiError('You still own active groups', 'owner_of_active_groups', 409, {
        code: 'owner_of_active_groups',
        message: 'You still own active groups',
        details: { groups: [] },
        error: 'You still own active groups',
      })
    );

    const user = userEvent.setup();
    render(<DangerZoneDeleteAccount />);
    await openAndSettle(user);
    await user.type(
      screen.getByPlaceholderText('delete my account'),
      'delete my account'
    );
    await user.click(screen.getByRole('button', { name: 'Delete my account' }));

    expect(
      await screen.findByText(
        'You still own groups with other members. Transfer ownership, then try again.'
      )
    ).toBeInTheDocument();
    expect(assignSpy).not.toHaveBeenCalled();
    // Modal stays in the confirm state (not the blocked-groups rendering).
    expect(screen.getByPlaceholderText('delete my account')).toBeInTheDocument();
  });

  it('shows the generic blocked failure message when details.groups is entirely absent (WR-05)', async () => {
    mockGetBlockers.mockResolvedValue({ groups: [] });
    mockDeleteAccount.mockRejectedValue(
      new ApiError('You still own active groups', 'owner_of_active_groups', 409, {
        code: 'owner_of_active_groups',
        message: 'You still own active groups',
        error: 'You still own active groups',
      })
    );

    const user = userEvent.setup();
    render(<DangerZoneDeleteAccount />);
    await openAndSettle(user);
    await user.type(
      screen.getByPlaceholderText('delete my account'),
      'delete my account'
    );
    await user.click(screen.getByRole('button', { name: 'Delete my account' }));

    expect(
      await screen.findByText(
        'You still own groups with other members. Transfer ownership, then try again.'
      )
    ).toBeInTheDocument();
    expect(assignSpy).not.toHaveBeenCalled();
  });

  it('navigates to logout->goodbye on DELETE success', async () => {
    mockGetBlockers.mockResolvedValue({ groups: [] });
    mockDeleteAccount.mockResolvedValue({ message: 'deleted' });

    const user = userEvent.setup();
    render(<DangerZoneDeleteAccount />);
    await openAndSettle(user);
    await user.type(
      screen.getByPlaceholderText('delete my account'),
      'delete my account'
    );
    await user.click(screen.getByRole('button', { name: 'Delete my account' }));

    await waitFor(() =>
      expect(assignSpy).toHaveBeenCalledWith('/api/auth/logout?returnTo=/goodbye')
    );
  });

  it('keeps the modal open with the retry message on a definitive 500 and does NOT navigate', async () => {
    mockGetBlockers.mockResolvedValue({ groups: [] });
    mockDeleteAccount.mockRejectedValue(
      new ApiError('Server error', 'internal', 500, {
        code: 'internal',
        message: 'Server error',
      })
    );

    const user = userEvent.setup();
    render(<DangerZoneDeleteAccount />);
    await openAndSettle(user);
    await user.type(
      screen.getByPlaceholderText('delete my account'),
      'delete my account'
    );
    await user.click(screen.getByRole('button', { name: 'Delete my account' }));

    expect(
      await screen.findByText(
        'Deletion failed — nothing was deleted. Please try again.'
      )
    ).toBeInTheDocument();
    expect(assignSpy).not.toHaveBeenCalled();
    // Modal stays open — the confirm input is still present.
    expect(screen.getByPlaceholderText('delete my account')).toBeInTheDocument();
  });
});

describe('classifyDeleteError — outcome lanes', () => {
  it('classifies the owner gate as blocked', () => {
    expect(
      classifyDeleteError(
        new ApiError('x', 'owner_of_active_groups', 409, {})
      )
    ).toBe('blocked');
  });

  it('classifies network, 504/408 proxy abort, and already-deleted as ambiguous', () => {
    expect(classifyDeleteError(new ApiError('x', 'network', 0))).toBe(
      'ambiguous'
    );
    expect(classifyDeleteError(new ApiError('x', 'internal', 504))).toBe(
      'ambiguous'
    );
    expect(classifyDeleteError(new ApiError('x', 'unknown', 408))).toBe(
      'ambiguous'
    );
    expect(classifyDeleteError(new ApiError('x', 'not_found', 404))).toBe(
      'ambiguous'
    );
    expect(classifyDeleteError(new ApiError('x', 'account_deleted', 410))).toBe(
      'ambiguous'
    );
  });

  it('classifies a received-body 500 and other 4xx as definitive', () => {
    expect(classifyDeleteError(new ApiError('x', 'internal', 500))).toBe(
      'definitive'
    );
    expect(classifyDeleteError(new ApiError('x', 'validation', 400))).toBe(
      'definitive'
    );
    expect(classifyDeleteError(new ApiError('x', 'forbidden', 403))).toBe(
      'definitive'
    );
  });
});
