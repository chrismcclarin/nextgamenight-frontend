/**
 * RENDER-level pins for `SuggestionCard.js` (Phase 88.6-42 task 3).
 *
 * WHY THIS FILE EXISTS, and why a grep would not have done (SPEC:101). This component's ground
 * comes from a FUNCTION RETURN — `getScoreColor()` — which is limitation 2 of `inkGroundPairs`,
 * the walk behind `groundInk.test.ts`. That walk therefore cannot see the pairing at all, which
 * is precisely why this file's `groundInk` roster UNDERCOUNTED it (one resolvable site on the
 * OFFENDERS roster, three invisible ones on a separate DECLARED-UNRESOLVABLE roster). A grep
 * over class strings would pin the same blind spot from the other side and prove nothing about
 * what actually renders. These assertions render the BELOW-THRESHOLD card — the branch that
 * actually produces the muted ground — and read the classes off the real tree.
 *
 * WHAT THIS FILE IS NOT. `SuggestionCard.js` has NO IMPORTER anywhere in `src/` and has been
 * unreachable since `HeatmapGrid` was superseded by `MergedHeatmapGrid` (before 2026-07-25; see
 * the `DECISION Phase 88.6-42 (D1)` marker at the component head for the corrected provenance).
 * So NOTHING here asserts a reachable user, and nothing here designs a user outcome — the owner
 * ruled arm (6), KEEP-MINIMAL, on 2026-09-13. These are GATE-HYGIENE pins: the ink, the size,
 * the weight and the two error-path defects, and nothing else.
 */
import * as React from 'react';
import { render, screen, cleanup, fireEvent, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const routerPush = vi.hoisted(() => vi.fn());
vi.mock('next/navigation', () => ({ useRouter: () => ({ push: routerPush }) }));
vi.mock('../components/TimezoneProvider', () => ({ useTimezone: () => ({ timezone: 'UTC' }) }));

// Only `suggestionAPI` is replaced; `importOriginal` keeps `ApiError` real so the error-path
// arms exercise the SHIPPED code-to-copy derivation rather than a stub of it.
vi.mock('@/lib/api', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/api')>();
  return { ...actual, suggestionAPI: { ...actual.suggestionAPI, convert: vi.fn() } };
});

import SuggestionCard from './SuggestionCard';
import { ApiError, suggestionAPI } from '@/lib/api';

type Mock = ReturnType<typeof vi.fn>;

/** propTypes declares onEventCreated a function; the component guards it anyway. */
const noop = () => {};

/** A suggestion BELOW the minimum threshold — the branch that yields the muted ground. */
const belowThreshold = {
  id: 'sug-1',
  suggested_start: '2026-02-01T18:00:00.000Z',
  suggested_end: '2026-02-01T21:00:00.000Z',
  participant_count: 2,
  preferred_count: 1,
  meets_minimum: false,
  converted_to_event_id: null,
};

const renderCard = (overrides: Record<string, unknown> = {}, props: Record<string, unknown> = {}) =>
  render(
    <SuggestionCard
      suggestion={{ ...belowThreshold, ...overrides }}
      groupId="g-1"
      isAdmin
      pollClosed={false}
      onEventCreated={noop}
      {...props}
    />
  );

beforeEach(() => {
  vi.clearAllMocks();
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe('SuggestionCard — D-16 ink on the function-returned ground (RENDER level, not grep)', () => {
  it('renders the below-threshold card on the MUTED ground — the precondition for every ink pin below', () => {
    // Anti-vacuity FIRST. If this branch ever stops producing `bg-surface-muted`, every
    // assertion below would still pass while measuring a ground that is not the one at issue.
    const { container } = renderCard();
    const root = container.firstElementChild as HTMLElement;
    expect(root.className).toContain('bg-surface-muted');
    expect(root.className).toContain('border-line');
  });

  it('the counter unit label is off `text-content-muted` (4.3725 -> 6.9620)', () => {
    renderCard();
    const unit = screen.getByText('players');
    expect(unit.className).toContain('text-content-secondary');
    expect(unit.className).not.toContain('text-content-muted');
    // …and the SIZE stays Caption 12: "counters" is an enumerated Caption role (UI-SPEC §4.2),
    // and this is the counter's unit label, so folding it up to 14 would be the wrong sweep.
    expect(unit.className).toContain('text-xs');
  });

  it('the below-threshold notice — LIVE text on the muted ground — is off `text-content-muted`', () => {
    renderCard();
    const notice = screen.getByText('Below minimum threshold');
    expect(notice.className).toContain('text-content-secondary');
    expect(notice.className).not.toContain('text-content-muted');
  });

  it('the already-converted line is off `text-content-link` (3.9909) — it was never a link', () => {
    renderCard({ converted_to_event_id: 'ev-9' });
    const line = screen.getByText('Already converted to event');
    expect(line.className).toContain('text-content-secondary');
    expect(line.className).not.toContain('text-content-link');
  });

  it('the DISABLED Create Event control is off `text-content-muted` too', async () => {
    // Swept for CONSISTENCY, not compliance: a disabled control is AA-exempt. `disabled` and
    // `cursor-not-allowed` are what say "disabled" here, never the contrast.
    (suggestionAPI.convert as Mock).mockReturnValue(new Promise(() => {}));
    renderCard();
    const button = screen.getByRole('button', { name: 'Create Event' });
    fireEvent.click(button);
    const spinning = await screen.findByRole('button', { name: 'Creating...' });
    expect(spinning).toBeDisabled();
    expect(spinning.className).toContain('text-content-secondary');
    expect(spinning.className).not.toContain('text-content-muted');
  });

  it('NO `text-content-muted` survives anywhere in the rendered card', () => {
    // The whole-file claim, stated positively at RENDER level so a class string that only
    // appears in a branch this suite does not name cannot hide.
    const { container } = renderCard({ converted_to_event_id: 'ev-9' });
    expect(container.innerHTML).not.toContain('text-content-muted');
    expect(container.innerHTML).not.toContain('text-content-link');
  });
});

describe('SuggestionCard — §4.3 / §4.5 size and weight outcomes', () => {
  it('the participant count is the pseudo-heading: text-xl / 700, and NOT a <Heading>', () => {
    const { container } = renderCard();
    const count = screen.getByText('2');
    expect(count.className).toContain('text-xl');
    expect(count.className).not.toContain('text-2xl');
    expect(count.className).toContain('font-bold');
    // It is a NUMBER, not a section title — migrating it onto the primitive would insert a
    // heading level into a card that has none, so the pseudo-heading treatment is deliberate.
    expect(container.querySelectorAll('h1,h2,h3,h4,h5,h6').length).toBe(0);
  });

  it('the EMPHASIS outcome: no off-scale weight (500/600) survives in the card', () => {
    const { container } = renderCard({ converted_to_event_id: 'ev-9' });
    expect(container.innerHTML).not.toContain('font-medium');
    expect(container.innerHTML).not.toContain('font-semibold');
    // The date line keeps its colour token, which is what carries the emphasis now.
    expect(container.innerHTML).toContain('text-content-primary');
  });
});

describe('SuggestionCard — the two error-path defects (A3 and D-31)', () => {
  it('A3: an UNPARSEABLE 2xx still reaches the else arm and renders REGISTER copy', async () => {
    // The else arm is NOT dead — this is the state that reaches it. `apiFetch` returns raw TEXT
    // for a 2xx it cannot parse, which satisfies neither `result.success` nor `result.event_id`.
    // Deleting the arm as "dead" would make the card silently do nothing here.
    (suggestionAPI.convert as Mock).mockResolvedValue('<html>gateway</html>');
    renderCard();
    fireEvent.click(screen.getByRole('button', { name: 'Create Event' }));
    expect(
      await screen.findByText('Something went wrong. Refresh the page to try again.')
    ).toBeInTheDocument();
    // No authored `Failed to X` literal survives on this path.
    expect(screen.queryByText(/Failed to create event/)).toBeNull();
  });

  it('A3: a 201 success body still navigates — the guard that WAS real is untouched', async () => {
    (suggestionAPI.convert as Mock).mockResolvedValue({
      success: true,
      event_id: 'ev-42',
      message: 'Created',
      event: {},
    });
    renderCard();
    fireEvent.click(screen.getByRole('button', { name: 'Create Event' }));
    await waitFor(() => expect(routerPush).toHaveBeenCalledWith('/groups/g-1/events/ev-42'));
  });

  it('D-31: a thrown ApiError renders DERIVED copy from its code, never `err.message`', async () => {
    (suggestionAPI.convert as Mock).mockRejectedValue(
      new ApiError('pg: duplicate key value violates unique constraint', 'internal', 500)
    );
    renderCard();
    fireEvent.click(screen.getByRole('button', { name: 'Create Event' }));
    expect(
      await screen.findByText('Something went wrong on our end. Please try again shortly.')
    ).toBeInTheDocument();
    // The upstream string must never reach the DOM — that is the whole of T-88-25-01.
    expect(screen.queryByText(/duplicate key/)).toBeNull();
  });

  it('D-31: a code-less failure falls to the register generic line, with no authored fallback', async () => {
    (suggestionAPI.convert as Mock).mockRejectedValue(new TypeError('Failed to fetch'));
    renderCard();
    fireEvent.click(screen.getByRole('button', { name: 'Create Event' }));
    expect(
      await screen.findByText('Something went wrong. Refresh the page to try again.')
    ).toBeInTheDocument();
  });
});
