// Colocated behavioural coverage for the Email section (Phase 88.8 plan 13,
// SPEC R12 / BOPS-05). Registered in the ci.yml drift-gate registry, because a
// unit run is green whether a suite passes or whether the file was DELETED.
//
// WHAT THIS SUITE CANNOT PROVE, stated here so a green run is not mistaken for
// cross-repo coverage. `usersAPI` is mocked at the MODULE BOUNDARY. Every
// "expired -> Resend -> code_sent" case below is therefore asserting the MOCK'S
// RETURN VALUE and nothing about the backend. The seam it would appear to prove
// — that plan 09's resend route actually serves a token whose `expires_at` has
// passed — is proved on the BACKEND side, by the behaviour row and test
// `88.8-09-PLAN.md` Task 1 carries for exactly that row state (the predicate is
// `status === 'active'` with NO `expires_at` clause, routes/users.js:1326-1346).
// Neither repo's CI can see the other.
//
// The wire KEY is not pinned here either, for the same structural reason: the
// client functions take SCALARS, so a module-boundary mock never receives a body
// object and `JSON.stringify` never runs. That pin lives in `src/lib/api.test.ts`,
// which stubs `fetch` and calls the real function.
//
// NO source `grep` gates in this file. `disabled` is a substring of
// `aria-disabled`, so a grep for the native attribute is inverted on both arms —
// the same defect review round 3 found in the api-key gate. The native-attribute
// sweep below walks the rendered DOM instead.
import * as React from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, cleanup, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { axe } from 'vitest-axe';

import { ApiError } from '@/lib/api';
import {
  EmailAddressSection,
  NO_ADDRESS_ON_FILE,
  checkCode,
  normaliseEmailChangeCode,
} from './EmailAddressSection';

vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

// Keep ApiError REAL so the rate-limited / transport arms exercise the actual
// `err.code` seam every call site reads; mock only the network calls.
vi.mock('@/lib/api', async () => {
  const actual = await vi.importActual<typeof import('@/lib/api')>('@/lib/api');
  return {
    ...actual,
    usersAPI: {
      requestEmailChange: vi.fn(),
      verifyEmailChange: vi.fn(),
      resendEmailChangeCode: vi.fn(),
      cancelEmailChange: vi.fn(),
      revertEmailToSignIn: vi.fn(),
    },
  };
});

vi.mock('@/lib/hooks/useSelfIdentity', () => ({
  useSelfIdentity: vi.fn(),
  SELF_IDENTITY_KEY: ['users', 'self'],
}));

/* Round 6 HIGH: the cache helpers are SPIED, never replaced — both delegate to the real
   implementation, so nothing about the section's behaviour changes. `self` comes from the
   mocked hook above, so a cache write is invisible through the rendered output; the call
   itself is the only observable, and WHICH helper the abandoned path chooses is exactly
   what the fix is about. */
vi.mock('@/lib/hooks/selfIdentityCache', async () => {
  const actual =
    await vi.importActual<typeof import('@/lib/hooks/selfIdentityCache')>(
      '@/lib/hooks/selfIdentityCache'
    );
  return {
    ...actual,
    patchSelfCache: vi.fn(actual.patchSelfCache),
    invalidateSelfCache: vi.fn(actual.invalidateSelfCache),
  };
});

import { usersAPI } from '@/lib/api';
import { invalidateSelfCache, patchSelfCache } from '@/lib/hooks/selfIdentityCache';
import { useSelfIdentity } from '@/lib/hooks/useSelfIdentity';

const api = usersAPI as unknown as {
  requestEmailChange: ReturnType<typeof vi.fn>;
  verifyEmailChange: ReturnType<typeof vi.fn>;
  resendEmailChangeCode: ReturnType<typeof vi.fn>;
  cancelEmailChange: ReturnType<typeof vi.fn>;
  revertEmailToSignIn: ReturnType<typeof vi.fn>;
};
const mockSelf = useSelfIdentity as unknown as ReturnType<typeof vi.fn>;
const cache = {
  patch: patchSelfCache as unknown as ReturnType<typeof vi.fn>,
  invalidate: invalidateSelfCache as unknown as ReturnType<typeof vi.fn>,
};

const SYNTHETIC = 'google-oauth2-1|xyz@auth0.local';
const REAL = 'alice@example.com';
const NEW = 'alice.new@example.com';

type SelfRow = {
  id: string;
  user_id: string;
  email: string | null;
  email_changed_at?: string | null;
  pending_email_change?: { address: string; expires_at: string } | null;
  revert_available?: boolean | null;
};

function selfState(row: SelfRow | undefined, isError = false) {
  return {
    self: row,
    selfUuid: row?.id,
    query: { isError, error: null, refetch: vi.fn() },
    isPending: !row && !isError,
  };
}

// `revert_available` (round 2 HIGH-B) defaults to the SERVER'S answer for the
// common case — available exactly when `email_changed_at` is set and the claim is
// verified and real, which every fixture below models — so the existing revert
// tests keep meaning "the timestamp is set and the server agrees". The
// fail-closed tests override it explicitly.
const ROW = (over: Partial<SelfRow> = {}): SelfRow => ({
  id: 'u-uuid-1',
  user_id: 'u-uuid-1',
  email: REAL,
  email_changed_at: null,
  pending_email_change: null,
  revert_available: Boolean(over.email_changed_at),
  ...over,
});

const body = (over: Record<string, unknown> = {}) => ({
  outcome: 'code_sent',
  email: REAL,
  pending_email_change: { address: NEW, expires_at: '2026-09-04T13:00:00.000Z' },
  verification_sent: true,
  email_changed_at: null,
  revert_available: Boolean(over.email_changed_at),
  ...over,
});

function renderSection() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <EmailAddressSection />
    </QueryClientProvider>
  );
}

/** Drive the section straight into awaiting-code via HYDRATION (no api calls). */
function renderAwaiting(over: Partial<SelfRow> = {}) {
  mockSelf.mockReturnValue(
    selfState(ROW({ pending_email_change: { address: NEW, expires_at: 'z' }, ...over }))
  );
  return renderSection();
}

beforeEach(() => {
  vi.clearAllMocks();
});

afterEach(cleanup);

const noApiCalls = () => {
  expect(api.requestEmailChange).not.toHaveBeenCalled();
  expect(api.verifyEmailChange).not.toHaveBeenCalled();
  expect(api.resendEmailChangeCode).not.toHaveBeenCalled();
  expect(api.cancelEmailChange).not.toHaveBeenCalled();
  expect(api.revertEmailToSignIn).not.toHaveBeenCalled();
};

// ---------------------------------------------------------------------------
// The two states that exist because the data arrives asynchronously
// ---------------------------------------------------------------------------

describe('EmailAddressSection — unresolved and unavailable', () => {
  it('renders UNRESOLVED (heading + inert placeholder) while self is undefined — never idle', () => {
    mockSelf.mockReturnValue(selfState(undefined));
    renderSection();

    expect(screen.getByRole('heading', { name: 'Email' })).toBeInTheDocument();
    // No address text, no Change, no revert affordance. Rendering idle here
    // paints an empty address beside a live Change action, then rearranges.
    expect(screen.queryByRole('button', { name: 'Change' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Use my sign-in address' })).not.toBeInTheDocument();
    expect(screen.queryByText(REAL)).not.toBeInTheDocument();
    noApiCalls();
  });

  it('renders UNAVAILABLE with NO actions and NO Auth0 session-email fallback on terminal self failure', () => {
    mockSelf.mockReturnValue(selfState(undefined, true));
    renderSection();

    /* Round 5 #36: ONE rendering of the sentence, and it is the live region itself —
       round 4 announced it AND left a visible twin, so assistive tech met it twice.
       The length assertion is kept (inverted) because it is the thing that pinned the
       duplication in place; the role assertion proves the surviving node is the one
       that announces. */
    expect(screen.getAllByText(/couldn't load the address/i)).toHaveLength(1);
    expect(screen.getByRole('status')).toHaveTextContent(/couldn't load the address/i);
    // AND IT FOLLOWS THE HEADING. Reading order is the other half of #36: a failure
    // sentence delivered before the <h2> arrives with nothing to attach it to.
    const section = screen.getByRole('heading', { name: 'Email' }).closest('section')!;
    const order = Array.from(section.children);
    expect(order.indexOf(screen.getByRole('heading', { name: 'Email' }))).toBeLessThan(
      order.indexOf(screen.getByRole('status'))
    );
    expect(screen.queryAllByRole('button')).toHaveLength(0);
    // The stale-value defect this whole correction removes.
    expect(screen.queryByText(/@/)).not.toBeInTheDocument();
  });
});

// ---------------------------------------------------------------------------
// Hydration — one shot, from the self row alone
// ---------------------------------------------------------------------------

describe('EmailAddressSection — hydration from the self row (D-39)', () => {
  it('a self row carrying a pending change hydrates AWAITING-CODE with ZERO api calls', () => {
    renderAwaiting();

    expect(screen.getByLabelText(/code from the email/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Verify' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Resend code' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Discard change' })).toBeInTheDocument();
    expect(screen.getByText('Not verified yet')).toBeInTheDocument();
    expect(screen.getByText(NEW)).toBeInTheDocument();
    // No mail was sent in THIS session, so no "we sent a code" line.
    expect(screen.queryByText(/we sent a code to/i)).not.toBeInTheDocument();
    noApiCalls();
  });

  it('`pending_email_change: null` at mount maps to IDLE — not an error, and NOT an expired banner', () => {
    // Plan 09 returns null for an EXPIRED row on purpose. With no send made this
    // session the section cannot tell an expired code from a user who never
    // requested one, and must not guess — that banner would greet every
    // first-time visitor.
    mockSelf.mockReturnValue(selfState(ROW({ pending_email_change: null })));
    renderSection();

    expect(screen.getByRole('button', { name: 'Change' })).toBeInTheDocument();
    expect(screen.getByText(REAL)).toBeInTheDocument();
    expect(screen.queryByText(/expired/i)).not.toBeInTheDocument();
    expect(screen.queryByLabelText(/code from the email/i)).not.toBeInTheDocument();
  });

  it('self RESOLVING AFTER first render, WITH a pending change, still lands in awaiting-code', () => {
    // The case a mount-only effect gets wrong: at mount there was nothing to read.
    mockSelf.mockReturnValue(selfState(undefined));
    const { rerender } = renderSection();
    expect(screen.queryByLabelText(/code from the email/i)).not.toBeInTheDocument();

    mockSelf.mockReturnValue(
      selfState(ROW({ pending_email_change: { address: NEW, expires_at: 'z' } }))
    );
    const client = new QueryClient();
    rerender(
      <QueryClientProvider client={client}>
        <EmailAddressSection />
      </QueryClientProvider>
    );

    expect(screen.getByLabelText(/code from the email/i)).toBeInTheDocument();
    expect(screen.getByText(NEW)).toBeInTheDocument();
  });

  it('self RESOLVING AFTER first render WITHOUT a pending change lands in idle showing the resolved address', () => {
    mockSelf.mockReturnValue(selfState(undefined));
    const { rerender } = renderSection();

    mockSelf.mockReturnValue(selfState(ROW()));
    const client = new QueryClient();
    rerender(
      <QueryClientProvider client={client}>
        <EmailAddressSection />
      </QueryClientProvider>
    );

    expect(screen.getByRole('button', { name: 'Change' })).toBeInTheDocument();
    expect(screen.getByText(REAL)).toBeInTheDocument();
  });

  it('a LATER self change does NOT re-hydrate — the section is not thrown out of the state it is in', async () => {
    // The section patches the identity cache after EVERY mutation, so a reactive
    // hydration would re-derive from the row it just wrote.
    const user = userEvent.setup();
    mockSelf.mockReturnValue(selfState(ROW()));
    const { rerender } = renderSection();

    await user.click(screen.getByRole('button', { name: 'Change' }));
    expect(screen.getByLabelText(/new email address/i)).toBeInTheDocument();

    // A self row arrives that WOULD have hydrated awaiting-code at mount.
    mockSelf.mockReturnValue(
      selfState(ROW({ pending_email_change: { address: NEW, expires_at: 'z' } }))
    );
    const client = new QueryClient();
    rerender(
      <QueryClientProvider client={client}>
        <EmailAddressSection />
      </QueryClientProvider>
    );

    // Still editing — the user's in-progress change survived.
    expect(screen.getByLabelText(/new email address/i)).toBeInTheDocument();
  });

  it('mount and hydration move NO focus', () => {
    mockSelf.mockReturnValue(selfState(undefined));
    const { rerender } = renderSection();
    expect(document.activeElement).toBe(document.body);

    mockSelf.mockReturnValue(selfState(ROW()));
    const client = new QueryClient();
    rerender(
      <QueryClientProvider client={client}>
        <EmailAddressSection />
      </QueryClientProvider>
    );
    // Landing on a long profile page must not steal focus.
    expect(document.activeElement).toBe(document.body);
  });
});

// ---------------------------------------------------------------------------
// The synthetic sentinel — both directions
// ---------------------------------------------------------------------------

describe('EmailAddressSection — the synthetic sentinel is never printed as an address', () => {
  it('renders the fixed no-address copy, no `@auth0` substring, and a live Change action', () => {
    mockSelf.mockReturnValue(selfState(ROW({ email: SYNTHETIC })));
    const { container } = renderSection();

    expect(screen.getByText(NO_ADDRESS_ON_FILE)).toBeInTheDocument();
    expect(container.textContent).not.toContain('@auth0');
    const change = screen.getByRole('button', { name: 'Change' });
    // Change stays available AND enabled — this is exactly the population the
    // phase exists for, and changing it is the thing they need.
    expect(change).not.toHaveAttribute('disabled');
    expect(change).not.toHaveAttribute('aria-disabled', 'true');
  });

  it('THE MIRROR: a REAL address IS rendered — the arm cannot be implemented as "never show the address"', () => {
    mockSelf.mockReturnValue(selfState(ROW({ email: REAL })));
    const { container } = renderSection();

    expect(screen.getByText(REAL)).toBeInTheDocument();
    expect(container.textContent).not.toContain(NO_ADDRESS_ON_FILE);
  });

  it('a synthetic idle state renders NO revert affordance — a consequence of the D-38 keying, not a gap', () => {
    // `email_changed_at` is null on these rows BY CONSTRUCTION: nobody has
    // changed the address, which is why it is still the provisioning sentinel.
    mockSelf.mockReturnValue(selfState(ROW({ email: SYNTHETIC, email_changed_at: null })));
    renderSection();
    expect(screen.queryByRole('button', { name: 'Use my sign-in address' })).not.toBeInTheDocument();
  });

  it('the helper line does NOT claim mail reaches a synthetic address', () => {
    mockSelf.mockReturnValue(selfState(ROW({ email: SYNTHETIC })));
    renderSection();
    expect(screen.getByText(/nothing we send can reach you/i)).toBeInTheDocument();
    expect(screen.queryByText(/This is the address we use to reach you/i)).not.toBeInTheDocument();
  });
});

// ---------------------------------------------------------------------------
// Editing / Save
// ---------------------------------------------------------------------------

describe('EmailAddressSection — editing and Save', () => {
  it('pressing Save on an EMPTY field renders its own fixed error and makes NO api call', async () => {
    const user = userEvent.setup();
    mockSelf.mockReturnValue(selfState(ROW()));
    renderSection();
    await user.click(screen.getByRole('button', { name: 'Change' }));
    await user.click(screen.getByRole('button', { name: 'Save' }));

    expect(screen.getByText('Enter the address you want us to use')).toBeInTheDocument();
    expect(api.requestEmailChange).not.toHaveBeenCalled();
  });

  it('Change moves focus to the email input, and Cancel moves it back to Change', async () => {
    const user = userEvent.setup();
    mockSelf.mockReturnValue(selfState(ROW()));
    renderSection();

    await user.click(screen.getByRole('button', { name: 'Change' }));
    await waitFor(() =>
      expect(document.activeElement).toBe(screen.getByLabelText(/new email address/i))
    );

    await user.click(screen.getByRole('button', { name: 'Cancel' }));
    await waitFor(() =>
      expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Change' }))
    );
  });

  it('no field error node exists while an incomplete address is being typed', async () => {
    const user = userEvent.setup();
    mockSelf.mockReturnValue(selfState(ROW()));
    renderSection();
    await user.click(screen.getByRole('button', { name: 'Change' }));
    await user.type(screen.getByLabelText(/new email address/i), 'ali');

    // FormField's error slot is unconditionally role="alert", so validating on
    // change would talk over the person mid-entry.
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  it('a successful Save lands in awaiting-code with the sent line and moves focus to the CODE input', async () => {
    const user = userEvent.setup();
    mockSelf.mockReturnValue(selfState(ROW()));
    api.requestEmailChange.mockResolvedValue(body());
    renderSection();

    await user.click(screen.getByRole('button', { name: 'Change' }));
    await user.type(screen.getByLabelText(/new email address/i), NEW);
    await user.click(screen.getByRole('button', { name: 'Save' }));

    /* getAllBy since 2026-09-05 (code review #32): the sentence now appears TWICE
       by design — once as the visible line, once inside the always-mounted
       `role="status"` region that actually announces it. Both copies are the
       point; asserting on exactly one would re-introduce the ambiguity. */
    await waitFor(() => expect(screen.getAllByText(`We sent a code to ${NEW}`).length).toBe(2));
    await waitFor(() =>
      expect(document.activeElement).toBe(screen.getByLabelText(/code from the email/i))
    );
    expect(api.requestEmailChange).toHaveBeenCalledWith('u-uuid-1', NEW);
  });

  it('a mail the PROVIDER refused renders awaiting-code with an error banner and Resend promoted — never "code sent"', async () => {
    const user = userEvent.setup();
    mockSelf.mockReturnValue(selfState(ROW()));
    api.requestEmailChange.mockResolvedValue(body({ verification_sent: false }));
    renderSection();

    await user.click(screen.getByRole('button', { name: 'Change' }));
    await user.type(screen.getByLabelText(/new email address/i), NEW);
    await user.click(screen.getByRole('button', { name: 'Save' }));

    // ONCE, not twice (round 3 #38): the error-tone Banner is itself an assertive live
    // region, so the section no longer echoes this copy into its own status region.
    await waitFor(() => expect(screen.getAllByText(/couldn't send the code just now/i).length).toBe(1));
    expect(screen.queryByText(/we sent a code to/i)).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Resend code' })).toBeInTheDocument();
  });

  it("`outcome: 'unchanged'` returns to idle with its own fixed copy and NO sent line", async () => {
    const user = userEvent.setup();
    mockSelf.mockReturnValue(selfState(ROW()));
    api.requestEmailChange.mockResolvedValue(
      body({ outcome: 'unchanged', pending_email_change: null, verification_sent: false })
    );
    renderSection();

    await user.click(screen.getByRole('button', { name: 'Change' }));
    await user.type(screen.getByLabelText(/new email address/i), REAL);
    await user.click(screen.getByRole('button', { name: 'Save' }));

    await waitFor(() =>
      // Twice: the visible Banner and the live region that announces it (#33).
      expect(screen.getAllByText("That's already the address we use for you").length).toBe(2)
    );
    expect(screen.queryByText(/we sent a code to/i)).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Change' })).toBeInTheDocument();
  });

  it('a FAILED save shows the shared error message INSIDE the field and leaves focus in the email input', async () => {
    const user = userEvent.setup();
    mockSelf.mockReturnValue(selfState(ROW()));
    api.requestEmailChange.mockRejectedValue(new ApiError('boom', 'internal', 500, {}));
    renderSection();

    await user.click(screen.getByRole('button', { name: 'Change' }));
    await user.type(screen.getByLabelText(/new email address/i), NEW);
    await user.click(screen.getByRole('button', { name: 'Save' }));

    await waitFor(() =>
      expect(screen.getByText(/something went wrong on our end/i)).toBeInTheDocument()
    );
    await waitFor(() =>
      expect(document.activeElement).toBe(screen.getByLabelText(/new email address/i))
    );
  });

  it('a `rate_limited` envelope on Save renders its OWN fixed copy, never the generic message', async () => {
    const user = userEvent.setup();
    mockSelf.mockReturnValue(selfState(ROW()));
    api.requestEmailChange.mockRejectedValue(new ApiError('slow down', 'rate_limited', 429, {}));
    renderSection();

    await user.click(screen.getByRole('button', { name: 'Change' }));
    await user.type(screen.getByLabelText(/new email address/i), NEW);
    await user.click(screen.getByRole('button', { name: 'Save' }));

    await waitFor(() =>
      expect(screen.getByText("You've asked for too many codes. Try again in a little while.")).toBeInTheDocument()
    );
    // NOT the generic rate-limited copy from MESSAGE_BY_CODE.
    expect(screen.queryByText(/going a little fast/i)).not.toBeInTheDocument();
  });

  it('a mutation body missing `email` is a CONTRACT error and never falls into the sent state', async () => {
    const user = userEvent.setup();
    mockSelf.mockReturnValue(selfState(ROW()));
    api.requestEmailChange.mockResolvedValue({
      outcome: 'code_sent',
      pending_email_change: { address: NEW, expires_at: 'z' },
      verification_sent: true,
      email_changed_at: null,
    });
    renderSection();

    await user.click(screen.getByRole('button', { name: 'Change' }));
    await user.type(screen.getByLabelText(/new email address/i), NEW);
    await user.click(screen.getByRole('button', { name: 'Save' }));

    await waitFor(() => expect(screen.getByRole('alert')).toBeInTheDocument());
    expect(screen.queryByText(/we sent a code to/i)).not.toBeInTheDocument();
  });
});

// ---------------------------------------------------------------------------
// The code field — local pre-flight, then the four server outcomes
// ---------------------------------------------------------------------------

describe('EmailAddressSection — the code field', () => {
  it('normalises case, dashes and spaces, and DECODES the three Crockford confusables like the backend', () => {
    expect(normaliseEmailChangeCode('ab12-cd34')).toBe('AB12CD34');
    expect(normaliseEmailChangeCode(' ab 12 cd 34 ')).toBe('AB12CD34');
    // O -> 0, I -> 1, L -> 1 (routes/users.js:1750). A client stricter than the
    // contract would reject codes the server accepts.
    expect(normaliseEmailChangeCode('ilo-o1234')).toBe('11001234');
    expect(checkCode('ilo-o1234')).toBe('ok');
  });

  it('classifies incomplete, out-of-alphabet and ok separately', () => {
    expect(checkCode('')).toBe('incomplete');
    expect(checkCode('AB12')).toBe('incomplete');
    expect(checkCode('ABU12345')).toBe('out-of-alphabet');
    expect(checkCode('AB12CD34')).toBe('ok');
  });

  it('an INCOMPLETE code makes no api call, shows its own copy, and leaves focus in the code input', async () => {
    const user = userEvent.setup();
    renderAwaiting();
    const field = screen.getByLabelText(/code from the email/i);
    await user.click(field);
    await user.type(field, 'AB12');
    await user.click(screen.getByRole('button', { name: 'Verify' }));

    expect(screen.getByText('Enter all 8 characters from the email')).toBeInTheDocument();
    expect(api.verifyEmailChange).not.toHaveBeenCalled();
  });

  it('an OUT-OF-ALPHABET code makes no api call and shows a DIFFERENT string from the incomplete one', async () => {
    const user = userEvent.setup();
    renderAwaiting();
    await user.type(screen.getByLabelText(/code from the email/i), 'ABU12345');
    await user.click(screen.getByRole('button', { name: 'Verify' }));

    expect(screen.getByText(/character we don't use/i)).toBeInTheDocument();
    expect(screen.queryByText('Enter all 8 characters from the email')).not.toBeInTheDocument();
    // And distinct from the SERVER's `invalid` copy — the section knows locally
    // that it never sent this code.
    expect(screen.queryByText(/that code isn't right/i)).not.toBeInTheDocument();
    expect(api.verifyEmailChange).not.toHaveBeenCalled();
  });

  it("the format instruction is PROGRAMMATICALLY ASSOCIATED — aria-describedby resolves to it, with and without an error", async () => {
    const user = userEvent.setup();
    renderAwaiting();
    const field = screen.getByLabelText(/code from the email/i);

    const resolve = () =>
      (field.getAttribute('aria-describedby') ?? '')
        .split(' ')
        .filter(Boolean)
        .map((id) => document.getElementById(id)?.textContent ?? '');

    // Without an error: the hint alone.
    expect(resolve().join(' ')).toContain('8 characters, letters and numbers');

    // With an error present: FormField MERGES rather than overwrites, so BOTH
    // the hint and the error id must still resolve.
    await user.type(field, 'AB12');
    await user.click(screen.getByRole('button', { name: 'Verify' }));
    const withError = resolve().join(' ');
    expect(withError).toContain('8 characters, letters and numbers');
    expect(withError).toContain('Enter all 8 characters from the email');
  });

  it('a VALID code calls verify with the normalised value and a `verified` outcome moves focus to Change', async () => {
    const user = userEvent.setup();
    renderAwaiting();
    api.verifyEmailChange.mockResolvedValue(
      body({ outcome: 'verified', email: NEW, pending_email_change: null, verification_sent: false, email_changed_at: '2026-09-04T12:00:00.000Z' })
    );

    await user.type(screen.getByLabelText(/code from the email/i), 'ab12-cd34');
    await user.click(screen.getByRole('button', { name: 'Verify' }));

    await waitFor(() => expect(api.verifyEmailChange).toHaveBeenCalledWith('u-uuid-1', 'AB12CD34'));
    await waitFor(() =>
      expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Change' }))
    );
    expect(document.activeElement).not.toBe(document.body);
  });

  it("`invalid` shows its own copy and STAYS in awaiting-code, with the code field cleared", async () => {
    const user = userEvent.setup();
    renderAwaiting();
    api.verifyEmailChange.mockResolvedValue(body({ outcome: 'invalid' }));

    const field = screen.getByLabelText(/code from the email/i);
    await user.type(field, 'AB12CD34');
    await user.click(screen.getByRole('button', { name: 'Verify' }));

    await waitFor(() =>
      expect(screen.getByText("That code isn't right — check the email and try again")).toBeInTheDocument()
    );
    expect(screen.getByRole('button', { name: 'Verify' })).toBeInTheDocument();
    expect(field).toHaveValue('');
  });

  it("`expired` shows its own copy with Resend promoted — and the copy exists ONLY on this round trip", async () => {
    const user = userEvent.setup();
    renderAwaiting();
    api.verifyEmailChange.mockResolvedValue(body({ outcome: 'expired' }));

    await user.type(screen.getByLabelText(/code from the email/i), 'AB12CD34');
    await user.click(screen.getByRole('button', { name: 'Verify' }));

    await waitFor(() => expect(screen.getByText('That code has expired')).toBeInTheDocument());
    expect(screen.getByRole('button', { name: 'Resend code' })).toBeInTheDocument();
    expect(screen.queryByText(/that code isn't right/i)).not.toBeInTheDocument();
  });

  it("`address_taken` has its OWN copy, is never collapsed into `invalid`, and stays in awaiting-code", async () => {
    const user = userEvent.setup();
    renderAwaiting();
    api.verifyEmailChange.mockResolvedValue(body({ outcome: 'address_taken' }));

    await user.type(screen.getByLabelText(/code from the email/i), 'AB12CD34');
    await user.click(screen.getByRole('button', { name: 'Verify' }));

    await waitFor(() =>
      expect(
        screen.getByText('Another account already uses that address. Try a different one, or ask us for help if it should be yours.')
      ).toBeInTheDocument()
    );
    expect(screen.queryByText(/that code isn't right/i)).not.toBeInTheDocument();
    expect(screen.queryByText('That code has expired')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Verify' })).toBeInTheDocument();
  });

  it('a TRANSPORT failure shows the shared error message — NEVER the `invalid` copy', async () => {
    const user = userEvent.setup();
    renderAwaiting();
    api.verifyEmailChange.mockRejectedValue(new ApiError('offline', 'network', 0, {}));

    await user.type(screen.getByLabelText(/code from the email/i), 'AB12CD34');
    await user.click(screen.getByRole('button', { name: 'Verify' }));

    await waitFor(() => expect(screen.getByText(/couldn't reach the server/i)).toBeInTheDocument());
    // A network blip must not read as a wrong code.
    expect(screen.queryByText(/that code isn't right/i)).not.toBeInTheDocument();
  });

  it('a FAILED verify leaves focus in the code input', async () => {
    const user = userEvent.setup();
    renderAwaiting();
    api.verifyEmailChange.mockResolvedValue(body({ outcome: 'invalid' }));

    await user.type(screen.getByLabelText(/code from the email/i), 'AB12CD34');
    await user.click(screen.getByRole('button', { name: 'Verify' }));

    await waitFor(() =>
      expect(document.activeElement).toBe(screen.getByLabelText(/code from the email/i))
    );
  });

  it('the code is never echoed into the status line', async () => {
    const user = userEvent.setup();
    renderAwaiting();
    await user.type(screen.getByLabelText(/code from the email/i), 'AB12CD34');
    const status = screen.getByRole('status');
    expect(status.textContent ?? '').not.toContain('AB12CD34');
  });

  it('the code input carries the one-time-code autocomplete hint plus id and name', () => {
    renderAwaiting();
    const field = screen.getByLabelText(/code from the email/i);
    expect(field).toHaveAttribute('autocomplete', 'one-time-code');
    expect(field).toHaveAttribute('name', 'email_change_code');
    expect(field.getAttribute('id')).toBeTruthy();
  });
});

// ---------------------------------------------------------------------------
// Resend / Discard — the DEDICATED routes
// ---------------------------------------------------------------------------

describe('EmailAddressSection — Resend and Discard', () => {
  it('Resend calls the DEDICATED resend endpoint (never re-posting the request one) and leaves focus on Resend', async () => {
    const user = userEvent.setup();
    renderAwaiting();
    api.resendEmailChangeCode.mockResolvedValue(body());

    const resend = screen.getByRole('button', { name: 'Resend code' });
    await user.click(resend);

    await waitFor(() => expect(api.resendEmailChangeCode).toHaveBeenCalledWith('u-uuid-1'));
    expect(api.requestEmailChange).not.toHaveBeenCalled();
    expect(document.activeElement).toBe(resend);
  });

  it('Resend is aria-disabled during its cooldown, keeps a STATIC label, stays mounted, and blocks the press', async () => {
    const user = userEvent.setup();
    renderAwaiting();
    api.resendEmailChangeCode.mockResolvedValue(body());

    await user.click(screen.getByRole('button', { name: 'Resend code' }));
    await waitFor(() =>
      expect(screen.getByRole('button', { name: 'Resend code' })).toHaveAttribute('aria-disabled', 'true')
    );

    // Label unchanged (no ticking countdown anywhere) and the control is still
    // in the tab order.
    const resend = screen.getByRole('button', { name: 'Resend code' });
    expect(resend).not.toHaveAttribute('disabled');
    await user.click(resend);
    expect(api.resendEmailChangeCode).toHaveBeenCalledTimes(1);
    expect(screen.getByText('You can ask for another code in a moment')).toBeInTheDocument();
  });

  it('a SESSION-LOCAL send followed by a self row that GOES null shows the expired copy — never a silent drop to idle', async () => {
    // The ONE case where this section may say a code is gone without a verify
    // round trip. Both halves are required and both are driven here: the section
    // must have SENT this session, and it must have SEEN a live pending row that
    // then went away. Unreachable in production today (staleTime: Infinity, and
    // the hook's docblock says the self row "NEVER self-refreshes") — written
    // anyway, because "silently drop to idle" is the failure it prevents.
    const user = userEvent.setup();
    const { rerender } = renderAwaiting();
    api.resendEmailChangeCode.mockResolvedValue(body());
    await user.click(screen.getByRole('button', { name: 'Resend code' }));
    await waitFor(() => expect(api.resendEmailChangeCode).toHaveBeenCalled());

    mockSelf.mockReturnValue(selfState(ROW({ pending_email_change: null })));
    const client = new QueryClient();
    rerender(
      <QueryClientProvider client={client}>
        <EmailAddressSection />
      </QueryClientProvider>
    );

    await waitFor(() => expect(screen.getByText('That code has expired')).toBeInTheDocument());
    expect(screen.getByRole('button', { name: 'Resend code' })).toBeInTheDocument();
    // NOT dropped to idle.
    expect(screen.getByLabelText(/code from the email/i)).toBeInTheDocument();
  });

  it('the arm does NOT fire on a self row that was null ALL ALONG — "goes null" is a transition, not a state', async () => {
    // The anti-vacuity mirror. Without it the arm fires the moment a Save
    // succeeds against a self row the cache patch has not reached, telling the
    // user their brand-new code has already expired.
    const user = userEvent.setup();
    mockSelf.mockReturnValue(selfState(ROW({ pending_email_change: null })));
    renderSection();
    api.requestEmailChange.mockResolvedValue(body());

    await user.click(screen.getByRole('button', { name: 'Change' }));
    await user.type(screen.getByLabelText(/new email address/i), NEW);
    await user.click(screen.getByRole('button', { name: 'Save' }));

    /* getAllBy since 2026-09-05 (code review #32): the sentence now appears TWICE
       by design — once as the visible line, once inside the always-mounted
       `role="status"` region that actually announces it. Both copies are the
       point; asserting on exactly one would re-introduce the ambiguity. */
    await waitFor(() => expect(screen.getAllByText(`We sent a code to ${NEW}`).length).toBe(2));
    expect(screen.queryByText('That code has expired')).not.toBeInTheDocument();
  });

  it('Discard calls the DEDICATED cancel endpoint, returns to idle, and moves focus to Change', async () => {
    const user = userEvent.setup();
    renderAwaiting();
    api.cancelEmailChange.mockResolvedValue(
      body({ outcome: 'cancelled', pending_email_change: null, verification_sent: false })
    );

    await user.click(screen.getByRole('button', { name: 'Discard change' }));

    await waitFor(() => expect(api.cancelEmailChange).toHaveBeenCalledWith('u-uuid-1'));
    await waitFor(() =>
      expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Change' }))
    );
    expect(api.requestEmailChange).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// The revert affordance (D-38) — and the focus hand-off it owes
// ---------------------------------------------------------------------------

describe('EmailAddressSection — revert (D-38)', () => {
  it('is ABSENT from the DOM when `email_changed_at` is null, and PRESENT when it is set', () => {
    mockSelf.mockReturnValue(selfState(ROW({ email_changed_at: null })));
    const first = renderSection();
    expect(screen.queryByRole('button', { name: 'Use my sign-in address' })).not.toBeInTheDocument();
    first.unmount();

    mockSelf.mockReturnValue(selfState(ROW({ email_changed_at: '2026-09-04T00:00:00.000Z' })));
    renderSection();
    expect(screen.getByRole('button', { name: 'Use my sign-in address' })).toBeInTheDocument();
  });

  // Round 2 HIGH-B (owner ruling 2026-09-05). The gate is the SERVER's answer, and it
  // fails CLOSED: with the timestamp set but the server saying no (an unverified or
  // synthetic claim on the access token — the wave-8 window), the control must not
  // render an action the route would refuse. Cross-finding C4: the engine's own remedy
  // rendered the button on an ABSENT key, so absence is asserted separately from false.
  it.each([
    ['revert_available is FALSE', false],
    ['revert_available is NULL (a default-scope echo)', null],
    ['revert_available is ABSENT', undefined],
  ])('is ABSENT from the DOM when email_changed_at is set but %s — the gate fails closed', (_label, value) => {
    const row = ROW({ email_changed_at: '2026-09-04T00:00:00.000Z' });
    if (value === undefined) delete row.revert_available;
    else row.revert_available = value;
    mockSelf.mockReturnValue(selfState(row));
    renderSection();
    expect(screen.queryByRole('button', { name: 'Use my sign-in address' })).not.toBeInTheDocument();
    expect(screen.queryByText(/sign-in address/i)).not.toBeInTheDocument();
  });

  it('is PRESENT only on the literal true — a truthy non-boolean does not open the gate', () => {
    const row = ROW({ email_changed_at: '2026-09-04T00:00:00.000Z' });
    (row as Record<string, unknown>).revert_available = 'yes';
    mockSelf.mockReturnValue(selfState(row));
    renderSection();
    expect(screen.queryByRole('button', { name: 'Use my sign-in address' })).not.toBeInTheDocument();
  });

  it('a SUCCESSFUL revert unmounts the control and hands focus to Change — NOT to document.body', async () => {
    const user = userEvent.setup();
    // The affordance renders only while email_changed_at is non-null; plan 09
    // returns null on `reverted`, so the button the user just pressed is gone on
    // the next paint. React does not relocate focus when the active element
    // unmounts — the browser drops it to <body>.
    mockSelf.mockReturnValue(selfState(ROW({ email_changed_at: '2026-09-04T00:00:00.000Z' })));
    const { rerender } = renderSection();
    api.revertEmailToSignIn.mockResolvedValue(
      body({ outcome: 'reverted', email: REAL, pending_email_change: null, verification_sent: false, email_changed_at: null })
    );

    await user.click(screen.getByRole('button', { name: 'Use my sign-in address' }));
    await waitFor(() => expect(api.revertEmailToSignIn).toHaveBeenCalled());

    // The cache patch is what removes the control; drive the same effect here.
    mockSelf.mockReturnValue(selfState(ROW({ email_changed_at: null })));
    const client = new QueryClient();
    rerender(
      <QueryClientProvider client={client}>
        <EmailAddressSection />
      </QueryClientProvider>
    );

    await waitFor(() =>
      expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Change' }))
    );
    expect(document.activeElement).not.toBe(document.body);
    expect(screen.queryByRole('button', { name: 'Use my sign-in address' })).not.toBeInTheDocument();
  });

  it('a FAILED revert (`address_taken`) leaves the control MOUNTED and focused, with the shared conflict copy', async () => {
    const user = userEvent.setup();
    mockSelf.mockReturnValue(selfState(ROW({ email_changed_at: '2026-09-04T00:00:00.000Z' })));
    renderSection();
    api.revertEmailToSignIn.mockResolvedValue(body({ outcome: 'address_taken' }));

    await user.click(screen.getByRole('button', { name: 'Use my sign-in address' }));

    await waitFor(() =>
      expect(
        screen.getByText('Another account already uses that address. Try a different one, or ask us for help if it should be yours.')
      ).toBeInTheDocument()
    );
    const revert = screen.getByRole('button', { name: 'Use my sign-in address' });
    expect(revert).toBeInTheDocument();
    await waitFor(() => expect(document.activeElement).toBe(revert));
  });

  it('a revert that throws shows the shared error message and leaves focus on the control', async () => {
    const user = userEvent.setup();
    mockSelf.mockReturnValue(selfState(ROW({ email_changed_at: '2026-09-04T00:00:00.000Z' })));
    renderSection();
    api.revertEmailToSignIn.mockRejectedValue(new ApiError('nope', 'validation', 400, {}));

    await user.click(screen.getByRole('button', { name: 'Use my sign-in address' }));

    // Round 3 #22: a `validation` envelope from a BODYLESS route is not a form error —
    // the section overrides the shared copy with a reload-the-page message.
    await waitFor(() => expect(screen.getByText(/that action is no longer available/i)).toBeInTheDocument());
    expect(screen.queryByText(/something looks off with that request/i)).not.toBeInTheDocument();
    await waitFor(() =>
      expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Use my sign-in address' }))
    );
  });
});

// ---------------------------------------------------------------------------
// Code review round 3 (owner ruling 2026-09-05) — the lane is symmetric, the gate
// answers, stale errors clear, validators match the backend, the region is proven
// ---------------------------------------------------------------------------

describe('EmailAddressSection — round 3: symmetric lane, answering gate, stale errors, validators', () => {
  it('#1/#35 — Verify pressed during an in-flight Resend is BLOCKED with a busy message, and fires no verify', async () => {
    const user = userEvent.setup();
    renderAwaiting();
    let releaseResend: (v: unknown) => void = () => {};
    api.resendEmailChangeCode.mockReturnValue(new Promise((res) => { releaseResend = res; }));

    await user.type(screen.getByLabelText(/code from the email/i), 'AB12CD34');
    await user.click(screen.getByRole('button', { name: 'Resend code' }));
    expect(api.resendEmailChangeCode).toHaveBeenCalledTimes(1);

    const verify = screen.getByRole('button', { name: 'Verify' });
    expect(verify).toHaveAttribute('aria-disabled', 'true'); // the lane, not only its own state
    expect(verify).not.toHaveAttribute('disabled');
    await user.click(verify);
    expect(api.verifyEmailChange).not.toHaveBeenCalled();
    expect(screen.getByRole('alert')).toHaveTextContent(/wait for the current step to finish/i);

    releaseResend(body({ outcome: 'code_sent' }));
    await waitFor(() => expect(screen.getByRole('button', { name: 'Verify' })).not.toHaveAttribute('aria-disabled', 'true'));
  });

  it('#34 — a gated Discard press answers with a fixed alert instead of silence', async () => {
    const user = userEvent.setup();
    renderAwaiting();
    let releaseVerify: (v: unknown) => void = () => {};
    api.verifyEmailChange.mockReturnValue(new Promise((res) => { releaseVerify = res; }));
    await user.type(screen.getByLabelText(/code from the email/i), 'AB12CD34');
    await user.click(screen.getByRole('button', { name: 'Verify' }));

    await user.click(screen.getByRole('button', { name: 'Discard change' }));
    expect(api.cancelEmailChange).not.toHaveBeenCalled();
    expect(screen.getByRole('alert')).toHaveTextContent(/wait for the current step to finish/i);

    releaseVerify(body({ outcome: 'verified', email: NEW, pending_email_change: null, verification_sent: false, email_changed_at: '2026-09-04T00:00:00.000Z' }));
    await waitFor(() => expect(screen.getByRole('button', { name: 'Change' })).toBeInTheDocument());
  });

  it('#35 — Change carries aria-disabled and answers while a Revert is in flight (no edit is started)', async () => {
    const user = userEvent.setup();
    mockSelf.mockReturnValue(selfState(ROW({ email_changed_at: '2026-09-04T00:00:00.000Z' })));
    renderSection();
    let releaseRevert: (v: unknown) => void = () => {};
    api.revertEmailToSignIn.mockReturnValue(new Promise((res) => { releaseRevert = res; }));

    await user.click(screen.getByRole('button', { name: 'Use my sign-in address' }));
    const change = screen.getByRole('button', { name: 'Change' });
    expect(change).toHaveAttribute('aria-disabled', 'true');
    await user.click(change);
    expect(screen.queryByLabelText(/new email address/i)).not.toBeInTheDocument();
    expect(screen.getByRole('alert')).toHaveTextContent(/wait for the current step to finish/i);

    releaseRevert(body({ outcome: 'reverted', email: REAL, pending_email_change: null, verification_sent: false, email_changed_at: null }));
    await waitFor(() => expect(api.revertEmailToSignIn).toHaveBeenCalledTimes(1));
  });

  it('#36 — after a rejected code the emptied field loses aria-invalid on the first keystroke', async () => {
    const user = userEvent.setup();
    renderAwaiting();
    api.verifyEmailChange.mockResolvedValue(body({ outcome: 'invalid', verification_sent: false }));
    const code = screen.getByLabelText(/code from the email/i);
    await user.type(code, 'AB12CD34');
    await user.click(screen.getByRole('button', { name: 'Verify' }));
    await waitFor(() => expect(screen.getByLabelText(/code from the email/i)).toHaveAttribute('aria-invalid', 'true'));
    expect(screen.getByLabelText(/code from the email/i)).toHaveValue('');

    await user.type(screen.getByLabelText(/code from the email/i), 'A');
    expect(screen.getByLabelText(/code from the email/i)).not.toHaveAttribute('aria-invalid', 'true');
    expect(screen.queryByText(/that code isn't right/i)).not.toBeInTheDocument();
  });

  it('#16 — the client validators match the backend: `a@b..com` and a 300-character address are refused before any request', async () => {
    const user = userEvent.setup();
    mockSelf.mockReturnValue(selfState(ROW()));
    renderSection();
    await user.click(screen.getByRole('button', { name: 'Change' }));
    const field = screen.getByLabelText(/new email address/i);

    await user.type(field, 'a@b..com');
    await user.click(screen.getByRole('button', { name: 'Save' }));
    expect(screen.getByRole('alert')).toHaveTextContent(/doesn't look like an email address/i);
    expect(api.requestEmailChange).not.toHaveBeenCalled();

    await user.clear(field);
    await user.type(field, `${'a'.repeat(290)}@example.com`);
    await user.click(screen.getByRole('button', { name: 'Save' }));
    expect(screen.getByRole('alert')).toHaveTextContent(/too long/i);
    expect(api.requestEmailChange).not.toHaveBeenCalled();
  });

  it('#40 — the always-mounted status region actually RECEIVES text on the code-sent, unchanged and resend paths', async () => {
    const user = userEvent.setup();
    mockSelf.mockReturnValue(selfState(ROW()));
    renderSection();
    // The section's OWN region is the sr-only one; an info Banner mounts a second
    // polite region while it is visible, so select by class rather than by role alone.
    const region = () => screen.getAllByRole('status').find((el) => el.classList.contains('sr-only'))!;
    api.requestEmailChange.mockResolvedValueOnce(body({ outcome: 'unchanged', pending_email_change: null, verification_sent: false }));
    await user.click(screen.getByRole('button', { name: 'Change' }));
    await user.type(screen.getByLabelText(/new email address/i), REAL);
    await user.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(region()).toHaveTextContent(/already the address we use/i));

    api.requestEmailChange.mockResolvedValueOnce(body({ outcome: 'code_sent' }));
    await user.click(screen.getByRole('button', { name: 'Change' }));
    await user.type(screen.getByLabelText(/new email address/i), NEW);
    await user.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(region()).toHaveTextContent(/we sent a code to/i));
  });

  it('#40 — the region receives the RESEND wording too (hydrated straight into awaiting-code, so no cooldown is armed)', async () => {
    const user = userEvent.setup();
    renderAwaiting();
    const region = () => screen.getAllByRole('status').find((el) => el.classList.contains('sr-only'))!;
    api.resendEmailChangeCode.mockResolvedValue(body({ outcome: 'code_sent' }));
    await user.click(screen.getByRole('button', { name: 'Resend code' }));
    await waitFor(() => expect(region()).toHaveTextContent(/we sent a new code to/i));
  });

  it('#40 — the EDITING state passes the automated a11y audit too', async () => {
    const user = userEvent.setup();
    mockSelf.mockReturnValue(selfState(ROW()));
    const { container } = renderSection();
    await user.click(screen.getByRole('button', { name: 'Change' }));
    expect(screen.getByLabelText(/new email address/i)).toBeInTheDocument();
    expect(await axe(container)).toHaveNoViolations();
  });
});

// ---------------------------------------------------------------------------
// DR-C — the native attribute, swept across every state
// ---------------------------------------------------------------------------

describe('EmailAddressSection — DR-C: no control carries the native `disabled` attribute in ANY state', () => {
  const sweep = (label: string) => {
    const buttons = screen.queryAllByRole('button');
    expect(buttons.length, `${label}: no buttons rendered — the sweep would be vacuous`).toBeGreaterThan(0);
    for (const btn of buttons) {
      expect(btn, `${label}: "${btn.textContent}" carries the native disabled attribute`).not.toHaveAttribute(
        'disabled'
      );
    }
  };

  it('sweeps idle, editing, saving, awaiting-code, verifying and verified', async () => {
    const user = userEvent.setup();
    mockSelf.mockReturnValue(selfState(ROW({ email_changed_at: '2026-09-04T00:00:00.000Z' })));
    renderSection();

    sweep('idle');

    await user.click(screen.getByRole('button', { name: 'Change' }));
    sweep('editing (empty field — Save is gated)');
    // The gate is aria-disabled, and the control is still in the tab order.
    expect(screen.getByRole('button', { name: 'Save' })).toHaveAttribute('aria-disabled', 'true');

    let releaseSave: (v: unknown) => void = () => {};
    api.requestEmailChange.mockReturnValue(new Promise((res) => { releaseSave = res; }));
    await user.type(screen.getByLabelText(/new email address/i), NEW);
    expect(screen.getByRole('button', { name: 'Save' })).not.toHaveAttribute('aria-disabled', 'true');
    await user.click(screen.getByRole('button', { name: 'Save' }));
    sweep('saving (in flight)');
    expect(screen.getByRole('button', { name: 'Save' })).toHaveAttribute('aria-disabled', 'true');

    releaseSave(body());
    await waitFor(() => expect(screen.getByLabelText(/code from the email/i)).toBeInTheDocument());
    sweep('awaiting-code (empty code — Verify is gated)');
    expect(screen.getByRole('button', { name: 'Verify' })).toHaveAttribute('aria-disabled', 'true');

    let releaseVerify: (v: unknown) => void = () => {};
    api.verifyEmailChange.mockReturnValue(new Promise((res) => { releaseVerify = res; }));
    await user.type(screen.getByLabelText(/code from the email/i), 'AB12CD34');
    expect(screen.getByRole('button', { name: 'Verify' })).not.toHaveAttribute('aria-disabled', 'true');
    await user.click(screen.getByRole('button', { name: 'Verify' }));
    sweep('verifying (in flight)');
    expect(screen.getByRole('button', { name: 'Verify' })).toHaveAttribute('aria-disabled', 'true');

    releaseVerify(
      body({ outcome: 'verified', email: NEW, pending_email_change: null, verification_sent: false, email_changed_at: '2026-09-04T00:00:00.000Z' })
    );
    await waitFor(() => expect(screen.getByRole('button', { name: 'Change' })).toBeInTheDocument());
    sweep('verified');
  });
});

describe('EmailAddressSection — HIGH-2: the three secondary actions have an in-flight lane', () => {
  /* WHY THIS SUITE REACHES awaiting-code THROUGH `verification_sent: false` AND NOT
     THROUGH `body()`. The default body carries `verification_sent: true`, which runs
     `startCooldown()` and sets a 30-SECOND cooldown; this file uses no fake timers and
     vitest.config.mts caps a test at 20s, so the cooldown can never lapse inside a
     test. A Resend assertion written on that path passes VACUOUSLY — `handleResend`
     returns at the cooldown guard before it ever calls the api, so `aria-disabled` is
     present for the wrong reason and the in-flight path is never exercised. The
     provider-refused body lands in the same state with NO cooldown, which is the only
     door into the code under test. Every test below therefore also asserts the api WAS
     called — that assertion is the anti-vacuity guard, not a formality. */
  const refused = () => body({ verification_sent: false });

  const reachAwaitingCode = async (user: ReturnType<typeof userEvent.setup>) => {
    api.requestEmailChange.mockResolvedValue(refused());
    await user.click(screen.getByRole('button', { name: 'Change' }));
    await user.type(screen.getByLabelText(/new email address/i), NEW);
    await user.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(screen.getByLabelText(/code from the email/i)).toBeInTheDocument());
  };

  it('a double-pressed Resend fires ONE request — the second press is blocked while the first is in flight', async () => {
    const user = userEvent.setup();
    mockSelf.mockReturnValue(selfState(ROW()));
    renderSection();
    await reachAwaitingCode(user);

    let release: (v: unknown) => void = () => {};
    api.resendEmailChangeCode.mockReturnValue(new Promise((res) => { release = res; }));

    const resend = screen.getByRole('button', { name: 'Resend code' });
    expect(resend).not.toHaveAttribute('aria-disabled', 'true');
    await user.click(resend);

    // ANTI-VACUITY: we got past the cooldown guard and actually called the api.
    expect(api.resendEmailChangeCode).toHaveBeenCalledTimes(1);
    expect(screen.getByRole('button', { name: 'Resend code' })).toHaveAttribute('aria-disabled', 'true');
    // DR-C: gated, never natively disabled, and still in the tab order.
    expect(screen.getByRole('button', { name: 'Resend code' })).not.toHaveAttribute('disabled');

    await user.click(screen.getByRole('button', { name: 'Resend code' }));
    expect(api.resendEmailChangeCode).toHaveBeenCalledTimes(1);

    release(refused());
    await waitFor(() =>
      expect(screen.getByRole('button', { name: 'Resend code' })).not.toHaveAttribute('aria-disabled', 'true')
    );
  });

  it('Discard is blocked while a VERIFY is in flight — the cross-lane guard', async () => {
    /* The harm this closes: POST /email/cancel revokes the very token the verify is
       consuming, so an unguarded Discard mid-verify made the server answer "that code
       isn't right" about a code that WAS right. */
    const user = userEvent.setup();
    mockSelf.mockReturnValue(selfState(ROW()));
    renderSection();
    await reachAwaitingCode(user);

    let releaseVerify: (v: unknown) => void = () => {};
    api.verifyEmailChange.mockReturnValue(new Promise((res) => { releaseVerify = res; }));
    await user.type(screen.getByLabelText(/code from the email/i), 'AB12CD34');
    await user.click(screen.getByRole('button', { name: 'Verify' }));
    expect(api.verifyEmailChange).toHaveBeenCalledTimes(1);

    const discard = screen.getByRole('button', { name: 'Discard change' });
    expect(discard).toHaveAttribute('aria-disabled', 'true');
    expect(discard).not.toHaveAttribute('disabled');
    await user.click(discard);
    expect(api.cancelEmailChange).not.toHaveBeenCalled();

    releaseVerify(
      body({ outcome: 'verified', email: NEW, pending_email_change: null, verification_sent: false, email_changed_at: '2026-09-04T00:00:00.000Z' })
    );
    await waitFor(() => expect(screen.getByRole('button', { name: 'Change' })).toBeInTheDocument());
  });

  it('a double-pressed Revert fires ONE request', async () => {
    const user = userEvent.setup();
    mockSelf.mockReturnValue(selfState(ROW({ email_changed_at: '2026-09-04T00:00:00.000Z' })));
    renderSection();

    let release: (v: unknown) => void = () => {};
    api.revertEmailToSignIn.mockReturnValue(new Promise((res) => { release = res; }));

    const revert = screen.getByRole('button', { name: 'Use my sign-in address' });
    await user.click(revert);
    expect(api.revertEmailToSignIn).toHaveBeenCalledTimes(1);
    expect(screen.getByRole('button', { name: 'Use my sign-in address' })).toHaveAttribute('aria-disabled', 'true');

    await user.click(screen.getByRole('button', { name: 'Use my sign-in address' }));
    expect(api.revertEmailToSignIn).toHaveBeenCalledTimes(1);

    release(body({ outcome: 'reverted', email: REAL, pending_email_change: null, verification_sent: false, email_changed_at: null }));
    await waitFor(() => expect(api.revertEmailToSignIn).toHaveBeenCalledTimes(1));
  });
});

describe('EmailAddressSection — code-review fixes 2026-09-05', () => {
  it('#8: a too-LONG but valid-alphabet code is reported as wrong length, not as a bad character', () => {
    // Reachable: the input allows maxLength 9, and these are all alphabet symbols.
    expect(checkCode('AB12CD345')).toBe('incomplete');
    expect(checkCode('AB12CD34')).toBe('ok');
    // The alphabet message still fires when the alphabet really is the problem.
    expect(checkCode('AB12CD3U')).toBe('out-of-alphabet');
  });

  it('#35: a Resend failure does NOT mark the untouched code input aria-invalid', async () => {
    const user = userEvent.setup();
    mockSelf.mockReturnValue(selfState(ROW()));
    api.requestEmailChange.mockResolvedValue(body({ verification_sent: false }));
    renderSection();

    await user.click(screen.getByRole('button', { name: 'Change' }));
    await user.type(screen.getByLabelText(/new email address/i), NEW);
    await user.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(screen.getByLabelText(/code from the email/i)).toBeInTheDocument());

    // One alert already on screen: the provider-refused Banner.
    const alertsBefore = screen.getAllByRole('alert').length;

    api.resendEmailChangeCode.mockRejectedValue(new Error('transport died'));
    await user.click(screen.getByRole('button', { name: 'Resend code' }));

    // The failure IS reported — as a second alert, beside the controls...
    await waitFor(() => expect(screen.getAllByRole('alert').length).toBe(alertsBefore + 1));
    // ...but NOT as a fault of a field the user has not typed into.
    expect(screen.getByLabelText(/code from the email/i)).not.toHaveAttribute('aria-invalid', 'true');
  });

  it('#36: Enter submits from the email field and from the code field', async () => {
    const user = userEvent.setup();
    mockSelf.mockReturnValue(selfState(ROW()));
    api.requestEmailChange.mockResolvedValue(body({ verification_sent: false }));
    renderSection();

    await user.click(screen.getByRole('button', { name: 'Change' }));
    await user.type(screen.getByLabelText(/new email address/i), NEW);
    await user.type(screen.getByLabelText(/new email address/i), '{Enter}');
    await waitFor(() => expect(api.requestEmailChange).toHaveBeenCalledTimes(1));

    await waitFor(() => expect(screen.getByLabelText(/code from the email/i)).toBeInTheDocument());
    api.verifyEmailChange.mockResolvedValue(
      body({ outcome: 'verified', email: NEW, pending_email_change: null, verification_sent: false, email_changed_at: '2026-09-04T00:00:00.000Z' })
    );
    await user.type(screen.getByLabelText(/code from the email/i), 'AB12CD34{Enter}');
    await waitFor(() => expect(api.verifyEmailChange).toHaveBeenCalledTimes(1));
  });

  it('#5: `unchanged` with a change still pending stays in awaiting-code instead of lying about it', async () => {
    const user = userEvent.setup();
    mockSelf.mockReturnValue(selfState(ROW()));
    // The server deliberately leaves the pending change alone and echoes it.
    api.requestEmailChange.mockResolvedValue(
      body({ outcome: 'unchanged', verification_sent: false })
    );
    renderSection();

    await user.click(screen.getByRole('button', { name: 'Change' }));
    await user.type(screen.getByLabelText(/new email address/i), REAL);
    await user.click(screen.getByRole('button', { name: 'Save' }));

    await waitFor(() =>
      expect(screen.getAllByText("That's already the address we use for you").length).toBe(2)
    );
    // The section does NOT claim the pending change is gone.
    expect(screen.getByLabelText(/code from the email/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Discard change' })).toBeInTheDocument();
  });

  it('#1: an expired verify keeps the pending address on screen even though the body nulls it', async () => {
    const user = userEvent.setup();
    mockSelf.mockReturnValue(selfState(ROW({ pending_email_change: { address: NEW, expires_at: '2026-09-04T13:00:00.000Z' } })));
    renderSection();

    await waitFor(() => expect(screen.getByLabelText(/code from the email/i)).toBeInTheDocument());
    expect(screen.getByText(NEW)).toBeInTheDocument();

    /* The server nulls pending_email_change on `expired` — its loader filters on
       expires_at > now(). Before the fix this blanked the address line at exactly
       the moment the user is asked to re-verify it. */
    api.verifyEmailChange.mockResolvedValue(
      body({ outcome: 'expired', pending_email_change: null, verification_sent: false })
    );
    mockSelf.mockReturnValue(selfState(ROW({ pending_email_change: null })));
    await user.type(screen.getByLabelText(/code from the email/i), 'AB12CD34');
    await user.click(screen.getByRole('button', { name: 'Verify' }));

    await waitFor(() => expect(api.verifyEmailChange).toHaveBeenCalled());
    expect(screen.getByText(NEW)).toBeInTheDocument();
  });
});

// ---------------------------------------------------------------------------
// Composition + a11y
// ---------------------------------------------------------------------------

/* ---------------------------------------------------------------------------
   POST-MERGE FIX SET (code review round 5 MED/LOW, 2026-09-07)

   Round 5 #32 recorded the gap these close: the round-4 frontend fix set shipped five
   behaviour changes and ONE changed assertion, so the suite was green whichever way the
   keep-the-code rule went and a later "restore the symmetry" tidy would have passed. Each
   test below pins a branch that had no assertion in either direction.
   --------------------------------------------------------------------------- */

describe('EmailAddressSection — post-merge fix set (round 5)', () => {
  const unusable = { outcome: 'verified', email: '', verification_sent: false };

  it('#1 — a TRANSPORT failure keeps the typed code, so Verify can be pressed again without re-transcribing it', async () => {
    const user = userEvent.setup();
    renderAwaiting();
    api.verifyEmailChange.mockRejectedValue(new ApiError('offline', 'network', 0, {}));

    await user.type(screen.getByLabelText(/code from the email/i), 'AB12CD34');
    await user.click(screen.getByRole('button', { name: 'Verify' }));
    await waitFor(() => expect(screen.getByText(/couldn't reach the server/i)).toBeInTheDocument());

    // THE POINT OF THE FIX: the 8 characters survive a network blip. Before this they
    // were wiped and had to be re-read off a phone's mail client.
    expect(screen.getByLabelText(/code from the email/i)).toHaveValue('AB12CD34');
    // And a second press actually re-sends THE SAME code — the anti-vacuity half.
    await user.click(screen.getByRole('button', { name: 'Verify' }));
    await waitFor(() => expect(api.verifyEmailChange).toHaveBeenCalledTimes(2));
    expect(api.verifyEmailChange).toHaveBeenLastCalledWith('u-uuid-1', 'AB12CD34');
  });

  it('#22 — an UNREADABLE answer keeps the code but points at Resend, never claiming the code is still good', async () => {
    const user = userEvent.setup();
    renderAwaiting();
    api.verifyEmailChange.mockResolvedValue(unusable);

    await user.type(screen.getByLabelText(/code from the email/i), 'AB12CD34');
    await user.click(screen.getByRole('button', { name: 'Verify' }));

    // The server may already have burnt the nonce on this branch, so the copy names the
    // escape hatch instead of asserting the code is live.
    await waitFor(() => expect(screen.getByText(/use resend code/i)).toBeInTheDocument());
    expect(screen.getByLabelText(/code from the email/i)).toHaveValue('AB12CD34');
    expect(screen.queryByText(/that code isn't right/i)).not.toBeInTheDocument();
  });

  it('#2 — Cancel WORKS during an in-flight Save, and the landing response does not drag the user into awaiting-code', async () => {
    const user = userEvent.setup();
    mockSelf.mockReturnValue(selfState(ROW()));
    renderSection();
    let release: (v: unknown) => void = () => {};
    api.requestEmailChange.mockReturnValue(new Promise((res) => { release = res; }));

    await user.click(screen.getByRole('button', { name: 'Change' }));
    await user.type(screen.getByLabelText(/new email address/i), NEW);
    await user.click(screen.getByRole('button', { name: 'Save' }));
    expect(api.requestEmailChange).toHaveBeenCalledTimes(1); // anti-vacuity: it is in flight

    await user.click(screen.getByRole('button', { name: 'Cancel' }));
    // The press is HONOURED, not swallowed: round 4 gated it and the focus steal happened
    // anyway when the response landed.
    expect(screen.getByRole('button', { name: 'Change' })).toBeInTheDocument();
    expect(screen.queryByLabelText(/new email address/i)).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Change' })).toHaveFocus();

    release(body({ outcome: 'code_sent' }));
    // The section stays where the user left it — no code panel, no focus theft — and says
    // what happened, because a pending change they do not know about is a surprise on the
    // next reload.
    /* Two nodes carry it, exactly as the `unchanged` copy does: the visible info Banner
       (a POLITE region that is conditionally mounted, so it announces nothing on its own)
       and the section's always-mounted region, which is what actually speaks. That
       pairing is the documented rule in this file's announce() docblock, not a slip. */
    await waitFor(() => expect(screen.getAllByText(/request had already reached us/i)).toHaveLength(2));
    expect(screen.queryByLabelText(/code from the email/i)).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Change' })).toHaveFocus();
    // The sr-only one is the section's always-mounted region — the surface that announces.
    const regions = screen.getAllByRole('status');
    expect(regions.some((r) => r.className.includes('sr-only'))).toBe(true);
    expect(regions.find((r) => r.className.includes('sr-only'))).toHaveTextContent(
      /request had already reached us/i
    );
  });

  it('#35/#39 — a busy Save answers in the ACTION lane: the email input is never marked invalid, and both controls point at the message', async () => {
    const user = userEvent.setup();
    mockSelf.mockReturnValue(selfState(ROW()));
    renderSection();
    let release: (v: unknown) => void = () => {};
    api.requestEmailChange.mockReturnValue(new Promise((res) => { release = res; }));

    await user.click(screen.getByRole('button', { name: 'Change' }));
    await user.type(screen.getByLabelText(/new email address/i), NEW);
    await user.click(screen.getByRole('button', { name: 'Save' }));
    expect(api.requestEmailChange).toHaveBeenCalledTimes(1);

    await user.click(screen.getByRole('button', { name: 'Save' }));
    expect(api.requestEmailChange).toHaveBeenCalledTimes(1); // the second press is blocked

    const alert = screen.getByRole('alert');
    expect(alert).toHaveTextContent(/wait for the current step to finish/i);
    // THE DEFECT THIS CLOSES: the busy line used to live in the FormField lane, which
    // stamps aria-invalid on an address the user has not mistyped (WCAG 4.1.2).
    expect(screen.getByLabelText(/new email address/i)).not.toHaveAttribute('aria-invalid', 'true');
    expect(screen.getByRole('button', { name: 'Save' })).toHaveAttribute('aria-describedby', alert.id);
    expect(screen.getByRole('button', { name: 'Cancel' })).toHaveAttribute('aria-describedby', alert.id);

    release(body({ outcome: 'code_sent' }));
    await waitFor(() => expect(screen.getByLabelText(/code from the email/i)).toBeInTheDocument());
  });

  it('#33/#35 — a self row with NO id gates the controls in ARIA as well as in the handler, and answers in the action lane', async () => {
    const user = userEvent.setup();
    mockSelf.mockReturnValue(selfState({ ...ROW(), id: undefined } as unknown as Parameters<typeof selfState>[0]));
    renderSection();

    await user.click(screen.getByRole('button', { name: 'Change' }));
    await user.type(screen.getByLabelText(/new email address/i), NEW);
    const save = screen.getByRole('button', { name: 'Save' });
    // DR-C's FIRST half, which round 4 shipped without: announced as unavailable...
    expect(save).toHaveAttribute('aria-disabled', 'true');
    expect(save).not.toHaveAttribute('disabled'); // ...and never natively disabled

    await user.click(save);
    expect(api.requestEmailChange).not.toHaveBeenCalled();
    const alert = screen.getByRole('alert');
    expect(alert).toHaveTextContent(/couldn't load your account details/i);
    expect(screen.getByLabelText(/new email address/i)).not.toHaveAttribute('aria-invalid', 'true');
    expect(save).toHaveAttribute('aria-describedby', alert.id);
  });

  it('#33 — Verify, Resend and Discard carry the same aria-disabled when the self row has no id', async () => {
    mockSelf.mockReturnValue(
      selfState({
        ...ROW({ pending_email_change: { address: NEW, expires_at: 'z' } }),
        id: undefined,
      } as unknown as Parameters<typeof selfState>[0])
    );
    renderSection();

    for (const name of ['Verify', 'Resend code', 'Discard change']) {
      const control = screen.getByRole('button', { name });
      expect(control).toHaveAttribute('aria-disabled', 'true');
      expect(control).not.toHaveAttribute('disabled');
    }
    noApiCalls();
  });

  it('#33 — the revert control carries it too', () => {
    mockSelf.mockReturnValue(
      selfState({
        ...ROW({ email_changed_at: '2026-09-04T00:00:00.000Z' }),
        id: undefined,
      } as unknown as Parameters<typeof selfState>[0])
    );
    renderSection();
    const revert = screen.getByRole('button', { name: 'Use my sign-in address' });
    expect(revert).toHaveAttribute('aria-disabled', 'true');
    expect(revert).not.toHaveAttribute('disabled');
  });

  it('#16/#19/#29 — a SYNTHETIC address is refused before the request, with copy naming the real reason', async () => {
    const user = userEvent.setup();
    mockSelf.mockReturnValue(selfState(ROW()));
    renderSection();

    await user.click(screen.getByRole('button', { name: 'Change' }));
    // A real, deliverable domain that the BROAD NIX-AUTH0 predicate matches — the exact
    // input that used to be told to "reload the page", forever.
    await user.type(screen.getByLabelText(/new email address/i), 'chris@auth0.com');
    await user.click(screen.getByRole('button', { name: 'Save' }));

    expect(screen.getByText(/reserved by our sign-in system/i)).toBeInTheDocument();
    expect(screen.queryByText(/reload the page/i)).not.toBeInTheDocument();
    // The address never leaves the browser.
    expect(api.requestEmailChange).not.toHaveBeenCalled();
  });

  it("#15 — the SERVER's `unsupported_address` refusal lands on the reserved-domain copy, not on \"reload the page\"", async () => {
    const user = userEvent.setup();
    mockSelf.mockReturnValue(selfState(ROW()));
    api.requestEmailChange.mockRejectedValue(
      new ApiError('That address cannot be used with this app', 'unsupported_address', 400, {})
    );
    renderSection();

    await user.click(screen.getByRole('button', { name: 'Change' }));
    await user.type(screen.getByLabelText(/new email address/i), NEW);
    await user.click(screen.getByRole('button', { name: 'Save' }));

    await waitFor(() => expect(screen.getByText(/reserved by our sign-in system/i)).toBeInTheDocument());
    expect(screen.queryByText(/no longer available/i)).not.toBeInTheDocument();
  });

  it('#11/#16 — a DIFFERENT 400 on the same route no longer inherits that copy', async () => {
    const user = userEvent.setup();
    mockSelf.mockReturnValue(selfState(ROW()));
    api.requestEmailChange.mockRejectedValue(new ApiError('Validation failed', 'validation', 400, {}));
    renderSection();

    await user.click(screen.getByRole('button', { name: 'Change' }));
    await user.type(screen.getByLabelText(/new email address/i), NEW);
    await user.click(screen.getByRole('button', { name: 'Save' }));

    /* The round-5 fix blanket-mapped `validation` on this route, reasoning that the client
       pre-flights left the synthetic gate as the only reachable cause. True, and still a
       confident WRONG answer for any other 400 — a body-key drift or a future validator
       would have told the user their DOMAIN was reserved. The specific code now carries
       the specific copy; everything else falls back to the section-wide default. */
    await waitFor(() => expect(screen.getByText(/no longer available/i)).toBeInTheDocument());
    expect(screen.queryByText(/reserved by our sign-in system/i)).not.toBeInTheDocument();
  });

  /* ── ROUND 6 HIGH: Cancel-during-Save, the three parts ──────────────────────
     The first version of the #2 fix shipped part 1 only. Its test released ONE promise
     with no second mutation, so it was green over the whole failure: the lane fell open
     the instant Cancel set the state to idle, and a late response patched its own row
     into an immortal cache underneath whatever the user was doing by then. */

  it('#2 (round 6 HIGH) — the lane stays CLOSED while a cancelled Save is still on the wire', async () => {
    const user = userEvent.setup();
    mockSelf.mockReturnValue(selfState(ROW()));
    renderSection();
    let release: (v: unknown) => void = () => {};
    api.requestEmailChange.mockReturnValue(new Promise((res) => { release = res; }));

    await user.click(screen.getByRole('button', { name: 'Change' }));
    await user.type(screen.getByLabelText(/new email address/i), NEW);
    await user.click(screen.getByRole('button', { name: 'Save' }));
    expect(api.requestEmailChange).toHaveBeenCalledTimes(1); // anti-vacuity: on the wire
    await user.click(screen.getByRole('button', { name: 'Cancel' }));

    /* `state` is now 'idle' — which is what made `mutating` (busy || saving || verifying)
       read FALSE while the POST was still open. `saveInFlight` is what holds the lane. */
    const change = screen.getByRole('button', { name: 'Change' });
    expect(change).toHaveAttribute('aria-disabled', 'true');
    expect(change).not.toHaveAttribute('disabled'); // DR-C: never natively disabled
    await user.click(change);
    expect(screen.queryByLabelText(/new email address/i)).not.toBeInTheDocument();
    expect(screen.getByRole('alert')).toHaveTextContent(/wait for the current step to finish/i);
    // No second mutation could start, which is what makes the interleave unreachable.
    expect(api.requestEmailChange).toHaveBeenCalledTimes(1);

    release(body({ outcome: 'code_sent' }));
    // The REQUEST is what reopens the lane, not the state the user left.
    await waitFor(() =>
      expect(screen.getByRole('button', { name: 'Change' })).not.toHaveAttribute('aria-disabled', 'true')
    );
  });

  it('#2 (round 6 HIGH) — an ABANDONED response REFETCHES the self row and never patches it', async () => {
    const user = userEvent.setup();
    mockSelf.mockReturnValue(selfState(ROW()));
    renderSection();
    let release: (v: unknown) => void = () => {};
    api.requestEmailChange.mockReturnValue(new Promise((res) => { release = res; }));

    await user.click(screen.getByRole('button', { name: 'Change' }));
    await user.type(screen.getByLabelText(/new email address/i), NEW);
    await user.click(screen.getByRole('button', { name: 'Save' }));
    await user.click(screen.getByRole('button', { name: 'Cancel' }));
    release(body({ outcome: 'code_sent' }));

    await waitFor(() => expect(cache.invalidate).toHaveBeenCalledTimes(1));
    /* THE WHOLE POINT: a body the section already knows is stale never goes into an
       immortal cache. The server DID act, so the row is refetched instead — a refetch
       asks what is true now and cannot resurrect an older pending address over a newer
       one. The non-abandoned path still patches (asserted by the test below). */
    expect(cache.patch).not.toHaveBeenCalled();
  });

  it('#2 — the NON-abandoned path still patches from the body, unchanged', async () => {
    const user = userEvent.setup();
    mockSelf.mockReturnValue(selfState(ROW()));
    api.requestEmailChange.mockResolvedValue(body({ outcome: 'code_sent' }));
    renderSection();

    await user.click(screen.getByRole('button', { name: 'Change' }));
    await user.type(screen.getByLabelText(/new email address/i), NEW);
    await user.click(screen.getByRole('button', { name: 'Save' }));

    await waitFor(() => expect(screen.getByLabelText(/code from the email/i)).toBeInTheDocument());
    expect(cache.patch).toHaveBeenCalledTimes(1);
    expect(cache.invalidate).not.toHaveBeenCalled();
  });

  it('#12 — a cancelled Save whose mail the PROVIDER refused says so, instead of pointing at a code that was never sent', async () => {
    const user = userEvent.setup();
    mockSelf.mockReturnValue(selfState(ROW()));
    renderSection();
    let release: (v: unknown) => void = () => {};
    api.requestEmailChange.mockReturnValue(new Promise((res) => { release = res; }));

    await user.click(screen.getByRole('button', { name: 'Change' }));
    await user.type(screen.getByLabelText(/new email address/i), NEW);
    await user.click(screen.getByRole('button', { name: 'Save' }));
    await user.click(screen.getByRole('button', { name: 'Cancel' }));
    release(body({ outcome: 'code_sent', verification_sent: false }));

    await waitFor(() => expect(screen.getByText(/couldn't send the code just now/i)).toBeInTheDocument());
    // "reload the page to finish it" would name a code that does not exist.
    expect(screen.queryByText(/request had already reached us/i)).not.toBeInTheDocument();
  });

  it('#29 — the section-wide `validation` default is untouched on the bodyless routes', async () => {
    const user = userEvent.setup();
    renderAwaiting();
    api.resendEmailChangeCode.mockRejectedValue(new ApiError('Validation failed', 'validation', 400, {}));

    await user.click(screen.getByRole('button', { name: 'Resend code' }));

    // A resend with nothing pending genuinely IS stale state — the reason the section-wide
    // override exists at all — so it must survive the Save-route override being dropped.
    await waitFor(() => expect(screen.getByText(/no longer available/i)).toBeInTheDocument());
    expect(screen.queryByText(/reserved by our sign-in system/i)).not.toBeInTheDocument();
  });
});

describe('EmailAddressSection — composition and accessibility', () => {
  it('every control has an accessible name and the section passes an automated a11y audit (idle)', async () => {
    mockSelf.mockReturnValue(selfState(ROW({ email_changed_at: '2026-09-04T00:00:00.000Z' })));
    const { container } = renderSection();
    for (const btn of screen.getAllByRole('button')) {
      expect(btn.textContent?.trim()).toBeTruthy();
    }
    expect(await axe(container)).toHaveNoViolations();
  });

  it('passes an automated a11y audit in awaiting-code, where both inputs and four controls are live', async () => {
    const { container } = renderAwaiting();
    expect(await axe(container)).toHaveNoViolations();
  });

  it('the verified/not-verified indicator is a visible WORD, not colour or an icon alone', () => {
    renderAwaiting();
    // WCAG 1.4.1: the state must live in a text node.
    expect(screen.getByText('Not verified yet')).toBeInTheDocument();
  });

  it('contains no hand-rolled button markup — every control is the house Button (composes `.btn`)', () => {
    mockSelf.mockReturnValue(selfState(ROW({ email_changed_at: '2026-09-04T00:00:00.000Z' })));
    const { container } = renderSection();
    const buttons = Array.from(container.querySelectorAll('button'));
    expect(buttons.length).toBeGreaterThan(0);
    for (const btn of buttons) {
      expect(btn.className, `"${btn.textContent}" is not a .btn`).toContain('btn');
    }
  });

  it('the email input carries id + name + an associated label (the Input.tsx:11-19 house rule)', async () => {
    const user = userEvent.setup();
    mockSelf.mockReturnValue(selfState(ROW()));
    renderSection();
    await user.click(screen.getByRole('button', { name: 'Change' }));

    const field = screen.getByLabelText(/new email address/i);
    expect(field).toHaveAttribute('name', 'email');
    expect(field.getAttribute('id')).toBeTruthy();
    expect(field).toHaveAttribute('type', 'email');
  });

  it('Resend is a SIBLING of the status region, never inside it', () => {
    renderAwaiting();
    const status = screen.getByRole('status');
    expect(within(status).queryByRole('button')).not.toBeInTheDocument();
  });
});
