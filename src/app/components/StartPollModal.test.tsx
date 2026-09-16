// Axe audit for StartPollModal after its migration onto the shared <Modal>
// primitive with overlay-dismiss disabled (PRIM-02 / D-09). StartPollModal
// carries in-progress form state that resets on close, so it migrates with
// `dismissable={false}` (overlay click cannot discard input). This pins the
// migrated modal to the Radix a11y contract: role=dialog + zero axe violations
// rendered open with its form.
import * as React from 'react';
import { render, screen, cleanup, fireEvent, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { axe } from 'vitest-axe';

// `importOriginal` spread — NOT a bare `{ apiFetch }` object.
//
// THIS IS A PRECONDITION, not tidiness (88.6-22 task 2). The shipped mock exported ONLY
// `apiFetch`, so `ApiError` resolved to `undefined` in the module under test, and
// `deriveCode`'s `error instanceof ApiError` check (useFetchErrorState.ts) throws a
// TypeError before any assertion in a code-keyed error arm can run. Now that this modal
// derives its copy from `ApiError.code` rather than from backend prose, the real class has
// to be present or the new arms would fail for the wrong reason. Keeping the spread also
// means a REMOVED export fails loudly instead of silently resolving to a mock.
vi.mock('../../lib/api', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../lib/api')>();
  return {
    ...actual,
    apiFetch: vi.fn().mockResolvedValue({ prompt: { id: 'p1' } }),
  };
});

import StartPollModal from './StartPollModal';
import { apiFetch, ApiError } from '../../lib/api';

type Mock = ReturnType<typeof vi.fn>;

beforeEach(() => {
  vi.clearAllMocks();
  (apiFetch as Mock).mockResolvedValue({ prompt: { id: 'p1' } });
});

afterEach(cleanup);

const baseProps = {
  groupId: 'group-1',
  group: { games: [{ id: 'g1', name: 'Catan' }] },
  isOpen: true,
  onClose: vi.fn(),
  onSuccess: vi.fn(),
};

describe('StartPollModal (migrated onto <Modal dismissable={false}>)', () => {
  it('renders as role=dialog when open', () => {
    render(<StartPollModal {...baseProps} />);
    expect(screen.getByRole('dialog')).toBeInTheDocument();
  });

  it('preserves the "Start a check-in" header copy', () => {
    render(<StartPollModal {...baseProps} />);
    expect(screen.getByText('Start a check-in')).toBeInTheDocument();
  });

  it('passes an axe audit with no violations', async () => {
    render(<StartPollModal {...baseProps} />);
    const dialog = screen.getByRole('dialog');
    expect(await axe(dialog)).toHaveNoViolations();
  });
});

// Phase 88.6 plan 22 task 2 (C1a — X1/D16/D54/D15).
//
// The error copy is derived from the HTTP STATUS, never from the backend's prose. Both arms
// below set the thrown error's `message` to `HTTP error! status: 4xx` DELIBERATELY: that is
// exactly what `ApiError.message` becomes once plan 42 drops `lib/api.ts:309`'s `body?.error`
// alias, because `POST /prompts` returns raw `{ error }` bodies. A passing arm therefore proves
// the copy comes from the CODE and could not have come from the message — which is the property
// the two deleted prose regexes did not have.
describe('StartPollModal — error copy is keyed on the status, not the prose (88.6-22)', () => {
  const submit = () => fireEvent.click(screen.getByRole('button', { name: 'Start poll' }));

  it('renders the conflict copy for a 409, from the code and not the message', async () => {
    (apiFetch as Mock).mockRejectedValueOnce(
      new ApiError('HTTP error! status: 409', 'conflict', 409)
    );
    render(<StartPollModal {...baseProps} />);
    submit();
    await waitFor(() =>
      expect(
        screen.getByText('This group already has an open poll. Close it before starting another.')
      ).toBeInTheDocument()
    );
    expect(screen.queryByText(/HTTP error! status/)).not.toBeInTheDocument();
  });

  it('renders the forbidden copy for a 403, from the code and not the message', async () => {
    (apiFetch as Mock).mockRejectedValueOnce(
      new ApiError('HTTP error! status: 403', 'forbidden', 403)
    );
    render(<StartPollModal {...baseProps} />);
    submit();
    await waitFor(() =>
      expect(
        screen.getByText('You must be an active group member to start a poll.')
      ).toBeInTheDocument()
    );
    expect(screen.queryByText(/HTTP error! status/)).not.toBeInTheDocument();
  });

  it('falls through to the ratified register line for a code-less failure — no fallback', async () => {
    // NO `fallback` is passed at the call site, so an `unknown` code resolves to
    // `MESSAGE_BY_CODE.unknown`. The retired shipped string was
    // 'Something went wrong. Try again.' — a DIFFERENT string, i.e. a real copy fork.
    (apiFetch as Mock).mockRejectedValueOnce(new Error('kaboom'));
    render(<StartPollModal {...baseProps} />);
    submit();
    await waitFor(() =>
      expect(
        screen.getByText('Something went wrong. Refresh the page to try again.')
      ).toBeInTheDocument()
    );
    expect(screen.queryByText('Something went wrong. Try again.')).not.toBeInTheDocument();
    expect(screen.queryByText('kaboom')).not.toBeInTheDocument();
  });

  it('renders the register validation line for a 400 — the disclosed copy change', async () => {
    (apiFetch as Mock).mockRejectedValueOnce(
      new ApiError('group_id is required', 'validation', 400)
    );
    render(<StartPollModal {...baseProps} />);
    submit();
    await waitFor(() =>
      expect(screen.queryByText('group_id is required')).not.toBeInTheDocument()
    );
    expect(
      screen.getByText('Something looks off with that request. Refresh the page to try again.')
    ).toBeInTheDocument();
  });
});
