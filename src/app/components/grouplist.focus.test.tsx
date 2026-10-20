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
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

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
// 88.6.1-70 contract C9: keep the real module so useRetainedContent and isAccessOrGoneError stay real; the notice itself is proven in grouplist.refresh.test.tsx against the real module.
vi.mock('@/components/ui/FetchErrorBanner', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/components/ui/FetchErrorBanner')>()),
  FetchErrorBanner: ({ state, title }: { state: { showError: boolean }; title?: string }) =>
    state.showError ? <div data-testid="fetch-error-banner">{title ?? 'degraded'}</div> : null,
  RefreshFailedNotice: () => null,
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
// Alpha with one other member, so its card carries a chip stack.
const ada = { id: 'u1', username: 'ada', UserGroup: { role: 'member' } };
const ALPHA_WITH_ADA = { ...ALPHA, Users: [me, ada] };
const STACK_TRIGGER = 'Members: ada. Show all members.';

const titleBlock = (name: string) => screen.getByRole('button', { name });
const yourGroups = () => screen.getByRole('heading', { name: 'Your Groups' });
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

// Expand Alpha's chip stack the way a keyboard user would and wait for its own focus move onto
// "Show less" (MemberChipStack moves focus on expand; with no FriendshipStatusProvider mounted the
// member chips are inert, so "Show less" is the first focusable control in the row).
async function expandAlphaStack() {
  focusAndClick(screen.getByRole('button', { name: STACK_TRIGGER }));
  const showLess = await screen.findByRole('button', { name: 'Show less' });
  await waitFor(() => expect(document.activeElement).toBe(showLess));
  return showLess;
}

describe('home group list focus after a refresh removes the focused control (88.6.1-41, Req 5 H7/H8)', () => {
  it('F1. H7: a refresh that removes only the chip stack of a SURVIVING card lands on that card title block', async () => {
    fx.getUserGroups.mockResolvedValueOnce([ALPHA_WITH_ADA]);
    const { rerender } = render(renderList(0));
    await screen.findByRole('button', { name: 'Alpha Crew' });
    await expandAlphaStack();

    // ada left: the stack has no one to show and returns null; the card survives.
    fx.getUserGroups.mockResolvedValueOnce([ALPHA]);
    rerender(renderList(1));

    await waitFor(() => expect(document.activeElement).toBe(titleBlock('Alpha Crew')));
  });

  it('F2. D-05: a refresh that removes the CARD that held focus lands on "Your Groups" (no heading minted)', async () => {
    fx.getUserGroups.mockResolvedValueOnce([ALPHA_WITH_ADA, BETA]);
    const { rerender } = render(renderList(0));
    await screen.findByRole('button', { name: 'Alpha Crew' });
    await expandAlphaStack();

    fx.getUserGroups.mockResolvedValueOnce([BETA]);
    rerender(renderList(1));

    await waitFor(() => expect(document.activeElement).toBe(yourGroups()));
    // The recovery hook's focusElement adds tabindex="-1" on first focus and keeps it on a
    // heading; grouplist.js writes no static tabIndex there.
    expect(yourGroups().getAttribute('tabindex')).toBe('-1');
  });

  it('F3. edge R5 ordering (backstop): focus moves only AFTER the refresh is applied, never at its start', async () => {
    fx.getUserGroups.mockResolvedValueOnce([ALPHA_WITH_ADA]);
    const { rerender } = render(renderList(0));
    await screen.findByRole('button', { name: 'Alpha Crew' });
    const showLess = await expandAlphaStack();

    const refresh = deferred<unknown[]>();
    fx.getUserGroups.mockReturnValueOnce(refresh.promise);
    rerender(renderList(1));
    await waitFor(() => expect(fx.getUserGroups).toHaveBeenCalledTimes(2));
    await flush();

    // The request is in flight and nothing has been applied: focus has not moved.
    expect(document.activeElement).toBe(showLess);

    await act(async () => {
      refresh.resolve([ALPHA]);
    });
    await waitFor(() => expect(document.activeElement).toBe(titleBlock('Alpha Crew')));
  });

  it('F5. never yank across hosts: focus OUTSIDE the cards never arms the list, so a later removal elsewhere is not pulled into "Your Groups"', async () => {
    fx.getUserGroups.mockResolvedValueOnce([ALPHA, BETA]);
    const elsewhere = <button type="button">Elsewhere</button>;
    const { rerender } = render(renderList(0, elsewhere));
    await screen.findByRole('button', { name: 'Alpha Crew' });
    act(() => screen.getByRole('button', { name: 'Elsewhere' }).focus());

    fx.getUserGroups.mockResolvedValueOnce([BETA]);
    rerender(renderList(1, elsewhere));
    await waitFor(() => expect(fx.getUserGroups).toHaveBeenCalledTimes(2));
    await flush();
    // POSITIVE signal: the refresh really applied (Alpha gone, Beta kept).
    expect(titleBlock('Beta Crew')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Alpha Crew' })).toBeNull();

    // An unrelated removal elsewhere on the page, after the refresh.
    rerender(renderList(1));
    await flush();
    await flush();

    expect(screen.queryByRole('button', { name: 'Elsewhere' })).toBeNull();
    expect(document.activeElement).not.toBe(yourGroups());
    expect(document.activeElement).toBe(document.body);
  });

  it('F7. H8 delete (D-07, D-05): the settings dialog restore lands on the gear, then the refresh that removes the card lands on "Your Groups"', async () => {
    fx.getUserGroups.mockResolvedValueOnce([ALPHA, BETA]);
    render(renderList(0));
    await screen.findByRole('button', { name: 'Alpha Crew' });
    const gear = gearOf('Alpha Crew');

    focusAndClick(gear);
    focusAndClick(await screen.findByRole('button', { name: 'Delete group' }));
    const confirm = await screen.findByRole('button', { name: 'Confirm delete' });

    const deleteGate = deferred<void>();
    fx.deleteGate = deleteGate;
    const refresh = deferred<unknown[]>();
    fx.getUserGroups.mockReturnValueOnce(refresh.promise);
    focusAndClick(confirm);
    await act(async () => {
      deleteGate.resolve();
    });

    // A-41a: the settings dialog's close restore is scheduled first and finds the gear still
    // connected (D-37 keeps the list mounted through the refresh).
    await waitFor(() => expect(document.activeElement).toBe(gear));

    await act(async () => {
      refresh.resolve([BETA]);
    });
    await waitFor(() => expect(document.activeElement).toBe(yourGroups()));
  });

  it('F8. #46: a refresh that only MOVES the focused card keeps focus on the control that held it', async () => {
    fx.getUserGroups.mockResolvedValueOnce([ALPHA, BETA]);
    const { rerender } = render(renderList(0));
    await screen.findByRole('button', { name: 'Alpha Crew' });
    const alphaCard = cardOf('Alpha Crew');
    const gear = gearOf('Alpha Crew');
    act(() => gear.focus());
    expect(document.activeElement).toBe(gear);

    // The same ids, Alpha now LAST: the list GET has no ORDER BY, so a settings save can do this.
    fx.getUserGroups.mockResolvedValueOnce([BETA, ALPHA]);
    rerender(renderList(1));
    await waitFor(() => {
      const cards = screen.getAllByTestId('group-card');
      expect(cards[cards.length - 1]).toBe(alphaCard);
    });
    await flush();

    expect(document.activeElement).toBe(gear);
    expect(gear.isConnected).toBe(true);
  });
});

// F9 needs the REAL FetchErrorBanner (its Try again, and plan 88.6.1-21's recovery armed at the
// press) and the REAL useFetchErrorState (whose retry reaches fetchGroups). This file's stubs
// render no Try again and their retry is a bare vi.fn(), so under them F9 would pin nothing. It
// loads the real two through its OWN local vi.importActual, independent of the file-level
// factories, so a later rewrite of those factories (plan 88.6.1-77 Step 1, contract C9) leaves F9
// untouched. The other leaf mocks stay as the file registers them.
describe('home group list: the full banner retry landing (88.6.1-41 #204)', () => {
  let RealBannerGroupList: React.ComponentType<any>;

  beforeAll(async () => {
    vi.resetModules();
    vi.doMock('@/components/ui/FetchErrorBanner', () =>
      vi.importActual('@/components/ui/FetchErrorBanner'),
    );
    vi.doMock('@/components/ui/useFetchErrorState', () =>
      vi.importActual('@/components/ui/useFetchErrorState'),
    );
    RealBannerGroupList = (await import('./grouplist')).default;
  });

  afterAll(() => {
    vi.doUnmock('@/components/ui/FetchErrorBanner');
    vi.doUnmock('@/components/ui/useFetchErrorState');
    vi.resetModules();
  });

  it('F9. CONFIRM-ONLY: a successful retry from the FULL banner lands on main through plan 21 own hook, never "Your Groups" or body', async () => {
    // Green before and after the card-only arm: the list never arms for focus outside a card,
    // so plan 21's hook is the only recovery on the banner's removal. It pins the landing.
    fx.getUserGroups.mockRejectedValueOnce(new Error('boom'));
    render(
      <main>
        <RealBannerGroupList {...listProps} refreshTrigger={0} />
      </main>,
    );
    const tryAgain = await screen.findByRole('button', { name: 'Try again' });

    fx.getUserGroups.mockResolvedValueOnce([ALPHA]);
    focusAndClick(tryAgain);

    await screen.findByRole('button', { name: 'Alpha Crew' });
    await waitFor(() => expect(document.activeElement).toBe(screen.getByRole('main')));
    expect(document.activeElement).not.toBe(yourGroups());
    expect(document.activeElement).not.toBe(document.body);
  });
});
