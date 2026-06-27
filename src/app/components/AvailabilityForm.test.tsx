// Per-form proof for PRIM-06: on a failed submit, AvailabilityForm must (a) render
// its inline submit-error UI (role="alert") AND (b) re-throw so handleAppSubmit's
// catch logs to logger.error -> Sentry (the reachable, tested Sentry path).
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, cleanup, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

vi.mock('@/lib/logger', () => ({
  logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn() },
}));
vi.mock('@/lib/api', () => ({
  availabilityFormAPI: {
    submitResponse: vi.fn().mockRejectedValue(new Error('Network down')),
    prefillFromGcal: vi.fn(),
    prefillFromSaved: vi.fn(),
  },
}));
vi.mock('./AvailabilityGrid', () => ({ default: () => <div data-testid="grid" /> }));

import AvailabilityForm from './AvailabilityForm';
import { logger } from '@/lib/logger';

afterEach(cleanup);

describe('AvailabilityForm submit-error path', () => {
  beforeEach(() => vi.clearAllMocks());

  it('on a failed submit renders the inline error (role=alert) AND logs via logger.error', async () => {
    const user = userEvent.setup();
    render(<AvailabilityForm magicToken="tok" userName="Sam" promptId="p1" />);

    // is_unavailable=true satisfies the cross-field refine without painting slots.
    await user.click(screen.getByRole('button', { name: /unavailable this week/i }));
    await user.click(screen.getByRole('button', { name: /submit availability/i }));

    await waitFor(() => {
      expect(screen.getByRole('alert')).toHaveTextContent(/network down|failed to submit/i);
    });
    expect(logger.error).toHaveBeenCalledWith('form submit failed', expect.any(Error));
  });
});
