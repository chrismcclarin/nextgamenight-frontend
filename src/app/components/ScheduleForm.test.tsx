// Per-form proof for PRIM-06: on a failed save, ScheduleForm must (a) render its
// inline submit-error UI (role="alert") AND (b) re-throw so handleAppSubmit's
// catch logs to logger.error -> Sentry (the reachable, tested Sentry path).
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, cleanup, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

vi.mock('@/lib/logger', () => ({
  logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn() },
}));
vi.mock('../../lib/api', () => ({
  promptSettingsAPI: {
    createSchedule: vi.fn().mockRejectedValue(new Error('Server boom')),
    updateSchedule: vi.fn(),
  },
}));
vi.mock('@auth0/nextjs-auth0/client', () => ({ useUser: () => ({ user: null }) }));
vi.mock('./GameComboInput', () => ({ default: () => <div data-testid="game-combo" /> }));
vi.mock('./MemberSelector', () => ({ default: () => <div data-testid="member-selector" /> }));

import ScheduleForm from './ScheduleForm';
import { logger } from '@/lib/logger';

afterEach(cleanup);

describe('ScheduleForm submit-error path', () => {
  beforeEach(() => vi.clearAllMocks());

  it('on a failed save renders the inline error (role=alert) AND logs via logger.error', async () => {
    const user = userEvent.setup();
    render(<ScheduleForm groupId="g1" />);

    await user.click(screen.getByRole('button', { name: /create schedule/i }));

    await waitFor(() => {
      expect(screen.getByRole('alert')).toHaveTextContent(/server boom|failed to save/i);
    });
    expect(logger.error).toHaveBeenCalledWith('form submit failed', expect.any(Error));
  });
});
