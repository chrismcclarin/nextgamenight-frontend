// Behavioral coverage for the account-deletion flow (Phase 87.2-07). The
// destructive path gets automated coverage of the pieces that must not regress:
//   (a) the fixed-phrase type-to-confirm gate (button disabled until exact),
//   (b) the blocked-state links read from the NESTED 409 envelope seam,
//   (c) the three-way DELETE outcome split — success + definitive-500 branches.
// usersAPI is mocked; ApiError + getEnvelopeDetails stay REAL so the nested
// err.details.details unwrap is exercised end-to-end, not stubbed.
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

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

  it('renders the Google Calendar reconnect note when the 409 carries google_access_revoked: true (WR-02)', async () => {
    mockGetBlockers.mockResolvedValue({ groups: [] });
    // Blocked at the in-transaction re-check — the BE has ALREADY revoked the
    // user's Google Calendar integration and flags it on the envelope details.
    mockDeleteAccount.mockRejectedValue(
      new ApiError('You still own active groups', 'owner_of_active_groups', 409, {
        code: 'owner_of_active_groups',
        message: 'You still own active groups',
        details: {
          groups: [{ id: 'g7', name: 'Wingspan Wing', memberCount: 3 }],
          google_access_revoked: true,
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

    await screen.findByRole('link', { name: 'Wingspan Wing' });
    expect(
      screen.getByText(/your Google Calendar connection was reset/i)
    ).toBeInTheDocument();
    expect(assignSpy).not.toHaveBeenCalled();
  });

  it('does NOT render the reconnect note on a blocked 409 without google_access_revoked (WR-02)', async () => {
    mockGetBlockers.mockResolvedValue({ groups: [] });
    mockDeleteAccount.mockRejectedValue(
      new ApiError('You still own active groups', 'owner_of_active_groups', 409, {
        code: 'owner_of_active_groups',
        message: 'You still own active groups',
        details: {
          groups: [{ id: 'g7', name: 'Wingspan Wing', memberCount: 3 }],
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

    await screen.findByRole('link', { name: 'Wingspan Wing' });
    expect(
      screen.queryByText(/your Google Calendar connection was reset/i)
    ).not.toBeInTheDocument();
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

  // Phase 88.8 (BOPS-05, SPEC R7 / D-19) — THE distinguishing test for the new
  // arm. Asserting only "not the ambiguous lane" would be green against the
  // unmodified component (a not_provisioned@404 already falls through to
  // 'definitive'); what is red without the arm is the COPY: today the user gets
  // the generic "Deletion failed — nothing was deleted. Please try again.",
  // which invites a retry that will fail identically forever. The reload
  // instruction is the only thing that actually resolves their state, because a
  // reload runs the just-in-time provisioning fetch.
  it('shows the never-provisioned reload copy (NOT the generic retry copy) and keeps the session', async () => {
    mockGetBlockers.mockResolvedValue({ groups: [] });
    mockDeleteAccount.mockRejectedValue(
      new ApiError('This account has no stored data yet.', 'not_provisioned', 404, {
        code: 'not_provisioned',
        message: 'This account has no stored data yet.',
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
        "There's no account data to delete yet. Reload the page and try again."
      )
    ).toBeInTheDocument();
    // NOT the generic definitive copy.
    expect(
      screen.queryByText(
        'Deletion failed — nothing was deleted. Please try again.'
      )
    ).not.toBeInTheDocument();
    // The session survives: no logout navigation, modal still open.
    expect(assignSpy).not.toHaveBeenCalled();
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

  // Phase 88.8 (BOPS-05, SPEC R7 / D-19). The never-provisioned 404 registered
  // BE-side by plan 07. It is DEFINITIVE and NON-DESTRUCTIVE: nothing was
  // deleted, nothing was lost, and the session must survive — the opposite of
  // the ambiguous lane, which navigates to logout->goodbye.
  //
  // NOTE ON WHAT THIS BLOCK DOES AND DOES NOT PROVE. The value assertion below
  // is GREEN against the unmodified classifier by fall-through: the already-gone
  // lane matches only not_found / account_deleted / status 410, so a
  // not_provisioned@404 misses all three and reaches `return 'definitive'`. It
  // is here as a REGRESSION pin, not as proof of the arm. The two things that
  // are actually red without the arm are (a) the rendered-copy test in the
  // outcome-split block above and (b) the source-order assertion below.
  it('classifies the never-provisioned 404 as definitive — the session survives', () => {
    expect(
      classifyDeleteError(new ApiError('x', 'not_provisioned', 404, {}))
    ).toBe('definitive');
  });

  it('leaves the three pre-existing lanes exactly where they were', () => {
    // Re-asserted alongside the new arm so a future REORDERING is caught here
    // and not in production. Owner gate, both ambiguous sub-lanes, definitive.
    expect(
      classifyDeleteError(new ApiError('x', 'owner_of_active_groups', 409, {}))
    ).toBe('blocked');
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
    // A bare 410 with no matching code still falls in the already-gone lane.
    expect(classifyDeleteError(new ApiError('x', 'unknown', 410))).toBe(
      'ambiguous'
    );
    expect(classifyDeleteError(new ApiError('x', 'internal', 500))).toBe(
      'definitive'
    );
  });
});

// Phase 88.8: two SOURCE assertions. Neither can be expressed as a behavioural
// test, and both guard an invariant whose only other enforcement is the
// TypeScript compiler — which is not what runs in the drift-gate registry.
describe('Phase 88.8 — source-level invariants', () => {
  // Resolved from the vitest root (the frontend package dir), NOT from
  // import.meta.url — vite rewrites that to an http:// URL under the jsdom
  // environment and readFileSync rejects it.
  const fromRoot = (rel: string) => readFileSync(resolve(process.cwd(), rel), 'utf8');
  const componentSource = fromRoot('src/app/components/DangerZoneDeleteAccount.tsx');

  it('places the not_provisioned arm ABOVE the already-gone lane', () => {
    // The arm's VALUE is indistinguishable from the fall-through today, so
    // ordering is the only thing that can be asserted mechanically. It matters
    // because a future widening of the already-gone lane (say, to every 404)
    // would otherwise swallow not_provisioned into a false "your account was
    // deleted" — the user would be signed out on an account that still exists.
    const armIndex = componentSource.indexOf("err.code === 'not_provisioned'");
    const alreadyGoneIndex = componentSource.indexOf("err.code === 'not_found'");
    expect(armIndex).toBeGreaterThan(-1);
    expect(alreadyGoneIndex).toBeGreaterThan(-1);
    expect(armIndex).toBeLessThan(alreadyGoneIndex);
  });

  it('keeps MESSAGE_BY_CODE annotated as the FULL mapped type, never a Partial', () => {
    // useFetchErrorState.ts forbids a Partial widening in prose; the compiler
    // enforces it; nothing mechanical did until now. A `Partial<Record<...>>`
    // here would make every FUTURE code silently missing rather than a build
    // failure — the exhaustiveness guarantee is the whole value of the Record.
    const hookSource = fromRoot('src/components/ui/useFetchErrorState.ts');
    expect(hookSource).toContain(
      'const MESSAGE_BY_CODE: Record<FetchErrorCode, string> = {'
    );
    expect(hookSource).not.toMatch(
      /const MESSAGE_BY_CODE\s*:\s*Partial\s*</
    );
    // And the new code has an entry, so the Record really is exhaustive over
    // the widened union rather than exhaustive over a stale one.
    expect(hookSource).toContain('not_provisioned:');
  });
});
