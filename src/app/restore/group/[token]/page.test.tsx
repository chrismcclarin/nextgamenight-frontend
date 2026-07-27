// Phase 88.2 plan 10 — the regression net over the restore-preview page.
//
// Pins, by name, the two bugs this page inherited from the invite flow:
//   F-450  an effect re-fire issuing parallel state-changing POSTs (D-04);
//   F-190  a 2xx with an empty body spinning on the loading state forever.
//
// ...plus the disclosure limit (D-02), the four backend outcomes, both routes
// into the already-restored state, and SPEC-REQ-7 on every string this page can
// put on screen.
//
// `.tsx` is mandatory: vitest.config.mts only includes `.ts`/`.tsx`.
import * as React from 'react';
import { render, screen, waitFor, cleanup } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const TOKEN = 'a'.repeat(64);
const GROUP_NAME = 'Tuesday Night Crew';
/** Distinctive per-path ids so an assertion cannot pass on the wrong one. */
const RESTORED_ID = '11111111-1111-4111-8111-111111111111';
const LIVE_ID = '22222222-2222-4222-8222-222222222222';
const PURGE_AFTER = '2026-08-25T12:00:00.000Z';

/**
 * Mirrors REDIRECT_DELAY_MS in page.tsx. Kept as a local literal rather than
 * imported: a Next.js App Router `page.tsx` may only export the default and the
 * framework's own segment-config names, so the page cannot export it. If the
 * page's dwell is ever lengthened, lengthen this too — the absence assertions
 * below are only meaningful when they outlast the timer.
 */
const DWELL_MS = 1500;

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

// Spread the real module so `ApiError` stays the REAL class — the page branches
// on `err instanceof ApiError`, so a stubbed one would send every rejection down
// the generic path and every error-mapping assertion below would be vacuous.
vi.mock('@/lib/api', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/api')>();
  return {
    ...actual,
    groupsAPI: {
      getRestorePreview: vi.fn(),
      acceptGroupOwnership: vi.fn(),
    },
  };
});

import RestoreGroupPage from './page';
import { groupsAPI, ApiError } from '@/lib/api';

type Mock = ReturnType<typeof vi.fn>;

const getPreview = () => groupsAPI.getRestorePreview as unknown as Mock;
const accept = () => groupsAPI.acceptGroupOwnership as unknown as Mock;

/** The live-offer preview body, keys verbatim from 88.2-07-SUMMARY.md. */
const LIVE_PREVIEW = { group_name: GROUP_NAME, purge_after: PURGE_AFTER };

/** The AF-9 already-restored preview body, keys verbatim. */
const ALREADY_RESTORED_PREVIEW = {
  status: 'already_restored',
  group_name: GROUP_NAME,
  group_id: LIVE_ID,
};

/**
 * The 409 rejection, built to 88.2-07-SUMMARY.md's recorded shape: the body is
 * RAW (`{ error, code, group_id }`), not a Phase 85 envelope, and apiFetch
 * stores the WHOLE body at `ApiError.details`. A page reading this through the
 * envelope accessor gets `undefined` and the redirect silently dies.
 */
function conflictError() {
  return new ApiError('This group has already been restored.', 'already_restored', 409, {
    error: 'This group has already been restored.',
    code: 'already_restored',
    group_id: LIVE_ID,
  });
}

function goneError(code: 'window_expired' | 'already_used' | 'invalid_token' | null) {
  return new ApiError(
    code === 'window_expired' ? 'This link has expired.' : 'This restore link is no longer valid.',
    // A 410 with no recognisable code falls back to the status map, which has no
    // entry for 410 — exactly the unattributable case the copy must survive.
    code ?? 'unknown',
    410,
    code ? { error: 'gone', code } : { error: 'gone' }
  );
}

function forbiddenError() {
  return new ApiError('You were not a member of this group', 'forbidden', 403, {
    error: 'You were not a member of this group',
  });
}

function signedIn() {
  authState.user = { sub: 'auth0|accepter' };
}

function signedOut() {
  authState.user = undefined;
}

function renderPage(strict = false) {
  return strict
    ? render(
        <React.StrictMode>
          <RestoreGroupPage />
        </React.StrictMode>
      )
    : render(<RestoreGroupPage />);
}

/** The three strings SPEC-REQ-7 forbids anywhere in the group-delete flow. */
const FORBIDDEN = ['cannot be undone', 'permanently remove', 'permanently delete'];

beforeEach(() => {
  vi.clearAllMocks();
  signedOut();
  authState.isLoading = false;
  getPreview().mockResolvedValue(LIVE_PREVIEW);
  accept().mockResolvedValue({
    success: true,
    group_id: RESTORED_ID,
    group_name: GROUP_NAME,
  });
});

afterEach(() => {
  cleanup();
});

describe('SPEC-REQ-9 — the public preview', () => {
  it('shows the group name and deadline to a logged-out visitor, and accepts nothing', async () => {
    renderPage();

    expect(await screen.findByText(GROUP_NAME)).toBeInTheDocument();
    // The deadline is FORMATTED, never the raw ISO string.
    expect(document.body.textContent).toContain('August 25, 2026');
    expect(document.body.textContent).not.toContain(PURGE_AFTER);

    const cta = screen.getByRole('link', { name: /sign in/i });
    expect(cta).toHaveAttribute(
      'href',
      `/api/auth/login?returnTo=${encodeURIComponent(`/restore/group/${TOKEN}`)}`
    );

    expect(accept()).not.toHaveBeenCalled();
  });

  it('D-02 — discloses the name and the date, and nothing about who or what is in the group', async () => {
    renderPage();
    await screen.findByText(GROUP_NAME);

    // No "6 members", no "37 events" — the restore preview deliberately shows
    // LESS than the QR invite preview, which earns its member count by being
    // meant for non-members. A restore link only ever reaches people who were
    // already in the group, so a richer preview buys no reach.
    expect(document.body.textContent).not.toMatch(/\d+\s*(members?|events?)/i);

    // ...and the page makes no second data call while logged out that could
    // carry the counts in.
    expect(getPreview()).toHaveBeenCalledTimes(1);
    expect(getPreview()).toHaveBeenCalledWith(TOKEN);
    expect(accept()).not.toHaveBeenCalled();
  });
});

describe('SPEC-REQ-9 — the authenticated acceptance', () => {
  it(
    'accepts, signals the group-list refresh and lands the user in the restored group',
    async () => {
      signedIn();
      renderPage();

      expect(await screen.findByText(/is back/i)).toBeInTheDocument();
      expect(accept()).toHaveBeenCalledWith(TOKEN);
      expect(sessionStorage.getItem('nggroups:refresh')).toBe('1');

      // MED #14: the id must come off the `group_id` KEY. The backend service is
      // camelCase internally and only the route converts, so a `{ groupId }`
      // shaped result would push `.../?id=undefined` — and every suite on both
      // sides would still be green. Asserting the exact value is what catches it.
      await waitFor(
        () => expect(pushMock).toHaveBeenCalledWith(`/groupHomePage?id=${RESTORED_ID}`),
        { timeout: 4000 }
      );
    },
    10000
  );

  it('D-04 / F-450 — fires exactly once across a strict-mode double-invoke and a forced effect re-run', async () => {
    signedIn();
    const { rerender } = renderPage(true);

    expect(await screen.findByText(/is back/i)).toBeInTheDocument();
    expect(accept()).toHaveBeenCalledTimes(1);

    // Force the accept effect to re-run for real: a NEW user object identity is
    // a changed dependency, which is exactly what re-fired the effect in F-450.
    // The ref must swallow it. A second call here means the guard is gone.
    authState.user = { sub: 'auth0|accepter' };
    rerender(
      <React.StrictMode>
        <RestoreGroupPage />
      </React.StrictMode>
    );
    await waitFor(() => expect(screen.getByText(/is back/i)).toBeInTheDocument());
    expect(accept()).toHaveBeenCalledTimes(1);
  });

  it('F-190 — a 2xx with an empty body is a terminal error, not an endless spinner', async () => {
    signedIn();
    getPreview().mockResolvedValue(null);
    renderPage();

    expect(await screen.findByText(/no longer valid/i)).toBeInTheDocument();
    // The bug this pins spins forever with no error state. Absence of the
    // spinner is the half that would have stayed green without this line.
    expect(screen.queryByRole('status')).toBeNull();
    expect(accept()).not.toHaveBeenCalled();
  });

  it('403 — a non-member is told plainly, and reaches no success state', async () => {
    signedIn();
    accept().mockRejectedValue(forbiddenError());
    renderPage();

    expect(await screen.findByText(/you can't take it over/i)).toBeInTheDocument();
    expect(screen.queryByText(/is back/i)).toBeNull();
    expect(screen.queryByText(/already brought this group back/i)).toBeNull();
    expect(pushMock).not.toHaveBeenCalled();
  });

  it('410 — an expired window says the data was erased', async () => {
    signedIn();
    accept().mockRejectedValue(goneError('window_expired'));
    renderPage();

    expect(await screen.findByText(/recovery window ended and its data was erased/i)).toBeInTheDocument();
  });

  it('410 — the copy is split by CAUSE, and the unattributable case claims nothing', async () => {
    signedIn();

    for (const code of ['already_used', 'invalid_token', null] as const) {
      accept().mockRejectedValue(goneError(code));
      renderPage();

      expect(await screen.findByText(/no longer valid/i)).toBeInTheDocument();
      const text = (document.body.textContent ?? '').toLowerCase();
      // The weaker message must NOT graduate into the destructive claim just
      // because the client could not attribute the 410.
      expect(text).not.toMatch(/erased/);
      expect(text).not.toMatch(/removed/);
      for (const phrase of FORBIDDEN) expect(text).not.toContain(phrase);

      cleanup();
      vi.clearAllMocks();
      getPreview().mockResolvedValue(LIVE_PREVIEW);
    }
  });
});

describe('already-restored — the same event, reached two ways', () => {
  it(
    '409 (the concurrent race) renders the success state and still lands the user in the group',
    async () => {
      // A member won the row lock BETWEEN this page's preview and its POST. Not
      // hypothetical: the preview returns a live offer, then the accept loses.
      signedIn();
      accept().mockRejectedValue(conflictError());
      renderPage();

      expect(await screen.findByText(/already brought this group back/i)).toBeInTheDocument();
      expect(screen.queryByText(/unable to restore/i)).toBeNull();

      // MED #15: the id is read off `err.details.group_id`, one level down. The
      // envelope accessor reads two levels and returns undefined here — SILENTLY,
      // so without this assertion a dead redirect ships green.
      await waitFor(
        () => expect(pushMock).toHaveBeenCalledWith(`/groupHomePage?id=${LIVE_ID}`),
        { timeout: 4000 }
      );
    },
    10000
  );

  it(
    'AF-9 via the preview, LOGGED IN — no acceptance is attempted and the user is handed into the group',
    async () => {
      signedIn();
      getPreview().mockResolvedValue(ALREADY_RESTORED_PREVIEW);
      renderPage();

      expect(await screen.findByText(/already brought this group back/i)).toBeInTheDocument();
      // There is nothing left to accept. A POST here would 409 and show the user
      // a failure they did not cause.
      expect(accept()).not.toHaveBeenCalled();

      await waitFor(
        () => expect(pushMock).toHaveBeenCalledWith(`/groupHomePage?id=${LIVE_ID}`),
        { timeout: 4000 }
      );
    },
    10000
  );

  it('AF-9 via the preview, LOGGED OUT — stays put and offers sign-in, never redirects', async () => {
    // The single most common path through this page: ONE nonce is fanned to every
    // remaining member, so every recipient after the first arrives here, and an
    // emailed link is overwhelmingly opened logged-out. Redirecting them to
    // /groupHomePage parks them on its loading state forever — it has no
    // route-level auth guard and gates its render on a membership check that
    // returns early without a session.
    signedOut();
    getPreview().mockResolvedValue(ALREADY_RESTORED_PREVIEW);
    renderPage();

    expect(await screen.findByText(/already brought this group back/i)).toBeInTheDocument();

    const cta = screen.getByRole('link', { name: /sign in/i });
    expect(cta).toHaveAttribute(
      'href',
      `/api/auth/login?returnTo=${encodeURIComponent(`/restore/group/${TOKEN}`)}`
    );

    // The redirect on this page is always DEFERRED behind a short dwell, so
    // asserting its absence the instant the copy appears passes vacuously — a
    // catch-proof run proved exactly that: removing the `if (!user) return`
    // guard left this test green. Wait past the dwell before asserting the
    // absence, or this case reports green over the bug it exists to catch.
    await new Promise((resolve) => setTimeout(resolve, DWELL_MS + 600));
    expect(pushMock).not.toHaveBeenCalled();
    expect(accept()).not.toHaveBeenCalled();
  }, 10000);
});

describe('SPEC-REQ-7 — no state on this page claims the group was permanently removed', () => {
  it('every reachable state is clean, including the ones composed at runtime', async () => {
    const scenarios: Array<{ name: string; setup: () => void; settled: RegExp }> = [
      {
        name: 'logged-out preview',
        setup: () => signedOut(),
        settled: new RegExp(GROUP_NAME),
      },
      {
        name: 'restored',
        setup: () => signedIn(),
        settled: /is back/i,
      },
      {
        name: 'already-restored via 409',
        setup: () => {
          signedIn();
          accept().mockRejectedValue(conflictError());
        },
        settled: /already brought this group back/i,
      },
      {
        name: 'already-restored via preview, logged out',
        setup: () => {
          signedOut();
          getPreview().mockResolvedValue(ALREADY_RESTORED_PREVIEW);
        },
        settled: /already brought this group back/i,
      },
      {
        name: '403 not a member',
        setup: () => {
          signedIn();
          accept().mockRejectedValue(forbiddenError());
        },
        settled: /you can't take it over/i,
      },
      {
        name: '410 window expired',
        setup: () => {
          signedIn();
          accept().mockRejectedValue(goneError('window_expired'));
        },
        settled: /data was erased/i,
      },
      {
        name: '410 unattributable',
        setup: () => {
          signedIn();
          accept().mockRejectedValue(goneError(null));
        },
        settled: /no longer valid/i,
      },
      {
        name: 'terminal error from a rejected preview',
        setup: () => {
          signedIn();
          getPreview().mockRejectedValue(new Error('boom'));
        },
        settled: /no longer valid/i,
      },
    ];

    for (const scenario of scenarios) {
      vi.clearAllMocks();
      getPreview().mockResolvedValue(LIVE_PREVIEW);
      accept().mockResolvedValue({
        success: true,
        group_id: RESTORED_ID,
        group_name: GROUP_NAME,
      });
      scenario.setup();

      renderPage();
      await screen.findByText(scenario.settled);

      const text = (document.body.textContent ?? '').toLowerCase();
      for (const phrase of FORBIDDEN) {
        expect(text, `${scenario.name} claims permanence`).not.toContain(phrase);
      }
      cleanup();
    }
  });
});
