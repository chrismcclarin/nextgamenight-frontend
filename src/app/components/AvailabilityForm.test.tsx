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
import { axe } from 'vitest-axe';

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
import { ApiError, availabilityFormAPI } from '@/lib/api';

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
    //
    // AMENDED 2026-09-28 by plan 88.6-58 task 1 (review H2, D-35 amended): the paragraph above
    // is now true only of CODE-LESS failures — this case's transport rejection, and the raw
    // `{ error, action }` token/validation arms (pinned confirm-only below). The CODED arms
    // (`prompt_closed`, `prompt_deadline_expired`, `rate_limited`) now reach the catch as an
    // `ApiError` and render their own register lines — the `it.each` cases below. The
    // `lib/api.ts:1086-1091` cite above is stale; read `submitResponse: async` in lib/api.ts.
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

  // ADDED by plan 88.6-58 task 1 (2026-09-28, /code-adversarial-review 88.6 H2, owner ruling
  // `H2-RULING` in 88.6-CODE-REVIEW-work/RULINGS.md). The backend ALREADY sends an envelope
  // `code` on the three lifecycle/limiter rejections of `POST /availability-responses`
  // (Sonnet/routes/availabilityResponse.js:99, :103 `prompt_closed`; :109
  // `prompt_deadline_expired`; middleware/rateLimiter.js:10 `rate_limited`), and
  // `submitResponse` returns the parsed body whatever the status — so these bodies reach the
  // component's `response.error` guard RESOLVED, not rejected. Before plan 58 the guard threw a
  // bare `Error` and every one of them rendered the `unknown` line ("Refresh the page…"), which
  // a refresh cannot fix. Each case below was RED on FE d03f728 and is GREEN after the coded
  // throw.
  async function submitWith(body: Record<string, unknown>) {
    (availabilityFormAPI.submitResponse as Mock).mockResolvedValueOnce(body);
    const user = userEvent.setup();
    render(<AvailabilityForm magicToken="tok" userName="Sam" promptId="p1" />);
    await user.click(screen.getByRole('button', { name: /unavailable this week/i }));
    await user.click(screen.getByRole('button', { name: /submit availability/i }));
  }

  it.each([
    [
      'prompt_deadline_expired',
      'The deadline for this availability prompt has passed.',
      'The deadline for this availability poll has passed.',
    ],
    [
      'prompt_closed',
      'This availability prompt is closed.',
      'This availability poll is already closed.',
    ],
    [
      'rate_limited',
      'Too many attempts. Please try again later.',
      "You're going a little fast — give it a moment, then try again.",
    ],
  ])(
    'a resolved `%s` envelope renders its ratified register line, not the generic one',
    async (code, backendMessage, registerLine) => {
      await submitWith({ code, message: backendMessage, error: backendMessage });
      await waitFor(() => {
        expect(screen.getByRole('alert')).toHaveTextContent(registerLine);
      });
      // The backend's own sentence stays OFF the display path (R1): only the register renders.
      expect(document.body.textContent).not.toContain(backendMessage);
      expect(document.body.textContent).not.toMatch(/refresh the page/i);
    },
  );

  it('CONFIRM-ONLY: a code-less `{ error, action }` token arm still renders the `unknown` line (the true D-35 residual)', async () => {
    // GREEN before and after plan 58 by design. It pins D-35's REAL residual so a later "tidy"
    // onto `mapErrorToCode(response, 400)` — which resolves a code-less 400 to `validation` and
    // would tell someone with an expired link "Something looks off with that request" — reds.
    await submitWith({ error: 'This link is no longer valid.', action: 'request_new' });
    await waitFor(() => {
      expect(screen.getByRole('alert')).toHaveTextContent(
        'Something went wrong. Refresh the page to try again.',
      );
    });
    expect(document.body.textContent).not.toMatch(/no longer valid/i);
  });

  it('the value reaching handleAppSubmit is a coded ApiError carrying the backend string only as upstreamMessage', async () => {
    const backendMessage = 'The deadline for this availability prompt has passed.';
    await submitWith({
      code: 'prompt_deadline_expired',
      message: backendMessage,
      error: backendMessage,
    });
    await waitFor(() => expect(logger.error).toHaveBeenCalled());
    const [msg, thrown] = (logger.error as Mock).mock.calls[0];
    expect(msg).toBe('form submit failed');
    expect(thrown).toBeInstanceOf(ApiError);
    expect(thrown.code).toBe('prompt_deadline_expired');
    expect(thrown.upstreamMessage).toBe(backendMessage);
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
// Phase 88.6-54 (R7 / SC-4, UI-SPEC §7.5) — the composed axe audit of the OPEN replace gate.
// ---------------------------------------------------------------------------------------
// WHY THIS SURFACE, AND WHY NOW: RESEARCH §Q1 lists AvailabilityForm.js as a `ui/ConfirmDialog`
// importer (88.6-RESEARCH.md:919) but in NEITHER of its two derived lists — not among the files
// whose tests already run axe (:922-926), not among the nine unaudited surfaces (:928-940). The
// enumeration dropped it, so SC-4 ("composed axe audits on EVERY modal surface this phase
// migrates") had a hole exactly here. Measured 2026-09-24 and re-measured 2026-09-28: this file and
// availability-form/[token]/page.test.tsx held ZERO `axe` occurrences.
//
// ORDERING (SPEC R7 Edge Coverage), confirmed at execution 2026-09-28 — this audit lands after the
// last commit of every file in the audited tree:
//   AvailabilityForm.js  1a220e8 (plan 88.6-42, 2026-09-16)
//   ConfirmDialog.tsx    861cee4 (plan 88-33,   2026-08-21)
//   useConfirmAction.ts  8ac83ee (plan 88-05,   2026-08-05)
// AvailabilityGrid.js moved later (plan 88.6-57, CR-102) but is MOCKED in this suite (the vi.mock
// at the top of the file) and renders inside the form, not inside the dialog under audit.
//
// NO `matchMedia` FORK — one tree, one run per rule set. AvailabilityForm.js, ConfirmDialog.tsx,
// useConfirmAction.ts and dialog.tsx call none (grep over the four, 2026-09-28, exit 1).
//
// SINGLE SURFACE — the gate opens over the magic-link PAGE, not over a `Modal`, so the SPEC's
// stacked-pair ("adjacency") clause does not apply here (the DangerZoneDeleteAccount audit records
// the same shape for its own single dialog).
//
// THE POSITIVE CONTROL is not optional. A ConfirmDialog's only heading is its Radix DialogTitle, so
// heading-order CANNOT fail on this dialog by itself; and a green WCAG 4.1.2 run proves nothing
// unless the same run is shown able to red on this dialog's DOM. Case 2 plants one defect per rule
// set inside the open dialog and requires each run to report it (gap-lap ML-12 / ML-33).
describe('Phase 88.6-54 (R7 / SC-4, UI-SPEC §7.5) — composed axe audit of the OPEN replace-gate ConfirmDialog', () => {
  const WCAG_412 = { runOnly: { type: 'tag' as const, values: ['wcag412'] } };
  const HEADING_ORDER = { runOnly: { type: 'rule' as const, values: ['heading-order'] } };
  const DIALOG_NAME = 'Replace your current selections?';

  // Its own fixture, same shape as the replace-gate describe's: one painted slot is "anything to lose".
  const PAINTED = {
    time_slots: [{ slotId: '2026-08-10T18:00:00.000Z', preference: 'preferred' }],
    is_unavailable: false,
  };

  beforeEach(() => {
    vi.clearAllMocks();
    (availabilityFormAPI.prefillFromGcal as Mock).mockResolvedValue({ slot_ids: [], count: 0 });
  });

  /** Opens the gate and settles on the OPEN dialog itself (by its accessible name), never on chrome. */
  async function openReplaceGate(): Promise<HTMLElement> {
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
    const dialog = await screen.findByRole('dialog', { name: DIALOG_NAME });
    // A branch-specific control of the open dialog: the audit runs on the settled gate, not a frame.
    expect(within(dialog).getByRole('button', { name: 'Replace' })).toBeInTheDocument();
    return dialog;
  }

  it('1. the open gate passes WCAG 4.1.2 and heading-order', async () => {
    const dialog = await openReplaceGate();
    expect(await axe(dialog, WCAG_412)).toHaveNoViolations();
    expect(await axe(dialog, HEADING_ORDER)).toHaveNoViolations();
  });

  it('2. positive control — the SAME two runs red on a defect planted inside this dialog', async () => {
    const dialog = await openReplaceGate();

    // WCAG 4.1.2: a button with no text and no label.
    const nameless = document.createElement('button');
    nameless.type = 'button';
    dialog.appendChild(nameless);
    const wcag = await axe(dialog, WCAG_412);
    expect(wcag.violations.map((v) => v.id)).toContain('button-name');
    nameless.remove();

    // heading-order: an h4 after the dialog's title (Radix DialogTitle renders an h2), so h2 -> h4.
    const title = within(dialog).getByRole('heading', { name: DIALOG_NAME });
    expect(title.tagName).toBe('H2');
    const skipped = document.createElement('h4');
    skipped.textContent = 'Planted skipped level';
    title.after(skipped);
    const order = await axe(dialog, HEADING_ORDER);
    expect(order.violations.map((v) => v.id)).toContain('heading-order');
    skipped.remove();

    // With both plants removed the dialog is back to the case-1 tree, and both runs are clean again.
    expect(await axe(dialog, WCAG_412)).toHaveNoViolations();
    expect(await axe(dialog, HEADING_ORDER)).toHaveNoViolations();
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

describe('AvailabilityForm submit CTA — D-8 aria-disabled + latch (88.6-42)', () => {
  beforeEach(() => vi.clearAllMocks());
  // Added by plan 88.6-42 (owner-authorized addition, 2026-09-16), converting the one control
  // plan 25 deliberately left on native `disabled` because `tokenContrast` test 53(b2) flagged
  // the spinner arcs beside it. Plan 42 re-spelled those arcs as SVG presentation attributes
  // FIRST, then converted — so the gate's subject is gone rather than its rule bent.
  it('gates with aria-disabled and KEEPS the control focusable mid-submit', async () => {
    const user = userEvent.setup();
    let release: () => void = () => {};
    (availabilityFormAPI.submitResponse as Mock).mockImplementation(
      () => new Promise<void>((resolve) => {
        release = () => resolve();
      })
    );
    render(<AvailabilityForm magicToken="tok" userName="Sam" promptId="p1" />);
    await user.click(screen.getByRole("button", { name: /unavailable this week/i }));

    const cta = screen.getByRole('button', { name: /submit availability/i });
    await user.click(cta);

    await waitFor(() => expect(cta).toHaveAttribute('aria-disabled', 'true'));
    // THE POINT OF THE CONVERSION: a natively-disabled button leaves the tab order the instant
    // it disables and drops a keyboard user to <body> mid-submit. This one does not.
    expect(cta).not.toBeDisabled();
    expect(cta).not.toHaveAttribute('disabled');

    release();
  });

  it('the spinner arcs carry SVG `opacity` attributes, never the bare utility', async () => {
    // The blocker this conversion had to clear, pinned so re-introducing the utility spelling
    // reds HERE as well as in tokenContrast test 53(b2) — two independent layers, because the
    // gate's 400-character window is a heuristic and this one is exact.
    const user = userEvent.setup();
    (availabilityFormAPI.submitResponse as Mock).mockImplementation(
      () => new Promise(() => {})
    );
    const { container } = render(<AvailabilityForm magicToken="tok" userName="Sam" promptId="p1" />);
    await user.click(screen.getByRole("button", { name: /unavailable this week/i }));
    await user.click(screen.getByRole("button", { name: /submit availability/i }));

    const spinner = await waitFor(() => {
      const found = container.querySelector('svg.animate-spin');
      expect(found).not.toBeNull();
      return found as SVGElement;
    });
    expect(spinner.querySelector('circle')?.getAttribute('opacity')).toBe('0.25');
    expect(spinner.querySelector('path')?.getAttribute('opacity')).toBe('0.75');
    expect(spinner.innerHTML).not.toContain('opacity-25');
    expect(spinner.innerHTML).not.toContain('opacity-75');
  });
});
