// Axe audit for BrowseMoreModal after its migration onto the shared <Modal>
// primitive at size="lg" (PRIM-02). BrowseMoreModal is the wide (max-w-4xl)
// modal with a sticky filter/sort toolbar pinned over a scrollable suggestion
// grid. This pins the migrated modal to the Radix a11y contract: role=dialog +
// zero axe violations rendered open.
//
// Line comments only in this file: a block comment holding a backtick or a closing token makes
// vitest collect ZERO tests here while reporting green (FE-TESTING-CONVENTIONS CF-9).
import * as React from 'react';
import { act, render, screen, cleanup, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { axe } from 'vitest-axe';
import BrowseMoreModal from './BrowseMoreModal';
import { ApiError } from '../../lib/api';
import { getFetchErrorMessage } from '../../components/ui/useFetchErrorState';

// suggestionsAPI fires on open; by default it resolves to an empty result so the modal settles
// into its (library-empty) state without touching network. Plan 88.6.1-32: the two functions are
// HOISTED handles so each arm can hold, resolve or reject an individual request.
//
// Plan 88.6-32: `importOriginal` + spread, NOT the full-replacement factory this used to be.
// The component's error branch now calls `getFetchErrorMessage`, which derives its code via
// `error instanceof ApiError` (`useFetchErrorState.ts:116`) — and a full replacement DELETES
// `ApiError` from the module, so that check would throw or silently never match. The same
// idiom, and the same reason, as `friends/page.backendDown.test.tsx`.
const api = vi.hoisted(() => ({
  getGroupSuggestions: vi.fn(),
  getEventSuggestions: vi.fn(),
}));
vi.mock('../../lib/api', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../lib/api')>()),
  suggestionsAPI: api,
}));

beforeEach(() => {
  api.getGroupSuggestions.mockReset();
  api.getEventSuggestions.mockReset();
  api.getGroupSuggestions.mockResolvedValue({ suggestions: [] });
  api.getEventSuggestions.mockResolvedValue({ suggestions: [] });
});

afterEach(cleanup);

const baseProps = {
  open: true,
  onClose: vi.fn(),
  groupId: 'group-1',
  defaultPlayerCount: 4,
  onSelectGame: vi.fn(),
};

describe('BrowseMoreModal (migrated onto <Modal size="lg">)', () => {
  it('renders as role=dialog when open', async () => {
    render(<BrowseMoreModal {...baseProps} />);
    expect(await screen.findByRole('dialog')).toBeInTheDocument();
  });

  it('passes an axe audit with no violations', async () => {
    render(<BrowseMoreModal {...baseProps} />);
    const dialog = await screen.findByRole('dialog');
    // Let the open-fetch resolve so the empty state (not the loading text) is
    // what axe audits.
    await waitFor(() =>
      expect(
        screen.getByText(/add games to your collection/i)
      ).toBeInTheDocument()
    );
    expect(await axe(dialog)).toHaveNoViolations();
  });

  // Plan 88.6-32 (R2). The library-empty CTA migrated from
  // `<Link className="btn btn-primary …">` to `<Button asChild variant="primary"><Link …>`.
  // WITHOUT `asChild` (`Button.tsx:113`) `Button` renders a real `<button>` and this CTA
  // silently stops navigating — and the two assertions that already existed here matched its
  // TEXT only, so both would have stayed green on exactly that regression. Role + href is the
  // pair that catches it: `role=link` dies if the element becomes a `<button>`, and `href`
  // dies if `asChild` is present but the `<Link>`'s props are dropped.
  it('keeps the library-empty CTA a real link to /userProfile (asChild, not a dead button)', async () => {
    render(<BrowseMoreModal {...baseProps} />);
    await screen.findByRole('dialog');
    const cta = await screen.findByRole('link', {
      name: /add games to your collection/i,
    });
    expect(cta).toHaveAttribute('href', '/userProfile');
    // The `.btn` class is gone and the primitive's own base is on the element — the migration
    // must not leave both expressions of the same styling behind.
    expect(cta).toHaveClass('btn');
    expect(cta.className).not.toMatch(/\binline-block\b/);
    // Nothing named this way is a <button>: queryByRole('button', …) must find nothing.
    expect(
      screen.queryByRole('button', { name: /add games to your collection/i })
    ).toBeNull();
  });

  // Plan 88.6-32 (D-10 / AC-10). The two 32x32 player-count steppers are the phase's ONLY
  // permanent `.btn` exemption: they stay raw `.btn btn-compact` rather than becoming
  // `<Button>`, and under plan 05's ARM A they carry the house focus ring in its INSET form
  // (never `ring-offset-2` — an offset ring on a 32px square in a tight toolbar paints into
  // its twin). Pinned so a later "consistency" sweep cannot migrate them or swap the ring form
  // without reading the markers at the site.
  it('leaves both player-count steppers on `.btn-compact` with an INSET focus ring', async () => {
    render(<BrowseMoreModal {...baseProps} />);
    await screen.findByRole('dialog');
    for (const name of [/decrease player count/i, /increase player count/i]) {
      const stepper = screen.getByRole('button', { name });
      expect(stepper).toHaveClass('btn-compact');
      expect(stepper).toHaveClass('focus-visible:ring-inset');
      expect(stepper.className).not.toMatch(/focus-visible:ring-offset-/);
      // The exemption is about SIZE — 32x32, above WCAG 2.5.8's 24px floor.
      expect(stepper).toHaveClass('w-8');
      expect(stepper).toHaveClass('h-8');
    }
  });
});

// ---------------------------------------------------------------------------------------------
// Plan 88.6.1-32 (D-09, D-41, AC-27, copy row E8). After the FIRST SUCCESSFUL load a refresh
// never returns to the loading branch: the previous cards (or the settled empty state) stay as
// the same DOM nodes, the results wrapper is aria-busy, and the always-mounted polite region in
// the reserved toolbar slot says copy row E8. A failed refresh over kept cards keeps them and
// puts the register's failure line in the slot's assertive region; a failed first load (and a
// failed refresh over an EMPTY result, owner ruling D11 (b)) shows it in the body as a keyed,
// inserted alert paragraph, never doubled. The real GameSuggestionCard renders (plan 88.6.1-03:
// a native button named by the game's name); no card mock.
// ---------------------------------------------------------------------------------------------

// Copy row E8, byte-equal to the copy table (the single U+2026 glyph, not three dots).
const UPDATING = 'Updating suggestions…';
const FIRST_LOAD_LINE = 'Loading suggestions...';
const LIBRARY_EMPTY = "Your group hasn't added any games to its collections yet.";
const FILTERS_EMPTY = 'No games match these filters. Try widening your selection.';

type SuggestionGame = {
  id: string;
  name: string;
  thumbnail_url?: string | null;
  min_players?: number | null;
  max_players?: number | null;
  playing_time?: number | null;
  weight?: number | null;
  owners?: string[];
  avg_group_rating?: number | null;
  review_count?: number | null;
};
type SuggestionsResponse = { suggestions: SuggestionGame[] };

function game(id: string, name: string, weight: number): SuggestionGame {
  return {
    id,
    name,
    thumbnail_url: null,
    min_players: 2,
    max_players: 4,
    playing_time: 45,
    weight,
    owners: [],
    avg_group_rating: null,
  };
}
const CATAN = game('00000000-0000-4000-8000-000000000001', 'Catan', 2.3);
const AZUL = game('00000000-0000-4000-8000-000000000002', 'Azul', 1.8);
const CARCASSONNE = game('00000000-0000-4000-8000-000000000003', 'Carcassonne', 1.9);
const ROOT = game('00000000-0000-4000-8000-000000000004', 'Root', 3.7);
const WINGSPAN = game('00000000-0000-4000-8000-000000000005', 'Wingspan', 2.4);

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

function networkError() {
  return new ApiError('SECRET-UPSTREAM-TEXT', 'network', 0);
}

function slotRegions() {
  const slot = screen.getByTestId('browse-more-status');
  return {
    polite: within(slot).getByRole('status'),
    assertive: within(slot).getByRole('alert'),
  };
}

// Renders the dialog and lets its first load settle with the given games.
async function renderSettled(games: SuggestionGame[]) {
  api.getGroupSuggestions.mockResolvedValueOnce({ suggestions: games });
  const utils = render(<BrowseMoreModal {...baseProps} />);
  if (games.length > 0) {
    await screen.findByRole('button', { name: games[0].name });
  } else {
    await screen.findByRole('link', { name: /add games to your collection/i });
  }
  return utils;
}

function holdNext() {
  const d = deferred<SuggestionsResponse>();
  api.getGroupSuggestions.mockReturnValueOnce(d.promise);
  return d;
}

describe('BrowseMoreModal refresh keeps the list (88.6.1-32, D-09, D-41, AC-27, E8)', () => {
  it('A: the first load shows the first-load line, the list is busy, both slot regions are empty', async () => {
    const d1 = holdNext();
    render(<BrowseMoreModal {...baseProps} />);
    expect(await screen.findByText(FIRST_LOAD_LINE)).toBeInTheDocument();
    expect(screen.getByTestId('browse-more-results')).toHaveAttribute('aria-busy', 'true');
    const { polite, assertive } = slotRegions();
    expect(polite.textContent).toBe('');
    expect(assertive.textContent).toBe('');
    await act(async () => {
      d1.resolve({ suggestions: [CATAN, AZUL] });
    });
    expect(await screen.findByRole('button', { name: 'Catan' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Azul' })).toBeInTheDocument();
    expect(screen.getByTestId('browse-more-results')).not.toHaveAttribute('aria-busy');
  });

  it('B: a refresh keeps the same card nodes, marks the list busy and says copy row E8 in the slot', async () => {
    const user = userEvent.setup();
    await renderSettled([CATAN, AZUL]);
    const catan = screen.getByRole('button', { name: 'Catan' });
    const { polite, assertive } = slotRegions();
    const callsBefore = api.getGroupSuggestions.mock.calls.length;
    const d2 = holdNext();
    await user.click(screen.getByRole('button', { name: 'Increase player count' }));
    // Positive signal first (CF-26), then the absences.
    await waitFor(() => expect(polite.textContent).toBe(UPDATING));
    expect(screen.queryByText(FIRST_LOAD_LINE)).toBeNull();
    expect(screen.getByRole('button', { name: 'Catan' })).toBe(catan);
    const results = screen.getByTestId('browse-more-results');
    expect(results).toHaveAttribute('aria-busy', 'true');
    // aria-busy sits on the list only, never on (or above) a live region.
    expect(polite.closest('[aria-busy]')).toBeNull();
    expect(assertive.closest('[aria-busy]')).toBeNull();
    expect(api.getGroupSuggestions.mock.calls.length).toBe(callsBefore + 1);
    await act(async () => {
      d2.resolve({ suggestions: [CATAN, CARCASSONNE] });
    });
    expect(await screen.findByRole('button', { name: 'Carcassonne' })).toBeInTheDocument();
    expect(slotRegions().polite).toBe(polite);
    expect(polite.textContent).toBe('');
    expect(screen.getByTestId('browse-more-results')).not.toHaveAttribute('aria-busy');
  });

  it('C1: latest wins when the OLDER refresh resolves first', async () => {
    const user = userEvent.setup();
    await renderSettled([CATAN, AZUL]);
    const { polite } = slotRegions();
    const d1 = holdNext();
    const d2 = holdNext();
    const inc = screen.getByRole('button', { name: 'Increase player count' });
    await user.click(inc);
    await user.click(inc);
    await waitFor(() => expect(polite.textContent).toBe(UPDATING));
    await act(async () => {
      d1.resolve({ suggestions: [ROOT] });
    });
    expect(polite.textContent).toBe(UPDATING);
    expect(screen.getByRole('button', { name: 'Catan' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Root' })).toBeNull();
    await act(async () => {
      d2.resolve({ suggestions: [WINGSPAN] });
    });
    expect(await screen.findByRole('button', { name: 'Wingspan' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Root' })).toBeNull();
    expect(polite.textContent).toBe('');
  });

  it('C2: latest wins when the NEWER refresh resolves first', async () => {
    const user = userEvent.setup();
    await renderSettled([CATAN, AZUL]);
    const { polite } = slotRegions();
    const d1 = holdNext();
    const d2 = holdNext();
    const inc = screen.getByRole('button', { name: 'Increase player count' });
    await user.click(inc);
    await user.click(inc);
    await waitFor(() => expect(polite.textContent).toBe(UPDATING));
    await act(async () => {
      d2.resolve({ suggestions: [WINGSPAN] });
    });
    expect(await screen.findByRole('button', { name: 'Wingspan' })).toBeInTheDocument();
    expect(polite.textContent).toBe('');
    await act(async () => {
      d1.resolve({ suggestions: [ROOT] });
    });
    expect(screen.getByRole('button', { name: 'Wingspan' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Root' })).toBeNull();
  });

  it('D: a failed refresh keeps the cards and puts the register line in the slot alert, on the same node', async () => {
    const user = userEvent.setup();
    await renderSettled([CATAN, AZUL]);
    const catan = screen.getByRole('button', { name: 'Catan' });
    const { polite, assertive } = slotRegions();
    const err = networkError();
    const line = getFetchErrorMessage(err);
    api.getGroupSuggestions.mockRejectedValueOnce(err);
    await user.click(screen.getByRole('button', { name: 'Increase player count' }));
    await waitFor(() => expect(assertive.textContent).toBe(line));
    expect(slotRegions().assertive).toBe(assertive);
    expect(screen.getByRole('button', { name: 'Catan' })).toBe(catan);
    expect(polite.textContent).toBe('');
    expect(screen.queryByText(LIBRARY_EMPTY)).toBeNull();
    expect(screen.queryByText(FILTERS_EMPTY)).toBeNull();
    expect(document.body.textContent).not.toContain('SECRET-UPSTREAM-TEXT');
    // The next refresh empties the alert on the same node and shows E8.
    const d3 = holdNext();
    await user.click(screen.getByRole('button', { name: 'Increase player count' }));
    await waitFor(() => expect(polite.textContent).toBe(UPDATING));
    expect(slotRegions().assertive).toBe(assertive);
    expect(assertive.textContent).toBe('');
    // A second identical failure sets the line again on the same node.
    await act(async () => {
      d3.reject(networkError());
    });
    await waitFor(() => expect(assertive.textContent).toBe(line));
    expect(slotRegions().assertive).toBe(assertive);
    expect(screen.getByRole('button', { name: 'Catan' })).toBe(catan);
  });

  it('D2: a failed refresh over an EMPTY result shows the body alert only, no empty state (owner ruling D11 (b))', async () => {
    const user = userEvent.setup();
    await renderSettled([]);
    const link = screen.getByRole('link', { name: /add games to your collection/i });
    const err = networkError();
    const line = getFetchErrorMessage(err);
    api.getGroupSuggestions.mockRejectedValueOnce(err);
    await user.click(screen.getByRole('button', { name: 'Increase player count' }));
    // Positive first: the failure text is on screen.
    await waitFor(() => expect(screen.getAllByText(line).length).toBeGreaterThan(0));
    const results = screen.getByTestId('browse-more-results');
    // Found by its TEXT inside the results; never a bare alert-role query (the empty slot
    // region is also an alert, and an alert takes no name from its content).
    expect(within(results).getByText(line)).toHaveAttribute('role', 'alert');
    expect(slotRegions().assertive.textContent).toBe('');
    expect(screen.queryByText(LIBRARY_EMPTY)).toBeNull();
    expect(screen.queryByText(FILTERS_EMPTY)).toBeNull();
    expect(screen.queryByRole('link', { name: /add games to your collection/i })).toBeNull();
    expect(screen.queryByRole('button', { name: /reset filters/i })).toBeNull();
    expect(link.isConnected).toBe(false);
    // Single-alert invariant: exactly one element carries the line as its own text.
    expect(screen.getAllByText(line)).toHaveLength(1);
  });

  it('E: a failed FIRST load inserts a new keyed alert paragraph in the body, never doubled in the slot', async () => {
    const user = userEvent.setup();
    const d1 = holdNext();
    render(<BrowseMoreModal {...baseProps} />);
    const loading1 = await screen.findByText(FIRST_LOAD_LINE);
    const err = networkError();
    const line = getFetchErrorMessage(err);
    await act(async () => {
      d1.reject(err);
    });
    const results = screen.getByTestId('browse-more-results');
    const failure1 = await within(results).findByText(line);
    expect(failure1).toHaveAttribute('role', 'alert');
    expect(failure1).not.toBe(loading1);
    expect(loading1.isConnected).toBe(false);
    expect(screen.queryByRole('button', { name: 'Catan' })).toBeNull();
    expect(screen.queryByText(LIBRARY_EMPTY)).toBeNull();
    expect(screen.queryByText(FILTERS_EMPTY)).toBeNull();
    expect(slotRegions().assertive.textContent).toBe('');
    // A filter change after a failed first load is a first load again, not a refresh.
    const d2 = holdNext();
    await user.click(screen.getByRole('button', { name: 'Increase player count' }));
    const loading2 = await screen.findByText(FIRST_LOAD_LINE);
    expect(slotRegions().polite.textContent).toBe('');
    await act(async () => {
      d2.reject(networkError());
    });
    const failure2 = await within(screen.getByTestId('browse-more-results')).findByText(line);
    expect(failure2).toHaveAttribute('role', 'alert');
    expect(failure2).not.toBe(loading2);
    expect(loading2.isConnected).toBe(false);
    expect(slotRegions().assertive.textContent).toBe('');
  });

  it('F: a settled empty state stays as the same node while a refresh is in flight', async () => {
    const user = userEvent.setup();
    await renderSettled([]);
    const link = screen.getByRole('link', { name: /add games to your collection/i });
    const { polite } = slotRegions();
    holdNext();
    await user.click(screen.getByRole('button', { name: 'Increase player count' }));
    await waitFor(() => expect(polite.textContent).toBe(UPDATING));
    expect(screen.getByRole('link', { name: /add games to your collection/i })).toBe(link);
    expect(screen.queryByText(FIRST_LOAD_LINE)).toBeNull();
  });

  it('D3: a tier tap does not flip the empty-state variant before the server answers (D11 (a))', async () => {
    const user = userEvent.setup();
    await renderSettled([]);
    const link = screen.getByRole('link', { name: /add games to your collection/i });
    const { polite } = slotRegions();
    const d2 = holdNext();
    await user.click(screen.getByRole('button', { name: 'Light' }));
    await waitFor(() => expect(polite.textContent).toBe(UPDATING));
    expect(screen.getByRole('link', { name: /add games to your collection/i })).toBe(link);
    expect(screen.queryByText(FILTERS_EMPTY)).toBeNull();
    await act(async () => {
      d2.resolve({ suggestions: [] });
    });
    expect(await screen.findByText(FILTERS_EMPTY)).toBeInTheDocument();
  });

  it('G: closing and reopening shows the last cards with copy row E8, never the first-load line', async () => {
    const { rerender } = await renderSettled([CATAN, AZUL]);
    rerender(<BrowseMoreModal {...baseProps} open={false} />);
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    holdNext();
    rerender(<BrowseMoreModal {...baseProps} open />);
    // A new card node is fine here: Radix remounts the dialog content on reopen.
    expect(await screen.findByRole('button', { name: 'Catan' })).toBeInTheDocument();
    await waitFor(() => expect(slotRegions().polite.textContent).toBe(UPDATING));
    expect(screen.queryByText(FIRST_LOAD_LINE)).toBeNull();
  });
});
