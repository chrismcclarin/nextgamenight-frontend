// Phase 87.5 Plan 09 (SPEC Req 6): behavioral net for the TutorialProvider
// sender flip. completeTutorial persists INSIDE the user-action callback (fired
// only when the user finishes/dismisses the overlay), NOT on mount. This proves:
//
//  (a) invoking completeTutorial via the provider context with selfUuid resolved
//      persists the caller's UUID (not user.sub); and
//  (b) mounting the provider — and selfUuid transitioning undefined→resolved —
//      does NOT persist completion on its own. A mount-fire send here would
//      silently auto-complete the tutorial for new users.
import * as React from 'react';
import { render, screen, cleanup, waitFor, fireEvent } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const SELF_UUID = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';

// tutorial_version high enough that the auto-trigger effect never shows the
// overlay — isolates the completeTutorial sender from the auto-show path.
const h = vi.hoisted(() => ({ selfUuid: undefined as string | undefined }));

vi.mock('@/lib/hooks/useSelfIdentity', () => ({
  SELF_IDENTITY_KEY: ['users', 'self'],
  useSelfIdentity: () => ({
    selfUuid: h.selfUuid,
    self: h.selfUuid
      ? { id: h.selfUuid, user_id: 'auth0|self', tutorial_version: 999 }
      : undefined,
    query: { isError: false, error: null, isPending: !h.selfUuid, refetch: vi.fn() },
    isPending: !h.selfUuid,
  }),
}));

vi.mock('@/lib/hooks/selfIdentityCache', () => ({ patchSelfCache: vi.fn() }));

vi.mock('@auth0/nextjs-auth0/client', () => ({
  useUser: () => ({ user: { sub: 'auth0|self' }, isLoading: false }),
}));

vi.mock('next/navigation', () => ({ usePathname: () => '/' }));

vi.mock('@tanstack/react-query', () => ({ useQueryClient: () => ({}) }));

vi.mock('./TutorialOverlay', () => ({ default: () => null }));

vi.mock('@/lib/api', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/api')>();
  return {
    ...actual,
    usersAPI: { ...actual.usersAPI, completeTutorial: vi.fn().mockResolvedValue({}) },
  };
});

import TutorialProvider, { useTutorial } from './TutorialProvider';
import { usersAPI } from '@/lib/api';

type Mock = ReturnType<typeof vi.fn>;

function TutorialConsumer() {
  const { completeTutorial } = useTutorial();
  return <button onClick={() => completeTutorial()}>complete</button>;
}

beforeEach(() => {
  vi.clearAllMocks();
  h.selfUuid = undefined;
});

afterEach(cleanup);

describe('TutorialProvider identity flip (Plan 09 Task 2)', () => {
  it('persists the resolved selfUuid when completeTutorial is invoked by the user', async () => {
    h.selfUuid = SELF_UUID;
    render(
      <TutorialProvider>
        <TutorialConsumer />
      </TutorialProvider>
    );

    fireEvent.click(screen.getByText('complete'));

    await waitFor(() =>
      expect(usersAPI.completeTutorial as Mock).toHaveBeenCalledWith(SELF_UUID, expect.any(Number))
    );
  });

  it('does NOT persist completion on mount or on selfUuid resolving alone', async () => {
    // Mount with identity unresolved — no user action.
    h.selfUuid = undefined;
    const { rerender } = render(
      <TutorialProvider>
        <TutorialConsumer />
      </TutorialProvider>
    );
    await new Promise((r) => setTimeout(r, 20));
    expect(usersAPI.completeTutorial as Mock).not.toHaveBeenCalled();

    // Identity resolves — auto-trigger runs but must NOT auto-complete.
    h.selfUuid = SELF_UUID;
    rerender(
      <TutorialProvider>
        <TutorialConsumer />
      </TutorialProvider>
    );
    await new Promise((r) => setTimeout(r, 20));
    expect(usersAPI.completeTutorial as Mock).not.toHaveBeenCalled();
  });
});
