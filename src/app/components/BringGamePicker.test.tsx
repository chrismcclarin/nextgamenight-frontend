// Phase 88.6-44 (R7 / AC-7, UI-SPEC §7.5) — the FIRST test file this surface has ever had.
//
// Three things live here, and the order matters for anyone extending it:
//
//   1. The composed axe audit (WCAG 4.1.2 + `heading-order`) scoped to the rendered
//      `role="dialog"`, run after this surface's last migration commit (plan 88.6-33's
//      `6410449`). ONE composed jsdom run per rule set per branch. THIS SURFACE HAS NO
//      `matchMedia` FORK: `BringGamePicker.js` never calls `matchMedia`, and neither does
//      anything in its rendered tree (`Modal`, `Input`, `Button`, `StatusRegion`, `SafeImage`
//      — measured 2026-09-22: the only non-test callers in `src/` are `EventScheduler.tsx`,
//      `createEvent.js` and `gameDetail/page.js`). So there is exactly one tree to audit, and no
//      stub is installed. A resize would measure nothing (jsdom has no layout, both rules are
//      viewport-independent) and is deliberately not performed.
//
//   2. The five defects axe CANNOT see (axe-core 4.12.1 has no rule for any of them), asserted
//      directly: the rows' programmatic selected state (and their de-duplicated NAME), the
//      search control's id/name/label under the fork-5 house rule, the announced loading
//      state, the announced save failure, and the load-failure branch that is NOT the
//      empty-collection copy. A green axe run certifies none of these, which is why a green
//      axe run alone was never the acceptance.
//
//   3. The focus contract, which axe structurally cannot evaluate (it reads a static DOM
//      snapshot): on OPEN, focus lands on the NAMED header Close control — `Modal.tsx`'s
//      documented default when no `initialFocusRef` is passed, and this surface passes none;
//      on CLOSE, focus returns to the NAMED trigger the test focused before opening. NOT an
//      "activeElement is not body" check: Radix restores to whatever held focus when the dialog
//      opened, so a bare open-from-mount render restores to <body> CORRECTLY and that check
//      would red a correct implementation.
//
// Render props are plan 88.6-33's recorded set (`88.6-33-SUMMARY.md` §2): `isOpen`,
// `onClose`, `eventId`, `self = { id, user_id }` (the SAME uuid), `onSave`. The three mocks it
// names are the three load-bearing ones. No delta was needed.
import * as React from 'react';
import { render, screen, cleanup, act, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { axe } from 'vitest-axe';
import { auditFormControls } from '../../test-utils/formControlAudit';

const SELF_ID = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const OTHER_ID = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const EVENT_ID = 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee';
const EVENT_ID_2 = 'ffffffff-ffff-4fff-8fff-ffffffffffff';

// A sentinel that reads like raw backend prose. `extractErrorMessage` (`api.ts`) returns
// `body?.message ?? body?.error` verbatim and `StatusRegion` renders its content verbatim, so
// the assertion "this string never reaches the dialog" is what makes the static-copy claim
// EXECUTABLE rather than a comment. Without it the shortest passing implementation sets the
// region straight from `err.message`.
const SENTINEL = 'SENTINEL_RAW_BACKEND_PROSE_7f3c';

const api = vi.hoisted(() => ({
  getOwnedGames: vi.fn(),
  getEventBrings: vi.fn(),
  updateMyBrings: vi.fn(),
}));
const loggerSpies = vi.hoisted(() => ({ info: vi.fn() }));

vi.mock('../../lib/api', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../lib/api')>();
  return {
    ...actual,
    userGamesAPI: { ...actual.userGamesAPI, getOwnedGames: api.getOwnedGames },
    eventBringsAPI: {
      ...actual.eventBringsAPI,
      getEventBrings: api.getEventBrings,
      updateMyBrings: api.updateMyBrings,
    },
  };
});

vi.mock('@/lib/logger', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/logger')>();
  // `errCtx` is the REAL one: the breadcrumb assertions are about what the call site passes.
  return { ...actual, logger: { ...actual.logger, info: loggerSpies.info } };
});

import BringGamePickerJs from './BringGamePicker';
import { getFetchErrorMessage } from '../../components/ui/useFetchErrorState';

// JS component: the inferred prop type marks every prop required. Cast so the harness passes
// only what it exercises (the createGroup.test / formLabels.audit idiom).
const BringGamePicker = BringGamePickerJs as unknown as React.ComponentType<Record<string, unknown>>;

// The ratified line a code-less rejection resolves to, READ FROM THE MODULE (the
// createGroup.test idiom): a register edit moves this test with it.
const RATIFIED_UNKNOWN_COPY = getFetchErrorMessage(new Error('anything at all'));
const EMPTY_COLLECTION_COPY = "You haven't added any games to your collection yet";
const LOADING_COPY = 'Loading your games...';

const WCAG_412 = { runOnly: { type: 'tag' as const, values: ['wcag412'] } };
const HEADING_ORDER = { runOnly: { type: 'rule' as const, values: ['heading-order'] } };

const SELF = { id: SELF_ID, user_id: SELF_ID };
// `https:` is on `isAllowedImageUrl`'s protocol allow-list, so this thumbnail takes
// `SafeImage`'s `<img>` path — the path the empty-`alt` assertion below is about.
const GAMES = [
  { id: 'g1', name: 'Catan', thumbnail_url: 'https://example.test/catan.png' },
  { id: 'g2', name: 'Azul' },
];
// Azul is MINE (nested `User.id` === `self.id`); Catan is brought by someone else.
const BRINGS = [
  { game_id: 'g2', User: { id: SELF_ID } },
  { game_id: 'g1', User: { id: OTHER_ID } },
];

/**
 * The consumer's shape (`gameDetail/page.js:2264-2266`): the picker stays MOUNTED and the host
 * flips `isOpen`. A real trigger button is rendered so the close-side focus assertion has a
 * NAMED element to return to. `closeFlipsOpen: false` keeps the dialog mounted after a
 * dismissal so the cleared regions can be read — the DOM cannot be inspected once the
 * component has returned `null`.
 */
function Host({
  self = SELF,
  eventId = EVENT_ID,
  onClose,
  onSave,
  initiallyOpen = false,
  closeFlipsOpen = true,
}: {
  self?: unknown;
  eventId?: string;
  onClose?: () => void;
  onSave?: () => void;
  initiallyOpen?: boolean;
  closeFlipsOpen?: boolean;
}) {
  const [open, setOpen] = React.useState(initiallyOpen);
  return (
    <>
      <button type="button" onClick={() => setOpen(true)}>
        Bring games
      </button>
      <BringGamePicker
        isOpen={open}
        onClose={() => {
          onClose?.();
          if (closeFlipsOpen) setOpen(false);
        }}
        eventId={eventId}
        self={self}
        onSave={onSave}
      />
    </>
  );
}

const politeRegion = () => screen.getByRole('status');
const assertiveRegion = () => screen.getByRole('alert');

/** Settle on a BRANCH-SPECIFIC element (a game row), never on the header (88.6-15 recipe). */
async function settleOnRows() {
  return screen.findByRole('checkbox', { name: 'Catan' });
}

beforeEach(() => {
  vi.clearAllMocks();
  api.getOwnedGames.mockResolvedValue(GAMES);
  api.getEventBrings.mockResolvedValue(BRINGS);
  api.updateMyBrings.mockResolvedValue({});
});
afterEach(cleanup);

describe('BringGamePicker — the surface renders (non-axe)', () => {
  it('renders the search control, one checkbox row per owned game, Skip and Save', async () => {
    render(<Host initiallyOpen />);
    await settleOnRows();
    expect(screen.getByRole('textbox', { name: 'Search your games' })).toBeInTheDocument();
    expect(screen.getAllByRole('checkbox')).toHaveLength(2);
    expect(screen.getByRole('button', { name: 'Skip for now' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Save' })).toBeInTheDocument();
    // Pre-selection from the brings fetch: mine is checked, the other member's is not, and the
    // other member's row says so.
    expect(screen.getByRole('checkbox', { name: 'Azul' })).toHaveAttribute('aria-checked', 'true');
    expect(screen.getByRole('checkbox', { name: 'Catan' })).toHaveAttribute('aria-checked', 'false');
    // The others-count is the row's DESCRIPTION, not part of its name (measured pre-fix: the
    // name read "Catan 1 other bringing this").
    expect(screen.getByRole('checkbox', { name: 'Catan' })).toHaveAccessibleDescription(
      '1 other bringing this'
    );
    expect(screen.getByRole('checkbox', { name: 'Azul' })).not.toHaveAttribute('aria-describedby');
  });

  it('filters the rows on typing and shows the no-match copy without announcing a count', async () => {
    const user = userEvent.setup();
    render(<Host initiallyOpen />);
    await settleOnRows();
    const before = politeRegion().textContent;
    await user.type(screen.getByRole('textbox', { name: 'Search your games' }), 'zzz');
    expect(screen.getByText('No games match your search')).toBeInTheDocument();
    expect(screen.queryAllByRole('checkbox')).toHaveLength(0);
    // The DEFAULT arm (plan 88.6-44): the search input is undebounced, so a per-keystroke
    // count announcement would be chatty. Nothing is announced on a keystroke.
    expect(politeRegion().textContent).toBe(before);
    expect(assertiveRegion().textContent).toBe('');
  });
});

describe('BringGamePicker — R7 composed axe audit (UI-SPEC §7.5)', () => {
  it('1. the POPULATED dialog passes WCAG 4.1.2 and heading-order', async () => {
    render(<Host initiallyOpen />);
    await settleOnRows();
    const dialog = screen.getByRole('dialog');
    expect(await axe(dialog, WCAG_412)).toHaveNoViolations();
    expect(await axe(dialog, HEADING_ORDER)).toHaveNoViolations();
  });

  it('2. the EMPTY-collection and LOAD-FAILURE branches pass the same two rules', async () => {
    api.getOwnedGames.mockResolvedValue([]);
    api.getEventBrings.mockResolvedValue([]);
    render(<Host initiallyOpen />);
    await screen.findByText(EMPTY_COLLECTION_COPY);
    let dialog = screen.getByRole('dialog');
    expect(await axe(dialog, WCAG_412)).toHaveNoViolations();
    expect(await axe(dialog, HEADING_ORDER)).toHaveNoViolations();
    cleanup();

    api.getOwnedGames.mockRejectedValue(new Error(SENTINEL));
    render(<Host initiallyOpen />);
    await waitFor(() => expect(assertiveRegion()).toHaveTextContent(RATIFIED_UNKNOWN_COPY));
    dialog = screen.getByRole('dialog');
    expect(await axe(dialog, WCAG_412)).toHaveNoViolations();
    expect(await axe(dialog, HEADING_ORDER)).toHaveNoViolations();
  });
});

describe('BringGamePicker — the defects axe cannot see (T-88.6-124 / T-88.6-142)', () => {
  it('1. each row is a checkbox whose state FLIPS on click (state idiom: role=checkbox + aria-checked)', async () => {
    const user = userEvent.setup();
    render(<Host initiallyOpen />);
    const catan = await settleOnRows();
    expect(catan).toHaveAttribute('aria-checked', 'false');
    await user.click(catan);
    expect(catan).toHaveAttribute('aria-checked', 'true');
    await user.click(catan);
    expect(catan).toHaveAttribute('aria-checked', 'false');
  });

  it('2. a row is NAMED by its visible game name EXACTLY ONCE — the thumbnail is decorative', async () => {
    render(<Host initiallyOpen />);
    await settleOnRows();
    // A by-ROLE name query, not a textContent check: `alt` text is part of the accessible name
    // and invisible to textContent. An exact string never matches "Catan Catan".
    const rows = screen.getAllByRole('checkbox', { name: 'Catan' });
    expect(rows).toHaveLength(1);
    expect(screen.queryByRole('checkbox', { name: /Catan.*Catan/ })).toBeNull();
    // The `<img>` path forwards an EMPTY alt (`SafeImage.js` `alt={alt || ''}`) — which makes
    // it presentational, so it is located by tag, not by role — and the well around it is
    // hidden from the name so the placeholder path can never add one either.
    const img = rows[0].querySelector('img');
    expect(img).not.toBeNull();
    expect(img!.getAttribute('alt')).toBe('');
    expect(img!.closest('[aria-hidden="true"]')).not.toBeNull();
  });

  it('3. the search control carries id + name + a label source (house rule Input.tsx:11-19)', async () => {
    render(<Host initiallyOpen />);
    await settleOnRows();
    const dialog = screen.getByRole('dialog');
    auditFormControls(dialog);
    const search = screen.getByRole('textbox', { name: 'Search your games' });
    expect(search).toHaveAttribute('id', 'bring-game-search');
    expect(search).toHaveAttribute('name', 'bring-game-search');
  });

  it('4. EMPTY-FIRST, then node identity: the polite region is born empty and the SAME node carries every later announcement', async () => {
    const user = userEvent.setup();
    // The ONE reachable empty-first render: `isOpen` with `self` UNDEFINED. The identity guard
    // returns early, `fetchData` never runs, and `loading` is `true` from `useState` — so an
    // implementation that DERIVES the loading message from `loading` mounts the region already
    // populated and FAILS here. (This does not certify the unresolved-identity path as fine —
    // it is a permanent silent spinner, recorded as a named residual in 88.6-44-SUMMARY.md.)
    const { rerender } = render(
      <BringGamePicker isOpen onClose={vi.fn()} eventId={EVENT_ID} self={undefined} />
    );
    const polite = politeRegion();
    const assertive = assertiveRegion();
    expect(polite.textContent).toBe('');
    expect(assertive.textContent).toBe('');
    expect(polite).toHaveAttribute('aria-live', 'polite');
    expect(assertive).toHaveAttribute('aria-live', 'assertive');
    expect(polite.className).toContain('sr-only');
    expect(assertive.className).toContain('sr-only');

    // Identity resolves -> the fetch starts -> the loading copy is a CHANGE on that same node.
    rerender(<BringGamePicker isOpen onClose={vi.fn()} eventId={EVENT_ID} self={SELF} />);
    await waitFor(() => expect(polite).toHaveTextContent(LOADING_COPY));
    expect(politeRegion()).toBe(polite);

    // Resolve: the same node, new text.
    await settleOnRows();
    expect(polite).toHaveTextContent('2 games loaded.');
    expect(politeRegion()).toBe(polite);
    expect(assertive.textContent).toBe('');

    // A rejected save and a filter keystroke leave the node in place (and the keystroke
    // announces nothing).
    api.updateMyBrings.mockRejectedValue(new Error(SENTINEL));
    await user.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(assertive).toHaveTextContent(RATIFIED_UNKNOWN_COPY));
    expect(assertiveRegion()).toBe(assertive);
    await user.type(screen.getByRole('textbox', { name: 'Search your games' }), 'a');
    expect(politeRegion()).toBe(polite);
    expect(polite).toHaveTextContent('2 games loaded.');
  });

  it('5. a REJECTED LOAD is announced ONCE, renders the failure branch (never the empty copy), and leaks no backend prose', async () => {
    api.getOwnedGames.mockRejectedValue(new Error(SENTINEL));
    render(<Host initiallyOpen />);
    await waitFor(() => expect(assertiveRegion()).toHaveTextContent(RATIFIED_UNKNOWN_COPY));

    const dialog = screen.getByRole('dialog');
    // The VISIBLE branch carries the same ratified sentence and no live role of its own.
    const visible = screen
      .getAllByText(RATIFIED_UNKNOWN_COPY)
      .filter((node) => !node.className.includes('sr-only'));
    expect(visible).toHaveLength(1);
    expect(visible[0]).not.toHaveAttribute('role');
    expect(screen.getAllByRole('alert')).toHaveLength(1); // announced exactly once
    // Not the empty-collection line — that was the shipped (false) behaviour.
    expect(screen.queryByText(EMPTY_COLLECTION_COPY)).toBeNull();
    // Static copy: the caught error's message reaches neither region nor the visible branch.
    expect(dialog.textContent).not.toContain(SENTINEL);
    expect(politeRegion().textContent).toBe('');
    // The channel: a breadcrumb through the house logger, `errCtx` shape, never the raw Error.
    expect(loggerSpies.info).toHaveBeenCalledTimes(1);
    const [msg, ctx] = loggerSpies.info.mock.calls[0];
    expect(msg).toBe('BringGamePicker: failed to load data');
    expect(ctx).toEqual({ name: 'Error', message: SENTINEL });
  });

  it('6. a rejected load followed by a successful one renders the LIST, not the failure branch', async () => {
    api.getOwnedGames.mockRejectedValueOnce(new Error(SENTINEL));
    const { rerender } = render(<Host initiallyOpen />);
    await waitFor(() => expect(assertiveRegion()).toHaveTextContent(RATIFIED_UNKNOWN_COPY));

    // A dep change re-runs the effect (the consumer re-points `eventId`); the regions stay
    // mounted, so the reset is observable.
    rerender(<Host initiallyOpen eventId={EVENT_ID_2} />);
    await settleOnRows();
    expect(assertiveRegion().textContent).toBe('');
    expect(screen.queryByText(RATIFIED_UNKNOWN_COPY)).toBeNull();
    expect(screen.getAllByRole('checkbox')).toHaveLength(2);
  });

  it('7. a rejection landing AFTER the effect cleanup ran writes nothing (dep change mid-flight)', async () => {
    let rejectFirst: (err: unknown) => void = () => {};
    api.getOwnedGames
      .mockImplementationOnce(
        () =>
          new Promise((_resolve, reject) => {
            rejectFirst = reject;
          })
      )
      .mockResolvedValue(GAMES);
    const { rerender } = render(<Host initiallyOpen />);
    await waitFor(() => expect(politeRegion()).toHaveTextContent(LOADING_COPY));

    // Supersede the in-flight fetch, settle on the POSITIVE signal (rows), then let the stale
    // rejection land.
    rerender(<Host initiallyOpen eventId={EVENT_ID_2} />);
    await settleOnRows();
    await act(async () => {
      rejectFirst(new Error(SENTINEL));
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(assertiveRegion().textContent).toBe('');
    expect(screen.queryByText(RATIFIED_UNKNOWN_COPY)).toBeNull();
    expect(screen.getAllByRole('checkbox')).toHaveLength(2);
    // ...and the breadcrumb STILL fires: it sits deliberately outside the `cancelled` guard.
    expect(loggerSpies.info).toHaveBeenCalledTimes(1);
  });

  it('8. a REJECTED SAVE is announced, keeps the modal open, and leaks no backend prose', async () => {
    const user = userEvent.setup();
    const onClose = vi.fn();
    const onSave = vi.fn();
    api.updateMyBrings.mockRejectedValue(new Error(SENTINEL));
    render(<Host initiallyOpen onClose={onClose} onSave={onSave} />);
    await settleOnRows();

    await user.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(assertiveRegion()).toHaveTextContent(RATIFIED_UNKNOWN_COPY));
    expect(screen.getByRole('dialog')).toBeInTheDocument();
    expect(onClose).not.toHaveBeenCalled();
    expect(onSave).not.toHaveBeenCalled();
    expect(screen.getByRole('dialog').textContent).not.toContain(SENTINEL);
    // The button is usable again (native disabled cleared in `finally`).
    expect(screen.getByRole('button', { name: 'Save' })).toBeEnabled();
    expect(loggerSpies.info).toHaveBeenCalledWith('BringGamePicker: failed to save', {
      name: 'Error',
      message: SENTINEL,
    });
  });

  it('9. a successful save calls onSave then closes through the local handleClose (regions cleared)', async () => {
    const user = userEvent.setup();
    const onClose = vi.fn();
    const onSave = vi.fn();
    render(<Host initiallyOpen onClose={onClose} onSave={onSave} closeFlipsOpen={false} />);
    await settleOnRows();
    await user.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(onClose).toHaveBeenCalledTimes(1));
    expect(onSave).toHaveBeenCalledTimes(1);
    expect(api.updateMyBrings).toHaveBeenCalledWith(EVENT_ID, ['g2']);
    expect(politeRegion().textContent).toBe('');
    expect(assertiveRegion().textContent).toBe('');
  });

  it('10. Esc — the Radix dismissal path — clears BOTH regions on its way to onClose', async () => {
    const user = userEvent.setup();
    const onClose = vi.fn();
    api.updateMyBrings.mockRejectedValue(new Error(SENTINEL));
    render(<Host initiallyOpen onClose={onClose} closeFlipsOpen={false} />);
    await settleOnRows();
    await user.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(assertiveRegion()).toHaveTextContent(RATIFIED_UNKNOWN_COPY));
    expect(politeRegion()).toHaveTextContent('2 games loaded.');

    await user.keyboard('{Escape}');
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(assertiveRegion().textContent).toBe('');
    expect(politeRegion().textContent).toBe('');
  });

  it('11. the header Close control and the Skip button clear the regions the same way', async () => {
    const user = userEvent.setup();
    const onClose = vi.fn();
    api.updateMyBrings.mockRejectedValue(new Error(SENTINEL));
    render(<Host initiallyOpen onClose={onClose} closeFlipsOpen={false} />);
    await settleOnRows();

    await user.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(assertiveRegion()).toHaveTextContent(RATIFIED_UNKNOWN_COPY));
    await user.click(screen.getByRole('button', { name: 'Skip for now' }));
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(assertiveRegion().textContent).toBe('');
    expect(politeRegion().textContent).toBe('');

    await user.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(assertiveRegion()).toHaveTextContent(RATIFIED_UNKNOWN_COPY));
    await user.click(screen.getByRole('button', { name: 'Close' }));
    expect(onClose).toHaveBeenCalledTimes(2);
    expect(assertiveRegion().textContent).toBe('');
  });

  it('12. a save rejection landing AFTER a dismissal does not re-populate the cleared region', async () => {
    const user = userEvent.setup();
    const onClose = vi.fn();
    let rejectSave: (err: unknown) => void = () => {};
    api.updateMyBrings.mockImplementation(
      () =>
        new Promise((_resolve, reject) => {
          rejectSave = reject;
        })
    );
    render(<Host initiallyOpen onClose={onClose} closeFlipsOpen={false} />);
    await settleOnRows();
    await user.click(screen.getByRole('button', { name: 'Save' }));
    expect(api.updateMyBrings).toHaveBeenCalledTimes(1);

    await user.keyboard('{Escape}');
    expect(onClose).toHaveBeenCalledTimes(1);
    await act(async () => {
      rejectSave(new Error(SENTINEL));
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(assertiveRegion().textContent).toBe('');
    expect(loggerSpies.info).toHaveBeenCalledWith('BringGamePicker: failed to save', {
      name: 'Error',
      message: SENTINEL,
    });
  });
});

describe('BringGamePicker — the focus contract axe cannot see (T-88.6-141)', () => {
  it('on OPEN focus lands on the NAMED header Close control (no initialFocusRef is passed); on CLOSE it returns to the NAMED trigger', async () => {
    const user = userEvent.setup();
    render(<Host />);
    const trigger = screen.getByRole('button', { name: 'Bring games' });
    trigger.focus();
    expect(document.activeElement).toBe(trigger);

    await user.click(trigger);
    const dialog = await screen.findByRole('dialog');
    await settleOnRows();
    // Named target, derived BEFORE writing: `Modal.tsx` documents the default as the first
    // focusable node, i.e. `<Modal.Header>`'s `DialogClose aria-label="Close"`. Opening on
    // Close rather than on the search field is ACCEPTED (recorded in 88.6-44-SUMMARY.md).
    const close = within(dialog).getByRole('button', { name: 'Close' });
    await waitFor(() => expect(document.activeElement).toBe(close));
    // The shipped weaker containment form, kept ONLY as a second assertion.
    expect(dialog.contains(document.activeElement)).toBe(true);

    await user.keyboard('{Escape}');
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    // Radix restores to the element that held focus when the dialog opened — the trigger.
    // This is a NAMED identity check; "not body" would pass on a wrong element and red a
    // correct bare-mount render.
    await waitFor(() => expect(document.activeElement).toBe(trigger));
  });
});
