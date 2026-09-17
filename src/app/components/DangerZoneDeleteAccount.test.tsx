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
import { act, fireEvent, render, screen, cleanup, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { withoutComments } from '../../test-utils/sourceScan';

import { ApiError } from '@/lib/api';
import DangerZoneDeleteAccount, {
  classifyDeleteError,
  DELETE_REQUEST_TIMEOUT_MS,
} from './DangerZoneDeleteAccount';

// Phase 88.6-30 (T-88.6-87): the pre-flight's swallowed `.catch` gains a diagnostic
// channel. `errCtx` stays REAL so the T-84-01 payload bound (name + message only) is
// exercised rather than stubbed; only the Sentry-bound sink is spied.
vi.mock('@/lib/logger', async () => {
  const actual = await vi.importActual<typeof import('@/lib/logger')>('@/lib/logger');
  return {
    ...actual,
    logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn() },
  };
});
import { logger } from '@/lib/logger';
const mockLoggerInfo = logger.info as ReturnType<typeof vi.fn>;

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
  // COMMENTS BLANKED via the repo's shared scanner: both files below describe
  // these invariants in prose, so a raw text scan would match the comment about
  // the rule rather than the code obeying it.
  const fromRoot = (rel: string) =>
    withoutComments(readFileSync(resolve(process.cwd(), rel), 'utf8'));
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

// ─────────────────────────────────────────────────────────────────────────────
// Phase 88.6-30 — D-33 (staleness), T-88.6-87 (diagnostic), AC-21 as amended by
// D52 (in-flight dismissal), D1 (the client bound), D28 (the failure region),
// D24 (the outcome-split focus restore).
// ─────────────────────────────────────────────────────────────────────────────

interface Deferred<T> {
  promise: Promise<T>;
  resolve: (value: T) => void;
  reject: (reason?: unknown) => void;
}

function deferred<T>(): Deferred<T> {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  // A rejection that is settled LATE would otherwise be an unhandled rejection in
  // the window before the component's own `.catch` is attached.
  promise.catch(() => {});
  return { promise, resolve, reject };
}

type Blockers = { groups: Array<{ id: string; name: string; memberCount: number }> };

const CATAN: Blockers = {
  groups: [{ id: 'g1', name: 'Catan Crew', memberCount: 4 }],
};

const trigger = () => screen.getByRole('button', { name: /^delete my account$/i });
const confirmInput = () => screen.getByPlaceholderText('delete my account');
const cancelAction = () => screen.getByRole('button', { name: 'Cancel' });
/** The always-mounted polite progress region (D52 piece (i)). */
const progressRegion = () => screen.getByRole('status');
/** Its `tabIndex={-1}` wrapper — the node the false->true focus move targets. */
const progressFocusTarget = () => progressRegion().parentElement as HTMLElement;

/** Open the modal and drive the DELETE to its in-flight state, holding it there. */
async function enterDeletingState(user: ReturnType<typeof userEvent.setup>) {
  mockGetBlockers.mockResolvedValue({ groups: [] });
  const inFlight = deferred<{ message: string }>();
  mockDeleteAccount.mockReturnValue(inFlight.promise);
  render(<DangerZoneDeleteAccount />);
  await user.click(trigger());
  await waitFor(() => expect(confirmInput()).not.toBeDisabled());
  await user.type(confirmInput(), 'delete my account');
  await user.click(screen.getByRole('button', { name: 'Delete my account' }));
  await waitFor(() =>
    expect(screen.getByRole('button', { name: 'Deleting…' })).toBeInTheDocument()
  );
  return inFlight;
}

describe('D-33 — the pre-flight generation guard (plan 29 idiom, folded todo IN-05)', () => {
  it('discards a SUPERSEDED pre-flight: neither its result NOR its pending-flag clear lands', async () => {
    // The todo's stated defect is the `.finally` half — a stale
    // `setPreflightPending(false)` re-enabling the confirm input under a pre-flight
    // that is still outstanding. A guard on `.then` alone leaves the reported bug.
    const first = deferred<Blockers>();
    const second = deferred<Blockers>();
    mockGetBlockers
      .mockReturnValueOnce(first.promise)
      .mockReturnValueOnce(second.promise);

    const user = userEvent.setup();
    render(<DangerZoneDeleteAccount />);

    await user.click(trigger());           // open  -> pre-flight #1 outstanding
    await user.click(cancelAction());      // close -> generation invalidated
    await user.click(trigger());           // reopen -> pre-flight #2 outstanding
    expect(confirmInput()).toBeDisabled();

    await act(async () => {
      first.resolve(CATAN);
      await Promise.resolve();
    });

    expect(
      screen.queryByRole('link', { name: 'Catan Crew' }),
      'a superseded pre-flight result was applied to a reopened modal'
    ).toBeNull();
    expect(
      confirmInput(),
      "a superseded pre-flight's `.finally` cleared the pending flag while pre-flight #2 was still outstanding — the todo's stated defect"
    ).toBeDisabled();

    // …and the CURRENT one still settles the flag, so the guard did not wedge it.
    await act(async () => {
      second.resolve({ groups: [] });
      await Promise.resolve();
    });
    await waitFor(() => expect(confirmInput()).not.toBeDisabled());
  });

  it('NEGATIVE CONTROL — a current pre-flight IS applied and DOES clear the pending flag', async () => {
    // A guard that discards everything is not a guard.
    mockGetBlockers.mockResolvedValue(CATAN);
    const user = userEvent.setup();
    render(<DangerZoneDeleteAccount />);
    await user.click(trigger());
    expect(await screen.findByRole('link', { name: 'Catan Crew' })).toBeInTheDocument();
  });

  it('invalidates on UNMOUNT — a pre-flight settling after the component is gone writes nothing and logs nothing', async () => {
    // React 18 removed the unmounted-setState warning, so a state write after
    // unmount is silent and unassertable. The OBSERVABLE consequence of the
    // unmount clause is the diagnostic: a rejection that lands after unmount must
    // produce no `logger.info`, exactly as a superseded one must not.
    const late = deferred<Blockers>();
    mockGetBlockers.mockReturnValueOnce(late.promise);
    const user = userEvent.setup();
    const view = render(<DangerZoneDeleteAccount />);
    await user.click(trigger());
    view.unmount();

    await act(async () => {
      late.reject(new Error('boom'));
      await Promise.resolve();
    });
    expect(
      mockLoggerInfo,
      'a pre-flight that settled after unmount still reached the diagnostic — the generation counter is not invalidated on unmount'
    ).not.toHaveBeenCalled();
  });
});

describe('T-88.6-87 — the pre-flight failure has a diagnostic channel and an honest comment', () => {
  it('logs a CURRENT rejection exactly once, carrying only the error name and message', async () => {
    mockGetBlockers.mockRejectedValue(
      new ApiError('upstream exploded', 'internal', 500, { secret: 'do-not-forward' })
    );
    const user = userEvent.setup();
    render(<DangerZoneDeleteAccount />);
    await user.click(trigger());
    await waitFor(() => expect(mockLoggerInfo).toHaveBeenCalledTimes(1));

    const [message, ctx] = mockLoggerInfo.mock.calls[0];
    expect(message).toBe('deletion pre-flight failed');
    // T-84-01: the payload is bounded to the caught error's NAME and MESSAGE —
    // never the blockers list, never the raw Error as ctx (logger.ts:24 types ctx
    // as a plain record).
    expect(Object.keys(ctx as object).sort()).toEqual(['message', 'name']);
    expect(ctx).not.toBeInstanceOf(Error);
    expect(JSON.stringify(ctx)).not.toContain('do-not-forward');
  });

  it('logs a STALE rejection not at all — the diagnostic sits AFTER the generation check', async () => {
    const first = deferred<Blockers>();
    const second = deferred<Blockers>();
    mockGetBlockers
      .mockReturnValueOnce(first.promise)
      .mockReturnValueOnce(second.promise);
    const user = userEvent.setup();
    render(<DangerZoneDeleteAccount />);
    await user.click(trigger());
    await user.click(cancelAction());
    await user.click(trigger());

    await act(async () => {
      first.reject(new Error('stale'));
      await Promise.resolve();
    });
    expect(mockLoggerInfo).not.toHaveBeenCalled();
  });

  it('leaves the UX SWALLOW byte-unchanged — a failed pre-flight surfaces no error state and no new copy', async () => {
    mockGetBlockers.mockRejectedValue(new Error('transient'));
    const user = userEvent.setup();
    render(<DangerZoneDeleteAccount />);
    await user.click(trigger());
    // The flow proceeds: the authoritative gate re-checks on the DELETE.
    await waitFor(() => expect(confirmInput()).not.toBeDisabled());
    // Only the diagnostic channel changed. The failure region is mounted (D28) but
    // EMPTY, and no new user-facing copy appeared.
    expect(screen.getByRole('alert')).toHaveTextContent('');
    expect(screen.queryByText(/pre-?flight/i)).toBeNull();
    expect(
      screen.getByRole('button', { name: 'Delete my account' })
    ).toBeInTheDocument();
  });
});

describe('AC-21 as amended by D52 — an in-flight DELETE cannot be dismissed', () => {
  it('gates Cancel with aria-disabled while keeping it FOCUSABLE and in the tab order', async () => {
    const user = userEvent.setup();
    await enterDeletingState(user);

    const cancel = cancelAction();
    expect(cancel).toHaveAttribute('aria-disabled', 'true');
    // Focusable-but-inert: the native attribute would remove it from the focus
    // order, and with the danger action already natively disabled and
    // `hideCloseButton` set, the dialog would contain ZERO tab-reachable controls
    // during an IRREVERSIBLE deletion.
    expect(cancel).not.toHaveAttribute('disabled');
    expect(cancel).not.toHaveAttribute('aria-hidden');
    cancel.focus();
    expect(document.activeElement).toBe(cancel);

    // `aria-disabled` is advisory — the HANDLER guard is what enforces the ruling.
    await user.click(cancel);
    expect(screen.getByRole('button', { name: 'Deleting…' })).toBeInTheDocument();
    expect(confirmInput()).toHaveValue('delete my account');
  });

  it('carries NO aria-disabled attribute at all when not deleting, and still dismisses + resets', async () => {
    mockGetBlockers.mockResolvedValue({ groups: [] });
    const user = userEvent.setup();
    render(<DangerZoneDeleteAccount />);
    await user.click(trigger());
    await waitFor(() => expect(confirmInput()).not.toBeDisabled());
    await user.type(confirmInput(), 'delete');

    // `|| undefined` so the attribute is ABSENT rather than "false", matching
    // NextGameNightCard.tsx:390's shipped shape.
    expect(cancelAction()).not.toHaveAttribute('aria-disabled');
    await user.click(cancelAction());
    await waitFor(() =>
      expect(screen.queryByPlaceholderText('delete my account')).toBeNull()
    );
    // resetState ran: reopening presents an empty confirmation phrase.
    await user.click(trigger());
    await waitFor(() => expect(confirmInput()).toHaveValue(''));
  });

  it('ignores Escape while deleting — `dismissable={false}` deliberately leaves that path enabled', async () => {
    const user = userEvent.setup();
    await enterDeletingState(user);
    await user.keyboard('{Escape}');
    expect(screen.getByRole('button', { name: 'Deleting…' })).toBeInTheDocument();
    expect(confirmInput()).toHaveValue('delete my account');
  });
});

describe('D52 — the announcements: a polite progress region and the converted failure region', () => {
  it('mounts the polite progress region EMPTY in the initial render, then puts the text in the SAME NODE', async () => {
    mockGetBlockers.mockResolvedValue({ groups: [] });
    const inFlight = deferred<{ message: string }>();
    mockDeleteAccount.mockReturnValue(inFlight.promise);
    const user = userEvent.setup();
    render(<DangerZoneDeleteAccount />);
    await user.click(trigger());
    await waitFor(() => expect(confirmInput()).not.toBeDisabled());

    // Empty-first: a region mounted WITH its content does not announce
    // (StatusRegion.tsx:9-12).
    const region = progressRegion();
    expect(region).toHaveTextContent('');
    expect(region).toHaveAttribute('aria-live', 'polite');

    await user.type(confirmInput(), 'delete my account');
    await user.click(screen.getByRole('button', { name: 'Delete my account' }));
    await waitFor(() => expect(progressRegion()).toHaveTextContent('Deleting…'));
    // NODE IDENTITY, not presence.
    expect(progressRegion()).toBe(region);
    // VISIBLE, per the owner ruling of 2026-09-14: this is the only feedback a
    // SIGHTED phone user gets during an irreversible deletion.
    expect(region.className).not.toMatch(/\bsr-only\b/);
    expect(region.parentElement?.className ?? '').not.toMatch(/\bsr-only\b/);
  });

  it('mounts the FAILURE region EMPTY too, and a definitive failure lands in the SAME NODE', async () => {
    mockGetBlockers.mockResolvedValue({ groups: [] });
    mockDeleteAccount.mockRejectedValue(
      new ApiError('boom', 'internal', 500, { code: 'internal' })
    );
    const user = userEvent.setup();
    render(<DangerZoneDeleteAccount />);
    await user.click(trigger());
    await waitFor(() => expect(confirmInput()).not.toBeDisabled());

    const failure = screen.getByRole('alert');
    expect(failure).toHaveTextContent('');
    expect(failure).toHaveAttribute('aria-live', 'assertive');

    await user.type(confirmInput(), 'delete my account');
    await user.click(screen.getByRole('button', { name: 'Delete my account' }));
    await waitFor(() =>
      expect(screen.getByRole('alert')).toHaveTextContent(
        'Deletion failed — nothing was deleted. Please try again.'
      )
    );
    expect(screen.getByRole('alert')).toBe(failure);
    // EXACTLY ONE region carries the failure — the progress region never does.
    expect(screen.getAllByRole('alert')).toHaveLength(1);
    expect(progressRegion()).toHaveTextContent('');
    expect(assignSpy).not.toHaveBeenCalled();
  });

  it('gives the converted region a COLOUR-ONLY className — no font-medium, and text-sm comes from the primitive', async () => {
    mockGetBlockers.mockResolvedValue({ groups: [] });
    const user = userEvent.setup();
    render(<DangerZoneDeleteAccount />);
    await user.click(trigger());
    await waitFor(() => expect(confirmInput()).not.toBeDisabled());
    const failure = screen.getByRole('alert');
    const classes = failure.className.split(/\s+/);
    expect(classes).toContain('text-content-status-error');
    expect(classes).toContain('text-sm'); // StatusRegion.tsx:43, the primitive's own default
    expect(classes).not.toContain('font-medium');
    // NextGameNightCard.tsx:457-459: do not add `empty:hidden` either.
    expect(failure.className).not.toMatch(/empty:hidden/);
  });

  it('on the BLOCKED commit the failure region is ABSENT and no failure copy is announced', async () => {
    mockGetBlockers.mockResolvedValue({ groups: [] });
    mockDeleteAccount.mockRejectedValue(
      new ApiError('blocked', 'owner_of_active_groups', 409, {
        code: 'owner_of_active_groups',
        details: { groups: [{ id: 'g7', name: 'Wingspan Wing', memberCount: 3 }] },
      })
    );
    const user = userEvent.setup();
    render(<DangerZoneDeleteAccount />);
    await user.click(trigger());
    await waitFor(() => expect(confirmInput()).not.toBeDisabled());
    await user.type(confirmInput(), 'delete my account');
    await user.click(screen.getByRole('button', { name: 'Delete my account' }));

    const lead = await screen.findByText(/You still own a group with other members/i);
    // Its arm is unmounted, so the failure region is not in the tree at all.
    expect(screen.queryByRole('alert')).toBeNull();
    // D24: focus lands on the blocked arm's LEAD paragraph — never the unmounted
    // confirm input, and never the group link, which navigates OUT of the dialog.
    expect(document.activeElement).toBe(lead);
    expect(document.activeElement).not.toBe(
      screen.getByRole('link', { name: 'Wingspan Wing' })
    );
  });
});

describe('D52 / D24 — focus lands on a NAMED element on both `deleting` edges', () => {
  it('false->true: focus moves to the tabIndex={-1} wrapper of the polite region, a node this component owns', async () => {
    // NOT `document.activeElement !== document.body`, which is vacuous in this
    // harness (keyboardOperability.test.tsx:148-153), and NOT the Radix Content
    // node, for which `Modal` forwards no ref (Modal.tsx:150-192).
    const user = userEvent.setup();
    await enterDeletingState(user);
    const target = progressFocusTarget();
    expect(target).toHaveAttribute('tabindex', '-1');
    expect(document.activeElement).toBe(target);
  });

  it('true->false with the modal still open and NOT blocked: focus returns to the confirm input', async () => {
    mockGetBlockers.mockResolvedValue({ groups: [] });
    mockDeleteAccount.mockRejectedValue(
      new ApiError('boom', 'internal', 500, { code: 'internal' })
    );
    const user = userEvent.setup();
    render(<DangerZoneDeleteAccount />);
    await user.click(trigger());
    await waitFor(() => expect(confirmInput()).not.toBeDisabled());
    await user.type(confirmInput(), 'delete my account');
    await user.click(screen.getByRole('button', { name: 'Delete my account' }));
    await waitFor(() => expect(screen.getByRole('alert')).not.toHaveTextContent(''));
    expect(document.activeElement).toBe(confirmInput());
  });
});

describe('D1 — the in-flight DELETE is BOUNDED', () => {
  it('threads a signal and lands a stall in the already-built ambiguous lane', async () => {
    mockGetBlockers.mockResolvedValue({ groups: [] });
    // A DELETE that never settles on its own — only the client bound can end it.
    mockDeleteAccount.mockImplementation(
      (signal?: AbortSignal) =>
        new Promise((_resolve, reject) => {
          signal?.addEventListener('abort', () =>
            reject(
              Object.assign(new Error('The operation was aborted.'), {
                name: 'AbortError',
              })
            )
          );
        })
    );
    // Fake timers ONLY, with fireEvent rather than userEvent: userEvent's own
    // internal delays plus `waitFor`'s polling do not compose with a frozen clock,
    // and this test is about the CLOCK, not about pointer fidelity.
    vi.useFakeTimers();
    try {
      render(<DangerZoneDeleteAccount />);
      fireEvent.click(trigger());
      await act(async () => {
        await Promise.resolve();
      });
      const input = confirmInput();
      expect(input).not.toBeDisabled();
      fireEvent.change(input, { target: { value: 'delete my account' } });
      fireEvent.click(screen.getByRole('button', { name: 'Delete my account' }));
      await act(async () => {
        await Promise.resolve();
      });

      expect(screen.getByRole('button', { name: 'Deleting…' })).toBeInTheDocument();
      expect(mockDeleteAccount).toHaveBeenCalledWith(expect.any(AbortSignal));
      // Nothing has happened yet — an unbounded request would stay here forever,
      // with Cancel guarded, Escape guarded and the overlay already closed.
      expect(assignSpy).not.toHaveBeenCalled();

      await act(async () => {
        vi.advanceTimersByTime(DELETE_REQUEST_TIMEOUT_MS + 1);
        await Promise.resolve();
        await Promise.resolve();
        await Promise.resolve();
      });
      expect(assignSpy).toHaveBeenCalledWith('/api/auth/logout?returnTo=/goodbye');
    } finally {
      vi.useRealTimers();
    }
  });

  it('pins the bound strictly ABOVE the BFF proxy timeout — a derived number, not a preference', () => {
    // A shorter value pre-empts the proxy's own 504 and converts the still-reachable
    // `blocked` (409) and `definitive` (500-rollback) outcomes into false
    // "your account has been deleted" logouts.
    const routeSource = readFileSync(
      resolve(process.cwd(), 'src/app/api/[...path]/route.ts'),
      'utf8'
    );
    const match = routeSource.match(/const PROXY_TIMEOUT_MS = ([\d_]+);/);
    expect(match, 'PROXY_TIMEOUT_MS not found in the BFF proxy route').not.toBeNull();
    const proxyTimeout = Number(match![1].replace(/_/g, ''));
    expect(DELETE_REQUEST_TIMEOUT_MS).toBeGreaterThan(proxyTimeout);
  });
});

describe('Phase 88.6-30 — source-level invariants', () => {
  const source = withoutComments(
    readFileSync(
      resolve(process.cwd(), 'src/app/components/DangerZoneDeleteAccount.tsx'),
      'utf8'
    )
  );
  const raw = readFileSync(
    resolve(process.cwd(), 'src/app/components/DangerZoneDeleteAccount.tsx'),
    'utf8'
  );

  it('keeps the danger action byte-unchanged on the NATIVE disabled attribute (arm A2 not taken)', () => {
    // Moving `:391` to `aria-disabled` per the strict 88.5 split first requires
    // minting a gated `.btn-danger` token pair in BOTH themes
    // (globals.css:1310-1314) — an owner-level token decision, not a side effect.
    expect(source).toContain('disabled={confirmDisabled}');
    expect(source).not.toMatch(/variant="danger"[\s\S]{0,160}aria-disabled/);
  });

  it('stores the generation counter in a REF, never useState and never a closured local', () => {
    // Read inside `.then`/`.catch`/`.finally` AFTER an await, where a useState
    // value is the one captured at issue time — it would pass the very staleness
    // check it exists to fail. Same rule plan 29 states at 88.6-29-PLAN.md:379.
    expect(source).toMatch(/preflightGenerationRef\s*=\s*React\.useRef/);
    expect(source).not.toMatch(/useState[^\n]*[Gg]eneration/);
  });

  it('carries the DECISION marker at the Cancel action naming both rejected alternatives', () => {
    expect(raw).toContain('DECISION Phase 88.6-30 (AC-21, mechanism amended by D52');
    // The native `disabled` attribute — AC-21's own 2026-09-09 wording.
    expect(raw).toMatch(/native `disabled`/);
    // The gated A2 move of `:391`.
    expect(raw).toMatch(/btn-danger/);
    // Both cited markers, so this reads as a considered divergence, not drift.
    expect(raw).toContain('NextGameNightCard.tsx:379-391');
    expect(raw).toContain('ConfirmDialog.tsx:160-173');
    // The Escape reason.
    expect(raw).toMatch(/onEscapeKeyDown/);
  });

  it('carries the DECISION marker distinguishing BOUNDING A WAIT from discarding a stale response', () => {
    expect(raw).toMatch(/bounds a wait[\s\S]{0,400}discard/i);
    expect(raw).toContain('88.6-29-PLAN.md:394');
  });

  it('does not edit src/lib/api.ts from here — the widened signature is plan 42 to write', () => {
    const apiSource = readFileSync(resolve(process.cwd(), 'src/lib/api.ts'), 'utf8');
    expect(apiSource).toContain('deleteAccount: (signal?: AbortSignal)');
  });
});

describe('Phase 88.6-30 task 3 — the primitives sweep (D-30, one pass)', () => {
  it('renders the card title through the Heading primitive at level 2 / 20px / 700', async () => {
    // D-04 / UI-SPEC §4.4: h2 @ 18 -> Heading 20, LEVEL PRESERVED (P4). The only h2@18
    // in the tree, so this is a one-site row of D-04's table.
    mockGetBlockers.mockResolvedValue({ groups: [] });
    render(<DangerZoneDeleteAccount />);
    const title = screen.getByRole('heading', { level: 2, name: 'Danger Zone' });
    expect(title.tagName).toBe('H2');
    expect(title).toHaveClass('text-xl');
    expect(title).toHaveClass('font-bold');
    // The weight comes from the primitive's base; the colour rides on className.
    expect(title).toHaveClass('text-content-status-error');
    expect(title.className).not.toMatch(/\btext-lg\b/);
  });

  it('renders the Danger Zone trigger through the Button primitive with no dead utilities', async () => {
    mockGetBlockers.mockResolvedValue({ groups: [] });
    render(<DangerZoneDeleteAccount />);
    const btn = trigger();
    expect(btn).toHaveClass('btn');
    expect(btn).toHaveClass('btn-danger');
    // §3.4 rule 3 / AC-3: `px-4 py-2 text-sm` are dead under unlayered `.btn` and are
    // deleted, not carried. A text-size utility on a Button is a btnCensus finding.
    expect(btn.className).not.toMatch(/\btext-(xs|sm|base|lg)\b/);
    expect(btn.className).not.toMatch(/\bp[xy]-\d/);
  });

  it('renders the destructive consequence copy at Body 16, not Label 14 (rule R2)', async () => {
    // This is the text a user reads before permanently deleting their account. Under R2 it
    // is running prose and goes to 16 — getting it wrong makes the most consequential text
    // in the app smaller.
    mockGetBlockers.mockResolvedValue({ groups: [] });
    const user = userEvent.setup();
    render(<DangerZoneDeleteAccount />);
    await user.click(trigger());
    await waitFor(() => expect(confirmInput()).not.toBeDisabled());

    const lead = screen.getByText(/This permanently deletes your account/i);
    expect(lead).toHaveClass('text-base');
    const consequences = screen.getByText(
      /The following are permanently destroyed/i
    ).parentElement as HTMLElement;
    expect(consequences).toHaveClass('text-base');
    // The field label stays at Label 14 — a `<label>` is not running prose.
    expect(screen.getByText(/To confirm, type/i)).toHaveClass('text-sm');
  });

  it('leaves NO off-scale weight utility in the file (§4.5: 400 / 700 only outside Button)', () => {
    // All five sites resolved to the EMPHASIS outcome — 400 plus a colour token the site
    // already carried — so all five are deletions. The `font-bold` on the confirm-phrase
    // span is on-scale and is not in this population.
    const swept = withoutComments(
      readFileSync(
        resolve(process.cwd(), 'src/app/components/DangerZoneDeleteAccount.tsx'),
        'utf8'
      )
    );
    expect(swept).not.toMatch(/\bfont-medium\b/);
    expect(swept).not.toMatch(/\bfont-semibold\b/);
    expect(swept).toMatch(/\bfont-bold\b/);
  });

  it('keeps the counter at Caption 12 — a counter is on §4.2 closed role list', async () => {
    // Not swept UP to 14: "counters" is an enumerated Caption role, and this span is
    // metadata beside a link, not the row's primary string.
    mockGetBlockers.mockResolvedValue(CATAN);
    const user = userEvent.setup();
    render(<DangerZoneDeleteAccount />);
    await user.click(trigger());
    await screen.findByRole('link', { name: 'Catan Crew' });
    expect(screen.getByText(/4 members/)).toHaveClass('text-xs');
  });
});
