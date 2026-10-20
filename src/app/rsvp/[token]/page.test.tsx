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
import { ApiError, rsvpPublicAPI } from '@/lib/api';
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
// The two 403 bodies, VERBATIM from Sonnet/routes/rsvp.js (:235-238 account_not_found,
// :260-263 expired_link, re-read at source 2026-09-29). Unlike the 410s these DO carry a
// `message` — and the page deliberately does NOT render it (fetchErrorTreatment R1: the
// backend's prose is never the display string). The ratified copy is the page's own.
const BODY_ACCOUNT_NOT_FOUND_403 = {
  error: 'account_not_found',
  message: 'We could not find your account — sign in and open the event to RSVP.',
};
const BODY_EXPIRED_LINK_403 = {
  error: 'expired_link',
  message: 'This RSVP link has expired or was already used. Open the event to RSVP.',
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

    // `group_id` reached `errorInfo`: the CTA exists and its href is built from it. Plan 88.6-63
    // (review round 2 #10): the target is the canonical group page `/groupHomePage?id=` (read at
    // groupHomePage/page.js `searchParams.get('id')`); the old `/groups/<id>` has no tracked route.
    const cta = screen.getByRole('link', { name: 'Go to Group' });
    expect(cta).toHaveAttribute('href', `/groupHomePage?id=${encodeURIComponent(GROUP_ID)}`);
  });

  it('1b. the Go to Group href percent-encodes group_id (T-88.6-G47, plan 88.6-63)', async () => {
    // A UUID encodes to itself, so arm 1 cannot tell an encoded href from a raw one. This arm
    // feeds a group_id carrying query metacharacters: raw interpolation would let `&x=1` smuggle
    // a second parameter into the group page URL.
    respond().mockResolvedValue({ error: 'event_cancelled', group_id: 'g&x=1/2' });

    render(<RsvpPage />);

    expect(await screen.findByRole('link', { name: 'Go to Group' })).toHaveAttribute(
      'href',
      '/groupHomePage?id=g%26x%3D1%2F2'
    );
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
      `/groupHomePage?id=${encodeURIComponent(GROUP_ID)}`
    );
  });

  it('3. a success body drives SUCCESS', async () => {
    respond().mockResolvedValue(BODY_SUCCESS);

    render(<RsvpPage />);

    expect(await screen.findByRole('heading', { name: "You're in!" })).toBeInTheDocument();
    // The status-keyed message, so the branch is proven to be the SUCCESS one and not a
    // coincidentally-similar screen.
    expect(screen.getByText('See you at Tuesday Trivia Night on March 3.')).toBeInTheDocument();
    // Plan 88.6-63 (R2-RSVP-COPY-RULING: b, review round 2 #2): the helper line is the ratified
    // sentence, byte-equal to UI-SPEC section 6.3. The backend REVOKES sibling links on consume, so
    // no success-branch copy may tell the user to reuse another RSVP link from the email.
    expect(
      screen.getByText('Changed your mind? Sign in and open the event to update your response.')
    ).toBeInTheDocument();
    expect(screen.queryByText(/RSVP link from the email/i)).toBeNull();
    expect(screen.queryByText(/different RSVP link/i)).toBeNull();
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
    // WHAT CHANGES IT: Phase 93 landing the backend `code` on the Sonnet/routes/rsvp.js 410 bodies
    // (anchors `error: 'event_cancelled',` and `error: 'event_passed',`) is the precondition, recorded as a blocking entry in
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

  // Plan 88.6-58 task 7 (review MEDLOW-16, ITEM-16-COPY-RULING ratified 2026-09-29). Before this,
  // both 403s fell through to ERROR and told the user to tap the link again — which fails again.
  it('6. the expired_link 403 body drives its OWN state with the ratified copy, never the retry advice and never the backend message', async () => {
    respond().mockResolvedValue(BODY_EXPIRED_LINK_403);

    render(<RsvpPage />);

    expect(
      await screen.findByRole('heading', { name: 'This link has already been used' }),
      'a body carrying `error: expired_link` must reach its own page state, not the generic ' +
        'error screen'
    ).toBeInTheDocument();
    expect(
      screen.getByText('Each RSVP link works once. Sign in and open the event to change your answer.')
    ).toBeInTheDocument();
    // The old advice is gone from this outcome, and the backend's prose is not the display string.
    expect(screen.queryByText(/try clicking the RSVP link/)).toBeNull();
    expect(screen.queryByText(BODY_EXPIRED_LINK_403.message)).toBeNull();
    // The way forward is the shipped "Go to Home" (no group_id on a 403 body → no Go to Group).
    expect(screen.queryByRole('link', { name: 'Go to Group' })).toBeNull();
    expect(screen.getByRole('link', { name: 'Go to Home' })).toHaveAttribute('href', '/');
    // The live region composes the same two strings (AC-19 idiom).
    expect(screen.getByTestId(PAGE_STATUS_TESTID).textContent).toBe(
      'This link has already been used Each RSVP link works once. Sign in and open the event to change your answer.'
    );
  });

  it('7. the account_not_found 403 body drives its OWN state with the ratified copy', async () => {
    respond().mockResolvedValue(BODY_ACCOUNT_NOT_FOUND_403);

    render(<RsvpPage />);

    expect(
      await screen.findByRole('heading', { name: "We couldn't find your account" })
    ).toBeInTheDocument();
    expect(screen.getByText('Sign in and open the event to RSVP.')).toBeInTheDocument();
    expect(screen.queryByText(/try clicking the RSVP link/)).toBeNull();
    expect(screen.queryByText(BODY_ACCOUNT_NOT_FOUND_403.message)).toBeNull();
    expect(screen.getByRole('link', { name: 'Go to Home' })).toHaveAttribute('href', '/');
    expect(screen.getByTestId(PAGE_STATUS_TESTID).textContent).toBe(
      "We couldn't find your account Sign in and open the event to RSVP."
    );
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
      ['EXPIRED_LINK', BODY_EXPIRED_LINK_403, /This link has already been used/, 1],
      ['ACCOUNT_NOT_FOUND', BODY_ACCOUNT_NOT_FOUND_403, /We couldn't find your account/, 1],
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
  it('opening the link sends the RSVP ONCE per page instance under StrictMode, and its answer lands (#40, plan 88.6.1-36)', async () => {
    // REWRITTEN IN PLACE by plan 88.6.1-36 (#40). This arm used to measure StrictMode's double
    // run as TWO requests and assert that the superseded run's late body did not overwrite the
    // live run's. That premise is gone: the token is single-use (the backend consumes it before
    // it records anything), so the second request always landed on a spent token, and the
    // per-run flag dropped run 1's real answer. The page then showed the used-link state for an
    // RSVP that WAS recorded. With the submit latch, run 2 never sends, so there is no
    // superseded-run write left to guard; what is pinned now is the latch contract.
    //
    // RED against the shipped per-run flag: two calls, and the used-link heading (run 1's
    // success dropped by its own cleanup, run 2's expired_link lands). RED against the
    // wrong-but-plausible half-fix, a latch BESIDE the per-run flag: one call, but run 1's
    // answer is still dropped and the page never leaves "Recording your RSVP...".
    respond()
      .mockResolvedValueOnce(BODY_SUCCESS)
      .mockResolvedValueOnce(BODY_EXPIRED_LINK_403);

    render(
      <React.StrictMode>
        <RsvpPage />
      </React.StrictMode>
    );

    // Positive signal first: the success heading from the ONE request.
    expect(
      await screen.findByRole('heading', { name: "You're in!" }),
      'the first request is the one that records the RSVP; its answer must reach the page'
    ).toBeInTheDocument();
    expect(respond()).toHaveBeenCalledTimes(1);
    expect(respond()).toHaveBeenCalledWith(TOKEN, EVENT_ID, USER_ID, 'yes');
    expect(screen.queryByRole('heading', { name: 'This link has already been used' })).toBeNull();
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

// Plan 88.6.1-36 (D-25 / D-32 copy row R3 / MEDLOW-17, and the owner's R9 ruling of 2026-10-05).
// A request that did not complete (ApiError code network: a transport failure or the 20 s
// deadline) and an answer the page could not use (ApiError code internal: a status of 500 or
// above, or a body under 500 that is not JSON) both mean the request MAY have reached the app,
// which consumes the single-use token before the work that can fail. So the page must not tell
// the person to tap the link again. The arms key on the instance and the code, never the
// message (plan 88.6.1-23 appends a timeout suffix to the message).
const R3_DETAIL =
  "We couldn't confirm your RSVP — the connection timed out. Sign in and open the event to check your answer.";
const R9_DETAIL = "We couldn't confirm your RSVP. Sign in and open the event to check your answer.";
const RETAP_DETAIL =
  'This link may be invalid or expired. Please try clicking the RSVP link from your email again.';

describe('rsvp/[token] — D-25 / R3 / R9: a request that did not complete, or an answer that could not be read (plan 88.6.1-36)', () => {
  it('U1. a network rejection shows R3 under the error headline, never the retap advice, and files the same breadcrumb', async () => {
    respond().mockRejectedValue(new ApiError('rsvp respond request did not complete', 'network', 0));

    render(<RsvpPage />);

    expect(
      await screen.findByRole('heading', { level: 1, name: 'Something went wrong' })
    ).toBeInTheDocument();
    expect(screen.getByText(R3_DETAIL)).toBeInTheDocument();
    expect(screen.queryByText(/try clicking the RSVP link/)).toBeNull();
    expect(screen.getByRole('link', { name: 'Go to Home' })).toHaveAttribute('href', '/');
    expect(screen.getByTestId(PAGE_STATUS_TESTID).textContent).toBe(
      `Something went wrong ${R3_DETAIL}`
    );

    // The breadcrumb is the shipped one, unchanged: name and message only, no token.
    expect(logger.info).toHaveBeenCalledTimes(1);
    expect((logger.info as unknown as Mock).mock.calls[0][0]).toBe('RSVP submission error:');
    const ctx = (logger.info as unknown as Mock).mock.calls[0][1];
    expect(Object.keys(ctx).sort()).toEqual(['message', 'name']);
    expect(JSON.stringify((logger.info as unknown as Mock).mock.calls[0])).not.toContain(TOKEN);
    expect(logger.error).not.toHaveBeenCalled();
    expect(logger.warn).not.toHaveBeenCalled();
  });

  it('U2. the LOADING to R3 flip fills the SAME slot-0 region (node identity), and the page keeps one region', async () => {
    let rejectRespond: (e: unknown) => void = () => {};
    respond().mockReturnValue(
      new Promise((_resolve, reject) => {
        rejectRespond = reject;
      })
    );

    render(<RsvpPage />);
    await screen.findByText('Recording your RSVP...');
    const regionBefore = screen.getByTestId(PAGE_STATUS_TESTID);
    expect(regionBefore.textContent).toBe('');

    await act(async () => {
      rejectRespond(new ApiError('rsvp respond request did not complete', 'network', 0));
    });
    await screen.findByRole('heading', { level: 1, name: 'Something went wrong' });

    const regionAfter = screen.getByTestId(PAGE_STATUS_TESTID);
    expect(regionAfter).toBe(regionBefore);
    expect(regionAfter.textContent).toBe(`Something went wrong ${R3_DETAIL}`);
    expect(screen.getAllByRole('status')).toHaveLength(1);
  });

  it('U3. the timeout-shaped message reaches R3 too — the page keys on the code, never the message', async () => {
    respond().mockRejectedValue(
      new ApiError('rsvp respond request did not complete (timed out after 20000 ms)', 'network', 0)
    );

    render(<RsvpPage />);

    await screen.findByRole('heading', { level: 1, name: 'Something went wrong' });
    expect(screen.getByText(R3_DETAIL)).toBeInTheDocument();
    expect(screen.queryByText(/try clicking the RSVP link/)).toBeNull();
  });

  it('U4. an internal rejection (the 5xx guard of plan 88.6.1-23) shows R9 — no cause stated, never the retap advice', async () => {
    // The owner's R9 ruling of 2026-10-05. This is the exact shape respondViaToken rejects with
    // for the backend's own JSON 500; the page keys on the code only, so the status is not read.
    respond().mockRejectedValue(new ApiError('rsvp respond request did not complete', 'internal', 500));

    render(<RsvpPage />);

    expect(
      await screen.findByRole('heading', { level: 1, name: 'Something went wrong' })
    ).toBeInTheDocument();
    expect(screen.getByText(R9_DETAIL)).toBeInTheDocument();
    expect(screen.queryByText(/try clicking the RSVP link/)).toBeNull();
    expect(screen.queryByText(/timed out/)).toBeNull();
    expect(screen.getByRole('link', { name: 'Go to Home' })).toHaveAttribute('href', '/');
    expect(screen.getByTestId(PAGE_STATUS_TESTID).textContent).toBe(
      `Something went wrong ${R9_DETAIL}`
    );
    expect(screen.getAllByRole('status')).toHaveLength(1);
  });

  it('U5. REGRESSION PIN: a duck-typed object that is not an ApiError instance keeps the error copy, whatever its code', async () => {
    // Green before and after this plan, by design: the arms read the instance, so a plain
    // object named ApiError (the shape of the AC-2 pin above) stays on the generic copy.
    for (const code of ['network', 'internal']) {
      respond().mockRejectedValue({ name: 'ApiError', code, message: 'x' });
      render(<RsvpPage />);

      await screen.findByRole('heading', { level: 1, name: 'Something went wrong' });
      expect(screen.getByText(RETAP_DETAIL)).toBeInTheDocument();
      expect(screen.queryByText(R3_DETAIL)).toBeNull();
      expect(screen.queryByText(R9_DETAIL)).toBeNull();
      cleanup();
    }
  });
});

// Plan 88.6.1-87 (close ruling P-77, owner 2026-10-18, his word "ratified"; key per owner ruling
// D4 "Option A"). The backend's post-consume 404 for an event that is gone now carries the token
// event_not_found, and respondViaToken rejects ApiError('not_found', 404) for it ONLY (pinned in
// src/lib/api.test.ts Y5..Y8). This page enters EVENT_GONE on the instance plus that code and
// shows the owner's words on the amber link-state card (owner ruling "amber", 2026-10-18). The
// two literals are written once here, copy rows P77a / P77b, straight apostrophe (D-32 R8).
// G1 and G3 were RED before the page change; G2 and G4 are regression pins, green before and
// after. The page suite mocks respondViaToken, so it never sees a status or a body token.
const EVENT_GONE_HEADLINE = 'This game night was cancelled';
const EVENT_GONE_DETAIL =
  "The event this link was for no longer exists, so there is nothing to answer. If you think that's a mistake, ask the organizer.";

describe('rsvp/[token] — the event is gone (88.6.1-87, close ruling P-77)', () => {
  it('G1. a not_found rejection shows the ratified headline and detail, Go to Home, and the same words in the one region', async () => {
    respond().mockRejectedValue(new ApiError('rsvp respond: the event no longer exists', 'not_found', 404));

    render(<RsvpPage />);

    expect(
      await screen.findByRole('heading', { level: 1, name: EVENT_GONE_HEADLINE })
    ).toBeInTheDocument();
    expect(screen.getByText(EVENT_GONE_DETAIL)).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Go to Home' })).toHaveAttribute('href', '/');
    expect(screen.getByTestId(PAGE_STATUS_TESTID).textContent).toBe(
      `${EVENT_GONE_HEADLINE} ${EVENT_GONE_DETAIL}`
    );
    expect(screen.getAllByRole('status')).toHaveLength(1);
    expect(screen.queryByText(/try clicking the RSVP link/)).toBeNull();
    expect(screen.queryByText('Something went wrong')).toBeNull();
  });

  it('G2. REGRESSION PIN: a RESOLVED prose body still shows the error copy (the page never reads the prose)', async () => {
    // Green before and after: the legacy body resolves (api.test.ts Y8) and this page has no
    // discriminant for it, so it stays on ERROR with the retap detail, never EVENT_GONE.
    respond().mockResolvedValue({ error: 'Event not found' });

    render(<RsvpPage />);

    expect(
      await screen.findByRole('heading', { level: 1, name: 'Something went wrong' })
    ).toBeInTheDocument();
    expect(screen.getByText(RETAP_DETAIL)).toBeInTheDocument();
    expect(screen.queryByText(EVENT_GONE_HEADLINE)).toBeNull();
  });

  it('G3. the LOADING to EVENT_GONE flip fills the SAME slot-0 region (node identity)', async () => {
    let rejectRespond: (e: unknown) => void = () => {};
    respond().mockReturnValue(
      new Promise((_resolve, reject) => {
        rejectRespond = reject;
      })
    );

    render(<RsvpPage />);
    await screen.findByText('Recording your RSVP...');
    const regionBefore = screen.getByTestId(PAGE_STATUS_TESTID);
    expect(regionBefore.textContent).toBe('');

    await act(async () => {
      rejectRespond(new ApiError('rsvp respond: the event no longer exists', 'not_found', 404));
    });
    await screen.findByRole('heading', { level: 1, name: EVENT_GONE_HEADLINE });

    const regionAfter = screen.getByTestId(PAGE_STATUS_TESTID);
    expect(regionAfter).toBe(regionBefore);
    expect(regionAfter.textContent).toBe(`${EVENT_GONE_HEADLINE} ${EVENT_GONE_DETAIL}`);
    expect(screen.getAllByRole('status')).toHaveLength(1);
  });

  it('G4. REGRESSION PIN: a duck-typed not_found object that is not an ApiError instance stays on the error copy', async () => {
    // U5's rule: the arms read the instance, so a plain object named ApiError never enters
    // EVENT_GONE. Green before and after.
    respond().mockRejectedValue({ name: 'ApiError', code: 'not_found', message: 'x' });

    render(<RsvpPage />);

    await screen.findByRole('heading', { level: 1, name: 'Something went wrong' });
    expect(screen.getByText(RETAP_DETAIL)).toBeInTheDocument();
    expect(screen.queryByText(EVENT_GONE_HEADLINE)).toBeNull();
  });
});
