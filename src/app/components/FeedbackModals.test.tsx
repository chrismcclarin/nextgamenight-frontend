// Phase 88 plan 17 Task 2 — Req 9 MIGRATION PROOF for the two feedback overlays.
//
// WHY THIS FILE EXISTS (read before extending):
// Req 9's acceptance is a class census, and a class grep can only prove the old
// markup is GONE — never that what replaced it is a real dialog. `Modal.test.tsx`
// axe-audits the primitive with trivial children; it does not exercise THIS
// content (a category <select>, a long-form textarea, a file-attach control),
// which is where a composed-content violation actually lives. Plan 88-12 found a
// shipped WCAG failure exactly this way, so the same shape is applied here.
//
// Coverage is deliberately per-SURFACE, not per-file: FeedbackForm has TWO
// distinct returns (form and success) and both are dialogs, so both are pinned.
//
// `.tsx` is mandatory: vitest.config.mts only includes `.ts`/`.tsx`, and the
// config's `jsx-in-js` pre-transform handles the `.js` components under test.
import * as React from 'react';
import { render, screen, cleanup, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { axe } from 'vitest-axe';

vi.mock('@auth0/nextjs-auth0/client', () => ({
  useUser: () => ({ user: { sub: 'auth0|self', name: 'Self', email: 'self@example.test' }, isLoading: false }),
}));

vi.mock('next/navigation', () => ({
  usePathname: () => '/groupHomePage',
  useRouter: () => ({ push: vi.fn(), replace: vi.fn() }),
}));

// Phase 88.8 plan 13 Task 3(b): FeedbackForm now reads the contact handle off
// the shared self row. This suite is about the MODAL migration, not identity, so
// the hook is stubbed rather than wrapping every render in a QueryClientProvider
// — without it `useQueryClient` throws and all four FeedbackForm cases fail for
// a reason that has nothing to do with what they assert. The address behaviour
// itself is pinned in FeedbackForm.test.tsx.
vi.mock('@/lib/hooks/useSelfIdentity', () => ({
  SELF_IDENTITY_KEY: ['users', 'self'],
  useSelfIdentity: () => ({
    self: { id: 'u-1', email: 'self@example.test' },
    selfUuid: 'u-1',
    query: { isError: false, error: null, isPending: false, refetch: vi.fn() },
    isPending: false,
  }),
}));

vi.mock('@/lib/api', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/api')>();
  return {
    ...actual,
    feedbackAPI: {
      ...actual.feedbackAPI,
      submitFeedback: vi.fn().mockResolvedValue({ success: true }),
      submitGitHubFeedback: vi.fn().mockResolvedValue({ success: true }),
    },
  };
});

import { feedbackAPI, ApiError } from '@/lib/api';
import FeedbackButton from './FeedbackButton';
import FeedbackForm from './FeedbackForm';
import { FeedbackModalProvider, useFeedbackModal } from './FeedbackModalProvider';

beforeEach(() => {
  vi.clearAllMocks();
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

/** The FAB is the icon-only trigger; the modal mounts on this same instance. */
async function openFeedbackModal() {
  const user = userEvent.setup();
  render(
    <FeedbackModalProvider>
      {/* `label`/`onOpen` are row-variant props — inferred as required from the
          .js signature, and ignored by the default floating variant under test. */}
      <FeedbackButton label="Send feedback" onOpen={vi.fn()} />
    </FeedbackModalProvider>
  );
  await user.click(screen.getByRole('button', { name: 'Send feedback' }));
  return user;
}

describe('FeedbackButton — Req 9 modal migration proof', () => {
  it('exposes role=dialog labelled by its title', async () => {
    await openFeedbackModal();
    expect(await screen.findByRole('dialog', { name: 'Send Feedback' })).toBeInTheDocument();
  });

  it('closes on Escape (Modal owns dismissal — the hand-rolled keydown listener is gone)', async () => {
    const user = await openFeedbackModal();
    await screen.findByRole('dialog');
    await user.keyboard('{Escape}');
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
  });

  it('renders exactly one Close affordance (a second would make the e2e role lookup ambiguous)', async () => {
    await openFeedbackModal();
    await screen.findByRole('dialog');
    expect(screen.getAllByRole('button', { name: 'Close' })).toHaveLength(1);
  });

  it('passes an axe audit with the composed feedback form inside it', async () => {
    await openFeedbackModal();
    const dialog = await screen.findByRole('dialog');
    expect(await axe(dialog)).toHaveNoViolations();
  });

  it('returns focus to the FAB on close (T-87.8-22 — restore must ride onCloseAutoFocus)', async () => {
    // Regression pin for the first CI run of PR #22: the provider restored the
    // invoker inside close(), which Radix's own close-autofocus then clobbered
    // after unmount. The restore now rides Modal's onCloseAutoFocus with
    // preventDefault(), so it is the LAST focus move of the transition.
    const user = await openFeedbackModal();
    await screen.findByRole('dialog');
    await user.keyboard('{Escape}');
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(screen.getByRole('button', { name: 'Send feedback' })).toHaveFocus();
  });
});

describe('FeedbackForm — Req 9 modal migration proof (both states)', () => {
  it('form state: role=dialog labelled by its title', async () => {
    render(<FeedbackForm onClose={vi.fn()} />);
    expect(
      await screen.findByRole('dialog', { name: 'Report Bug or Suggest Feature' })
    ).toBeInTheDocument();
  });

  it('form state: Escape closes via the shared Modal', async () => {
    const user = userEvent.setup();
    const onClose = vi.fn();
    render(<FeedbackForm onClose={onClose} />);
    await screen.findByRole('dialog');
    await user.keyboard('{Escape}');
    expect(onClose).toHaveBeenCalled();
  });

  it('form state: passes an axe audit with the composed form inside it', async () => {
    render(<FeedbackForm onClose={vi.fn()} />);
    const dialog = await screen.findByRole('dialog');
    expect(await axe(dialog)).toHaveNoViolations();
  });

  it('success state: still a dialog, and still has an accessible name', async () => {
    const user = userEvent.setup();
    render(<FeedbackForm onClose={vi.fn()} />);
    await user.type(screen.getByPlaceholderText(/Brief description/i), 'A subject');
    await user.type(screen.getByPlaceholderText(/provide as much detail/i), 'A description');
    await user.click(screen.getByRole('button', { name: /^Submit$/i }));

    // The success panel is header-less by design; its "Thank You!" heading is
    // the DialogTitle, which is the ONLY thing giving it an accessible name.
    const dialog = await screen.findByRole('dialog', { name: 'Thank You!' });
    expect(await axe(dialog)).toHaveNoViolations();
  });
});

/**
 * Phase 88.8 plan 13 Task 3(c) — FeedbackButton sends NO address at all.
 *
 * The defect originates in a CLIENT asserting an identity the server already
 * owns, on a route that is already behind the auth gate. `88.8-09-PLAN.md`
 * Task 4 derives `user_email` server-side from `Users.email` — correct by
 * construction and strictly better than any client value.
 */
describe('FeedbackButton — the request body carries no address key (88.8 R12)', () => {
  it('submits an EXACT key set with no address field of any spelling', async () => {
    const user = await openFeedbackModal();
    await screen.findByRole('dialog');
    await user.type(
      screen.getByPlaceholderText(/what happened|tell us|describe/i),
      'Something went wrong on this page.'
    );
    await user.click(screen.getByRole('button', { name: /^Send$|^Submit$/i }));

    await waitFor(() => expect(feedbackAPI.submitGitHubFeedback).toHaveBeenCalled());
    const arg = (feedbackAPI.submitGitHubFeedback as ReturnType<typeof vi.fn>).mock.calls[0][0];
    // An EXACT key-set assertion, not a `toBeUndefined` — a RENAMED field
    // (`email`, `contactEmail`) would pass the weaker form.
    expect(Object.keys(arg).sort()).toEqual(
      ['category', 'label', 'pageUrl', 'text', 'userAgent', 'userName'].sort()
    );
    // userName is DELIBERATELY kept: it is a display name, not a contact handle.
    expect(arg.userName).toBe('Self');
  });
});

/* ---------------------------------------------------------------------------
   PHASE 88.6-31 task 2 — the FAB migration, the shadow respelling, the missing
   Sentry capture and the ref-held success timer.

   jsdom performs no layout and loads no stylesheet, so NOTHING here rests on
   `getComputedStyle` — not for the shadow and not for the glyph. CLASS-LIST PINS are
   the instrument at this level; rendered geometry and real computed shadow values
   belong to the planted probes in the phone Playwright lane.
   --------------------------------------------------------------------------- */

import * as Sentry from '@sentry/nextjs';

vi.mock('@sentry/nextjs', () => ({ captureException: vi.fn() }));

describe('FeedbackButton — Phase 88.6-31 (the FAB, the capture, the timer)', () => {
  /* The FAB's class-list pins render WITHOUT opening the modal, deliberately. Radix marks the
     dialog's siblings `aria-hidden` while it is open, so the FAB leaves the accessibility tree
     the moment `openFeedbackModal()` clicks it — which is why the shipped `:121` query above
     runs only AFTER the dialog closes. Measured 2026-09-16, not assumed: a post-open
     `getAllByRole('button', { name: 'Send feedback' })` finds nothing. */
  const renderFab = () => {
    render(
      <FeedbackModalProvider>
        <FeedbackButton label="Send feedback" onOpen={vi.fn()} />
      </FeedbackModalProvider>
    );
    return screen.getByRole('button', { name: 'Send feedback' });
  };

  it('PRESERVATION + migration: the FAB is still found by its shipped role-and-name query, and carries `btn-primary` — not the ghost class list', () => {
    // The accessible name is a property PRESERVED through the migration, not one added —
    // T-88.6-86 is a REGRESSION risk, so the by-name query is what proves it survived.
    const fab = renderFab();
    expect(fab.className).toContain('btn-primary');
    expect(fab.className).not.toContain('bg-transparent');
  });

  it('the FAB keeps its 56px box (a FLOOR is not a size), takes `size="icon"`, and sheds its dead classes and its per-site ring', () => {
    const fab = renderFab();

    // `w-14 h-14` = 56px EXCEEDS the 44px floor `size="icon"` contributes. Dropping it on the
    // belief that "the primitive supplies the size" would shrink the control by 12px (P6).
    expect(fab.className).toContain('w-14');
    expect(fab.className).toContain('h-14');
    expect(fab.className).toContain('min-h-11');
    expect(fab.className).toContain('min-w-11');
    // Live layout kept — `.btn` declares no position and no z-index.
    expect(fab.className).toContain('fixed');
    expect(fab.className).toContain('z-30');
    // Dead under unlayered `.btn`, so deleted.
    expect(fab.className).not.toContain('rounded-full');
    expect(fab.className).not.toMatch(/\bjustify-center\b/);
    // A-2 ARM A (`88.6-05-SUMMARY.md:186`): the ring lives in the primitive's cva base, so the
    // byte-identical per-site string is gone rather than duplicated. The base's ring survives,
    // and it appears exactly ONCE.
    expect(fab.className.match(/focus-visible:ring-focus-ring/g)).toHaveLength(1);
  });

  it('D-14b / D49-b: the FAB rests on the THEME tier with the hover PINNED — exactly one bare and one `enabled-hover:` shadow token, hover tier >= resting, and no alias spelling survives', () => {
    const fab = renderFab();
    const tokens = fab.className.split(/\s+/).filter((t) => t.includes('shadow-'));

    /* The regression this pin exists for, and the reason the AC is a POSITIVE pin on the merged
       className rather than "`shadow-lg` is byte-unchanged": twMerge keeps `shadow-lg` AND the
       base's `shadow-theme-sm` (different token families, so neither dedupes the other) and the
       base's resting value wins in sheet order — so a preserved alias would have RESTED with no
       shadow at all and lifted only to `md`. An "unchanged" AC would have CERTIFIED that. */
    expect(tokens.filter((t) => /^(enabled-hover:|hover:)?shadow-(sm|md|lg|xs|xl|2xl|inner)$/.test(t))).toEqual([]);

    const bare = tokens.filter((t) => /^shadow-theme-(sm|md|lg)$/.test(t));
    const hover = tokens.filter((t) => /^enabled-hover:shadow-theme-(sm|md|lg)$/.test(t));
    expect(bare).toEqual(['shadow-theme-lg']);
    expect(hover).toEqual(['enabled-hover:shadow-theme-lg']);
    // The base's `enabled-hover:shadow-theme-md` was DEDUPED by the pin rather than racing it —
    // which is the whole reason the pin uses `enabled-hover:` on both sides and not bare `hover:`.
    expect(tokens).not.toContain('enabled-hover:shadow-theme-md');
    // Hover tier >= resting tier: an inverted elevation is the §3.4 rule-2 defect itself.
    const TIER: Record<string, number> = {
      'shadow-theme-sm': 1,
      'shadow-theme-md': 2,
      'shadow-theme-lg': 3,
    };
    expect(TIER[hover[0].replace('enabled-hover:', '')]).toBeGreaterThanOrEqual(TIER[bare[0]]);
  });

  it('D-21 / AC-16: a failed GitHub-feedback submit now REPORTS to Sentry — class-only, `channel`-tagged, and with no body field in the payload', async () => {
    vi.mocked(feedbackAPI.submitGitHubFeedback).mockRejectedValueOnce(
      new ApiError('the backend said something quotable', 'internal', 500, { error: 'raw body' })
    );
    const user = await openFeedbackModal();
    await screen.findByRole('dialog');
    await user.type(
      screen.getByPlaceholderText(/what happened|tell us|describe/i),
      'Something went wrong on this page.'
    );
    await user.click(screen.getByRole('button', { name: /^Send$|^Submit$/i }));

    await waitFor(() => expect(Sentry.captureException).toHaveBeenCalledTimes(1));
    const [err, ctx] = vi.mocked(Sentry.captureException).mock.calls[0] as [
      Error,
      { tags?: Record<string, unknown> },
    ];
    // CLASS-ONLY — a synthesized Error naming the class (and `err.code` when present), never
    // the raw error object and never `err.message`, which is the backend's extracted string.
    expect(err).toBeInstanceOf(Error);
    expect(err.message).toMatch(/^feedback submit failed: ApiError/);
    expect(err.message).not.toContain('the backend said something quotable');
    // The tag set, and the `channel` discriminator that separates the two feedback writers.
    expect(ctx.tags).toEqual({ feature: 'feedback', op: 'submit', channel: 'github' });
    // Every tag VALUE is a compile-time source literal — `scrubEvent` never walks `event.tags`,
    // and Sentry INDEXES them, so a computed value would bypass the whole scrub layer.
    for (const v of Object.values(ctx.tags!)) expect(typeof v).toBe('string');
    // NONE of this file's request-body fields ride along: userName, pageUrl, the prose, the UA.
    const payload = JSON.stringify(vi.mocked(Sentry.captureException).mock.calls[0]);
    expect(payload).not.toContain('Self');
    expect(payload).not.toContain('groupHomePage');
    expect(payload).not.toContain('Something went wrong on this page.');
    expect(payload).not.toContain('raw body');
  });

  it('SPEC R1: the failure renders the RATIFIED register line, never the upstream string or the retired authored fallback', async () => {
    vi.mocked(feedbackAPI.submitGitHubFeedback).mockRejectedValueOnce(
      new ApiError('the backend said something quotable', 'rate_limited', 429, {})
    );
    const user = await openFeedbackModal();
    await screen.findByRole('dialog');
    await user.type(
      screen.getByPlaceholderText(/what happened|tell us|describe/i),
      'Something went wrong on this page.'
    );
    await user.click(screen.getByRole('button', { name: /^Send$|^Submit$/i }));

    /* A REAL `ApiError` with a real code, not a bare TypeError: at this seam the API client is
       mocked, so an unwrapped error would derive `unknown` and the assertion could not tell the
       register apart from a generic fallback. `rate_limited` proves the CODE was read. */
    expect(await screen.findByText(/going a little fast/i)).toBeInTheDocument();
    expect(screen.queryByText(/failed to submit feedback/i)).toBeNull();
    expect(screen.queryByText(/the backend said something quotable/i)).toBeNull();
  });

  it('R2 #34: the 2s success timer is cleared on unmount, so the SHARED provider `close()` cannot fire into an unmounted component', async () => {
    /* The probe is what makes this discriminating. `close()` belongs to the PROVIDER, not to a
       prop this component owns, so the only observable of "the timer fired after unmount" is the
       provider's own state — and the provider must OUTLIVE the unmount for that to be visible.
       So the harness unmounts the FeedbackButton alone, by rerender, and leaves the provider up.
       Against the bare `setTimeout` this file shipped, the callback still runs and flips the
       probe to `closed`; with the ref and the unmount clear, it stays `open`. */
    function Probe() {
      const { isOpen } = useFeedbackModal();
      return <span data-testid="probe">{isOpen ? 'open' : 'closed'}</span>;
    }
    const Harness = ({ mounted }: { mounted: boolean }) => (
      <FeedbackModalProvider>
        <Probe />
        {mounted ? <FeedbackButton label="Send feedback" onOpen={vi.fn()} /> : null}
      </FeedbackModalProvider>
    );

    vi.useFakeTimers({ shouldAdvanceTime: true });
    try {
      const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
      const { rerender } = render(<Harness mounted />);
      await user.click(screen.getByRole('button', { name: 'Send feedback' }));
      await screen.findByRole('dialog');
      await user.type(
        screen.getByPlaceholderText(/what happened|tell us|describe/i),
        'Something went wrong on this page.'
      );
      await user.click(screen.getByRole('button', { name: /^Send$|^Submit$/i }));

      // POSITIVE settle signal first — the success panel proves the 2s timer is ARMED. An
      // absence claim asserted before this point observes nothing at all.
      await screen.findByText(/Thanks! Your feedback has been submitted\./i);
      expect(screen.getByTestId('probe')).toHaveTextContent('open');

      // The modal can close under it: the close button, Escape, an outside click, a route
      // change. The component unmounts; the shared provider does not.
      rerender(<Harness mounted={false} />);
      await vi.advanceTimersByTimeAsync(3000);

      expect(screen.getByTestId('probe')).toHaveTextContent('open');
    } finally {
      vi.useRealTimers();
    }
  });
});
