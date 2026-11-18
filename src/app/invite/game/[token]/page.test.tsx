// Phase 88.6-23 task 1 — the alias-independence net over the game-invite landing page.
//
// WHAT THIS FILE EXISTS FOR, in one sentence: to prove that the "Game Night Has Passed"
// screen and the permanent-invalid screen are selected by the HTTP STATUS and not by the
// backend's prose, so plan 88.6-42's `body.error` alias drop in wave 8 cannot silently kill
// them on the app's public QR/SMS entry surface.
//
// THE LOAD-BEARING DETAIL: every `ApiError` below is built with the POST-ALIAS-DROP message
// shape — `HTTP error! status: 410` / `… 404`, which is what `extractErrorMessage`
// (`src/lib/api.ts`) returns once `body?.error` stops being read. A test that passed a
// realistic "This game night has already passed" message would go green against the OLD
// prose-matching code too, and would prove nothing at all.
//
// `.tsx` is mandatory: `vitest.config.mts:67` collects `src/**/*.{test,spec}.{ts,tsx}` only,
// so a `.js` sibling would be silently never run.
import * as React from 'react';
import { readFileSync } from 'node:fs';
import { join as join_path } from 'node:path';
import { render, screen, cleanup, act, waitFor, fireEvent } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const TOKEN = 'b'.repeat(64);

const { pushMock, authState } = vi.hoisted(() => ({
  pushMock: vi.fn(),
  authState: {
    user: undefined as { sub: string } | undefined,
    isLoading: false,
  },
}));

vi.mock('next/navigation', () => ({
  useParams: () => ({ token: TOKEN }),
  useRouter: () => ({ push: pushMock, replace: vi.fn() }),
}));

vi.mock('@auth0/nextjs-auth0/client', () => ({
  useUser: () => ({ user: authState.user, isLoading: authState.isLoading }),
}));

// Spread the real module so `ApiError` stays the REAL class and `getFetchErrorMessage` keeps
// its real register — the page's copy assertions would be vacuous against a stub.
vi.mock('@/lib/api', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/api')>();
  return {
    ...actual,
    eventsAPI: {
      getEventInvitePreview: vi.fn(),
      joinGameByToken: vi.fn(),
    },
  };
});

import GameInvitePage from './page';
import { eventsAPI, ApiError } from '@/lib/api';

type Mock = ReturnType<typeof vi.fn>;
const preview = () => eventsAPI.getEventInvitePreview as unknown as Mock;
const join = () => eventsAPI.joinGameByToken as unknown as Mock;

/**
 * The shape `ApiError` carries AFTER plan 88.6-42 drops the `body.error` alias: the backend
 * still sends `{ error: '…' }`, but `extractErrorMessage` stops reading it, so the message
 * degenerates to the status fallback. Building the arms this way is what makes a green run
 * evidence rather than a coincidence.
 */
function postAliasDropError(status: number, code: 'gone' | 'not_found') {
  return new ApiError(`HTTP error! status: ${status}`, code, status, {
    error: 'This game night has already passed',
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  authState.user = undefined;
  authState.isLoading = false;
  preview().mockReset();
  join().mockReset();
});

afterEach(cleanup);

describe('invite/game/[token] — status-keyed branches (D-45 / D-59)', () => {
  it('a 410 renders the expired screen even when the message carries no backend prose', async () => {
    preview().mockRejectedValue(postAliasDropError(410, 'gone'));

    render(<GameInvitePage />);

    expect(
      await screen.findByRole('heading', { name: /game night has passed/i }),
      'the 410 branch must be selected by `err.status`, not by the words in `err.message`'
    ).toBeInTheDocument();
    // The negative half: the generic permanent copy must NOT be what rendered.
    expect(screen.queryByText(/this invite link is no longer valid\./i)).toBeNull();
  });

  it('a 404 renders the permanent-invalid screen, also with no prose to match', async () => {
    preview().mockRejectedValue(postAliasDropError(404, 'not_found'));

    render(<GameInvitePage />);

    expect(
      await screen.findByRole('heading', { name: /this invite is no longer valid/i })
    ).toBeInTheDocument();
    expect(screen.getByText('This invite link is no longer valid.')).toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: /game night has passed/i })).toBeNull();
  });

  it('a transient failure renders the RATIFIED register line, never the upstream text', async () => {
    // A real network failure arrives as `ApiError(…, 'network', 0)` from `apiFetch`
    // (`src/lib/api.ts`, anchor `if (error instanceof TypeError)`). R1: the register supplies the words.
    preview().mockRejectedValue(
      new ApiError('Network error: Could not connect to the server.', 'network', 0)
    );

    render(<GameInvitePage />);

    expect(
      await screen.findByRole('heading', { name: /couldn't join game night/i })
    ).toBeInTheDocument();
    expect(
      screen.getByText("We couldn't reach the server. Check your connection and try again.")
    ).toBeInTheDocument();
    expect(screen.queryByText(/could not connect to the server/i)).toBeNull();
  });

  it('a join failure renders the register line rather than "Failed to join game night."', async () => {
    authState.user = { sub: 'auth0|abc' };
    preview().mockResolvedValue({ game_name: 'Wingspan', event_date: '2030-01-01T00:00:00Z' });
    join().mockRejectedValue(postAliasDropError(404, 'not_found'));

    render(<GameInvitePage />);

    expect(
      await screen.findByRole('heading', { name: /this invite is no longer valid/i })
    ).toBeInTheDocument();
    expect(screen.getByText("We couldn't find what you were looking for.")).toBeInTheDocument();
    expect(screen.queryByText(/failed to join game night/i)).toBeNull();
  });

  // ADDED by plan 88.6-58 task 6 (2026-09-28, /code-adversarial-review 88.6 MEDLOW-14). The
  // preview catch already routes a 410 to the `expired` screen (D-45/D-59); the JOIN catch did
  // not, so an event that passed between preview and join rendered the generic permanent
  // screen. `POST /events/join-game-by-token`'s only 410 is the has-passed gate
  // (Sonnet/routes/events.js:1353). RED on FE d03f728, GREEN after the join-catch 410 arm.
  it('a JOIN 410 renders the same expired screen the preview 410 does', async () => {
    authState.user = { sub: 'auth0|abc' };
    preview().mockResolvedValue({ game_name: 'Wingspan', event_date: '2030-01-01T00:00:00Z' });
    join().mockRejectedValue(postAliasDropError(410, 'gone'));

    render(<GameInvitePage />);

    expect(
      await screen.findByRole('heading', { name: /game night has passed/i }),
      'the join catch must select `expired` on `err.status === 410`, like the preview catch'
    ).toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: /this invite is no longer valid/i })).toBeNull();
    expect(screen.queryByText(/this is no longer available/i)).toBeNull();
  });

  it('NEGATIVE: a JOIN 500 still takes the transient error path, not the expired screen', async () => {
    authState.user = { sub: 'auth0|abc' };
    preview().mockResolvedValue({ game_name: 'Wingspan', event_date: '2030-01-01T00:00:00Z' });
    join().mockRejectedValue(new ApiError('HTTP error! status: 500', 'internal', 500));

    render(<GameInvitePage />);

    expect(
      await screen.findByRole('heading', { name: /couldn't join game night/i })
    ).toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: /game night has passed/i })).toBeNull();
  });
});

describe('invite/game/[token] — the migrated anchors keep their element kind and href', () => {
  it('the sign-in CTA is still a link with a byte-identical returnTo', async () => {
    preview().mockResolvedValue({ game_name: 'Wingspan', event_date: '2030-01-01T00:00:00Z' });

    render(<GameInvitePage />);

    const signIn = await screen.findByRole('link', { name: /join game night/i });
    // T-88.6-64: this is the anonymous user's ONLY way in. An `asChild` migration that
    // rewrote the element to a `<Link>`, or re-encoded the query, locks them out.
    expect(signIn).toHaveAttribute(
      'href',
      `/api/auth/login?returnTo=${encodeURIComponent(`/invite/game/${TOKEN}`)}`
    );
    expect(signIn.tagName).toBe('A');
  });

  it('the expired screen Go Home CTA is still a link to /', async () => {
    preview().mockRejectedValue(postAliasDropError(410, 'gone'));

    render(<GameInvitePage />);

    await screen.findByRole('heading', { name: /game night has passed/i });
    expect(screen.getByRole('link', { name: /go home/i })).toHaveAttribute('href', '/');
  });
});

// Plan 88.6.1-19 task 2 — W048 / AC-32 (register WR-410): the classifier decides on the HTTP
// status alone, so wording in a backend message can never turn a dead link into a Retry. Plus
// copy row L1 (D-30) and the silent decorative glyphs (R8).
describe('invite/game/[token] — W048, L1 and glyphs (plan 88.6.1-19)', () => {
  it('W1: a preview 404 whose message mentions fetching is permanent — no Retry', async () => {
    preview().mockRejectedValue(new ApiError('Could not fetch this invite', 'not_found', 404));

    render(<GameInvitePage />);

    expect(
      await screen.findByRole('heading', { name: /this invite is no longer valid/i }),
      'a 404 is permanent whatever its message says'
    ).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Retry' })).toBeNull();
  });

  it('W2: a join 404 whose message mentions the network is permanent — no Retry', async () => {
    authState.user = { sub: 'auth0|abc' };
    preview().mockResolvedValue({ game_name: 'Wingspan', event_date: '2030-01-15T12:00:00Z' });
    join().mockRejectedValue(
      new ApiError('network lookup failed for this invite', 'not_found', 404)
    );

    render(<GameInvitePage />);

    expect(
      await screen.findByRole('heading', { name: /this invite is no longer valid/i })
    ).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Retry' })).toBeNull();
  });

  it('W3 (regression pin): a raw TypeError with no status stays transient, with Retry', async () => {
    // The Safari transport error that publicFetch rethrows raw (its TypeError arm only wraps a
    // message containing "fetch").
    preview().mockRejectedValue(new TypeError('Load failed'));

    render(<GameInvitePage />);

    expect(
      await screen.findByRole('heading', { name: /couldn't join game night/i })
    ).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Retry' })).toBeInTheDocument();
  });

  it('L1: the loading line names what is loading', async () => {
    preview().mockReturnValue(new Promise(() => {}));

    render(<GameInvitePage />);

    expect(await screen.findByText('Loading your game night invite...')).toBeInTheDocument();
    expect(screen.queryByText('Loading...')).toBeNull();
  });

  it('G: the expired, transient and permanent glyphs are hidden from assistive technology', async () => {
    const arms: Array<[unknown, RegExp]> = [
      [postAliasDropError(410, 'gone'), /game night has passed/i],
      [new ApiError('Network error: Could not connect to the server.', 'network', 0), /couldn't join game night/i],
      [postAliasDropError(404, 'not_found'), /this invite is no longer valid/i],
    ];
    for (const [err, heading] of arms) {
      preview().mockReset();
      preview().mockRejectedValue(err);
      const { container } = render(<GameInvitePage />);
      await screen.findByRole('heading', { name: heading });
      expect(
        container.querySelectorAll('svg:not([aria-hidden="true"])'),
        `an exposed glyph on the branch headed ${heading}`
      ).toHaveLength(0);
      cleanup();
    }
  });
});

// Plan 88.6.1-19 task 3 — R8 (the game page's slot-0 region) and Req 5 (a Retry that removes
// the button under the user hands focus to the settled outcome's heading).
//
// The region's test handle is re-declared here, never imported (the page must not export it).
const PAGE_STATUS_TESTID = 'game-invite-page-status';
const FIXTURE = { game_name: 'Wingspan', event_date: '2030-01-15T12:00:00Z' };
const FIXTURE_DATE = 'Tuesday, January 15, 2030';
const NETWORK_LINE = "We couldn't reach the server. Check your connection and try again.";
const networkError = () =>
  new ApiError('Network error: Could not connect to the server.', 'network', 0);

/** A promise the test settles by hand. */
function deferred<T = unknown>() {
  let resolve: (v: T) => void = () => {};
  let reject: (e: unknown) => void = () => {};
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

describe('invite/game/[token] — R8 page announcement and Retry focus (plan 88.6.1-19)', () => {
  it('R1 (region, expired): one always-mounted sr-only region at slot 0, empty while loading, the SAME node carries the outcome', async () => {
    const held = deferred();
    preview().mockReturnValue(held.promise);

    const { container } = render(<GameInvitePage />);

    await screen.findByText('Loading your game night invite...');
    const region = screen.getByTestId(PAGE_STATUS_TESTID);
    expect(region).toHaveAttribute('aria-live', 'polite');
    expect(region.textContent).toBe('');
    expect(container.firstElementChild, 'the region sits at fragment slot 0').toBe(region);
    expect(screen.getAllByRole('status')).toHaveLength(1);
    expect(region).toHaveClass('sr-only');

    await act(async () => {
      held.reject(postAliasDropError(410, 'gone'));
    });
    await screen.findByRole('heading', { name: /game night has passed/i });

    expect(screen.getByTestId(PAGE_STATUS_TESTID), 'node identity across the flip').toBe(region);
    expect(region.textContent).toBe(
      'Game Night Has Passed This game night has already passed. Ask the organizer for an invite to the next one!'
    );
  });

  it('R2 (joined): the region carries the heading, the game and its date', async () => {
    authState.user = { sub: 'auth0|abc' };
    preview().mockResolvedValue(FIXTURE);
    join().mockResolvedValue({ success: true });

    render(<GameInvitePage />);

    await screen.findByRole('heading', { name: "You're in!" });
    expect(screen.getByTestId(PAGE_STATUS_TESTID).textContent).toBe(
      `You're in! Wingspan ${FIXTURE_DATE}`
    );
  });

  it('R3 (already-joined): the region carries the heading and its detail line', async () => {
    authState.user = { sub: 'auth0|abc' };
    preview().mockResolvedValue(FIXTURE);
    join().mockResolvedValue({ already_joined: true });

    render(<GameInvitePage />);

    await screen.findByRole('heading', { name: "You're already in this game" });
    expect(screen.getByTestId(PAGE_STATUS_TESTID).textContent).toBe(
      "You're already in this game You joined earlier — see you there!"
    );
  });

  it('R4 (transient): the region carries the heading and the register line', async () => {
    preview().mockRejectedValue(networkError());

    render(<GameInvitePage />);

    await screen.findByRole('heading', { name: /couldn't join game night/i });
    expect(screen.getByTestId(PAGE_STATUS_TESTID).textContent).toBe(
      `Couldn't join game night ${NETWORK_LINE}`
    );
  });

  it('R5 (permanent): the region carries the heading and the invalid-link line', async () => {
    preview().mockRejectedValue(postAliasDropError(404, 'not_found'));

    render(<GameInvitePage />);

    await screen.findByRole('heading', { name: /this invite is no longer valid/i });
    expect(screen.getByTestId(PAGE_STATUS_TESTID).textContent).toBe(
      'This invite is no longer valid This invite link is no longer valid.'
    );
  });

  it('R6 (signed-out preview): the region names the game and its date', async () => {
    preview().mockResolvedValue(FIXTURE);

    render(<GameInvitePage />);

    await screen.findByRole('link', { name: /join game night/i });
    expect(screen.getByTestId(PAGE_STATUS_TESTID).textContent).toBe(`Wingspan ${FIXTURE_DATE}`);
  });

  it('F1 (Req 5): after a Retry, focus is on the loading line in flight, then on the settled heading', async () => {
    const user = userEvent.setup();
    const held = deferred();
    preview().mockRejectedValueOnce(networkError()).mockReturnValueOnce(held.promise);

    render(<GameInvitePage />);

    await screen.findByRole('heading', { name: /couldn't join game night/i });
    await user.click(screen.getByRole('button', { name: 'Retry' }));
    // A-64 (88.6.1 code review): the line that replaced the pressed Retry takes focus in flight
    // and speaks by taking it, as on the restore page — never <body>.
    const line = await screen.findByText('Loading your game night invite...');
    await waitFor(() => expect(document.activeElement).toBe(line));

    await act(async () => {
      held.resolve(FIXTURE);
    });
    const heading = await screen.findByRole('heading', { level: 1, name: 'Wingspan' });
    await waitFor(() => expect(document.activeElement).toBe(heading));
  });

  it('F2: the first load moves no focus', async () => {
    preview().mockRejectedValue(networkError());

    render(<GameInvitePage />);

    await screen.findByRole('heading', { name: /couldn't join game night/i });
    expect(document.activeElement).toBe(document.body);
  });

  it('F3: a user who moved focus elsewhere during the retry is not pulled back', async () => {
    const user = userEvent.setup();
    const held = deferred();
    preview().mockRejectedValueOnce(networkError()).mockReturnValueOnce(held.promise);

    render(
      <>
        <button type="button">Elsewhere</button>
        <GameInvitePage />
      </>
    );

    await screen.findByRole('heading', { name: /couldn't join game night/i });
    await user.click(screen.getByRole('button', { name: 'Retry' }));
    await screen.findByText('Loading your game night invite...');
    const elsewhere = screen.getByRole('button', { name: 'Elsewhere' });
    act(() => {
      elsewhere.focus();
    });

    await act(async () => {
      held.resolve(FIXTURE);
    });
    await screen.findByRole('heading', { level: 1, name: 'Wingspan' });
    expect(document.activeElement).toBe(elsewhere);
  });

  it('B1 (R8 idempotency backstop): a Retry that fails the same way clears the region and refills the SAME node', async () => {
    const user = userEvent.setup();
    const held = deferred();
    preview().mockRejectedValueOnce(networkError()).mockReturnValueOnce(held.promise);

    render(<GameInvitePage />);

    await screen.findByRole('heading', { name: /couldn't join game night/i });
    const region = screen.getByTestId(PAGE_STATUS_TESTID);
    const T = region.textContent;
    expect(T).toBe(`Couldn't join game night ${NETWORK_LINE}`);

    await user.click(screen.getByRole('button', { name: 'Retry' }));
    await screen.findByText('Loading your game night invite...');
    expect(screen.getByTestId(PAGE_STATUS_TESTID)).toBe(region);
    expect(region.textContent).toBe('');

    await act(async () => {
      held.reject(networkError());
    });
    await screen.findByRole('heading', { name: /couldn't join game night/i });
    // Positive wait: the 100 ms dwell may still be running when the heading returns.
    await waitFor(() => expect(region.textContent).toBe(T));
    expect(screen.getByTestId(PAGE_STATUS_TESTID)).toBe(region);
  });

  it('B1-fast (offline Retry): the region stays empty for at least 100 ms before the same text returns', async () => {
    preview().mockRejectedValueOnce(networkError()).mockRejectedValueOnce(networkError());

    render(<GameInvitePage />);

    await screen.findByRole('heading', { name: /couldn't join game night/i });
    const region = screen.getByTestId(PAGE_STATUS_TESTID);
    const T = region.textContent;
    expect(T).toBe(`Couldn't join game night ${NETWORK_LINE}`);

    const retry = screen.getByRole('button', { name: 'Retry' });
    const pressedAt = performance.now();
    await act(async () => {
      retry.click();
    });
    // The second preview call has already rejected inside that act. Without a dwell the region
    // refills with T in the same tick — a synchronous clear-then-set WebKit does not re-announce.
    expect(region.textContent, 'the region must read empty right after an instant failure').toBe('');

    await waitFor(() => expect(region.textContent).toBe(T));
    expect(performance.now() - pressedAt).toBeGreaterThanOrEqual(100);
    expect(screen.getByTestId(PAGE_STATUS_TESTID)).toBe(region);
  });
});

// Phase 88.9-66 (X68, owner ruled by chat 2026-11-14): a transient failure shows Retry, so the
// unknown line gives one remedy there; the same holds for a transient JOIN failure.
describe('invite/game/[token] — the line beside Retry (88.9-66: X68)', () => {
  it('X68 (88.9): a transient failure shows the ratified unknown line beside Retry', async () => {
    const RULED = "Something went wrong. If trying again doesn't help, refresh the page.";
    // The preview fails with a code-less 500.
    preview().mockRejectedValue(new ApiError('HTTP error! status: 500', 'unknown', 500, { error: 'boom' }));
    render(<GameInvitePage />);
    expect(await screen.findByText(RULED)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Retry' })).toBeInTheDocument();
    expect(screen.queryByText(/Refresh the page to try again/)).toBeNull();
    cleanup();

    // A signed-in person whose JOIN fails with a code-less 500: the same line beside Retry.
    preview().mockReset();
    authState.user = { sub: 'auth0|abc' };
    preview().mockResolvedValue({ game_name: 'Wingspan', event_date: '2030-01-01T00:00:00Z' });
    join().mockRejectedValue(new ApiError('HTTP error! status: 500', 'unknown', 500, { error: 'boom' }));
    render(<GameInvitePage />);
    expect(await screen.findByText(RULED)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Retry' })).toBeInTheDocument();
    expect(screen.queryByText(/Refresh the page to try again/)).toBeNull();
  });
});

// Phase 88.9-52 (Q69, owner 2026-11-16 "approve all"). Amber X: could not load or join, trying
// again may work. Red X: the link is dead. The grey clock on the passed game night is untouched.
describe('invite/game/[token] — Q69 the failure glyph by cause (88.9-52)', () => {
  const X_PATH = 'M6 18L18 6M6 6l12 12';
  const expectTone = (container: HTMLElement, tone: 'amber' | 'red', label: string) => {
    const path = container.querySelector(`path[d="${X_PATH}"]`);
    expect(path, `${label}: the failure card draws no X`).not.toBeNull();
    const svg = path!.closest('svg')!;
    const circle = svg.parentElement!;
    const on = tone === 'amber' ? 'warning' : 'error';
    const off = tone === 'amber' ? 'error' : 'warning';
    expect(circle, `${label}: the circle is not the ${on} fill`).toHaveClass(`bg-status-${on}-subtle`);
    expect(circle, label).not.toHaveClass(`bg-status-${off}-subtle`);
    expect(svg, `${label}: the X is not the ${on} ink`).toHaveClass(`text-content-status-${on}`);
    expect(svg, label).not.toHaveClass(`text-content-status-${off}`);
    expect(svg).toHaveAttribute('aria-hidden', 'true');
    expect(container.querySelectorAll('svg'), `${label}: one glyph on the card`).toHaveLength(1);
  };
  const EVENT = { game_name: 'Wingspan', event_date: '2030-01-01T00:00:00Z' };

  it('Q69-2: a preview that could not load draws the X on amber (network, 5xx, 429); a preview 404 draws it on red', async () => {
    const temporary: ApiError[] = [
      new ApiError('Network error: Could not connect to the server.', 'network', 0),
      new ApiError('HTTP error! status: 500', 'internal', 500),
      new ApiError('HTTP error! status: 429', 'rate_limited', 429),
    ];
    for (const err of temporary) {
      preview().mockReset();
      preview().mockRejectedValue(err);
      const { container } = render(<GameInvitePage />);
      await screen.findByRole('heading', { name: "Couldn't join game night" });
      expectTone(container, 'amber', `preview ${err.code}`);
      expect(screen.getByRole('button', { name: 'Retry' })).toBeInTheDocument();
      cleanup();
    }
    preview().mockReset();
    preview().mockRejectedValue(postAliasDropError(404, 'not_found'));
    const { container } = render(<GameInvitePage />);
    await screen.findByRole('heading', { name: 'This invite is no longer valid' });
    expectTone(container, 'red', 'preview 404');
  });

  it('Q69-2: a join that could not complete draws the X on amber (network, 5xx, 429, CSRF, a bad 2xx); a join 404 draws it on red', async () => {
    const temporary: Array<[string, ApiError]> = [
      ['network', new ApiError('Network error: Could not connect to the server.', 'network', 0)],
      ['5xx', new ApiError('HTTP error! status: 500', 'internal', 500)],
      ['429', new ApiError('HTTP error! status: 429', 'rate_limited', 429)],
      ['CSRF 403', new ApiError('HTTP error! status: 403', 'forbidden', 403, { csrf_rejected: true })],
    ];
    for (const [label, err] of temporary) {
      preview().mockReset();
      join().mockReset();
      authState.user = { sub: 'auth0|abc' };
      preview().mockResolvedValue(EVENT);
      join().mockRejectedValue(err);
      const { container } = render(<GameInvitePage />);
      await screen.findByRole('heading', { name: "Couldn't join game night" });
      expectTone(container, 'amber', `join ${label}`);
      expect(screen.getByRole('button', { name: 'Retry' })).toBeInTheDocument();
      cleanup();
    }

    // A 2xx the page cannot read is not a refusal either.
    preview().mockReset();
    join().mockReset();
    authState.user = { sub: 'auth0|abc' };
    preview().mockResolvedValue(EVENT);
    join().mockResolvedValue({});
    let view = render(<GameInvitePage />);
    await screen.findByRole('heading', { name: "Couldn't join game night" });
    expectTone(view.container, 'amber', 'join bad 2xx');
    cleanup();

    preview().mockReset();
    join().mockReset();
    preview().mockResolvedValue(EVENT);
    join().mockRejectedValue(postAliasDropError(404, 'not_found'));
    view = render(<GameInvitePage />);
    await screen.findByRole('heading', { name: 'This invite is no longer valid' });
    expectTone(view.container, 'red', 'join 404');
  });

  it('Q69-4: the passed game night keeps its grey clock, no X', async () => {
    preview().mockRejectedValue(postAliasDropError(410, 'gone'));
    const { container } = render(<GameInvitePage />);
    await screen.findByRole('heading', { name: 'Game Night Has Passed' });
    expect(container.querySelector(`path[d="${X_PATH}"]`)).toBeNull();
    const svg = container.querySelector('svg')!;
    expect(svg).toHaveClass('text-content-muted');
    expect(svg.parentElement!).toHaveClass('bg-surface-elevated');
  });

  it('Q69-3: an expired session on the join is amber and offers the sign-in round trip, not a Retry that re-sends the dead session', async () => {
    authState.user = { sub: 'auth0|abc' };
    preview().mockResolvedValue(EVENT);
    join().mockRejectedValue(new ApiError('HTTP error! status: 401', 'unauthorized', 401));
    const { container } = render(<GameInvitePage />);
    await screen.findByRole('heading', { name: "Couldn't join game night" });
    expectTone(container, 'amber', 'join 401');
    expect(screen.getByText('Your session may have expired. Sign in again to continue.')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Retry' })).toBeNull();
    const signIn = screen.getByRole('link', { name: 'Sign in to try again' });
    expect(signIn).toHaveAttribute(
      'href',
      `/api/auth/login?returnTo=${encodeURIComponent(`/invite/game/${TOKEN}`)}`
    );
    // The connection hint belongs to the Retry form of the card.
    expect(screen.queryByText('Check your connection and try again.')).toBeNull();
    expect(screen.getByRole('link', { name: 'Go Home' })).toHaveAttribute('href', '/');
    expect(join()).toHaveBeenCalledTimes(1);
  });

  // Phase 88.9-52 (R27, owner 2026-11-17 "Yes"): the auth layer answers every signed-in route 410
  // account_deleted for a deleted account, so the join has TWO 410s. The status alone sent this one
  // to the passed-game-night card, which is untrue for this person.
  it('R27 (88.9-52): a join 410 account_deleted draws the red X card with the register sentence, not the passed game night, and no contact line', async () => {
    const CONTACT = 'Contact the group owner for a new invite link.';
    authState.user = { sub: 'auth0|abc' };
    preview().mockResolvedValue(EVENT);
    join().mockRejectedValue(new ApiError('HTTP error! status: 410', 'account_deleted', 410));
    const { container } = render(<GameInvitePage />);
    await screen.findByRole('heading', { name: 'This invite is no longer valid' });
    expectTone(container, 'red', 'join 410 account_deleted');
    expect(screen.queryByRole('heading', { name: 'Game Night Has Passed' })).toBeNull();
    expect(screen.getByText('This account has already been deleted.')).toBeInTheDocument();
    expect(screen.queryByText(CONTACT), 'a new invite link cannot help a deleted account').toBeNull();
    expect(screen.queryByRole('button', { name: 'Retry' })).toBeNull();
    expect(screen.getByRole('link', { name: 'Go Home' })).toHaveAttribute('href', '/');
    expect(screen.getByTestId('game-invite-page-status').textContent).toBe(
      'This invite is no longer valid This account has already been deleted.'
    );
    expect(join()).toHaveBeenCalledTimes(1);
    cleanup();

    // The other permanent card keeps its contact line: a dead link is what a new link fixes.
    preview().mockReset();
    join().mockReset();
    preview().mockResolvedValue(EVENT);
    join().mockRejectedValue(postAliasDropError(404, 'not_found'));
    render(<GameInvitePage />);
    await screen.findByRole('heading', { name: 'This invite is no longer valid' });
    expect(screen.getByText(CONTACT)).toBeInTheDocument();
    cleanup();

    // The sentence is the register's, read by code: the page file holds no copy of it.
    const source = readFileSync(join_path(process.cwd(), 'src/app/invite/game/[token]/page.js'), 'utf8');
    expect(source).not.toContain('already been deleted');
  });
});

// Phase 88.9-52 (PIX-5, picture pass, the Q69 as-is note): the small line under the failure sentence,
// Check your connection and try again., named the connection as the cause on EVERY retryable failure,
// so a 5xx card said "our end" in one sentence and "your connection" in the next. It now shows only
// when the failure IS a network failure (ApiError code network). No string changed.
describe('invite/game/[token] — the connection hint by cause (88.9-52: PIX-5)', () => {
  const HINT = 'Check your connection and try again.';
  const EVENT = { game_name: 'Wingspan', event_date: '2030-01-01T00:00:00Z' };
  const CAUSES: Array<[string, unknown, boolean]> = [
    ['network', new ApiError('Network error: Could not connect to the server.', 'network', 0), true],
    ['5xx', new ApiError('HTTP error! status: 500', 'internal', 500), false],
    ['code-less 500', new ApiError('HTTP error! status: 500', 'unknown', 500, { error: 'boom' }), false],
    ['429', new ApiError('HTTP error! status: 429', 'rate_limited', 429), false],
    ['CSRF 403', new ApiError('HTTP error! status: 403', 'forbidden', 403, { csrf_rejected: true }), false],
    // A transport error rethrown raw carries no code, so the page cannot call it a network failure.
    ['raw TypeError', new TypeError('Load failed'), false],
  ];
  const expectCard = (label: string, hinted: boolean) => {
    expect(screen.getByRole('button', { name: 'Retry' }), `${label}: no Retry`).toBeInTheDocument();
    const hint = screen.queryByText(HINT);
    const sentence = screen.getByRole('heading', { name: "Couldn't join game night" }).nextElementSibling as HTMLElement;
    expect(sentence.tagName, `${label}: the failure sentence`).toBe('P');
    if (hinted) {
      expect(hint, `${label}: the connection hint is missing on a network failure`).not.toBeNull();
      // The sentence keeps its small gap to the hint, and the hint carries the gap to Retry.
      expect(sentence).toHaveClass('mb-2');
      expect(hint).toHaveClass('mb-6');
    } else {
      expect(hint, `${label}: the card blames the connection for a failure that is not one`).toBeNull();
      // With no hint the sentence carries the gap to Retry itself.
      expect(sentence).toHaveClass('mb-6');
      expect(sentence).not.toHaveClass('mb-2');
    }
  };

  it('PIX-5 (88.9-52): a preview failure shows the connection hint for a network failure only', async () => {
    for (const [label, err, hinted] of CAUSES) {
      preview().mockReset();
      preview().mockRejectedValue(err);
      render(<GameInvitePage />);
      await screen.findByRole('heading', { name: "Couldn't join game night" });
      expectCard(`preview ${label}`, hinted);
      cleanup();
    }
  });

  it('PIX-5 (88.9-52): a join failure shows the connection hint for a network failure only, and a Retry clears it', async () => {
    for (const [label, err, hinted] of CAUSES) {
      preview().mockReset();
      join().mockReset();
      authState.user = { sub: 'auth0|abc' };
      preview().mockResolvedValue(EVENT);
      join().mockRejectedValue(err);
      render(<GameInvitePage />);
      await screen.findByRole('heading', { name: "Couldn't join game night" });
      expectCard(`join ${label}`, hinted);
      cleanup();
    }

    // A 2xx the page cannot read is not a network failure.
    preview().mockReset();
    join().mockReset();
    authState.user = { sub: 'auth0|abc' };
    preview().mockResolvedValue(EVENT);
    join().mockResolvedValue({});
    render(<GameInvitePage />);
    await screen.findByRole('heading', { name: "Couldn't join game night" });
    expectCard('join bad 2xx', false);
    cleanup();

    // Network first (hint), then Retry answers 500: the hint does not carry over.
    preview().mockReset();
    join().mockReset();
    authState.user = undefined;
    preview()
      .mockRejectedValueOnce(new ApiError('Network error: Could not connect to the server.', 'network', 0))
      .mockRejectedValueOnce(new ApiError('HTTP error! status: 500', 'internal', 500));
    render(<GameInvitePage />);
    await screen.findByRole('heading', { name: "Couldn't join game night" });
    expectCard('first load, network', true);
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
    await screen.findByText('Something went wrong on our end. Please try again shortly.');
    expectCard('after Retry, 5xx', false);
  });
});
