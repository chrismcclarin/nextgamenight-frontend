// Phase 88.6-23 task 3 — the announcement, focus and fallback-copy net over the
// availability-form magic-link page. NONE existed for this route before this plan.
//
// THE ANNOUNCEMENT IS PROVEN BY NODE IDENTITY, NOT BY PRESENCE. A region that is rendered only
// inside the SUBMITTED branch would satisfy a presence assertion and would announce NOTHING —
// screen readers announce CHANGES to a live region, not the conditional mount of a new one. So
// each arm CAPTURES the region before the flip and asserts on the SAME captured element after.
// Re-querying after the flip degrades the test back to presence and is deliberately avoided.
//
// A bare `getByRole('status')` is also FORBIDDEN here: `AvailabilityForm` renders its own
// always-mounted `sr-only` `StatusRegion` (`useConfirmAction`'s `statusNode`), so the READY
// render legitimately carries TWO. The page-level one is addressed by its `data-testid`.
//
// `.tsx` is mandatory: `vitest.config.mts:67` collects `src/**/*.{test,spec}.{ts,tsx}` only.
import * as React from 'react';
import { render, screen, cleanup, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const TOKEN = 'e'.repeat(64);
const STATUS_TESTID = 'availability-page-status';

vi.mock('next/navigation', () => ({
  useParams: () => ({ token: 'e'.repeat(64) }),
}));

/**
 * A stand-in for the real form. It is NOT a convenience: the real `AvailabilityForm` renders its
 * own always-mounted `StatusRegion`, and this stub renders one too — so the "two `role=status`
 * nodes coexist on READY" property the page's marker records is REPRODUCED here rather than
 * mocked away. The submit button is what drives `onSuccess`.
 */
vi.mock('@/app/components/AvailabilityForm', () => ({
  default: ({ onSuccess }: { onSuccess: (r: unknown) => void }) => (
    <div>
      <div role="status" aria-live="polite" className="sr-only" />
      <button type="button" onClick={() => onSuccess({ isUnavailable: false, slotCount: 3 })}>
        Submit availability
      </button>
    </div>
  ),
}));

vi.mock('@/lib/api', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/api')>();
  return {
    ...actual,
    magicAuthAPI: { validateToken: vi.fn() },
    availabilityFormAPI: { getExistingResponse: vi.fn() },
  };
});

vi.mock('@/lib/logger', () => ({
  logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn() },
  errCtx: (err: unknown) => ({
    name: (err as Error)?.name ?? typeof err,
    message: (err as Error)?.message ?? String(err),
  }),
}));

import AvailabilityFormPage from './page';
import { magicAuthAPI, availabilityFormAPI } from '@/lib/api';
import { logger } from '@/lib/logger';

type Mock = ReturnType<typeof vi.fn>;
const validate = () => magicAuthAPI.validateToken as unknown as Mock;
const existing = () => availabilityFormAPI.getExistingResponse as unknown as Mock;

/*
 * REAL-HELPER ARMS (plan 88.6-62, review round 2 #7). Before this plan the error arms here
 * rejected `validateToken` with a HAND-BUILT `ApiError(…, 'network', 0)` — green coverage of a
 * contract the shipped helper could not produce (it threw a plain `Error`). These helpers route
 * the mocked function to the REAL one from the actual module, so only global `fetch` is stubbed
 * and the page sees exactly what `lib/api.ts` throws or resolves.
 */
const actualApi = () => vi.importActual<typeof import('@/lib/api')>('@/lib/api');
async function useRealValidate() {
  const actual = await actualApi();
  validate().mockImplementation((...args: Parameters<typeof actual.magicAuthAPI.validateToken>) =>
    actual.magicAuthAPI.validateToken(...args),
  );
}
async function useRealExisting() {
  const actual = await actualApi();
  existing().mockImplementation(
    (...args: Parameters<typeof actual.availabilityFormAPI.getExistingResponse>) =>
      actual.availabilityFormAPI.getExistingResponse(...args),
  );
}
/** A `fetch` resolving one response whose body is `bodyText`. */
const respond = (status: number, bodyText: string) =>
  vi.fn().mockResolvedValue({ ok: status >= 200 && status < 300, status, text: async () => bodyText });
const dropped = () => vi.fn().mockRejectedValue(new TypeError('Failed to fetch'));

const ORGANIZER_GUIDANCE = /please contact your group organizer to request a new availability link\./i;
const NETWORK_LINE = "We couldn't reach the server. Check your connection and try again.";
const INTERNAL_LINE = 'Something went wrong on our end. Please try again shortly.';

const VALID_TOKEN_BODY = {
  valid: true,
  prompt_id: 'p1',
  user: { name: 'Alice' },
  game: { name: 'Wingspan' },
  expiresAt: new Date(Date.now() + 86_400_000).toISOString(),
};

beforeEach(() => {
  vi.clearAllMocks();
  validate().mockReset();
  existing().mockReset();
  existing().mockResolvedValue(null);
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

/** The page-level region, addressed unambiguously. */
const pageRegion = () => screen.getByTestId(STATUS_TESTID);

describe('availability-form/[token] — AC-19, the SUBMITTED announcement', () => {
  it('announces the success STATEMENT and the detail on the SAME live node', async () => {
    validate().mockResolvedValue(VALID_TOKEN_BODY);
    const user = userEvent.setup();

    render(<AvailabilityFormPage />);

    const submit = await screen.findByRole('button', { name: /submit availability/i });

    // Capture BEFORE the flip. Everything after asserts on this element.
    const region = pageRegion();
    expect(region).toHaveAttribute('role', 'status');
    expect(region).toHaveAttribute('aria-live', 'polite');
    expect(region).toHaveAttribute('aria-atomic', 'true');
    expect(region, 'a region mounted WITH its content does not announce').toHaveTextContent('');

    await user.click(submit);

    await screen.findByRole('heading', { name: /availability submitted!/i });

    expect(region, 'the region must survive the branch flip as the SAME node').toBeInTheDocument();
    expect(region).toHaveTextContent('Availability Submitted!');
    expect(
      region,
      'the detail ALONE only echoes the user\'s own input back; the statement is what says the ' +
        'availability was recorded, and the check glyph that used to carry it is now aria-hidden'
    ).toHaveTextContent('You selected 3 time slots.');
  });

  it('announces the unavailable-path detail too, from the same constant the <p> renders', async () => {
    validate().mockResolvedValue(VALID_TOKEN_BODY);

    // A one-off stub render path: drive onSuccess with the isUnavailable shape.
    const { container } = render(<AvailabilityFormPage />);
    await screen.findByRole('button', { name: /submit availability/i });
    const region = pageRegion();

    // Reach the same callback the form would call.
    const btn = screen.getByRole('button', { name: /submit availability/i });
    btn.dispatchEvent(new MouseEvent('click', { bubbles: true }));

    await screen.findByRole('heading', { name: /availability submitted!/i });
    expect(container).toBeTruthy();
    expect(region).toHaveTextContent('You selected 3 time slots.');
  });
});

describe('availability-form/[token] — AC-19 widened, the ERROR announcement', () => {
  it('fills the SAME slot-0 region on the LOADING -> ERROR flip', async () => {
    // A deferred FETCH (rebuilt by plan 88.6-62 on the real helper) so the LOADING render can
    // be observed first; rejecting it with a TypeError is what a dropped connection looks like.
    let rejectFetch: (e: unknown) => void = () => {};
    vi.stubGlobal(
      'fetch',
      vi.fn(
        () =>
          new Promise((_resolve, reject) => {
            rejectFetch = reject;
          }),
      ),
    );
    await useRealValidate();

    render(<AvailabilityFormPage />);

    // Positive settle on the LOADING branch's own copy, then capture.
    await screen.findByText(/validating your link\.\.\./i);
    const region = pageRegion();
    expect(region).toHaveTextContent('');

    rejectFetch(new TypeError('Failed to fetch'));

    await screen.findByRole('heading', { name: /something went wrong/i });
    expect(region).toBeInTheDocument();
    expect(region).toHaveTextContent(NETWORK_LINE);
  });

  it('the region is EMPTY on READY — it is not a permanent announcement', async () => {
    validate().mockResolvedValue(VALID_TOKEN_BODY);

    render(<AvailabilityFormPage />);

    await screen.findByRole('button', { name: /submit availability/i });
    expect(pageRegion()).toHaveTextContent('');
  });
});

describe('availability-form/[token] — AC-19, the FOCUS half', () => {
  it('moves focus to the confirmation heading on the SUBMITTED edge', async () => {
    validate().mockResolvedValue(VALID_TOKEN_BODY);
    const user = userEvent.setup();

    render(<AvailabilityFormPage />);
    const submit = await screen.findByRole('button', { name: /submit availability/i });

    await user.click(submit);

    const heading = await screen.findByRole('heading', { name: /availability submitted!/i });
    await waitFor(() => expect(document.activeElement).toBe(heading));
    expect(
      heading,
      'without tabIndex={-1} the heading cannot take programmatic focus at all'
    ).toHaveAttribute('tabindex', '-1');
  });

  it('does NOT move focus on the ERROR flip — the branch has no control the user was operating', async () => {
    vi.stubGlobal('fetch', dropped());
    await useRealValidate();

    render(<AvailabilityFormPage />);

    const heading = await screen.findByRole('heading', { name: /something went wrong/i });
    expect(document.activeElement).not.toBe(heading);
    expect(heading).not.toHaveAttribute('tabindex');
  });
});

describe('availability-form/[token] — the anonymous-entry fallback backstop (SPEC `empty / R1`)', () => {
  it('an error with NEITHER code NOR message renders the ratified `unknown` line', async () => {
    // A network drop that is not an ApiError, and an HTML 5xx body, both degenerate to this:
    // a thrown value carrying no `code` and no usable `message`.
    validate().mockRejectedValue({});

    render(<AvailabilityFormPage />);

    // AMENDED by plan 88.6-62: a THROWN failure is not a dead link, so the heading is the
    // ratified FetchErrorBanner title, not "Link No Longer Valid" (this arm used to find that).
    await screen.findByRole('heading', { level: 1, name: 'Something went wrong' });
    expect(screen.queryByRole('heading', { name: /link no longer valid/i })).toBeNull();

    const line = 'Something went wrong. Refresh the page to try again.';
    // TWO matches by design: the visible `<p>` and the slot-0 live region that announces it.
    const matches = screen.getAllByText(line);
    expect(
      matches,
      'this is the surface where a blank error page costs the most — the visitor has no ' +
        'account, no navigation and no context to recover from'
    ).toHaveLength(2);
    expect(matches.some((el) => el.tagName === 'P')).toBe(true);
    expect(screen.getByTestId(STATUS_TESTID)).toHaveTextContent(line);
    expect(screen.queryByText('undefined')).toBeNull();
    // AMENDED by plan 88.6-62 (review round 2 cluster A): this arm used to assert the organizer
    // guidance was "still beside it" — it pinned the defect. "Request a new link" contradicts a
    // line that is not about the link at all, so the guidance now renders ONLY for an invalid link.
    expect(screen.queryByText(ORGANIZER_GUIDANCE)).toBeNull();
  });
});

describe('availability-form/[token] — AC-2: the token-validation failure is a breadcrumb', () => {
  it('calls logger.info with the frozen message and a keyed ctx, never the raw Error', async () => {
    // Rebuilt by plan 88.6-62 over a REAL 500 (Sonnet/routes/magicAuth.js's raw catch body).
    vi.stubGlobal('fetch', respond(500, '{"error":"Validation failed","action":"request_new"}'));
    await useRealValidate();

    render(<AvailabilityFormPage />);
    await screen.findByRole('heading', { name: /something went wrong/i });

    expect(logger.info).toHaveBeenCalledWith(
      'Token validation error:',
      expect.objectContaining({ name: 'ApiError', message: 'HTTP error! status: 500' })
    );
    const ctx = (logger.info as unknown as Mock).mock.calls[0][1];
    expect(Object.keys(ctx).sort(), 'T-84-01: name and message ONLY').toEqual([
      'message',
      'name',
    ]);
    expect(logger.error).not.toHaveBeenCalled();
  });

  // REPLACED by plan 88.6-62 (review round 2 #20): the arm that stood here rejected the
  // pre-fill lookup with a plain Error and asserted NO breadcrumb. After plans 58/62 the only
  // REJECTION that reaches that catch is a transport failure (non-2xx and unparseable 2xx both
  // resolve null), which has operator value — so it now files ONE breadcrumb. The DELETE arm's
  // point is kept for the NORMAL outcome, the confirm-only case below.
  it('#20: a pre-fill lookup that REJECTS (transport) files ONE breadcrumb and the page still reaches READY', async () => {
    validate().mockResolvedValue(VALID_TOKEN_BODY);
    vi.stubGlobal(
      'fetch',
      vi.fn((url: string) =>
        url.includes('/availability-responses/')
          ? Promise.reject(new TypeError('Failed to fetch'))
          : Promise.reject(new Error(`unexpected fetch in this arm: ${url}`)),
      ),
    );
    await useRealExisting();

    render(<AvailabilityFormPage />);
    await screen.findByRole('button', { name: /submit availability/i });

    expect(logger.info).toHaveBeenCalledTimes(1);
    expect(logger.info).toHaveBeenCalledWith('Availability pre-fill lookup failed:', {
      name: 'ApiError',
      message: 'availability existing-response lookup did not complete',
    });
  });

  it('#20 CONFIRM-ONLY: the normal no-prior-response outcome (404 -> null) files NO breadcrumb', async () => {
    validate().mockResolvedValue(VALID_TOKEN_BODY);
    existing().mockResolvedValue(null);

    render(<AvailabilityFormPage />);
    await screen.findByRole('button', { name: /submit availability/i });

    expect(
      logger.info,
      'AC-2 `console.log` rule, DELETE arm: a normal control-flow outcome with no operator ' +
        'value is removed, not turned into a Sentry breadcrumb'
    ).not.toHaveBeenCalled();
  });
});

// ADDED by plan 88.6-62 task 2 (2026-09-29, /code-adversarial-review 88.6 round 2 cluster A
// #1/#7/#12, owner ruling `R2-FIXNOW-SET-RULING: yes`). A dropped packet, a rate limit and a
// backend 500 used to render "Link No Longer Valid" + "request a new link" on a working link.
// Every arm runs the REAL `validateToken` over a stubbed `fetch`. All but the CONFIRM-ONLY arm
// were RED on FE 6238108 (task 1 landed the helper contract; this page still said "dead link").
describe('availability-form/[token] — 88.6-62: a dead link is told apart from a failed request', () => {
  const expectFailedRequest = async (line: string) => {
    const heading = await screen.findByRole('heading', { level: 1, name: 'Something went wrong' });
    expect(heading).toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: /link no longer valid/i })).toBeNull();
    const matches = screen.getAllByText(line);
    expect(matches.some((el) => el.tagName === 'P')).toBe(true);
    expect(pageRegion()).toHaveTextContent(line);
    expect(screen.queryByText(ORGANIZER_GUIDANCE)).toBeNull();
  };

  it('a dropped connection says check your connection — not that the link is dead', async () => {
    vi.stubGlobal('fetch', dropped());
    await useRealValidate();
    render(<AvailabilityFormPage />);
    await expectFailedRequest(NETWORK_LINE);
  });

  it('the magic-token limiter 429 renders the rate_limited line', async () => {
    vi.stubGlobal(
      'fetch',
      respond(
        429,
        '{"code":"rate_limited","message":"Too many attempts. Please try again later.","error":"Too many attempts. Please try again later."}',
      ),
    );
    await useRealValidate();
    render(<AvailabilityFormPage />);
    await expectFailedRequest("You're going a little fast — give it a moment, then try again.");
  });

  it('the raw code-less 500 renders the internal line', async () => {
    vi.stubGlobal('fetch', respond(500, '{"error":"Validation failed","action":"request_new"}'));
    await useRealValidate();
    render(<AvailabilityFormPage />);
    await expectFailedRequest(INTERNAL_LINE);
  });

  it('an unparseable 200 (a gateway HTML page) renders the internal line', async () => {
    vi.stubGlobal('fetch', respond(200, '<!DOCTYPE html><html><body>gateway</body></html>'));
    await useRealValidate();
    render(<AvailabilityFormPage />);
    await expectFailedRequest(INTERNAL_LINE);
  });

  it('CONFIRM-ONLY: the 400 token_invalid envelope keeps the invalid-link heading, copy and organizer guidance', async () => {
    vi.stubGlobal(
      'fetch',
      respond(
        400,
        JSON.stringify({
          code: 'token_invalid',
          message: 'This link is no longer valid.',
          error: 'This link is no longer valid.',
          details: { action: 'request_new' },
        }),
      ),
    );
    await useRealValidate();
    render(<AvailabilityFormPage />);
    await screen.findByRole('heading', { level: 1, name: 'Link No Longer Valid' });
    expect(
      screen.getAllByText('This link is no longer valid. It may have expired or already been used.')
        .some((el) => el.tagName === 'P'),
    ).toBe(true);
    expect(screen.getByText(ORGANIZER_GUIDANCE)).toBeInTheDocument();
  });
});

describe('availability-form/[token] — the branch roots and the second region', () => {
  it('keeps all four branch root classNames byte-unchanged and adds no wrapper', async () => {
    validate().mockResolvedValue(VALID_TOKEN_BODY);

    const { container } = render(<AvailabilityFormPage />);
    await screen.findByRole('button', { name: /submit availability/i });

    // Slot 0 is the region; slot 1 is the branch root. No wrapper div between them.
    expect(container.children).toHaveLength(2);
    expect(container.children[0]).toBe(pageRegion());
    expect(container.children[1].className).toBe(
      'min-h-screen bg-surface-page py-8 px-4 md:px-6'
    );
  });

  it('READY carries TWO always-mounted role=status nodes, deliberately', async () => {
    validate().mockResolvedValue(VALID_TOKEN_BODY);

    render(<AvailabilityFormPage />);
    await screen.findByRole('button', { name: /submit availability/i });

    // This is why a bare getByRole('status') is forbidden in this file. The page-level one
    // survives the flip; the form's unmounts with the form.
    expect(screen.getAllByRole('status')).toHaveLength(2);
  });
});
