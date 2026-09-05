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

import { feedbackAPI } from '@/lib/api';
import FeedbackButton from './FeedbackButton';
import FeedbackForm from './FeedbackForm';
import { FeedbackModalProvider } from './FeedbackModalProvider';

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
