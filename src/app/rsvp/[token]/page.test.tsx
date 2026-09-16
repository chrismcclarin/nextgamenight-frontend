// Phase 88.6-24 task 3 — the guard net over the RSVP magic-link landing page.
//
// WHY THIS FILE EXISTS. Under the owner's D62 branch-B ruling (2026-09-09) the two 410 domain
// discriminants at `page.js` STAY as `result.error === 'event_passed' | 'event_cancelled'` reads,
// because the backend emits those bodies with no `code` at all. That means the two page states
// they drive are the phase's most convertible-by-accident surface: a mechanical
// "read `body.code` instead" edit makes both branches unreachable and drops the page to its
// generic error screen with nothing red. Before this file NOTHING asserted that a 410 carrying
// `event_passed` produces the already-happened screen — which is exactly why such a conversion
// could have shipped.
//
// The body shapes below are copied VERBATIM from `Sonnet/routes/rsvp.js` (:293-296 cancelled,
// :302-306 passed, re-read at source 2026-09-16) rather than approximated. An approximated
// fixture is how a test passes against a shape the backend does not emit.
//
// `//` comments only, and no `*/` or backtick inside a block comment: a literal backtick in a
// `/* */` comment makes vite:oxc collect ZERO tests from this file while reporting green.
//
// `.tsx` is mandatory: `vitest.config.mts` collects `src/**/*.{test,spec}.{ts,tsx}` only.
import * as React from 'react';
import { render, screen, cleanup, act } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const TOKEN = 'd'.repeat(64);
const GROUP_ID = '44444444-4444-4444-8444-444444444444';
const EVENT_ID = 'evt-1';
const USER_ID = 'usr-1';

// The live region's test handle. Re-declared here rather than imported: Next's generated route
// types constrain a page module's named exports, so `page.js` cannot export it (it fails
// `npm run typecheck` with "not assignable to type 'never'"). If the literal in `page.js` ever
// changes, every arm below that queries it fails loudly rather than silently passing.
const PAGE_STATUS_TESTID = 'rsvp-page-status';

vi.mock('next/navigation', () => ({
  useParams: () => ({ token: TOKEN }),
  useSearchParams: () => new URLSearchParams(`e=${EVENT_ID}&u=${USER_ID}&s=yes`),
}));

vi.mock('@/lib/api', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/api')>();
  return { ...actual, rsvpPublicAPI: { respondViaToken: vi.fn() } };
});

vi.mock('@/lib/logger', () => ({
  logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn() },
  errCtx: (err: unknown) => ({
    name: (err as Error)?.name ?? typeof err,
    message: (err as Error)?.message ?? String(err),
  }),
}));

import RsvpPage from './page';
import { rsvpPublicAPI } from '@/lib/api';
import { logger } from '@/lib/logger';

type Mock = ReturnType<typeof vi.fn>;
const respond = () => rsvpPublicAPI.respondViaToken as unknown as Mock;

// The two 410 bodies, VERBATIM from Sonnet/routes/rsvp.js. Note what is NOT here: no `code`,
// no `message`. That absence is the whole subject of this suite.
const BODY_CANCELLED_410 = { error: 'event_cancelled', group_id: GROUP_ID };
const BODY_PASSED_410 = {
  error: 'event_passed',
  event_name: 'Tuesday Trivia Night',
  group_id: GROUP_ID,
};
const BODY_SUCCESS = {
  success: true,
  status: 'yes',
  event_name: 'Tuesday Trivia Night',
  event_date: 'March 3',
};

beforeEach(() => {
  vi.clearAllMocks();
  respond().mockReset();
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe('rsvp/[token] — the four page states, pinned against the backend real body shapes', () => {
  it('1. the cancelled 410 body drives EVENT_PASSED, renders the cancelled copy, and carries group_id into errorInfo', async () => {
    respond().mockResolvedValue(BODY_CANCELLED_410);

    render(<RsvpPage />);

    // EVENT_PASSED is the page state; its heading is the observable proof of it.
    expect(
      await screen.findByRole('heading', { name: 'This event has already happened' }),
      'a body carrying `error: event_cancelled` must reach PAGE_STATES.EVENT_PASSED, not the ' +
        'generic error screen'
    ).toBeInTheDocument();

    // The cancelled body carries NO `event_name`, so the generic sentence is the cancelled copy.
    expect(
      screen.getByText('This event has already taken place or has been cancelled.')
    ).toBeInTheDocument();

    // `group_id` reached `errorInfo`: the CTA exists and its href is built from it.
    const cta = screen.getByRole('link', { name: 'Go to Group' });
    expect(cta).toHaveAttribute('href', `/groups/${GROUP_ID}`);
  });

  it('2. the passed 410 body drives EVENT_PASSED, renders the passed copy, and carries event_name AND group_id into errorInfo', async () => {
    respond().mockResolvedValue(BODY_PASSED_410);

    render(<RsvpPage />);

    expect(
      await screen.findByRole('heading', { name: 'This event has already happened' })
    ).toBeInTheDocument();

    // `event_name` reached `errorInfo`: the copy names the event rather than falling back to
    // the generic sentence asserted in arm 1.
    expect(screen.getByText('Tuesday Trivia Night has already taken place.')).toBeInTheDocument();
    expect(
      screen.queryByText('This event has already taken place or has been cancelled.')
    ).toBeNull();

    expect(screen.getByRole('link', { name: 'Go to Group' })).toHaveAttribute(
      'href',
      `/groups/${GROUP_ID}`
    );
  });

  it('3. a success body drives SUCCESS', async () => {
    respond().mockResolvedValue(BODY_SUCCESS);

    render(<RsvpPage />);

    expect(await screen.findByRole('heading', { name: "You're in!" })).toBeInTheDocument();
    // The status-keyed message, so the branch is proven to be the SUCCESS one and not a
    // coincidentally-similar screen.
    expect(screen.getByText('See you at Tuesday Trivia Night on March 3.')).toBeInTheDocument();
  });

  it('3b. a success body with NO responseData-bearing shape still cannot reach SUCCESS without data', async () => {
    // The shipped guard is `pageState === SUCCESS && responseData`. `responseData` is set from
    // the SAME object, so this arm pins the SHAPE of the guard rather than a reachable path:
    // a falsy `success` never sets it at all. Labelled PRESERVATION so a reader does not read
    // its green as proof of a branch that has no producer.
    respond().mockResolvedValue({ success: false });

    render(<RsvpPage />);

    expect(await screen.findByRole('heading', { name: 'Something went wrong' })).toBeInTheDocument();
  });

  it('4. a body with neither success nor a recognised discriminant drives ERROR — the fallthrough, bounded', async () => {
    // An unrecognised discriminant, not an empty body: this bounds the fallthrough's SCOPE.
    respond().mockResolvedValue({ error: 'some_future_reason', group_id: GROUP_ID });

    render(<RsvpPage />);

    expect(await screen.findByRole('heading', { name: 'Something went wrong' })).toBeInTheDocument();
    expect(
      screen.getByText(
        'This link may be invalid or expired. Please try clicking the RSVP link from your email again.'
      )
    ).toBeInTheDocument();
    // The EVENT_PASSED screen's CTA must NOT appear — the fallthrough is generic by design.
    expect(screen.queryByRole('link', { name: 'Go to Group' })).toBeNull();
    expect(screen.getByRole('link', { name: 'Go to Home' })).toHaveAttribute('href', '/');
  });

  it('5. THE REGRESSION GUARD: a body carrying ONLY `code` and no `error` drives ERROR — this is the LIVE CONTRACT, not a bug', async () => {
    // READ THIS BEFORE "FIXING" IT. Under the owner ruling of 2026-09-09 (D62, branch B) the
    // frontend reads `body.error` for these two discriminants and the backend emits no `code`
    // for them at all. So a `code`-only body reaching the generic error screen IS the shipped
    // contract today, and this assertion documents it rather than reporting a defect.
    //
    // WHAT CHANGES IT: Phase 93 landing the backend `code` on Sonnet/routes/rsvp.js:293-296 and
    // :302-306 is the precondition, recorded as a blocking entry in
    // `.planning/deferred/phase-93.md` under `[cleanup] Retighten`. When that lands, this
    // assertion INVERTS — `event_passed` by code must then reach EVENT_PASSED — and it must be
    // inverted deliberately, in the same change, never deleted to make a red go away.
    respond().mockResolvedValue({ code: 'event_passed', event_name: 'X', group_id: GROUP_ID });

    render(<RsvpPage />);

    expect(
      await screen.findByRole('heading', { name: 'Something went wrong' }),
      'if this arm fails with the already-happened screen, someone converted the discriminant ' +
        'reads to `body.code` ahead of Phase 93 landing the backend half'
    ).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: 'Go to Group' })).toBeNull();
  });
});

describe('rsvp/[token] — r2 #181 / AC-19: the LOADING to result swap is announced', () => {
  it('fills the SAME slot-0 region on the LOADING to SUCCESS flip — node identity, not presence', async () => {
    let resolveRespond: (v: unknown) => void = () => {};
    respond().mockReturnValue(
      new Promise((resolve) => {
        resolveRespond = resolve;
      })
    );

    render(<RsvpPage />);

    // Settle on a branch-specific element (the LOADING copy), never on chrome.
    await screen.findByText('Recording your RSVP...');
    const regionBefore = screen.getByTestId(PAGE_STATUS_TESTID);
    expect(regionBefore).toHaveAttribute('aria-live', 'polite');
    expect(regionBefore.textContent).toBe('');

    await act(async () => {
      resolveRespond(BODY_SUCCESS);
    });
    await screen.findByRole('heading', { name: "You're in!" });

    const regionAfter = screen.getByTestId(PAGE_STATUS_TESTID);
    expect(
      regionAfter,
      'the region must be the SAME DOM node across the branch flip — a region that unmounts and ' +
        'remounts with its content announces nothing, which is the whole contract StatusRegion ' +
        'codifies'
    ).toBe(regionBefore);
    // It carries the STATEMENT and the detail, both strings the page already renders.
    expect(regionAfter.textContent).toBe("You're in! See you at Tuesday Trivia Night on March 3.");
  });

  it('fills the SAME slot-0 region on the LOADING to EVENT_PASSED flip', async () => {
    let resolveRespond: (v: unknown) => void = () => {};
    respond().mockReturnValue(
      new Promise((resolve) => {
        resolveRespond = resolve;
      })
    );

    render(<RsvpPage />);
    await screen.findByText('Recording your RSVP...');
    const regionBefore = screen.getByTestId(PAGE_STATUS_TESTID);

    await act(async () => {
      resolveRespond(BODY_PASSED_410);
    });
    await screen.findByRole('heading', { name: 'This event has already happened' });

    const regionAfter = screen.getByTestId(PAGE_STATUS_TESTID);
    expect(regionAfter).toBe(regionBefore);
    expect(regionAfter.textContent).toBe(
      'This event has already happened Tuesday Trivia Night has already taken place.'
    );
  });

  it('fills the SAME slot-0 region on the LOADING to ERROR flip', async () => {
    let resolveRespond: (v: unknown) => void = () => {};
    respond().mockReturnValue(
      new Promise((resolve) => {
        resolveRespond = resolve;
      })
    );

    render(<RsvpPage />);
    await screen.findByText('Recording your RSVP...');
    const regionBefore = screen.getByTestId(PAGE_STATUS_TESTID);

    await act(async () => {
      resolveRespond({});
    });
    await screen.findByRole('heading', { name: 'Something went wrong' });

    const regionAfter = screen.getByTestId(PAGE_STATUS_TESTID);
    expect(regionAfter).toBe(regionBefore);
    expect(regionAfter.textContent).toBe(
      'Something went wrong This link may be invalid or expired. Please try clicking the RSVP link from your email again.'
    );
  });

  it('the region is at FRAGMENT SLOT 0 with no shared wrapper, and the four branch roots keep their own classNames', async () => {
    respond().mockResolvedValue(BODY_SUCCESS);
    const { container } = render(<RsvpPage />);
    await screen.findByRole('heading', { name: "You're in!" });

    // Slot 0: the region is the FIRST child of the render root, and the branch root is its
    // sibling — not its descendant, and not wrapped with it in a shared box.
    expect(container.firstElementChild).toBe(screen.getByTestId(PAGE_STATUS_TESTID));
    expect(container.children).toHaveLength(2);

    // The branch roots are NOT interchangeable: LOADING carries no `p-4`, the other three do.
    // A shared wrapper would have to pick one.
    expect(container.children[1]).toHaveClass(
      'min-h-screen',
      'bg-surface-page',
      'flex',
      'items-center',
      'justify-center',
      'p-4'
    );
  });

  it('r2 #180: no glyph on any branch is exposed to the accessibility tree', async () => {
    // All five `<svg>`s are decorative duplicates of the heading beside them. Asserted per
    // branch rather than as a file-wide grep, so a NEW glyph added to any branch reds here.
    const branches: Array<[string, unknown, RegExp, number]> = [
      ['SUCCESS', BODY_SUCCESS, /You're in!/, 1],
      ['EVENT_PASSED', BODY_PASSED_410, /This event has already happened/, 1],
      ['ERROR', {}, /Something went wrong/, 1],
    ];

    for (const [, body, heading, expected] of branches) {
      respond().mockResolvedValue(body);
      const { container } = render(<RsvpPage />);
      await screen.findByRole('heading', { name: heading });

      const svgs = Array.from(container.querySelectorAll('svg'));
      expect(svgs).toHaveLength(expected);
      for (const svg of svgs) {
        expect(svg).toHaveAttribute('aria-hidden', 'true');
        expect(svg).toHaveAttribute('focusable', 'false');
      }
      cleanup();
    }
  });

  it('the region is visually hidden — sr-only, not a visible duplicate of the heading beside it', async () => {
    respond().mockResolvedValue(BODY_SUCCESS);
    render(<RsvpPage />);
    await screen.findByRole('heading', { name: "You're in!" });

    expect(screen.getByTestId(PAGE_STATUS_TESTID)).toHaveClass('sr-only');
  });
});

describe('rsvp/[token] — AC-13: the mount effect cannot write state after unmount', () => {
  it("a superseded effect run's late response does not overwrite the live run's page state", async () => {
    // WHY THIS SHAPE, and not the obvious one. The obvious arm — unmount mid-flight and assert
    // no "setState on an unmounted component" warning — is VACUOUS on React 18: that warning was
    // removed and the late write is a silent no-op, so the arm passes with the guard DELETED.
    // Measured, not assumed: deleting the flag and the cleanup left it green (see the
    // red-then-green ledger in 88.6-24-SUMMARY.md).
    //
    // The write the guard really suppresses is a SUPERSEDED RUN's. StrictMode mounts, cleans up
    // and re-runs the effect, so two requests are in flight and run 1 is already cancelled. If
    // run 1 resolves LAST without the guard, its stale body lands on top of the live run's — the
    // user is shown the wrong outcome for their RSVP. Measured here: StrictMode issues exactly 2
    // calls.
    const resolvers: Array<(v: unknown) => void> = [];
    respond().mockImplementation(
      () =>
        new Promise((resolve) => {
          resolvers.push(resolve);
        })
    );

    render(
      <React.StrictMode>
        <RsvpPage />
      </React.StrictMode>
    );

    // Positive settle: both runs really are in flight before anything resolves.
    await screen.findByText('Recording your RSVP...');
    expect(resolvers).toHaveLength(2);

    // The LIVE run (2) answers first, with the real outcome.
    await act(async () => {
      resolvers[1](BODY_SUCCESS);
    });
    await screen.findByRole('heading', { name: "You're in!" });

    // The SUPERSEDED run (1) answers late, with a different outcome.
    await act(async () => {
      resolvers[0](BODY_PASSED_410);
    });

    expect(
      screen.getByRole('heading', { name: "You're in!" }),
      "without the `cancelled` cleanup flag the superseded run's late body overwrites the live " +
        "run's, and the page shows the already-happened screen for an RSVP that was recorded"
    ).toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: 'This event has already happened' })).toBeNull();
  });

  it('an unmount mid-flight is survivable — no throw, and the page stays gone', async () => {
    // PRESERVATION arm, labelled as such: it is green with and without the guard on React 18
    // (the late setState is a silent no-op there). It is retained because it becomes load-bearing
    // the moment React's behaviour changes, and because it pins that unmounting mid-flight does
    // not throw.
    let resolveRespond: (v: unknown) => void = () => {};
    respond().mockReturnValue(
      new Promise((resolve) => {
        resolveRespond = resolve;
      })
    );

    const { unmount } = render(<RsvpPage />);
    await screen.findByText('Recording your RSVP...');

    unmount();
    await act(async () => {
      resolveRespond(BODY_SUCCESS);
    });

    expect(screen.queryByRole('heading', { name: "You're in!" })).toBeNull();
  });

  it('the mutation is NOT cancelled by the guard — the RSVP is still recorded', async () => {
    // The guard prevents the late setState, not the request. Asserted so nobody "completes" it
    // with an AbortController: the user clicked an RSVP link and the response must be recorded.
    let resolveRespond: (v: unknown) => void = () => {};
    respond().mockReturnValue(
      new Promise((resolve) => {
        resolveRespond = resolve;
      })
    );

    const { unmount } = render(<RsvpPage />);
    await screen.findByText('Recording your RSVP...');
    unmount();
    await act(async () => {
      resolveRespond(BODY_SUCCESS);
    });

    expect(respond()).toHaveBeenCalledTimes(1);
    expect(respond()).toHaveBeenCalledWith(TOKEN, EVENT_ID, USER_ID, 'yes');
  });
});

describe('rsvp/[token] — AC-2: the submission failure is a house-logger breadcrumb', () => {
  it('a thrown submission calls logger.info with the frozen message and a name/message-only ctx', async () => {
    const boom = Object.assign(new Error('HTTP error! status: 500'), { name: 'ApiError' });
    respond().mockRejectedValue(boom);

    render(<RsvpPage />);
    await screen.findByRole('heading', { name: 'Something went wrong' });

    expect(logger.info).toHaveBeenCalledWith(
      'RSVP submission error:',
      expect.objectContaining({ name: 'ApiError', message: 'HTTP error! status: 500' })
    );
    // The ruled LEVEL (AMENDED 2026-09-13): a breadcrumb, never an event.
    expect(logger.error).not.toHaveBeenCalled();
    expect(logger.warn).not.toHaveBeenCalled();

    // T-84-01 / T-88.6-166: name and message ONLY. Never the raw Error, never the magic-link
    // token, never the request URL, never the response body.
    const ctx = (logger.info as unknown as Mock).mock.calls[0][1];
    expect(Object.keys(ctx).sort()).toEqual(['message', 'name']);
    expect(ctx).not.toBeInstanceOf(Error);
    expect(JSON.stringify((logger.info as unknown as Mock).mock.calls[0])).not.toContain(TOKEN);
  });

  it('a 410 discriminant body files NO breadcrumb — it resolves, it does not throw', async () => {
    // The D62 ruling governs the rendered COPY; AC-2 governs the LOG CHANNEL. They are
    // independent, and no discriminant value is passed to the logger.
    respond().mockResolvedValue(BODY_PASSED_410);

    render(<RsvpPage />);
    await screen.findByRole('heading', { name: 'This event has already happened' });

    expect(logger.info).not.toHaveBeenCalled();
  });
});
