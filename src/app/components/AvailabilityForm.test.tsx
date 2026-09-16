// Per-form proof for PRIM-06: on a failed submit, AvailabilityForm must (a) render
// its inline submit-error UI (role="alert") AND (b) re-throw so handleAppSubmit's
// catch logs to logger.error -> Sentry (the reachable, tested Sentry path).
//
// Phase 88-13 adds the second block below: the two pre-fill buttons overwrite a
// painted grid with no undo, and their gate moved off `window.confirm` onto the
// shared dialog tier. The gate was previously untested at this level.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, cleanup, waitFor, fireEvent, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

// WIDENED by plan 88.6-25 task 2 to the `importOriginal` form plan 88.6-15 shipped
// (PromptScheduleManager.test.tsx:67-73). The narrow factory replaced the WHOLE module, so once
// this component adopted `errCtx` for its AC-2 conversions the helper came back undefined and
// every render through a prefill catch threw. Spreading the real module keeps `errCtx` REAL,
// which is deliberate and not just convenient: the ctx assertion below then proves the shipped
// helper's output (T-84-01's name-and-message-only shape) rather than a re-implementation of it.
vi.mock('@/lib/logger', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/logger')>();
  return {
    ...actual,
    logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn() },
  };
});
// WIDENED by plan 88.6-25 task 2 to the `importOriginal` form FriendInvitePanel.test.tsx:72-80
// ships, and the reason is a REAL defect this suite would otherwise hide rather than a style
// preference. The narrow factory replaced the WHOLE module, so `ApiError` came back undefined —
// and `getFetchErrorMessage`'s `deriveCode` does `error instanceof ApiError`, which THROWS a
// TypeError on an undefined right-hand side. The component's catch then died before
// `setSubmitError`, the inline `role="alert"` never rendered, and the failure looked like a
// component bug. Spreading the real module keeps `ApiError` real, which is what makes the
// register assertion below mean anything.
vi.mock('@/lib/api', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/api')>();
  return {
    ...actual,
    availabilityFormAPI: {
      ...actual.availabilityFormAPI,
      submitResponse: vi.fn().mockRejectedValue(new Error('Network down')),
      prefillFromGcal: vi.fn(),
      prefillFromSaved: vi.fn(),
    },
  };
});
vi.mock('./AvailabilityGrid', () => ({ default: () => <div data-testid="grid" /> }));

import type { ComponentType } from 'react';
import AvailabilityFormDefault from './AvailabilityForm';
import { logger } from '@/lib/logger';
import { availabilityFormAPI } from '@/lib/api';

// AvailabilityForm is a JS component; its inferred prop type marks every prop
// required. Cast to a permissive type so the test can render with only the
// props it exercises.
const AvailabilityForm = AvailabilityFormDefault as unknown as ComponentType<{
  magicToken?: string;
  userName?: string;
  promptId?: string;
  gcalConnected?: boolean;
  hasSavedAvailability?: boolean;
  existingResponse?: {
    time_slots: Array<{ slotId: string; preference: string }>;
    is_unavailable: boolean;
  } | null;
}>;

type Mock = ReturnType<typeof vi.fn>;

afterEach(cleanup);

describe('AvailabilityForm submit-error path', () => {
  beforeEach(() => vi.clearAllMocks());

  it('on a failed submit renders the inline error (role=alert) AND logs via logger.error', async () => {
    const user = userEvent.setup();
    render(<AvailabilityForm magicToken="tok" userName="Sam" promptId="p1" />);

    // is_unavailable=true satisfies the cross-field refine without painting slots.
    await user.click(screen.getByRole('button', { name: /unavailable this week/i }));
    await user.click(screen.getByRole('button', { name: /submit availability/i }));

    // REWRITTEN by plan 88.6-25 task 2. The shipped form of this assertion was
    // `/network down|failed to submit/i` — it matched the RAW UPSTREAM message on one arm and
    // the hand-written 'Failed to submit availability…' literal on the other, so it passed
    // BEFORE the fix and would have passed after a fix that kept leaking upstream text. It
    // proved nothing. It now names the ratified register line this path resolves to, so the
    // suite reds if an upstream string ever renders here again.
    //
    // WHY THIS EXACT STRING: `submitResponse` performs no `res.ok` check (lib/api.ts:1086-1091),
    // so what reaches the catch is a plain `Error` with no `code`; `getFetchErrorMessage` is
    // called with NO fallback, so it resolves `unknown` — MESSAGE_BY_CODE.unknown,
    // useFetchErrorState.ts. That genericness is the RULED RESIDUAL of D62 branch B
    // (owner, 2026-09-09), not a defect: until Phase 93 lands the backend `code`, an expired
    // magic link and a validation refusal render the same sentence here.
    await waitFor(() => {
      expect(screen.getByRole('alert')).toHaveTextContent(
        'Something went wrong. Refresh the page to try again.',
      );
    });
    // ...and the upstream text the mock threw is NOT anywhere in the rendered surface. Without
    // this half the assertion above still passes while a second element leaks the message.
    expect(document.body.textContent).not.toMatch(/network down/i);
    expect(logger.error).toHaveBeenCalledWith('form submit failed', expect.any(Error));
  });
});

describe('Phase 88-13 — replacing painted selections is gated by a styled dialog', () => {
  // One painted slot is enough: the gate's condition is "anything to lose".
  const PAINTED = {
    time_slots: [{ slotId: '2026-08-10T18:00:00.000Z', preference: 'preferred' }],
    is_unavailable: false,
  };

  beforeEach(() => {
    vi.clearAllMocks();
    (availabilityFormAPI.prefillFromGcal as Mock).mockResolvedValue({ slot_ids: [], count: 0 });
    (availabilityFormAPI.prefillFromSaved as Mock).mockResolvedValue({ slot_ids: [], count: 0 });
  });

  /** The replace gate, addressed by its accessible name (UI-SPEC §11.2 copy). */
  function replaceDialog(): HTMLElement {
    return screen.getByRole('dialog', { name: 'Replace your current selections?' });
  }

  it('gates the GCal import, states what is lost, and runs it only on confirm', async () => {
    render(
      <AvailabilityForm
        magicToken="tok"
        userName="Sam"
        promptId="p1"
        gcalConnected
        existingResponse={PAINTED}
      />
    );

    fireEvent.click(screen.getByRole('button', { name: /import from google calendar/i }));
    const dialog = await screen.findByRole('dialog', { name: 'Replace your current selections?' });
    expect(dialog).toHaveTextContent("What you've painted so far will be overwritten.");
    // Blocking, not advisory: nothing has been fetched or painted yet.
    expect(availabilityFormAPI.prefillFromGcal).not.toHaveBeenCalled();

    fireEvent.click(within(dialog).getByRole('button', { name: 'Replace' }));
    await waitFor(() => expect(availabilityFormAPI.prefillFromGcal).toHaveBeenCalledTimes(1));
  });

  it('cancel aborts the saved-availability replace — the grid is untouched', async () => {
    render(
      <AvailabilityForm
        magicToken="tok"
        userName="Sam"
        promptId="p1"
        hasSavedAvailability
        existingResponse={PAINTED}
      />
    );

    fireEvent.click(screen.getByRole('button', { name: /use my saved availability/i }));
    const dialog = await screen.findByRole('dialog', { name: 'Replace your current selections?' });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Cancel' }));

    await waitFor(() =>
      expect(
        screen.queryByRole('dialog', { name: 'Replace your current selections?' })
      ).toBeNull()
    );
    expect(availabilityFormAPI.prefillFromSaved).not.toHaveBeenCalled();
  });

  it('asks nothing when there is nothing to lose (unchanged behaviour)', async () => {
    render(
      <AvailabilityForm magicToken="tok" userName="Sam" promptId="p1" gcalConnected />
    );

    fireEvent.click(screen.getByRole('button', { name: /import from google calendar/i }));
    await waitFor(() => expect(availabilityFormAPI.prefillFromGcal).toHaveBeenCalledTimes(1));
    expect(
      screen.queryByRole('dialog', { name: 'Replace your current selections?' })
    ).toBeNull();
    expect(replaceDialog).toThrow();
  });

  it('both buttons share ONE gate — the copy cannot drift between them', async () => {
    const { unmount } = render(
      <AvailabilityForm
        magicToken="tok"
        userName="Sam"
        promptId="p1"
        gcalConnected
        hasSavedAvailability
        existingResponse={PAINTED}
      />
    );

    fireEvent.click(screen.getByRole('button', { name: /import from google calendar/i }));
    const fromGcal = (await screen.findByRole('dialog', {
      name: 'Replace your current selections?',
    })).textContent;
    fireEvent.click(within(replaceDialog()).getByRole('button', { name: 'Cancel' }));
    await waitFor(() =>
      expect(
        screen.queryByRole('dialog', { name: 'Replace your current selections?' })
      ).toBeNull()
    );

    fireEvent.click(screen.getByRole('button', { name: /use my saved availability/i }));
    const fromSaved = (await screen.findByRole('dialog', {
      name: 'Replace your current selections?',
    })).textContent;

    expect(fromSaved).toBe(fromGcal);

    // ...and confirming the SECOND trigger runs the SECOND action, not the
    // first: one shared config must not mean one shared target.
    fireEvent.click(within(replaceDialog()).getByRole('button', { name: 'Replace' }));
    await waitFor(() => expect(availabilityFormAPI.prefillFromSaved).toHaveBeenCalledTimes(1));
    expect(availabilityFormAPI.prefillFromGcal).not.toHaveBeenCalled();

    unmount();
  });
});

// ---------------------------------------------------------------------------------------
// Plan 88.6-25 task 2 — the prefill status line: a FAILURE stays distinguishable from an
// EMPTY SUCCESS, and neither carries backend text.
// ---------------------------------------------------------------------------------------
// BOTH STATES for BOTH ARMS, and one case alone would not do. The failure arm alone can be
// made to pass by relabelling a legitimate zero-result as a failure; the empty-success arm
// alone can be made to pass by dropping the failure branch entirely. Together they pin the
// discriminant: `prefillStatus.failed`, which the success path never sets. `count: 0` CANNOT
// be the signal — the backend filters `source:'default'`, so a user with no saved patterns
// legitimately resolves with zero (AvailabilityForm.js's own comment on performSavedPrefill).
// A collapse here would be T-88.6-79 (the empty-vs-failed defect plan 27 closes on
// EventCalendar.js) newly created on the ANONYMOUS magic-link surface.
describe('Phase 88.6-25 — prefill failure vs empty success, and no upstream text either way', () => {
  // The literal a rejected prefill used to interpolate. lib/api.ts:1126/:1159 throw
  // `new Error(err.error || …)`, i.e. the backend body's own field, so this stands in for
  // real upstream text on an unauthenticated page.
  const UPSTREAM = 'Calendar sync token revoked by upstream';

  const ARMS = [
    {
      arm: 'gcal',
      props: { gcalConnected: true },
      trigger: /import from google calendar/i,
      api: 'prefillFromGcal',
      logMessage: '[AvailabilityForm] GCal prefill failed:',
      failureSentence: "Couldn't import from Google Calendar.",
      emptySentence: 'No free slots found in Google Calendar for this week — paint manually below.',
    },
    {
      arm: 'saved',
      props: { hasSavedAvailability: true },
      trigger: /use my saved availability/i,
      api: 'prefillFromSaved',
      logMessage: '[AvailabilityForm] Saved prefill failed:',
      failureSentence: "Couldn't use saved availability.",
      emptySentence: 'No saved availability matches this week — paint manually below.',
    },
  ] as const;

  beforeEach(() => vi.clearAllMocks());

  for (const a of ARMS) {
    it(`${a.arm}: a REJECTED prefill renders the complete failure sentence, with no backend text`, async () => {
      (availabilityFormAPI[a.api] as Mock).mockRejectedValue(new Error(UPSTREAM));
      render(<AvailabilityForm magicToken="tok" userName="Sam" promptId="p1" {...a.props} />);

      // Nothing painted, so no replace gate — the perform* callback runs directly.
      fireEvent.click(screen.getByRole('button', { name: a.trigger }));

      // Settle on the FAILURE SENTENCE itself, never on the absence of something: an absence
      // assertion is satisfied on the first tick, before the catch has even run.
      expect(await screen.findByText(a.failureSentence)).toBeTruthy();
      // The upstream message reaches NOTHING the user can read.
      expect(document.body.textContent).not.toMatch(/revoked by upstream/i);
      // ...and it is NOT relabelled as the empty-success outcome.
      expect(screen.queryByText(a.emptySentence)).toBeNull();
      // AC-2 channel: the raw console call is gone and the house logger carries it, with the
      // error's name and message in the CTX object rather than the raw Error.
      expect(logger.info).toHaveBeenCalledWith(a.logMessage, {
        name: 'Error',
        message: UPSTREAM,
      });
    });

    it(`${a.arm}: a RESOLVED prefill that returns ZERO slots still reads as an empty success`, async () => {
      (availabilityFormAPI[a.api] as Mock).mockResolvedValue({ slot_ids: [], count: 0 });
      render(<AvailabilityForm magicToken="tok" userName="Sam" promptId="p1" {...a.props} />);

      fireEvent.click(screen.getByRole('button', { name: a.trigger }));

      expect(await screen.findByText(a.emptySentence)).toBeTruthy();
      // This is the half that catches a discriminant keyed on `count === 0`: with one, the
      // legitimate zero-result would paint the failure sentence at an anonymous visitor.
      expect(screen.queryByText(a.failureSentence)).toBeNull();
      expect(logger.info).not.toHaveBeenCalled();
    });
  }
});
