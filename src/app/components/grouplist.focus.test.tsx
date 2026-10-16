// Phase 88.6.1-41 — focus on the home group list when a refresh changes it (Req 5 H7/H8, D-04,
// D-05, D-07), and the D-37 consumer half: a refresh no longer blanks the list, so a control the
// user stands on survives a refresh that keeps its card.
//
// THE HARNESS. The real GroupList, wrapped in <main> because the signed-in home's page floor is
// <main> (layout.js, the main element with className flex-1). GroupSettings is replaced by a stub
// built on the HOUSE Modal, so the dialog's own close restore (plan 88.6.1-20) runs for real: a
// "Save Changes" that calls onUpdate then onClose (GroupSettings.js's save order) and a "Delete
// group" that opens a SIBLING Modal whose "Confirm delete" calls onClose then onGroupDeleted
// (GroupSettings.js's delete order). The settings Modal renders BEFORE the confirm Modal, as in
// GroupSettings.js, because the order of their unmount timers decides the first landing (A-41a).
//
// A synthetic click does not move focus in jsdom, so every control is focused with
// act(() => el.focus()) before fireEvent.click(el) (keyboardOperability.test.tsx, the same idiom).
// Positive landings use waitFor on document.activeElement; every absence is asserted
// synchronously after a positive signal or a deterministic flush (FE-TESTING-CONVENTIONS CF-26).
// Comments in this file are line comments only (CF-9).
import * as React from 'react';
import { render, screen, cleanup, waitFor, within, act, fireEvent } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const SELF_UUID = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';

type Deferred<T> = {
  promise: Promise<T>;
  resolve: (value: T) => void;
  reject: (reason?: unknown) => void;
};

function deferred<T>(): Deferred<T> {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

// Hoisted so the module factories below and the tests share one instance of each.
const fx = vi.hoisted(() => ({
  getUserGroups: vi.fn(),
  // The stub's Save and Confirm handlers await these before calling back into the list. A test
  // that does not replace them gets an already-open gate.
  saveGate: { promise: Promise.resolve() } as { promise: Promise<void> },
  deleteGate: { promise: Promise.resolve() } as { promise: Promise<void> },
}));

vi.mock('@/lib/hooks/useSelfIdentity', () => ({
  SELF_IDENTITY_KEY: ['users', 'self'],
  useSelfIdentity: () => ({
    selfUuid: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
    self: { id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', user_id: 'auth0|self' },
    query: { isError: false, error: null, refetch: vi.fn() },
    isPending: false,
  }),
}));

// The identity suite's light stubs: showError follows isError, and the banner renders its title.
vi.mock('@/components/ui/useFetchErrorState', () => ({
  useFetchErrorState: (q: { isError?: boolean }) => ({
    showError: Boolean(q?.isError),
    message: '',
    code: 'unknown',
    retry: vi.fn(),
  }),
}));
vi.mock('@/components/ui/FetchErrorBanner', () => ({
  FetchErrorBanner: ({ state, title }: { state: { showError: boolean }; title?: string }) =>
    state.showError ? <div data-testid="fetch-error-banner">{title ?? 'degraded'}</div> : null,
}));

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn() }),
}));

vi.mock('@auth0/nextjs-auth0/client', () => ({
  useUser: () => ({ user: { sub: 'auth0|self' }, isLoading: false }),
}));

vi.mock('@/app/components/TimezoneProvider', () => ({
  useTimezone: () => ({ timezone: 'America/New_York', setTimezone: vi.fn() }),
}));

vi.mock('@/app/components/SafeImage', () => ({ default: () => null }));
vi.mock('@/app/components/ClickableMemberName', () => ({ default: () => null }));

vi.mock('@/app/components/GroupSettings', async () => {
  const R = await import('react');
  const { Modal } = await import('@/app/components/Modal');
  function GroupSettingsStub({
    onClose,
    onUpdate,
    onGroupDeleted,
  }: {
    onClose: () => void;
    onUpdate: () => void;
    onGroupDeleted: () => void;
  }) {
    const [confirmOpen, setConfirmOpen] = R.useState(false);
    return (
      <>
        <Modal open onClose={onClose}>
          <Modal.Header>Customize Group</Modal.Header>
          <Modal.Body>
            <button
              type="button"
              onClick={async () => {
                await fx.saveGate.promise;
                onUpdate();
                onClose();
              }}
            >
              Save Changes
            </button>
            <button type="button" onClick={() => setConfirmOpen(true)}>
              Delete group
            </button>
          </Modal.Body>
        </Modal>
        <Modal open={confirmOpen} onClose={() => setConfirmOpen(false)}>
          <Modal.Header>Delete it?</Modal.Header>
          <Modal.Body>
            <button
              type="button"
              onClick={async () => {
                await fx.deleteGate.promise;
                onClose();
                onGroupDeleted();
              }}
            >
              Confirm delete
            </button>
          </Modal.Body>
        </Modal>
      </>
    );
  }
  return { default: GroupSettingsStub };
});

vi.mock('@/lib/api', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/api')>();
  return {
    ...actual,
    groupsAPI: { ...actual.groupsAPI, getUserGroups: fx.getUserGroups },
  };
});

import GroupList from './grouplist';

// GroupList is untyped JS; a typed-any props bag keeps JSX from demanding unrelated props (the
// grouplist.identity.test.tsx shape).
const listProps: any = { user: { sub: 'auth0|self' } };

const me = { id: SELF_UUID, username: 'me', UserGroup: { role: 'owner' } };
const ownerCrew = (id: string, name: string) => ({ id, name, Users: [me], Events: [] });
const ALPHA = ownerCrew('g-alpha', 'Alpha Crew');
const BETA = ownerCrew('g-beta', 'Beta Crew');

const titleBlock = (name: string) => screen.getByRole('button', { name });
const cardOf = (name: string) => titleBlock(name).closest('[data-testid="group-card"]') as HTMLElement;
const gearOf = (name: string) => within(cardOf(name)).getByRole('button', { name: /^Customize\b/ });
const flush = async () => {
  await act(async () => {});
};
const focusAndClick = (el: HTMLElement) => {
  act(() => el.focus());
  fireEvent.click(el);
};

function renderList(refreshTrigger: number, extra?: React.ReactNode) {
  return (
    <main>
      {extra}
      <GroupList {...listProps} refreshTrigger={refreshTrigger} />
    </main>
  );
}

beforeEach(() => {
  fx.getUserGroups.mockReset();
  fx.saveGate = { promise: Promise.resolve() };
  fx.deleteGate = { promise: Promise.resolve() };
});

afterEach(cleanup);

describe('home group list focus (88.6.1-41)', () => {
  it('F4. never yank: a refresh that removes a DIFFERENT card leaves focus where it was', async () => {
    fx.getUserGroups.mockResolvedValueOnce([ALPHA, BETA]);
    const { rerender } = render(renderList(0));
    await screen.findByRole('button', { name: 'Beta Crew' });
    const betaTitle = titleBlock('Beta Crew');
    act(() => betaTitle.focus());
    expect(document.activeElement).toBe(betaTitle);

    fx.getUserGroups.mockResolvedValueOnce([BETA]);
    rerender(renderList(1));
    await waitFor(() => expect(fx.getUserGroups).toHaveBeenCalledTimes(2));
    await flush();
    await flush();

    expect(screen.queryByRole('button', { name: 'Alpha Crew' })).toBeNull();
    expect(document.activeElement).toBe(betaTitle);
  });

  it('F6. H8 save (D-07 consumer half): the settings dialog closes onto a gear that is still there', async () => {
    fx.getUserGroups.mockResolvedValueOnce([ALPHA]);
    render(renderList(0));
    await screen.findByRole('button', { name: 'Alpha Crew' });
    const gear = gearOf('Alpha Crew');

    focusAndClick(gear);
    const save = await screen.findByRole('button', { name: 'Save Changes' });

    const saveGate = deferred<void>();
    fx.saveGate = saveGate;
    const refresh = deferred<unknown[]>();
    fx.getUserGroups.mockReturnValueOnce(refresh.promise);
    focusAndClick(save);
    await act(async () => {
      saveGate.resolve();
    });

    await waitFor(() => expect(fx.getUserGroups).toHaveBeenCalledTimes(2));
    await waitFor(() => expect(document.activeElement).toBe(gear));
    expect(screen.queryByText('Loading groups...')).toBeNull();
    expect(gear.isConnected).toBe(true);

    await act(async () => {
      refresh.resolve([ALPHA]);
    });
    await flush();
    expect(document.activeElement).toBe(gear);
  });
});
