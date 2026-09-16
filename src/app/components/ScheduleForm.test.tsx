// Per-form proof for PRIM-06: on a failed save, ScheduleForm must (a) render its
// inline submit-error UI (role="alert") AND (b) re-throw so handleAppSubmit's
// catch logs to logger.error -> Sentry (the reachable, tested Sentry path).
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
vi.mock('./GameComboInput', () => ({ default: () => <div data-testid="game-combo" /> }));
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
