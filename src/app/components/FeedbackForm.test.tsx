/**
 * 87.6 D-08 / T-87.6-03 — logged-out FeedbackForm transport proof.
 *
 * FeedbackForm mounts from the PUBLIC Footer (root layout), so a fully
 * logged-out visitor must be able to submit a bug report / suggestion via
 * feedbackAPI.submitFeedback on publicFetch (direct PUBLIC_API_BASE_URL,
 * never the authenticated BFF). Feedback carries NO user attribution (owner
 * decision 2026-07-24, review WR-01): the body must not include user_id.
 *
 * This test observes the ACTUAL request the component issues by stubbing the
 * GLOBAL fetch (the real network boundary publicFetch hits) — NOT by mocking
 * feedbackAPI / publicFetch / the api.ts module exports (which would only prove
 * a mock was called, or never intercept due to module-internal binding). Auth
 * is mocked to logged-out; the assertions are that the outgoing request targets
 * the public backend origin, carries NO Authorization header, and omits user_id.
 *
 * This is the FE-TRANSPORT half of the logged-out proof; the BE-source half is
 * cited in the SUMMARY (server.js public prefix '/feedback' + optionalAuth +
 * the unauthenticated POST handler).
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, cleanup, waitFor, fireEvent, act } from '@testing-library/react';
import { useState } from 'react';
import userEvent from '@testing-library/user-event';

// Logged-out: no Auth0 user. Retained for the 87.6 transport proof below even
// though FeedbackForm no longer consumes the hook directly (Phase 88.8 plan 13
// Task 3(b) removed its only reader) — `useSelfIdentity` is what the component
// reads now, and the two must agree in the logged-out case.
vi.mock('@auth0/nextjs-auth0/client', () => ({ useUser: () => ({ user: null }) }));

// Round 6 #3/#28: the submit-failure report.
vi.mock('@sentry/nextjs', () => ({ captureException: vi.fn() }));

// Phase 88.8 plan 13 Task 3(b): the contact handle is `Users.email` off the
// shared self row, never the Auth0 session claim.
const h = vi.hoisted(() => ({
  self: undefined as undefined | Record<string, unknown>,
  // Round 3 DR3: per-test overrides for the query flags the submit gate reads.
  query: {} as Record<string, unknown>,
}));
vi.mock('../../lib/hooks/useSelfIdentity', () => ({
  SELF_IDENTITY_KEY: ['users', 'self'],
  useSelfIdentity: () => ({
    self: h.self,
    selfUuid: h.self?.id as string | undefined,
    query: { isError: false, error: null, isPending: !h.self, refetch: vi.fn(), ...h.query },
    isPending: !h.self,
  }),
}));

import * as Sentry from '@sentry/nextjs';

import FeedbackForm from './FeedbackForm';
import { PUBLIC_API_BASE_URL } from '../../lib/api';

const SESSION_EMAIL = 'session-only@example.com';
const APP_EMAIL = 'app-address@example.com';
const SYNTHETIC = 'google-oauth2-1|xyz@auth0.local';

/* SELECTOR RULE (Phase 88.6-31). This form has TWO polite `role="status"` regions since the
   attach-success region landed — the new one (`-screenshot-attached`) and the gate line
   (`-submit-status`) — so EVERY bare `getByRole('status')` in this file was ambiguous and is
   repointed here. Three spellings are forbidden and each for its own reason:
     - `getByRole('status')`            — ambiguous; RTL throws "found multiple elements".
     - `getAllByRole('status')[n]`      — DOM order puts the NEW attach region FIRST, so an
                                          index-based repair silently retargets the wrong node.
     - `querySelector('#' + id)`        — React is ^18.2.0, so `useId` ids contain COLONS and
                                          that call is a `SyntaxError`.
   The resolution is BY ID via `document.getElementById`. The id itself is discovered with an
   ATTRIBUTE selector (`[id$="…"]`), which is colon-safe and, unlike the role query, unique per
   form — one `-submit-status` node and one `-screenshot-attached` node each.

   MEASURED CORRECTION to the plan text, recorded rather than absorbed: the plan expected
   `:246`'s `toHaveTextContent('')` to pass SILENTLY against the new empty attach region. It does
   not — `getByRole` is SINGULAR and throws on two matches, so all five sites failed LOUDLY
   (run captured 2026-09-16). The silent-pass hazard is real but belongs to the `getAllByRole`
   index spelling, which is why that spelling is forbidden above. Repointing is mandatory either
   way: the round-5 #41 guard at `:246` must keep asserting on the GATE region. */
const regionByIdSuffix = (suffix: string): HTMLElement => {
  const seed = document.querySelector(`[id$="${suffix}"]`);
  if (!seed) throw new Error(`no element whose id ends in "${suffix}"`);
  const byId = document.getElementById(seed.id);
  if (!byId) throw new Error(`getElementById("${seed.id}") resolved nothing`);
  return byId;
};
/** The DR3 gate line / reply-to disclosure region. */
const gateStatusRegion = () => regionByIdSuffix('-submit-status');
/** The Phase 88.6-31 attach-success region. */
const attachStatusRegion = () => regionByIdSuffix('-screenshot-attached');

afterEach(cleanup);

describe('FeedbackForm logged-out submission (87.6 D-08)', () => {
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    vi.clearAllMocks();
    h.self = undefined;
    // Stub the real network boundary. publicFetch does `await response.text()`
    // then JSON.parses it, so return a minimal ok Response-like.
    fetchMock = vi.fn(async () => ({
      ok: true,
      status: 200,
      text: async () => JSON.stringify({ success: true }),
    }));
    vi.stubGlobal('fetch', fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('submits to the public feedback endpoint with NO Authorization header', async () => {
    const user = userEvent.setup();
    render(<FeedbackForm onClose={() => {}} />);

    await user.type(screen.getByPlaceholderText(/Brief description/i), 'Logged-out bug');
    await user.type(
      screen.getByPlaceholderText(/provide as much detail/i),
      'Reporting this while signed out.',
    );
    await user.click(screen.getByRole('button', { name: /^Submit$/i }));

    // The success panel confirms the component treated the request as accepted.
    await waitFor(() => expect(screen.getByText(/Thank You/i)).toBeInTheDocument());

    // Exactly one outgoing request, at the public backend origin.
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [calledUrl, calledOptions] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(calledUrl).toBe(`${PUBLIC_API_BASE_URL}/feedback`);
    expect(calledUrl.startsWith(PUBLIC_API_BASE_URL)).toBe(true);
    expect(calledOptions.method).toBe('POST');

    // No Authorization header on the logged-out public request (case-insensitive).
    const headers = (calledOptions.headers ?? {}) as Record<string, string>;
    const headerKeys = Object.keys(headers).map((k) => k.toLowerCase());
    expect(headerKeys).not.toContain('authorization');

    // FE half of the no-attribution contract (WR-01): the outgoing body never
    // carries user_id (the BE half — stored null regardless — is pinned in
    // periodictabletopbackend_v2/Sonnet/tests/routes/feedback.test.js).
    const body = JSON.parse(calledOptions.body as string);
    expect(body).not.toHaveProperty('user_id');
  });
});

/**
 * Phase 88.8 plan 13 Task 3(b) — `user_email` is `Users.email`, or null.
 *
 * `user_email` is a CONTACT HANDLE, not attribution: `routes/feedback.js` puts
 * it in the admin mail's From line (`:162`, `:183`) and, when truthy, in
 * `replyTo` (`:204`). A wrong address there is worse than none — it is precisely
 * the value D-42's move and the account-deletion scrub will not match.
 */
describe('FeedbackForm user_email — the APP address, never the Auth0 session claim (88.8 R12)', () => {
  let fetchMock: ReturnType<typeof vi.fn>;

  const submit = async () => {
    const user = userEvent.setup();
    render(<FeedbackForm onClose={() => {}} />);
    await user.type(screen.getByPlaceholderText(/Brief description/i), 'A subject');
    await user.type(screen.getByPlaceholderText(/provide as much detail/i), 'A description here.');
    await user.click(screen.getByRole('button', { name: /^Submit$/i }));
    await waitFor(() => expect(fetchMock).toHaveBeenCalled());
    return JSON.parse((fetchMock.mock.calls[0][1] as RequestInit).body as string);
  };

  beforeEach(() => {
    vi.clearAllMocks();
    h.self = undefined;
    fetchMock = vi.fn(async () => ({
      ok: true,
      status: 200,
      text: async () => JSON.stringify({ success: true }),
    }));
    vi.stubGlobal('fetch', fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('sends the SELF row address when it DIFFERS from the mocked session address', async () => {
    // Discriminating by construction: a fixture where the two agree proves
    // nothing about which one was read.
    h.self = { id: 'u-1', email: APP_EMAIL };
    const body = await submit();
    expect(body.user_email).toBe(APP_EMAIL);
    expect(body.user_email).not.toBe(SESSION_EMAIL);
  });

  it('sends NULL for a SYNTHETIC self address — the sentinel is not a contact handle', async () => {
    // Downstream consequence, verified at the backend rather than assumed here:
    // the admin mail's From falls back to its existing 'Anonymous' literal
    // (routes/feedback.js:162, :183) and the send options carry NO `replyTo`
    // key at all, because `:204` is a conditional spread. Losing reply-to is
    // CORRECT — there is no inbox behind `<sub>@auth0.local`.
    h.self = { id: 'u-1', email: SYNTHETIC };
    const body = await submit();
    expect(body.user_email).toBeNull();
  });

  it('sends null when logged out — unchanged from what shipped', async () => {
    h.self = undefined;
    const body = await submit();
    expect(body.user_email).toBeNull();
  });

  it('never sends the Auth0 session address, in ANY of the three cases', async () => {
    for (const row of [{ id: 'u-1', email: APP_EMAIL }, { id: 'u-1', email: SYNTHETIC }, undefined]) {
      vi.clearAllMocks();
      fetchMock.mockClear();
      cleanup();
      h.self = row;
      const body = await submit();
      expect(body.user_email).not.toBe(SESSION_EMAIL);
    }
  });
});

/**
 * Code review round 3 DR3 (owner ruling 2026-09-05) — the self-row gate on Submit is
 * PERCEIVABLE and REACHABLE, and the missing-reply-to case is DISCLOSED. Three lenses
 * converged on the round-1 guard: it natively disabled Submit with no label change and
 * no announcement while the self row loaded (a keyboard dead end), and dropped the
 * handle silently when the self query errored.
 */
describe('FeedbackForm — round 3 DR3: the loading gate answers, the error case is disclosed', () => {
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    vi.clearAllMocks();
    h.self = undefined;
    h.query = {};
    fetchMock = vi.fn(async () => ({ ok: true, status: 200, text: async () => JSON.stringify({ success: true }) }));
    vi.stubGlobal('fetch', fetchMock);
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    h.query = {};
  });

  it('while the self row is FETCHING, Submit is aria-disabled (never natively), stays in the tab order, explains itself, and a press files nothing', async () => {
    h.query = { isFetching: true };
    const user = userEvent.setup();
    render(<FeedbackForm onClose={() => {}} />);
    await user.type(screen.getByPlaceholderText(/Brief description/i), 'A subject');
    await user.type(screen.getByPlaceholderText(/provide as much detail/i), 'A description here.');

    const submit = screen.getByRole('button', { name: /^Submit$/i });
    expect(submit).toHaveAttribute('aria-disabled', 'true');
    expect(submit).not.toHaveAttribute('disabled');
    expect(gateStatusRegion()).toHaveTextContent(/loading your details/i);

    await user.click(submit);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('when the self query ERRORED, the reporter is told the reply-to is missing, and can still file (user_email null, never the session address)', async () => {
    h.query = { isError: true, isFetching: false };
    const user = userEvent.setup();
    render(<FeedbackForm onClose={() => {}} />);
    expect(screen.getByText(/couldn't load your email address/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /^Submit$/i })).not.toHaveAttribute('aria-disabled', 'true');

    await user.type(screen.getByPlaceholderText(/Brief description/i), 'A subject');
    await user.type(screen.getByPlaceholderText(/provide as much detail/i), 'A description here.');
    await user.click(screen.getByRole('button', { name: /^Submit$/i }));
    await waitFor(() => expect(fetchMock).toHaveBeenCalled());
    const body = JSON.parse((fetchMock.mock.calls[0][1] as RequestInit).body as string);
    expect(body.user_email).toBeNull();
  });

  it('a settled row WITH a usable address shows neither the loading line nor the missing-reply-to line', () => {
    h.self = { id: 'u1', email: APP_EMAIL };
    render(<FeedbackForm onClose={() => {}} />);
    expect(gateStatusRegion()).toHaveTextContent('');
    expect(screen.queryByText(/couldn't load your email address/i)).not.toBeInTheDocument();
  });
});

/* ---------------------------------------------------------------------------
   POST-MERGE FIX SET (code review round 5 MED/LOW, 2026-09-07) — #37/#41/#8/#40.
   --------------------------------------------------------------------------- */

describe('FeedbackForm — post-merge fix set (round 5)', () => {
  let fetchMock: ReturnType<typeof vi.fn>;

  const fillAndSubmit = async (user: ReturnType<typeof userEvent.setup>) => {
    await user.type(screen.getByPlaceholderText(/Brief description/i), 'A subject');
    await user.type(screen.getByPlaceholderText(/provide as much detail/i), 'A description here.');
    await user.click(screen.getByRole('button', { name: /^Submit$/i }));
  };

  beforeEach(() => {
    vi.clearAllMocks();
    h.self = { id: 'u1', email: APP_EMAIL };
    h.query = {};
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    h.self = undefined;
    h.query = {};
  });

  it('#37 — a FAILED submit is announced through a live region and named by Submit`s aria-describedby', async () => {
    // The harm: the red box painted and assistive tech was told nothing, so a keyboard or
    // screen-reader reporter believed the report had gone.
    fetchMock = vi.fn(async () => { throw new TypeError('Failed to fetch'); });
    vi.stubGlobal('fetch', fetchMock);
    const user = userEvent.setup();
    render(<FeedbackForm onClose={() => {}} />);

    /* Selected by id suffix rather than by role: since round 6 #31 the screenshot error
       is a second always-mounted assertive region in this form, so `getByRole('alert')`
       is ambiguous — which is the cheap signal that BOTH errors now announce. */
    const submitError = () => document.querySelector('[id$="-submit-error"]');
    expect(submitError()).toHaveAttribute('role', 'alert');
    // ALWAYS MOUNTED AND EMPTY FIRST — a region that mounts WITH its content announces
    // nothing, which is the shape this fix replaces.
    expect(submitError()).toHaveTextContent('');

    await fillAndSubmit(user);

    await waitFor(() => expect((submitError()?.textContent ?? '').length).toBeGreaterThan(0));
    const submit = screen.getByRole('button', { name: /^Submit$/i });
    expect(submit.getAttribute('aria-describedby')).toContain(submitError()!.id);
    // The gate line is still referenced too — the failure JOINS it, never replaces it.
    expect(submit.getAttribute('aria-describedby')).toContain(gateStatusRegion().id);
  });

  it('#3/#28 — a failed submit is REPORTED to Sentry, class-only, with none of the report body in the payload', async () => {
    fetchMock = vi.fn(async () => { throw new TypeError('Failed to fetch'); });
    vi.stubGlobal('fetch', fetchMock);
    const user = userEvent.setup();
    render(<FeedbackForm onClose={() => {}} />);

    const SECRET_PROSE = 'my password is hunter2 and my address is nobody@example.com';
    await user.type(screen.getByPlaceholderText(/Brief description/i), 'A subject');
    await user.type(screen.getByPlaceholderText(/provide as much detail/i), SECRET_PROSE);
    await user.click(screen.getByRole('button', { name: /^Submit$/i }));

    await waitFor(() => expect(Sentry.captureException).toHaveBeenCalledTimes(1));
    const [err, ctx] = vi.mocked(Sentry.captureException).mock.calls[0] as [
      Error,
      { tags?: Record<string, unknown> },
    ];
    expect(err).toBeInstanceOf(Error);
    expect(err.message).toMatch(/^feedback submit failed: /);
    expect(ctx.tags).toEqual({ feature: 'feedback', op: 'submit', channel: 'public' });
    /* THE POINT OF "class-only": this is the app's own bug channel, so the body in flight
       is the reporter's prose, their address and possibly a screenshot. None of it may
       ride along to Sentry. */
    const payload = JSON.stringify(vi.mocked(Sentry.captureException).mock.calls[0]);
    expect(payload).not.toContain('hunter2');
    expect(payload).not.toContain('nobody@example.com');
  });

  it('#41 — the reply-to warning arrives as a CHANGE to the already-mounted region, not as a new node', async () => {
    /* What the round-4 comment over-claimed: `selfNotReady` is `isFetching`, false on a
       warm cache and false for a settled errored query, so the sentence could be present
       on the region`s very first commit — which announces nothing. The text is now set
       from an effect, and the region is the SAME DOM node before and after, which is what
       makes the first appearance an announceable change.
       WHAT THIS CANNOT PROVE, stated rather than implied: RTL`s render flushes effects
       inside act(), so no assertion here can observe the one commit between mount and
       effect. Node identity across the transition is the observable half. */
    fetchMock = vi.fn(async () => ({ ok: true, status: 200, text: async () => JSON.stringify({ success: true }) }));
    vi.stubGlobal('fetch', fetchMock);
    const { rerender } = render(<FeedbackForm onClose={() => {}} />);
    const before = gateStatusRegion();
    expect(before).toHaveTextContent('');

    h.self = { id: 'u1', email: SYNTHETIC };
    rerender(<FeedbackForm onClose={() => {}} />);

    const after = gateStatusRegion();
    expect(after).toBe(before);
    expect(after).toHaveTextContent(/couldn't load your email address/i);
  });

  it('#30 — the screenshot attach control is KEYBOARD-REACHABLE, and the label paints its focus ring', async () => {
    fetchMock = vi.fn(async () => ({ ok: true, status: 200, text: async () => JSON.stringify({ success: true }) }));
    vi.stubGlobal('fetch', fetchMock);
    render(<FeedbackForm onClose={() => {}} />);

    /* WCAG 2.1.1. It carried `className="hidden"` (display:none) inside a non-focusable
       <label>, so there was no keyboard path to attaching a screenshot at all. */
    const input = document.querySelector('input[type="file"]')!;
    expect(input).not.toHaveClass('hidden');
    expect(input).toHaveClass('sr-only');
    (input as HTMLElement).focus();
    expect(input).toHaveFocus();

    // And the focus is VISIBLE, on the box the user can actually see (WCAG 2.4.7) —
    // trading 2.1.1 for 2.4.7 would not be a fix.
    const label = document.querySelector(`label[for="${input.id}"]`)!;
    expect(label.className).toMatch(/peer-focus-visible:ring-2/);
    expect(input).toHaveClass('peer');
  });

  it('#31 — a rejected screenshot is ANNOUNCED and associated with the file input', async () => {
    fetchMock = vi.fn(async () => ({ ok: true, status: 200, text: async () => JSON.stringify({ success: true }) }));
    vi.stubGlobal('fetch', fetchMock);
    const user = userEvent.setup();
    render(<FeedbackForm onClose={() => {}} />);

    const input = document.querySelector('input[type="file"]') as HTMLInputElement;
    const region = document.querySelector('[id$="-screenshot-error"]')!;
    expect(region).toHaveAttribute('role', 'alert');
    expect(region).toHaveTextContent(''); // mounted empty, so the message is a CHANGE
    expect(input).not.toHaveAttribute('aria-describedby');

    /* THE OVER-SIZE branch rather than the wrong-type one, deliberately: user-event
       filters an upload against the input's own `accept` attribute, so a text/plain file
       never reaches the change handler here and the assertion would pass vacuously on a
       component that did nothing. Size is the rejection a real user hits anyway — a phone
       screenshot clears 2 MB easily — and it lands in the same error lane. */
    const overSize = new File([new Uint8Array(2 * 1024 * 1024 + 1)], 'huge.png', {
      type: 'image/png',
    });
    await user.upload(input, overSize);

    expect(region).toHaveTextContent(/file is too large/i);
    // The one that mattered: a screen-reader user used to press Submit believing the
    // screenshot was attached.
    expect(input).toHaveAttribute('aria-describedby', region.id);
  });

  it('#6 — the success timer is cleared on unmount, so it cannot fire into a closed modal', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    try {
      fetchMock = vi.fn(async () => ({ ok: true, status: 200, text: async () => JSON.stringify({ success: true }) }));
      vi.stubGlobal('fetch', fetchMock);
      const onClose = vi.fn();
      const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
      const { unmount } = render(<FeedbackForm onClose={onClose} />);

      await fillAndSubmit(user);
      await waitFor(() => expect(fetchMock).toHaveBeenCalled());
      expect(onClose).not.toHaveBeenCalled(); // the 2s timer is armed, not yet fired

      // The modal closes under it — the close button, Escape, an outside click, a route
      // change. The timer must not survive that.
      unmount();
      await vi.advanceTimersByTimeAsync(3000);

      expect(onClose).not.toHaveBeenCalled();
    } finally {
      vi.useRealTimers();
    }
  });

  it('#8/#40 — two concurrently mounted forms carry DISTINCT ids, and each Submit points at its OWN status line', () => {
    fetchMock = vi.fn(async () => ({ ok: true, status: 200, text: async () => JSON.stringify({ success: true }) }));
    vi.stubGlobal('fetch', fetchMock);
    /* Two mount sites exist today (Footer, and FetchErrorBanner, which can appear more
       than once), so the hard-coded `feedback-submit-status` could resolve a Submit`s
       description to the OTHER form`s status line. Queried through the DOM rather than
       the accessibility tree on purpose: a modal marks its siblings aria-hidden, which
       would hide one of the two from a role query and make this pass vacuously. */
    render(
      <>
        <FeedbackForm onClose={() => {}} />
        <FeedbackForm onClose={() => {}} />
      </>
    );

    /* REPOINTED Phase 88.6-31 — this was `[role="status"]`, which is now FOUR nodes across two
       forms (each form has a gate line AND an attach-success region). The selector moves to the
       gate line's id SUFFIX, which is what this test was always about: one per form, distinct
       between forms, and it is the one `aria-describedby` names. */
    const statuses = Array.from(document.querySelectorAll('[id$="-submit-status"]'));
    expect(statuses).toHaveLength(2);
    const ids = statuses.map((n) => n.id);
    expect(ids[0]).toBeTruthy();
    expect(ids[0]).not.toBe(ids[1]);
    expect(ids).not.toContain('feedback-submit-status');

    const submits = Array.from(document.querySelectorAll('button[type="submit"]'));
    expect(submits).toHaveLength(2);
    submits.forEach((btn, i) => {
      expect(btn.getAttribute('aria-describedby')).toContain(ids[i]);
      expect(btn.getAttribute('aria-describedby')).not.toContain(ids[i === 0 ? 1 : 0]);
    });
  });
});

/* ---------------------------------------------------------------------------
   PHASE 88.6-31 — the round-7 D-21 residuals in this form.

   Every arm below was run against the UNFIXED component (or a deliberately planted
   wrong fix) before being accepted; the PRESERVATION halves are labelled as such so a
   reader can tell the two apart.
   --------------------------------------------------------------------------- */

describe('FeedbackForm — Phase 88.6-31 (D-21 residuals)', () => {
  let fetchMock: ReturnType<typeof vi.fn>;

  const overSizeFile = (name: string) =>
    new File([new Uint8Array(2 * 1024 * 1024 + 1)], name, { type: 'image/png' });
  const goodFile = (name: string) => new File([new Uint8Array(8)], name, { type: 'image/png' });
  const fileInput = () => document.querySelector('input[type="file"]') as HTMLInputElement;

  beforeEach(() => {
    vi.clearAllMocks();
    h.self = { id: 'u1', email: APP_EMAIL };
    h.query = {};
    fetchMock = vi.fn(async () => ({
      ok: true,
      status: 200,
      text: async () => JSON.stringify({ success: true }),
    }));
    vi.stubGlobal('fetch', fetchMock);
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    h.self = undefined;
    h.query = {};
  });

  // ---- the migrated Remove-screenshot control (D48 / UI-SPEC §3.2 + §1.2 V-15) ----

  it('the Remove control is findable BY ROLE AND NAME in the state that mounts it, and carries the ghost class list — not `btn-primary`', async () => {
    const user = userEvent.setup();
    render(<FeedbackForm onClose={() => {}} />);
    await user.upload(fileInput(), goodFile('shot.png'));

    const remove = await screen.findByRole('button', { name: /remove screenshot/i });
    // THE CLASS-LIST PIN that catches an OMITTED `variant` — Button's cva default is
    // `primary`, so a variant-less `<Button size="icon">` would paint a purple close button.
    expect(remove.className).toContain('bg-transparent');
    expect(remove.className).not.toContain('btn-primary');
    // `size="icon"` supplies the 44x44 floor this control had at NO width before.
    expect(remove.className).toContain('min-h-11');
    expect(remove.className).toContain('min-w-11');
    // The glyph is a CHILD; no `text-*` size is authored on the button element (it would be
    // DEAD under `.btn`'s unlayered font-size).
    expect(remove.className).not.toMatch(/(^|\s)text-(xs|sm|base|lg|xl|2xl|3xl)(\s|$)/);
    const glyph = remove.querySelector('span[aria-hidden="true"]');
    expect(glyph).not.toBeNull();
    expect(glyph!.className).toContain('text-lg');
    expect(glyph!.textContent).toBe('×');
  });

  it('R2 #195 / WCAG 2.4.3 — activating Remove from its own handler hands focus to the re-mounted file input, not to <body>', async () => {
    const user = userEvent.setup();
    render(<FeedbackForm onClose={() => {}} />);
    await user.upload(fileInput(), goodFile('shot.png'));
    const remove = await screen.findByRole('button', { name: /remove screenshot/i });

    await user.click(remove);

    // Settle on the branch-specific element: the input only exists in the ELSE arm.
    await waitFor(() => expect(fileInput()).toBeInTheDocument());
    expect(document.activeElement).not.toBe(document.body);
    expect(document.activeElement).toBe(fileInput());
  });

  it('PRESERVATION — the decorative screenshot glyph is aria-hidden, and the round 6 #30 `sr-only peer` sibling structure is untouched', async () => {
    const user = userEvent.setup();
    render(<FeedbackForm onClose={() => {}} />);

    // The else-arm structure first (preservation half).
    const input = fileInput();
    expect(input).toHaveClass('sr-only');
    expect(input).toHaveClass('peer');
    const label = document.querySelector(`label[for="${input.id}"]`)!;
    expect(label.className).toMatch(/peer-focus-visible:ring-2/);

    await user.upload(input, goodFile('shot.png'));
    await screen.findByRole('button', { name: /remove screenshot/i });
    const glyph = document.querySelector('svg.w-5.h-5');
    expect(glyph).not.toBeNull();
    expect(glyph).toHaveAttribute('aria-hidden', 'true');
  });

  it('A-23 (WCAG 2.4.3): a successful attach hands focus to Remove screenshot, never the dialog container or body', async () => {
    const user = userEvent.setup();
    render(<FeedbackForm onClose={() => {}} />);

    const input = fileInput();
    input.focus();
    await user.upload(input, goodFile('shot.png'));
    const remove = await screen.findByRole('button', { name: /remove screenshot/i });
    await waitFor(() => expect(document.activeElement).toBe(remove));
    expect(document.activeElement).not.toBe(document.body);
  });

  it('A-23 (guard): a REJECTED file keeps the input mounted and moves focus nowhere', async () => {
    const user = userEvent.setup({ applyAccept: false });
    render(<FeedbackForm onClose={() => {}} />);

    const input = fileInput();
    input.focus();
    await user.upload(input, overSizeFile('huge.png'));
    expect(screen.queryByRole('button', { name: /remove screenshot/i })).toBeNull();
    expect(document.activeElement).toBe(input);
  });

  // ---- the attach-success region (V-18) ----

  it('NODE IDENTITY, D-22 house shape — the attach region exists, is `status` (never `alert`), EMPTY and sr-only before any attach; the SAME node carries copy row F1, visible, after', async () => {
    const user = userEvent.setup();
    render(<FeedbackForm onClose={() => {}} />);

    const before = attachStatusRegion();
    expect(before).toHaveAttribute('role', 'status');
    expect(before).not.toHaveAttribute('role', 'alert');
    expect(before.textContent).toBe('');
    // AMENDED Phase 88.6.1-34 (D-22): the region takes the house srOnlyWhenEmpty prop. The prop
    // hides an EMPTY region only, so the 2026-09-14 visible-when-set ruling (V-18) is kept: an
    // empty region is out of flow, so its unconditional mt-1 costs no idle layout.
    expect(before).toHaveClass('sr-only');
    expect(before).toHaveClass('mt-1');
    expect(before).toHaveClass('truncate');
    expect(before.className).not.toMatch(/\bmin-h-/);

    await user.upload(fileInput(), goodFile('evidence.png'));

    // IDENTITY, not presence — this is what catches a conditionally-mounted region: a fresh
    // look-up of the SAME id must return the IDENTICAL node object.
    const after = attachStatusRegion();
    expect(after).toBe(before);
    // Copy row F1 (D-30), exact bytes.
    expect(after.textContent).toBe('Screenshot attached: evidence.png');
    // Visible when set (V-18 kept); bounded visually, unbounded in text content.
    expect(after).not.toHaveClass('sr-only');
    expect(after.className).toContain('truncate');
  });

  it('T-88.6.1-681 encoding — a file name that looks like markup is rendered as TEXT in the attach line (F1), never as an element', async () => {
    const user = userEvent.setup();
    render(<FeedbackForm onClose={() => {}} />);

    await user.upload(fileInput(), goodFile('<b>x</b>.png'));

    const region = attachStatusRegion();
    expect(region.textContent).toBe('Screenshot attached: <b>x</b>.png');
    expect(region.querySelector('b')).toBeNull();
  });

  it('THE DISCRIMINATING ASSERTION — a REJECTED file leaves the attach region EMPTY while `screenshotError` populates (a `screenshot`-derived region cannot tell these apart)', async () => {
    const user = userEvent.setup();
    render(<FeedbackForm onClose={() => {}} />);

    /* The OVER-SIZE arm rather than the wrong-type one, for the reason the round-5 suite
       already records: user-event filters an upload against the input's own `accept`, so a
       text/plain file never reaches the handler and the assertion would pass vacuously. */
    await user.upload(fileInput(), overSizeFile('huge.png'));

    // POSITIVE settle signal first — an absence claim asserted on the first tick observes
    // nothing. Wait for the rejection to land, THEN assert the attach region stayed empty.
    await waitFor(() =>
      expect(document.querySelector('[id$="-screenshot-error"]')).toHaveTextContent(/too large/i)
    );
    expect(attachStatusRegion().textContent).toBe('');
    // D-22 (Phase 88.6.1-34): a rejected file leaves the attach region empty, so it stays hidden.
    expect(attachStatusRegion()).toHaveClass('sr-only');
  });

  it('remove-then-reattach of the SAME file announces TWICE — the region clears on Remove and is re-set on the next attach', async () => {
    const user = userEvent.setup();
    render(<FeedbackForm onClose={() => {}} />);

    await user.upload(fileInput(), goodFile('same.png'));
    expect(attachStatusRegion().textContent).toBe('Screenshot attached: same.png');

    await user.click(await screen.findByRole('button', { name: /remove screenshot/i }));
    await waitFor(() => expect(fileInput()).toBeInTheDocument());
    // CLEAR PATH 1 — a region still asserting an attachment after Remove is wrong, not stale.
    expect(attachStatusRegion().textContent).toBe('');
    // D-22: empty again, so visually hidden again (Phase 88.6.1-34).
    expect(attachStatusRegion()).toHaveClass('sr-only');

    await user.upload(fileInput(), goodFile('same.png'));
    expect(attachStatusRegion().textContent).toBe('Screenshot attached: same.png');
  });

  // ---- the post-success reset ----

  it('the post-success reset clears the submit error, the screenshot error AND the attach message — all three, today it clears none of them', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    try {
      const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
      render(<FeedbackForm onClose={() => {}} />);

      // Populate BOTH error states and the attach region before the successful submit — a
      // test that checks only `error` passes with two thirds of the bug intact.
      await user.upload(fileInput(), overSizeFile('huge.png'));
      await waitFor(() =>
        expect(document.querySelector('[id$="-screenshot-error"]')).toHaveTextContent(/too large/i)
      );
      await user.upload(fileInput(), goodFile('ok.png'));
      expect(attachStatusRegion()).toHaveTextContent('ok.png');

      fetchMock.mockImplementationOnce(async () => {
        throw new TypeError('Failed to fetch');
      });
      await user.type(screen.getByPlaceholderText(/Brief description/i), 'A subject');
      await user.type(screen.getByPlaceholderText(/provide as much detail/i), 'A description.');
      await user.click(screen.getByRole('button', { name: /^Submit$/i }));
      await waitFor(() =>
        expect((document.querySelector('[id$="-submit-error"]')?.textContent ?? '').length)
          .toBeGreaterThan(0)
      );

      // Now succeed. The 2s timer body is what must clear all three.
      await user.click(screen.getByRole('button', { name: /^Submit$/i }));
      await waitFor(() => expect(screen.getByText(/Thank You/i)).toBeInTheDocument());
      await vi.advanceTimersByTimeAsync(2500);

      await waitFor(() => expect(screen.queryByText(/Thank You/i)).toBeNull());
      expect(document.querySelector('[id$="-submit-error"]')).toHaveTextContent('');
      expect(document.querySelector('[id$="-screenshot-error"]')).toHaveTextContent('');
      expect(attachStatusRegion()).toHaveTextContent('');
    } finally {
      vi.useRealTimers();
    }
  });

  // ---- R1: the raw read, and the NAMED §6.2 exception that keeps the region ----

  it('SPEC R1 — a failed submit renders the RATIFIED register line in the ASSERTIVE errorId region, never the backend string, and no toast replaces it', async () => {
    fetchMock.mockImplementation(async () => {
      throw new TypeError('Failed to fetch');
    });
    const user = userEvent.setup();
    render(<FeedbackForm onClose={() => {}} />);

    await user.type(screen.getByPlaceholderText(/Brief description/i), 'A subject');
    await user.type(screen.getByPlaceholderText(/provide as much detail/i), 'A description.');
    await user.click(screen.getByRole('button', { name: /^Submit$/i }));

    const box = () => document.querySelector('[id$="-submit-error"]')!;
    await waitFor(() => expect((box().textContent ?? '').length).toBeGreaterThan(0));
    // The NAMED §6.2 mutation-row exception: the region is PRESERVED at assertive politeness
    // and only its VALUE moved onto the register.
    expect(box()).toHaveAttribute('role', 'alert');
    expect(box()).toHaveAttribute('aria-live', 'assertive');
    // Neither the raw upstream string nor the retired authored fallback.
    expect(box()).not.toHaveTextContent('Failed to fetch');
    expect(box()).not.toHaveTextContent(/failed to submit feedback/i);
    /* The register's own line for this failure shape. MEASURED, not assumed: a bare
       `TypeError('Failed to fetch')` derives the `network` code, so `getFetchErrorMessage(err)`
       — called with NO `fallback`, so no copy was authored (P1) — answers with
       `MESSAGE_BY_CODE.network` (`useFetchErrorState.ts:47`). */
    expect(box()).toHaveTextContent(/couldn't reach the server/i);
  });
});

// ---------------------------------------------------------------------------
// PHASE 88.6.1-34, TASK 2 — the screenshot field's real name (MEDLOW-32, AC-22), the silent
// required stars (AC-33 clause 2, W024, register N-1), and the D-22 house empty-region shape on
// the remaining three regions (screenshot error, submit error, gate line), plus Edge R8 adjacency.
// Every arm was run against the tree as task 1 left it; the adjacency case is labelled
// PRESERVATION because it was already true and pins what must not move.
// ---------------------------------------------------------------------------

describe('FeedbackForm — Phase 88.6.1-34 task 2 (MEDLOW-32, AC-33 stars, D-22 regions, R8 adjacency)', () => {
  let fetchMock: ReturnType<typeof vi.fn>;
  const fileInput = () => document.querySelector('input[type="file"]') as HTMLInputElement;
  const overSizeFile = (name: string) =>
    new File([new Uint8Array(2 * 1024 * 1024 + 1)], name, { type: 'image/png' });

  beforeEach(() => {
    vi.clearAllMocks();
    h.self = undefined;
    h.query = {};
    fetchMock = vi.fn(async () => ({
      ok: true,
      status: 200,
      text: async () => JSON.stringify({ success: true }),
    }));
    vi.stubGlobal('fetch', fetchMock);
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    h.self = undefined;
    h.query = {};
  });

  it('MEDLOW-32 — the file input is named "Screenshot (optional)" first, and still contains the drop zone words (WCAG 2.5.3 label-in-name)', () => {
    render(<FeedbackForm onClose={() => {}} />);
    const input = fileInput();
    expect(input).toHaveAccessibleName(/^Screenshot \(optional\)/);
    expect(input).toHaveAccessibleName(/Click to attach a screenshot/);
  });

  it('MEDLOW-32 — aria-labelledby lists exactly the section label then the drop zone; the drop zone keeps its for, the section label gains none', () => {
    render(<FeedbackForm onClose={() => {}} />);
    const input = fileInput();
    const ids = (input.getAttribute('aria-labelledby') ?? '').split(' ').filter(Boolean);
    expect(ids).toHaveLength(2);
    // getElementById, never a CSS id selector: useId ids contain colons.
    const section = document.getElementById(ids[0]);
    const dropzone = document.getElementById(ids[1]);
    expect(section?.tagName).toBe('LABEL');
    expect(dropzone?.tagName).toBe('LABEL');
    expect(section!.textContent).toMatch(/^Screenshot \(optional\)$/);
    expect(dropzone!.textContent).toMatch(/Click to attach a screenshot/);
    expect(ids[0]).toMatch(/-screenshot-label$/);
    expect(ids[1]).toMatch(/-screenshot-dropzone$/);
    // Neither label gains or loses a for: the drop zone still opens the picker, the heading never does.
    expect(dropzone).toHaveAttribute('for', input.id);
    expect(section).not.toHaveAttribute('for');
  });

  it('AC-33 / W024 — the two required stars are aria-hidden, keep their colour, and the inputs are named without them and stay required', () => {
    render(<FeedbackForm onClose={() => {}} />);
    const stars = Array.from(document.querySelectorAll('label span.text-red-500'));
    expect(stars).toHaveLength(2);
    stars.forEach((star) => {
      expect(star).toHaveAttribute('aria-hidden', 'true');
      expect(star.textContent).toBe('*');
    });
    const subject = screen.getByPlaceholderText(/Brief description/i);
    const description = screen.getByPlaceholderText(/provide as much detail/i);
    expect(subject).toHaveAccessibleName('Subject');
    expect(description).toHaveAccessibleName('Description');
    expect(subject).toBeRequired();
    expect(description).toBeRequired();
  });

  it('D-22 — the screenshot-error region (assertive) is sr-only while empty, and the SAME node is visible with its classes when a file is rejected', async () => {
    const user = userEvent.setup();
    render(<FeedbackForm onClose={() => {}} />);
    const before = regionByIdSuffix('-screenshot-error');
    expect(before.textContent).toBe('');
    expect(before).toHaveClass('sr-only');

    await user.upload(fileInput(), overSizeFile('huge.png'));

    await waitFor(() => expect(regionByIdSuffix('-screenshot-error')).toHaveTextContent(/too large/i));
    const after = regionByIdSuffix('-screenshot-error');
    expect(after).toBe(before);
    expect(after).not.toHaveClass('sr-only');
    expect(after).toHaveClass('text-xs');
    expect(after).toHaveClass('text-content-status-error');
    expect(after).toHaveClass('mt-1');
  });

  it('D-22 — the submit-error region (assertive) is sr-only while empty, and the SAME node is the visible error box after a failed send', async () => {
    fetchMock.mockImplementation(async () => {
      throw new TypeError('Failed to fetch');
    });
    const user = userEvent.setup();
    render(<FeedbackForm onClose={() => {}} />);
    const before = regionByIdSuffix('-submit-error');
    expect(before.textContent).toBe('');
    expect(before).toHaveClass('sr-only');

    await user.type(screen.getByPlaceholderText(/Brief description/i), 'A subject');
    await user.type(screen.getByPlaceholderText(/provide as much detail/i), 'A description.');
    await user.click(screen.getByRole('button', { name: /^Submit$/i }));

    await waitFor(() => expect((regionByIdSuffix('-submit-error').textContent ?? '').length).toBeGreaterThan(0));
    const after = regionByIdSuffix('-submit-error');
    expect(after).toBe(before);
    expect(after).not.toHaveClass('sr-only');
    expect(after).toHaveClass('bg-status-error-subtle');
    expect(after).toHaveClass('border-status-error');
    expect(after).toHaveClass('text-content-status-error');
  });

  it('D-22 — the gate line (polite) is sr-only while empty with no reserved min-height, and the SAME node is visible when the reply-to line is set', () => {
    const { rerender } = render(<FeedbackForm onClose={() => {}} />);
    const before = gateStatusRegion();
    expect(before.textContent).toBe('');
    expect(before).toHaveClass('sr-only');
    expect(before.className).not.toMatch(/\bmin-h-/);

    h.self = { id: 'u1', email: SYNTHETIC };
    rerender(<FeedbackForm onClose={() => {}} />);

    const after = gateStatusRegion();
    expect(after).toBe(before);
    expect(after).toHaveTextContent(/couldn't load your email address/i);
    expect(after).not.toHaveClass('sr-only');
    expect(after.className).not.toMatch(/\bmin-h-/);
  });

  it('PRESERVATION, Edge R8 adjacency — exactly two alert regions (the two errors) and two status regions (attach, gate); no region nests in another', () => {
    render(<FeedbackForm onClose={() => {}} />);
    const regions = {
      screenshotError: regionByIdSuffix('-screenshot-error'),
      submitError: regionByIdSuffix('-submit-error'),
      attach: regionByIdSuffix('-screenshot-attached'),
      gate: regionByIdSuffix('-submit-status'),
    };
    expect(regions.screenshotError).toHaveAttribute('role', 'alert');
    expect(regions.submitError).toHaveAttribute('role', 'alert');
    expect(regions.attach).toHaveAttribute('role', 'status');
    expect(regions.gate).toHaveAttribute('role', 'status');
    const form = regions.gate.closest('form')!;
    expect(form.querySelectorAll('[role="alert"]')).toHaveLength(2);
    expect(form.querySelectorAll('[role="status"]')).toHaveLength(2);
    const all = Object.values(regions);
    all.forEach((outer) => {
      all.forEach((inner) => {
        if (outer !== inner) expect(outer.contains(inner)).toBe(false);
      });
    });
  });
});

// ---------------------------------------------------------------------------
// PHASE 88.6.1-34, TASK 3 — Submit while sending (D-35, AC-12, Edge R4), focus after a send
// (Req 5, AC-14, Edge R5), copy row F2 on an unexplained failure (D-30, CP-2), the repeat
// failure re-announce (Edge R8 idempotency, backstop) and the late send after a close (review
// r1 #39). Cases labelled PRESERVATION or BACKSTOP were green before the change and pin what
// must not move; every other case was run RED against the tree as task 2 left it.
// ---------------------------------------------------------------------------

describe('FeedbackForm — Phase 88.6.1-34 task 3 (D-35, Req 5, F2, R8 idempotency, late send #39)', () => {
  const OK_RESPONSE = { ok: true, status: 200, text: async () => JSON.stringify({ success: true }) };
  const PAYLOAD_TOO_LARGE = {
    ok: false,
    status: 413,
    text: async () => JSON.stringify({ error: 'Payload Too Large' }),
  };

  // A fetch stub whose response the test releases by hand.
  const deferredFetch = () => {
    let release: (value: unknown) => void = () => {};
    let fail: (reason: unknown) => void = () => {};
    const pending = new Promise((resolve, reject) => {
      release = resolve;
      fail = reject;
    });
    const fn = vi.fn(() => pending);
    return { fn, release: (v: unknown) => release(v), fail: (e: unknown) => fail(e) };
  };

  const fill = async (user: ReturnType<typeof userEvent.setup>) => {
    await user.type(screen.getByPlaceholderText(/Brief description/i), 'A subject');
    await user.type(screen.getByPlaceholderText(/provide as much detail/i), 'A description.');
  };
  const submitButton = () => screen.getByRole('button', { name: /^(Submit|Submitting\.\.\.)$/ });
  const flushMacrotask = () => act(() => new Promise((r) => setTimeout(r, 0)));

  beforeEach(() => {
    vi.clearAllMocks();
    h.self = undefined;
    h.query = {};
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    h.self = undefined;
    h.query = {};
  });

  it('D-35 latch, Edge R4 idempotency — two submits in one act while the first send is pending file exactly ONE request, and the refused submit is defaultPrevented', async () => {
    const d = deferredFetch();
    vi.stubGlobal('fetch', d.fn);
    const user = userEvent.setup();
    render(<FeedbackForm onClose={() => {}} />);
    await fill(user);

    const form = submitButton().closest('form')!;
    const second = new Event('submit', { bubbles: true, cancelable: true });
    act(() => {
      fireEvent.submit(form);
      fireEvent(form, second);
    });

    await waitFor(() => expect(d.fn).toHaveBeenCalled());
    await flushMacrotask();
    expect(d.fn).toHaveBeenCalledTimes(1);
    expect(second.defaultPrevented).toBe(true);

    d.fail(new TypeError('Failed to fetch'));
    await waitFor(() => expect(submitButton()).toHaveTextContent('Submit'));
  });

  it('D-35 attributes, Edge R4 concurrency — while sending, the pressed Submit is aria-disabled (never natively), reads "Submitting...", keeps focus, and a second press sends nothing; all of it releases when the FIRST send settles', async () => {
    const d = deferredFetch();
    vi.stubGlobal('fetch', d.fn);
    const user = userEvent.setup();
    render(<FeedbackForm onClose={() => {}} />);
    await fill(user);

    await user.click(submitButton());
    await waitFor(() => expect(d.fn).toHaveBeenCalledTimes(1));
    await user.click(submitButton());
    await flushMacrotask();

    const pressed = submitButton();
    expect(pressed).toHaveAttribute('aria-disabled', 'true');
    expect(pressed).not.toHaveAttribute('disabled');
    expect(pressed).toHaveTextContent('Submitting...');
    // CONFIRM-ONLY in jsdom (C-11: jsdom never blurs a disabled element); the phone spec's
    // Test C proves the focus half in a real browser. The two attribute lines above are the red half.
    expect(document.activeElement).toBe(pressed);
    expect(d.fn).toHaveBeenCalledTimes(1);

    d.fail(new TypeError('Failed to fetch'));
    await waitFor(() => expect(submitButton()).toHaveTextContent('Submit'));
    expect(submitButton()).not.toHaveAttribute('aria-disabled');
  });

  it('PRESERVATION, D-35 rule of KIND and POSITION — an empty Subject keeps Submit natively disabled with no aria-disabled; while sending, the sibling Cancel stays natively disabled', async () => {
    const d = deferredFetch();
    vi.stubGlobal('fetch', d.fn);
    const user = userEvent.setup();
    render(<FeedbackForm onClose={() => {}} />);

    expect(submitButton()).toBeDisabled();
    expect(submitButton()).not.toHaveAttribute('aria-disabled');

    await fill(user);
    await user.click(submitButton());
    await waitFor(() => expect(d.fn).toHaveBeenCalledTimes(1));
    expect(screen.getByRole('button', { name: 'Cancel' })).toBeDisabled();

    d.fail(new TypeError('Failed to fetch'));
    await waitFor(() => expect(submitButton()).toHaveTextContent('Submit'));
  });

  it('Req 5, Edge R5 ordering (backstop) — focus stays on Submit while the send is pending, then lands on the success title "Thank You!", never <body> and never the dialog container', async () => {
    const d = deferredFetch();
    vi.stubGlobal('fetch', d.fn);
    const user = userEvent.setup();
    render(<FeedbackForm onClose={() => {}} />);
    await fill(user);

    const pressed = submitButton();
    await user.click(pressed);
    await waitFor(() => expect(d.fn).toHaveBeenCalledTimes(1));
    expect(document.activeElement).toBe(pressed);

    d.release(OK_RESPONSE);

    await waitFor(() =>
      expect(document.activeElement).toBe(screen.getByRole('heading', { name: 'Thank You!' }))
    );
    expect(document.activeElement).not.toBe(document.body);
    expect(document.activeElement).not.toBe(screen.getByRole('dialog'));
  });

  it('Req 5, the Safari shape — a send whose Submit never took focus (Safari does not focus a clicked button) still lands on "Thank You!" through the submitter', async () => {
    // Deviation pin (Phase 88.6.1-34, consumer contract point 1): the hook is armed with the
    // event's submitter. Without it, focus on <body> at the press leaves the hook nothing to
    // watch, and Radix moves focus to the dialog CONTAINER when the form is swapped out.
    const d = deferredFetch();
    vi.stubGlobal('fetch', d.fn);
    const user = userEvent.setup();
    render(<FeedbackForm onClose={() => {}} />);
    await fill(user);

    const pressed = submitButton();
    (document.activeElement as HTMLElement).blur();
    expect(document.activeElement).toBe(document.body);
    const submitEvent = new Event('submit', { bubbles: true, cancelable: true });
    Object.defineProperty(submitEvent, 'submitter', { value: pressed });
    act(() => {
      fireEvent(pressed.closest('form')!, submitEvent);
    });
    await waitFor(() => expect(d.fn).toHaveBeenCalledTimes(1));

    d.release(OK_RESPONSE);

    await waitFor(() =>
      expect(document.activeElement).toBe(screen.getByRole('heading', { name: 'Thank You!' }))
    );
  });

  it('F2 (D-30, CP-2) — an unexplained failure (a code-less 413 maps to unknown) shows exactly copy row F2 in the assertive error region', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => PAYLOAD_TOO_LARGE));
    const user = userEvent.setup();
    render(<FeedbackForm onClose={() => {}} />);
    await fill(user);
    await user.click(submitButton());

    const box = regionByIdSuffix('-submit-error');
    await waitFor(() => expect((box.textContent ?? '').length).toBeGreaterThan(0));
    expect(box.textContent).toBe("We couldn't send your feedback. Please try again.");
  });

  it('BACKSTOP, Edge R8 idempotency — the same failure twice is a real clear-then-set on the SAME assertive node, so it is announced twice', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => PAYLOAD_TOO_LARGE));
    const user = userEvent.setup();
    render(<FeedbackForm onClose={() => {}} />);
    await fill(user);

    const box = regionByIdSuffix('-submit-error');
    await user.click(submitButton());
    await waitFor(() => expect((box.textContent ?? '').length).toBeGreaterThan(0));
    const firstText = box.textContent;

    let removed = 0;
    let added = 0;
    const observer = new MutationObserver((records) => {
      records.forEach((r) => {
        removed += r.removedNodes.length;
        added += r.addedNodes.length;
      });
    });
    observer.observe(box, { childList: true, characterData: true, subtree: true });
    await user.click(submitButton());
    await waitFor(() => expect(added).toBeGreaterThan(0));
    observer.disconnect();

    expect(removed).toBeGreaterThan(0);
    expect(regionByIdSuffix('-submit-error')).toBe(box);
    expect(box.textContent).toBe(firstText);
  });

  it('review r1 #39 — a send that settles after its form was closed (Escape) never closes the re-opened form, and the new typed Subject survives', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    try {
      const d = deferredFetch();
      vi.stubGlobal('fetch', d.fn);
      const hostOnClose = vi.fn();
      // Both real mount sites render the form only while open, so a close UNMOUNTS it
      // (Footer.js, the setShowFeedbackForm(false) arrow).
      function Host() {
        const [open, setOpen] = useState(true);
        return (
          <>
            <button type="button" onClick={() => setOpen(true)}>
              Reopen
            </button>
            {open && (
              <FeedbackForm
                onClose={() => {
                  hostOnClose();
                  setOpen(false);
                }}
              />
            )}
          </>
        );
      }
      const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
      render(<Host />);
      await fill(user);
      await user.click(submitButton());
      await waitFor(() => expect(d.fn).toHaveBeenCalledTimes(1));

      // Close mid-send the way a person can (Cancel stays natively disabled while sending).
      await user.keyboard('{Escape}');
      await waitFor(() => expect(screen.queryByPlaceholderText(/Brief description/i)).toBeNull());
      await user.click(screen.getByRole('button', { name: 'Reopen' }));
      const newSubject = await screen.findByPlaceholderText(/Brief description/i);
      await user.type(newSubject, 'Typed after reopening');
      const closesAfterReopen = hostOnClose.mock.calls.length;

      d.release(OK_RESPONSE);
      await vi.advanceTimersByTimeAsync(2500);

      // POSITIVE signal first: the re-opened form is still there, holding the typed text.
      expect(screen.getByPlaceholderText(/Brief description/i)).toHaveValue('Typed after reopening');
      expect(hostOnClose.mock.calls.length).toBe(closesAfterReopen);
    } finally {
      vi.useRealTimers();
    }
  });
});

// Phase 88.6.1-79 (AC-29): a refetch that fails over a held row keeps the row (TanStack
// reports `isError` with `data`), and the form already sends that row's address as the
// reply-to — so the missing-reply-to line must follow the no-row rule, not the raw flag.
describe('a held identity row is a known reply-to (88.6.1-79, AC-29)', () => {
  const REPLY_TO_LINE = "We couldn't load your email address, so we won't be able to reply to this.";
  let fetchMock: ReturnType<typeof vi.fn>;

  const fileOne = async () => {
    const user = userEvent.setup();
    await user.type(screen.getByPlaceholderText(/Brief description/i), 'A subject');
    await user.type(screen.getByPlaceholderText(/provide as much detail/i), 'A description here.');
    await user.click(screen.getByRole('button', { name: /^Submit$/i }));
    await waitFor(() => expect(fetchMock).toHaveBeenCalled());
    return JSON.parse((fetchMock.mock.calls[0][1] as RequestInit).body as string);
  };

  beforeEach(() => {
    vi.clearAllMocks();
    h.self = undefined;
    h.query = {};
    fetchMock = vi.fn(async () => ({ ok: true, status: 200, text: async () => JSON.stringify({ success: true }) }));
    vi.stubGlobal('fetch', fetchMock);
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    h.self = undefined;
    h.query = {};
  });

  it('FF1: a held row with a usable address and the flag in error shows no missing-reply-to line and sends that address', async () => {
    h.self = { id: 'u-1', email: APP_EMAIL };
    h.query = { isError: true, isFetching: false };
    render(<FeedbackForm onClose={() => {}} />);

    expect(screen.queryByText(REPLY_TO_LINE)).not.toBeInTheDocument();
    const body = await fileOne();
    expect(body.user_email).toBe(APP_EMAIL);
  });

  it('FF2 (guard): no row and the flag in error shows the line and sends no address', async () => {
    h.query = { isError: true, isFetching: false };
    render(<FeedbackForm onClose={() => {}} />);

    expect(screen.getByText(REPLY_TO_LINE)).toBeInTheDocument();
    const body = await fileOne();
    expect(body.user_email).toBeNull();
  });
});
