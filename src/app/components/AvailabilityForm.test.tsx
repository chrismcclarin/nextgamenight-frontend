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

    await waitFor(() => {
      expect(screen.getByRole('alert')).toHaveTextContent(/network down|failed to submit/i);
    });
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
