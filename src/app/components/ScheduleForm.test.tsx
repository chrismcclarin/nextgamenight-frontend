// Per-form proof for PRIM-06: on a failed save, ScheduleForm must (a) render its
// inline submit-error UI (role="alert") AND (b) re-throw so handleAppSubmit's
// catch logs to logger.error -> Sentry (the reachable, tested Sentry path).
import * as React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, cleanup, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

vi.mock('@/lib/logger', () => ({
  logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn() },
}));
// Plan 88.6-32: `importOriginal` + spread, NOT the full-replacement factory this used to be.
// `onSubmit` now derives its copy through `getFetchErrorMessage`, and `deriveCode` resolves the
// code with `error instanceof ApiError` (`useFetchErrorState.ts:116`). A full replacement
// DELETES `ApiError` from this module, and `x instanceof undefined` is a TypeError — so the
// old factory would have turned a correct migration into a crash inside the catch.
vi.mock('../../lib/api', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../lib/api')>()),
  promptSettingsAPI: {
    createSchedule: vi.fn().mockRejectedValue(new Error('Server boom')),
    updateSchedule: vi.fn(),
  },
}));
vi.mock('@auth0/nextjs-auth0/client', () => ({ useUser: () => ({ user: null }) }));
// ScheduleForm consumes useSelfIdentity (87.5-11: feeds selfUuid to GameComboInput's
// searchAll). That hook calls react-query's useQuery, which needs a QueryClientProvider
// this focused submit-error test does not mount. Mock it (identity is irrelevant here).
vi.mock('../../lib/hooks/useSelfIdentity', () => ({
  useSelfIdentity: () => ({ selfUuid: undefined, self: undefined }),
}));
// Phase 88.6-44: a FAITHFUL stand-in, not a bare div. It renders exactly what the real
// `GameComboInput` forwards to its text input (`GameComboInput.js:215-235`: `id`, `name`,
// `aria-label={placeholder}`, the external `inputRef`), so the composed audit below sees what
// THIS FORM passes — which is what the house-rule finding on this surface was about. The real
// combobox's own ARIA is pinned by `Combobox.test.tsx`'s axe audit; mounting it here would add
// floating-ui + a search debounce to every test in this file for no additional signal.
vi.mock('./GameComboInput', () => ({
  default: ({
    id,
    name,
    placeholder,
    inputRef,
  }: {
    id?: string;
    name?: string;
    placeholder?: string;
    inputRef?: { current: HTMLInputElement | null };
  }) => (
    <input
      type="text"
      id={id}
      name={name}
      aria-label={placeholder || 'Search for a game or type a name'}
      ref={(node) => {
        if (inputRef) inputRef.current = node;
      }}
      data-testid="game-combo"
    />
  ),
}));
// Render the received selection so tests can observe what the form actually
// holds (IN-04 late-roster re-seed) without reaching into form internals.
vi.mock('./MemberSelector', () => ({
  default: ({ selectedMemberIds }: { selectedMemberIds?: string[] }) => (
    <div data-testid="member-selector">{(selectedMemberIds ?? []).join(',')}</div>
  ),
}));

import type { ComponentType } from 'react';
import ScheduleFormDefault from './ScheduleForm';
import { logger } from '@/lib/logger';

// ScheduleForm is a JS component; its inferred prop type marks every prop
// required. Cast to a permissive type so the test can render with only the
// props it exercises.
const ScheduleForm = ScheduleFormDefault as unknown as ComponentType<{
  groupId?: string;
  members?: Array<{ id: string; username?: string }>;
  onCancel?: () => void;
}>;

afterEach(cleanup);

describe('ScheduleForm submit-error path', () => {
  beforeEach(() => vi.clearAllMocks());

  // Plan 88.6-32 (R1 / T-88.6-89) REWROTE this arm's copy expectation and added the
  // one-node half. It used to accept `/server boom|failed to save/i` — the `server boom`
  // alternative is precisely the raw upstream leak this phase closes, and `failed to save` is
  // the hand-rolled copy the register replaced, so BOTH alternatives are now defects rather
  // than acceptable outcomes. The rejection here carries no `ApiError` code, so the register
  // resolves `unknown`; that string is asserted as a literal because `MESSAGE_BY_CODE` is
  // module-private by design and must not be exported to make an assertion importable.
  const UNKNOWN_COPY = 'Something went wrong. Refresh the page to try again.';

  it('on a failed save renders the inline error (role=alert) AND logs via logger.error', async () => {
    const user = userEvent.setup();
    render(<ScheduleForm groupId="g1" />);

    await user.click(screen.getByRole('button', { name: /create schedule/i }));

    await waitFor(() => {
      expect(screen.getByRole('alert')).toHaveTextContent(UNKNOWN_COPY);
    });
    expect(screen.queryByText(/server boom/i)).toBeNull();
    expect(logger.error).toHaveBeenCalledWith('form submit failed', expect.any(Error));
  });

  it('leaves EXACTLY ONE error node in the DOM after a failed submit', async () => {
    // This catch used to write BOTH `setServerError` and `setError('root', …)`, rendered in
    // byte-identical boxes one line apart — so deriving both from one `getFetchErrorMessage`
    // call would have printed the same ratified sentence twice, once announced and once
    // silent. The pair is collapsed; `serverError` is the survivor and it is the one that
    // already carried `role="alert"`.
    const user = userEvent.setup();
    render(<ScheduleForm groupId="g1" />);

    await user.click(screen.getByRole('button', { name: /create schedule/i }));
    await waitFor(() => expect(screen.getByRole('alert')).toBeInTheDocument());

    expect(screen.getAllByText(UNKNOWN_COPY)).toHaveLength(1);
    expect(screen.getAllByRole('alert')).toHaveLength(1);
  });
});

// IN-04 (87.5 review): create-mode member defaults are captured at mount. If the
// form mounts before the roster fetch resolves (members=[]) the all-members
// default seeded empty and stayed empty forever — a schedule silently scoped to
// nobody. The fix re-seeds exactly once when the roster transitions
// empty→populated and nothing is selected.
describe('ScheduleForm create-mode late-roster re-seed (IN-04)', () => {
  beforeEach(() => vi.clearAllMocks());

  const ROSTER = [
    { id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', username: 'ada' },
    { id: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', username: 'bob' },
  ];

  it('re-seeds the all-members default when the roster resolves AFTER mount', async () => {
    const { rerender } = render(<ScheduleForm groupId="g1" members={[]} />);
    // Pre-resolution: MemberSelector is not even rendered (members.length gate).
    expect(screen.queryByTestId('member-selector')).toBeNull();

    rerender(<ScheduleForm groupId="g1" members={ROSTER} />);

    await waitFor(() => {
      expect(screen.getByTestId('member-selector')).toHaveTextContent(
        ROSTER.map((m) => m.id).join(',')
      );
    });
  });

  it('does NOT overwrite a roster provided at mount (defaults already correct)', () => {
    render(<ScheduleForm groupId="g1" members={ROSTER} />);
    expect(screen.getByTestId('member-selector')).toHaveTextContent(
      ROSTER.map((m) => m.id).join(',')
    );
  });
});

// ---------------------------------------------------------------------------
// Phase 88.6-44 (R7 / AC-7, UI-SPEC §7.5) — the composed axe audit, after this surface's LAST
// migration commit (plan 88.6-32's `e9ac345`; `git log -1 -- ScheduleForm.js` re-checked at
// execution). THIS SURFACE HAS NO `matchMedia` FORK: neither `ScheduleForm.js` nor anything it
// renders (`Modal`, `FormField`, `Input`, `SelectControl`, `Button`) calls `matchMedia` — the only
// non-test callers in `src/` are `EventScheduler.tsx`, `createEvent.js` and `gameDetail/page.js`
// (measured 2026-09-22). One tree, one run per rule set, no resize.
//
// The house rule is asserted HERE because `formLabels.audit.test.tsx` never covered this form —
// its roster is fixed (`GroupGamesList`, `GroupLibrary`, `BrowseMoreModal`, `StartPollModal`,
// `MemberSelector`, `ParticipantRow`) and axe's `label` rule cannot stand in for id/name.
// `MemberSelector` is stubbed in this file (its own real checkboxes are in that roster).
// ---------------------------------------------------------------------------
import { axe } from 'vitest-axe';
import { auditFormControls } from '../../test-utils/formControlAudit';

const WCAG_412 = { runOnly: { type: 'tag' as const, values: ['wcag412'] } };
const HEADING_ORDER = { runOnly: { type: 'rule' as const, values: ['heading-order'] } };

/** A real trigger + the consumer's mount shape (`PromptScheduleManager` mounts the form on demand). */
function AuditHost() {
  const [open, setOpen] = React.useState(false);
  return (
    <>
      <button type="button" onClick={() => setOpen(true)}>
        + New Schedule
      </button>
      {open && <ScheduleForm groupId="g1" onCancel={() => setOpen(false)} />}
    </>
  );
}

describe('ScheduleForm — R7 composed axe audit + house rule + focus contract (88.6-44)', () => {
  beforeEach(() => vi.clearAllMocks());

  it('1. the dialog passes WCAG 4.1.2 and heading-order (one composed run each; no media-query fork)', async () => {
    render(<ScheduleForm groupId="g1" />);
    // Settle on a branch-specific control, not the header.
    await screen.findByRole('combobox', { name: 'Day of Week' });
    const dialog = screen.getByRole('dialog');
    expect(await axe(dialog, WCAG_412)).toHaveNoViolations();
    expect(await axe(dialog, HEADING_ORDER)).toHaveNoViolations();
  });

  it('2. every form control carries id + name + a label source (house rule Input.tsx:11-19)', async () => {
    render(<ScheduleForm groupId="g1" />);
    await screen.findByRole('combobox', { name: 'Day of Week' });
    const dialog = screen.getByRole('dialog');
    auditFormControls(dialog);
    // The finding this surface HAD (pre-fix: no id, no name, an orphan "Game" label): the game
    // input is now wired exactly like createEvent's, and the visible label points at it.
    const game = screen.getByTestId('game-combo');
    expect(game).toHaveAttribute('id', 'schedule-game-name');
    expect(game).toHaveAttribute('name', 'schedule-game-name');
    expect(dialog.querySelector('label[for="schedule-game-name"]')).toHaveTextContent('Game');
  });

  it('3. focus: on OPEN the passed initialFocusRef target (Day of Week) holds focus; on CLOSE the NAMED trigger does', async () => {
    const user = userEvent.setup();
    render(<AuditHost />);
    const trigger = screen.getByRole('button', { name: '+ New Schedule' });
    trigger.focus();
    await user.click(trigger);
    const dialog = await screen.findByRole('dialog');
    const dayOfWeek = screen.getByRole('combobox', { name: 'Day of Week' });
    // `ScheduleForm.js` passes `initialFocusRef={dayOfWeekRef}` — the NAMED target, not merely
    // "somewhere inside".
    await waitFor(() => expect(document.activeElement).toBe(dayOfWeek));
    expect(dialog.contains(document.activeElement)).toBe(true);

    await user.keyboard('{Escape}');
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    // NAMED identity, never "not body": a bare open-from-mount render lands on <body> correctly.
    await waitFor(() => expect(document.activeElement).toBe(trigger));
  });
});
