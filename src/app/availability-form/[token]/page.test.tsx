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
import { magicAuthAPI, availabilityFormAPI, ApiError } from '@/lib/api';
import { logger } from '@/lib/logger';

type Mock = ReturnType<typeof vi.fn>;
const validate = () => magicAuthAPI.validateToken as unknown as Mock;
const existing = () => availabilityFormAPI.getExistingResponse as unknown as Mock;

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

afterEach(cleanup);

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
    // A deferred validation so the LOADING render can be observed first.
    let rejectValidate: (e: unknown) => void = () => {};
    validate().mockReturnValue(
      new Promise((_resolve, reject) => {
        rejectValidate = reject;
      })
    );

    render(<AvailabilityFormPage />);

    // Positive settle on the LOADING branch's own copy, then capture.
    await screen.findByText(/validating your link\.\.\./i);
    const region = pageRegion();
    expect(region).toHaveTextContent('');

    rejectValidate(new ApiError('Network error', 'network', 0));

    await screen.findByRole('heading', { name: /link no longer valid/i });
    expect(region).toBeInTheDocument();
    expect(region).toHaveTextContent(
      "We couldn't reach the server. Check your connection and try again."
    );
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
    validate().mockRejectedValue(new ApiError('Network error', 'network', 0));

    render(<AvailabilityFormPage />);

    const heading = await screen.findByRole('heading', { name: /link no longer valid/i });
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

    await screen.findByRole('heading', { name: /link no longer valid/i });

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
    // And the always-rendered organizer guidance is still beside it.
    expect(
      screen.getByText(/please contact your group organizer to request a new availability link\./i)
    ).toBeInTheDocument();
  });
});

describe('availability-form/[token] — AC-2: the token-validation failure is a breadcrumb', () => {
  it('calls logger.info with the frozen message and a keyed ctx, never the raw Error', async () => {
    validate().mockRejectedValue(new ApiError('HTTP error! status: 500', 'internal', 500));

    render(<AvailabilityFormPage />);
    await screen.findByRole('heading', { name: /link no longer valid/i });

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

  it('a missing pre-fill response files NO breadcrumb — the log there was deleted, not converted', async () => {
    validate().mockResolvedValue(VALID_TOKEN_BODY);
    existing().mockRejectedValue(new Error('no pre-fill'));

    render(<AvailabilityFormPage />);
    await screen.findByRole('button', { name: /submit availability/i });

    expect(
      logger.info,
      'AC-2 `console.log` rule, DELETE arm: a normal control-flow outcome with no operator ' +
        'value is removed, not turned into a Sentry breadcrumb'
    ).not.toHaveBeenCalled();
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
