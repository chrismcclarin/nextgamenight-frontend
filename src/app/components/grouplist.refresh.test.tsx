// Phase 88.6.1-77 — the home group list under plan 88.6.1-70's shared RF1 notice (owner ruling
// 2026-10-05, D-51): a failed REFRESH keeps what loaded (the cards, or the "No groups yet" of a
// list that loaded empty, D-50 ruling Y) and says so with RefreshFailedNotice and its Retry; an
// access or gone answer is never a refresh failure (contract C10); a withdrawal never drops focus
// to the page body (contract C12). Cases cite plan 70's consumer contract (C1-C12) by item.
//
// HARNESS. The leaf stubs and the useSelfIdentity shape are copied from grouplist.identity.test.tsx,
// but NOT its useFetchErrorState / FetchErrorBanner stubs: both modules are REAL here (with
// RefreshFailedNotice, useRetainedContent and RetainedContentFocusGuard), because a stubbed retry
// cannot prove a recovery. The API module is spread over importOriginal so ApiError stays real
// (C-3). Comments are // lines only (CF-9).
import * as React from 'react';
import { render, screen, cleanup, waitFor, act } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const h = vi.hoisted(() => ({
  getUserGroups: vi.fn(),
  // A STABLE identity refetch, so the real hook never re-subscribes a listener on every render.
  identityRefetch: vi.fn(),
}));

vi.mock('@/lib/hooks/useSelfIdentity', () => ({
  SELF_IDENTITY_KEY: ['users', 'self'],
  useSelfIdentity: () => ({
    selfUuid: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
    self: { id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', user_id: 'auth0|self' },
    query: { isError: false, error: null, refetch: h.identityRefetch },
    isPending: false,
  }),
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

vi.mock('@/app/components/GroupSettings', () => ({ default: () => null }));
vi.mock('@/app/components/SafeImage', () => ({ default: () => null }));
vi.mock('@/app/components/ClickableMemberName', () => ({ default: () => null }));

vi.mock('@/lib/api', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/api')>();
  return {
    ...actual,
    groupsAPI: { ...actual.groupsAPI, getUserGroups: h.getUserGroups },
  };
});

import GroupList from './grouplist';
import { ApiError } from '@/lib/api';
import { getFetchErrorMessage } from '@/components/ui/useFetchErrorState';

// GroupList is untyped JS; a typed-any props bag keeps JSX from demanding unrelated props (the
// grouplist.identity.test.tsx shape).
const listProps: any = { user: { sub: 'auth0|self' } };

// Copy row RF1 / D-47 (plan 70's REFRESH_FAILED_NOTICE), written once here (contract C7). While
// shown it is in the DOM twice: the visible line and the polite region.
const RF1 = "Couldn't refresh. Showing what loaded earlier.";
const LOAD_TITLE = "We couldn't load your groups";

const ALPHA = { id: 'g-alpha', name: 'Alpha Crew', Users: [], Events: [] };
const BETA = { id: 'g-beta', name: 'Beta Crew', Users: [], Events: [] };
const ERR_500 = new ApiError('Internal error', 'internal', 500);
const ERR_NETWORK = new ApiError('Network error', 'network', 0);

function deferred<T = unknown>() {
  let resolve!: (v: T) => void;
  let reject!: (e: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

function renderList(refreshTrigger: number) {
  return (
    <main>
      <GroupList {...listProps} refreshTrigger={refreshTrigger} />
    </main>
  );
}

const yourGroups = () => screen.getByRole('heading', { name: 'Your Groups' });
const titleBlock = (name: string) => screen.getByRole('button', { name });
const cardOf = (el: Element) => el.closest('[data-testid="group-card"]');
const rf1Region = () =>
  Array.from(document.querySelectorAll('[role="status"]')).find((n) => n.textContent === RF1);
// The visible RF1 line: the RF1 text node that sits in no status region.
const rf1Line = () => screen.getAllByText(RF1).find((n) => !n.closest('[role="status"]'));
// The positive RF1 signal waits for BOTH copies (plan 88.6.1-30's lesson).
const waitForRf1 = () => waitFor(() => expect(screen.getAllByText(RF1)).toHaveLength(2));
const follows = (a: Node, b: Node) =>
  Boolean(a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING);

// First load [Alpha Crew], then a refresh (a rerender with the next refreshTrigger, as the home
// page does) that rejects with `failure`. Returns the card and the status nodes captured BEFORE it.
async function loadCardsThenFail(failure: unknown) {
  h.getUserGroups.mockResolvedValueOnce([ALPHA]);
  const view = render(renderList(0));
  const title = await screen.findByRole('button', { name: 'Alpha Crew' });
  const card = cardOf(title) as HTMLElement;
  expect(card, 'the Alpha card renders').not.toBeNull();
  const regionsBefore = screen.queryAllByRole('status');
  h.getUserGroups.mockRejectedValueOnce(failure);
  view.rerender(renderList(1));
  return { view, card, regionsBefore };
}

beforeEach(() => {
  h.getUserGroups.mockReset();
});

afterEach(() => {
  cleanup();
});

describe('GroupList refresh notice (88.6.1-77: AC-29, RF1, D-50, 88.6.1-70 contract C2-C10)', () => {
  it('RF-1. a failed refresh (a 500) keeps the cards and shows RF1 in a region that was already there, above the cards (C8 a, b, e)', async () => {
    const { card, regionsBefore } = await loadCardsThenFail(ERR_500);
    await waitForRf1();

    const region = rf1Region();
    expect(region, 'a status node carries RF1').toBeDefined();
    // Node identity (C-6, Edge R8 empty): the same node, filled — never a region mounted with text.
    expect(regionsBefore.find((n) => n === region)).toBe(region);
    expect(cardOf(titleBlock('Alpha Crew'))).toBe(card);
    expect(card.isConnected).toBe(true);
    expect(screen.queryByText(LOAD_TITLE)).toBeNull();
    expect(screen.queryByRole('heading', { name: 'No groups yet' })).toBeNull();
    expect(screen.getAllByRole('button', { name: 'Retry' })).toHaveLength(1);
    const line = rf1Line() as HTMLElement;
    expect(line, 'the visible RF1 line').toBeDefined();
    expect(follows(yourGroups(), line), 'the line follows "Your Groups"').toBe(true);
    expect(follows(line, card), 'the line precedes the card').toBe(true);
  });

  it('RF-2. Retry holds Retrying… until its GET settles, then lands focus on "Your Groups" (C8 c, C2, C4, Req 5)', async () => {
    const { card } = await loadCardsThenFail(ERR_500);
    await waitForRf1();
    const region = rf1Region() as Element;
    const retry = screen.getByRole('button', { name: 'Retry' });

    const held = deferred();
    h.getUserGroups.mockImplementationOnce(() => held.promise);
    const user = userEvent.setup();
    await user.click(retry);
    await waitFor(() => expect(h.getUserGroups).toHaveBeenCalledTimes(3));
    expect(retry).toHaveAttribute('aria-disabled', 'true');
    expect(retry).not.toHaveAttribute('disabled');
    expect(retry).toHaveTextContent('Retrying…');
    expect(document.activeElement).toBe(retry);
    expect(rf1Line(), 'the visible RF1 line stays while the GET is held').toBeDefined();
    expect(cardOf(titleBlock('Alpha Crew'))).toBe(card);

    await act(async () => {
      held.resolve([ALPHA, BETA]);
    });
    await waitFor(() => expect(document.activeElement).toBe(yourGroups()));
    expect(screen.queryAllByText(RF1)).toHaveLength(0);
    expect(region.textContent).toBe('');
    expect(titleBlock('Beta Crew')).toBeInTheDocument();
    expect(cardOf(titleBlock('Alpha Crew'))).toBe(card);
    expect(document.activeElement).not.toBe(document.body);
  });

  it('RF-3. a failed Retry keeps the notice in the SAME region, re-announced, and never the full banner (C2, D-31)', async () => {
    const { card } = await loadCardsThenFail(ERR_500);
    await waitForRf1();
    const region = rf1Region() as Element;
    const retry = screen.getByRole('button', { name: 'Retry' });
    // Records each text the region holds, so the re-announcement (empty, then refilled) is seen.
    const texts: string[] = [];
    const observer = new MutationObserver(() => texts.push(region.textContent ?? ''));
    observer.observe(region, { childList: true, characterData: true, subtree: true });

    h.getUserGroups.mockRejectedValueOnce(ERR_500);
    const user = userEvent.setup();
    await user.click(retry);
    await waitFor(() => expect(h.getUserGroups).toHaveBeenCalledTimes(3));
    await waitFor(() => expect(texts.lastIndexOf(RF1)).toBeGreaterThan(texts.indexOf('')));
    observer.disconnect();
    expect(texts.indexOf(''), 'the region emptied after the press').toBeGreaterThanOrEqual(0);
    expect(region.textContent).toBe(RF1);
    expect(rf1Region()).toBe(region);
    expect(document.activeElement).toBe(retry);
    expect(retry).toHaveTextContent('Retry');
    expect(retry).not.toHaveTextContent('Retrying');
    expect(retry).not.toHaveAttribute('aria-disabled');
    expect(screen.queryByText(LOAD_TITLE)).toBeNull();
    expect(cardOf(titleBlock('Alpha Crew'))).toBe(card);
  });

  it('RF-4. a list that loaded EMPTY is retained: RF1 shows above "No groups yet", never the full banner (D-50, ruling Y)', async () => {
    h.getUserGroups.mockResolvedValueOnce([]);
    const view = render(renderList(0));
    const empty = await screen.findByRole('heading', { name: 'No groups yet' });
    const regionsBefore = screen.queryAllByRole('status');

    h.getUserGroups.mockRejectedValueOnce(ERR_500);
    view.rerender(renderList(1));
    await waitForRf1();

    const region = rf1Region();
    expect(region, 'a status node carries RF1').toBeDefined();
    expect(regionsBefore.find((n) => n === region)).toBe(region);
    expect(screen.getByRole('heading', { name: 'No groups yet' })).toBe(empty);
    expect(empty.isConnected).toBe(true);
    expect(screen.queryByText(LOAD_TITLE)).toBeNull();
    const line = rf1Line() as HTMLElement;
    expect(line, 'the visible RF1 line').toBeDefined();
    expect(follows(line, empty), 'the line precedes "No groups yet"').toBe(true);
  });

  it('RF-5. a failed refresh with a network error keeps the cards under RF1 (C8 e, the transient half)', async () => {
    const { card } = await loadCardsThenFail(ERR_NETWORK);
    await waitForRf1();
    expect(cardOf(titleBlock('Alpha Crew'))).toBe(card);
    expect(card.isConnected).toBe(true);
    expect(screen.queryByText(LOAD_TITLE)).toBeNull();
  });

  // C8 (e): every expected register line is read through getFetchErrorMessage on the SAME error
  // object, never typed here.
  it('RF-6. a refresh answered 401 withdraws the cards for the full banner and its register line, never RF1 (C10, C8 e)', async () => {
    const err = new ApiError('Session expired', 'unauthorized', 401);
    const { card } = await loadCardsThenFail(err);
    expect((await screen.findAllByText(getFetchErrorMessage(err))).length).toBeGreaterThan(0);
    expect(screen.getByText(LOAD_TITLE)).toBeInTheDocument();
    expect(screen.queryAllByText(RF1)).toHaveLength(0);
    expect(screen.queryByRole('button', { name: 'Alpha Crew' })).toBeNull();
    expect(card.isConnected).toBe(false);
    expect(screen.queryByRole('heading', { name: 'No groups yet' })).toBeNull();
  });

  it('RF-7. the notice\'s own Retry answered 403 withdraws the cards and lands focus on "Your Groups" (C10, C8 e, Req 5)', async () => {
    await loadCardsThenFail(ERR_500);
    await waitForRf1();

    const err = new ApiError('Forbidden', 'forbidden', 403);
    h.getUserGroups.mockRejectedValueOnce(err);
    const user = userEvent.setup();
    await user.click(screen.getByRole('button', { name: 'Retry', exact: true }));
    expect((await screen.findAllByText(getFetchErrorMessage(err))).length).toBeGreaterThan(0);
    await waitFor(() => expect(document.activeElement).toBe(yourGroups()));
    expect(screen.queryAllByText(RF1)).toHaveLength(0);
    expect(screen.queryByRole('button', { name: 'Alpha Crew' })).toBeNull();
    expect(document.activeElement).not.toBe(document.body);
  });

  // The house idiom (useFetchErrorState.test.tsx, function fireVisibility): the hook's tab-return
  // re-attempt, the refresh nobody pressed. It listens only while the error shows, so each case
  // below first puts RF1 up with a 500.
  function fireVisibility(state: 'visible' | 'hidden') {
    Object.defineProperty(document, 'visibilityState', { value: state, configurable: true });
    document.dispatchEvent(new Event('visibilitychange'));
  }

  async function withdrawWhileCardFocused(err: unknown) {
    await loadCardsThenFail(ERR_500);
    await waitForRf1();
    const cardTitle = titleBlock('Alpha Crew');
    act(() => cardTitle.focus());
    expect(document.activeElement).toBe(cardTitle);

    h.getUserGroups.mockRejectedValueOnce(err);
    // No press and no rerender: the tab-return re-attempt is the only refresh.
    act(() => fireVisibility('visible'));
    expect((await screen.findAllByText(getFetchErrorMessage(err))).length).toBeGreaterThan(0);
    await waitFor(() => expect(document.activeElement).toBe(yourGroups()));
    expect(cardTitle.isConnected).toBe(false);
    expect(document.activeElement).not.toBe(document.body);
    expect(h.getUserGroups).toHaveBeenCalledTimes(3);
  }

  it('RF-8. an UNPRESSED refresh answered 403 or 401 withdraws the cards while a card holds focus: focus lands on "Your Groups", never body (C12 a, C8 f1)', async () => {
    // The 403 leg.
    await withdrawWhileCardFocused(new ApiError('Forbidden', 'forbidden', 403));
    cleanup();
    h.getUserGroups.mockReset();
    // The 401 leg, from a FRESH render.
    await withdrawWhileCardFocused(new ApiError('Session expired', 'unauthorized', 401));
  });

  it('RF-9. an UNPRESSED refresh that SUCCEEDS while Retry holds focus lands on "Your Groups" (C12 b, C8 f2)', async () => {
    await loadCardsThenFail(ERR_500);
    await waitForRf1();
    const retry = screen.getByRole('button', { name: 'Retry', exact: true });
    // Focused, never clicked.
    act(() => retry.focus());
    expect(document.activeElement).toBe(retry);

    h.getUserGroups.mockResolvedValueOnce([ALPHA, BETA]);
    act(() => fireVisibility('visible'));
    await waitFor(() => expect(document.activeElement).toBe(yourGroups()));
    expect(screen.queryAllByText(RF1)).toHaveLength(0);
    expect(titleBlock('Beta Crew')).toBeInTheDocument();
    expect(retry.isConnected).toBe(false);
    expect(document.activeElement).not.toBe(document.body);
  });
});
