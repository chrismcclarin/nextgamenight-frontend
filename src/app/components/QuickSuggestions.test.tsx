// Phase 88.6-39 (W52 / D-18) — the FIRST suite that RENDERS `QuickSuggestions`.
//
// WHY IT HAD TO BE NEW. Every create-event suite mocks this component to `null`
// (`createEvent.integration.test.tsx`, `createEvent.participants.test.tsx`), so none of them can
// assert anything about what it renders. The staleness guard, the real-failure report, the ruled
// one-slot design and the chip's accessible name all needed a suite that mounts it.
//
// TWO CONSTRAINTS, BOTH LOAD-BEARING:
//
// - **NO HEIGHT ASSERTION MAY BE WRITTEN HERE.** `vitest.config.mts` runs jsdom, which evaluates
//   no layout: every box is zero, so a "the slot did not change height" assertion at this level
//   would pass on zeroes and prove nothing. It would be VACUOUS, which is worse than absent. The
//   constant-height invariant is asserted here STRUCTURALLY — one container instance is the single
//   height source and the three contents swap inside it — and its geometry is asserted only in the
//   phone Playwright lane.
// - **The ruling is D4 (owner, 2026-09-14).** One slot for every member, hint inside the slot on
//   empty, no role gate. There is no role polarity left to assert; what replaces it is an
//   output-IDENTITY assertion across roles.
import * as React from 'react';
import { render, screen, cleanup, fireEvent, act, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const GROUP_ID = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd';

const api = vi.hoisted(() => ({ getGroupSuggestions: vi.fn() }));
const log = vi.hoisted(() => ({ error: vi.fn(), warn: vi.fn(), info: vi.fn() }));
/** Counts renders of the always-constructed modal tree — see the finger-up blast-radius pin. */
const counts = vi.hoisted(() => ({ browseModal: 0 }));

vi.mock('@/lib/logger', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/logger')>();
  return { ...actual, logger: log };
});

vi.mock('@/lib/api', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/api')>();
  return {
    ...actual,
    suggestionsAPI: { ...actual.suggestionsAPI, getGroupSuggestions: api.getGroupSuggestions },
  };
});

vi.mock('@/app/components/BrowseMoreModal', () => {
  const BrowseMoreModalRenderCounter = () => {
    counts.browseModal += 1;
    return null;
  };
  return { default: BrowseMoreModalRenderCounter };
});

import { ApiError } from '@/lib/api';
import {
  __resetPaintGestureActiveStore,
  setPaintGestureActive,
} from './heatmap/paintGestureActiveStore';
import QuickSuggestionsDefault from './QuickSuggestions';

type QuickSuggestionsProps = {
  groupId?: string | null;
  playerCount?: number;
  duration?: number | null;
  onSelectGame?: (game: { id: string; name: string }) => void;
  eventId?: string | null;
  /** The D4 ruling deleted the role gate; this prop is dead to the component and is passed by
   *  ONE pin below purely to prove that passing it changes nothing. */
  userRole?: string | null;
};
const QuickSuggestions = QuickSuggestionsDefault as unknown as React.ComponentType<QuickSuggestionsProps>;

const GAMES = [
  {
    id: 'g-1',
    name: 'Catan',
    thumbnail_url: 'https://cf.geekdo-images.example/catan.jpg',
    min_players: 3,
    max_players: 4,
  },
];

const slot = () => screen.getByTestId('quick-suggestions-slot');
const placeholder = () => screen.queryByTestId('quick-suggestions-placeholder');
const emptyBox = () => screen.queryByTestId('quick-suggestions-empty');

/** A promise a test settles by hand — the only way to observe an in-flight fetch. */
function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

function renderSuggestions(props: QuickSuggestionsProps = {}) {
  return render(
    <QuickSuggestions
      groupId={GROUP_ID}
      playerCount={4}
      duration={120}
      onSelectGame={vi.fn()}
      {...props}
    />
  );
}

/** Run out the component's 500ms debounce inside `act`, so the fetch actually starts. */
async function runDebounce() {
  await act(async () => {
    vi.advanceTimersByTime(500);
  });
}

beforeEach(() => {
  vi.useFakeTimers({ shouldAdvanceTime: true });
  vi.clearAllMocks();
  counts.browseModal = 0;
  __resetPaintGestureActiveStore();
  api.getGroupSuggestions.mockResolvedValue({ suggestions: [] });
});

afterEach(() => {
  cleanup();
  __resetPaintGestureActiveStore();
  vi.useRealTimers();
});

// ---------------------------------------------------------------------------
// The ruled one-slot design (D4).
// ---------------------------------------------------------------------------
describe('QuickSuggestions — ONE slot, for every member (owner ruling D4, 2026-09-14)', () => {
  it('is present on the FIRST commit with `userRole` still null — the magic-link auto-open path', () => {
    // `userRole` is `useState(null)` in all three mounters and is only set from an async members
    // fetch, while `groupPlanning/page.js` AUTO-OPENS the modal at mount on the magic-link path.
    // A role-gated render was ABSENT at commit 1 there. The slot no longer needs the role.
    renderSuggestions({ groupId: null, playerCount: 0, userRole: null });
    expect(slot()).toBeInTheDocument();
  });

  it('never returns null — there is no branch that renders nothing while the modal is open', async () => {
    // Three commits walking all three contents; the component renders a slot at every one.
    const gate = deferred<{ suggestions: typeof GAMES }>();
    api.getGroupSuggestions.mockReturnValue(gate.promise);
    const { rerender } = renderSuggestions({ playerCount: 0 }); // invalid params: settled, empty
    expect(emptyBox()).toBeInTheDocument();

    rerender(
      <QuickSuggestions groupId={GROUP_ID} playerCount={4} duration={120} onSelectGame={vi.fn()} />
    );
    await runDebounce();
    expect(placeholder()).toBeInTheDocument(); // in flight

    await act(async () => {
      gate.resolve({ suggestions: GAMES });
    });
    expect(screen.getByRole('button', { name: /Catan/ })).toBeInTheDocument(); // chips
  });

  it('the SAME container instance carries all three contents, and nothing above it remounts', async () => {
    /* THE CONSTANT-HEIGHT INVARIANT, ASSERTED STRUCTURALLY. jsdom evaluates no layout, so this is
       the honest form of it: one element is the single height source and the contents swap
       INSIDE it. If a future edit returns a different subtree per outcome, this identity check
       reds — which is exactly the collapse the ruling removed. */
    const gate = deferred<{ suggestions: typeof GAMES }>();
    api.getGroupSuggestions.mockReturnValue(gate.promise);
    const { rerender } = renderSuggestions({ playerCount: 0 });

    const container = slot();
    const heading = screen.getByText('Suggestions');
    expect(emptyBox()).toBeInTheDocument();

    rerender(
      <QuickSuggestions groupId={GROUP_ID} playerCount={4} duration={120} onSelectGame={vi.fn()} />
    );
    await runDebounce();
    expect(slot()).toBe(container);
    expect(placeholder()).toBeInTheDocument();

    await act(async () => {
      gate.resolve({ suggestions: GAMES });
    });
    expect(slot()).toBe(container);
    expect(screen.getByText('Suggestions')).toBe(heading);
  });

  it('renders IDENTICALLY for a member and for an owner/admin given the same data', async () => {
    // What replaces the deleted role gate. The two polarities the old gate had are now one.
    api.getGroupSuggestions.mockResolvedValue({ suggestions: [] });
    const asMember = renderSuggestions({ userRole: 'member' });
    await runDebounce();
    const memberHtml = asMember.container.innerHTML;
    cleanup();

    const asOwner = renderSuggestions({ userRole: 'owner' });
    await runDebounce();
    expect(asOwner.container.innerHTML).toBe(memberHtml);
  });

  it('the settled-empty content is the dotted hint box, carrying the ruled copy', async () => {
    renderSuggestions();
    await runDebounce();

    const box = emptyBox() as HTMLElement;
    expect(box).toBeInTheDocument();
    expect(box.className).toContain('border-dashed');
    expect(
      screen.getByText('Add games to your collection to enable suggestions')
    ).toBeInTheDocument();
  });
});

// ---------------------------------------------------------------------------
// The in-flight bar: an ACTUAL fetch, never `!loaded`.
// ---------------------------------------------------------------------------
describe('QuickSuggestions — the in-flight bar tracks a REAL fetch, in both polarities', () => {
  it('a commit with a fetch IN FLIGHT shows the bar', async () => {
    const gate = deferred<{ suggestions: never[] }>();
    api.getGroupSuggestions.mockReturnValue(gate.promise);
    renderSuggestions();
    await runDebounce();

    expect(placeholder()).toBeInTheDocument();
    expect(emptyBox()).not.toBeInTheDocument();

    await act(async () => {
      gate.resolve({ suggestions: [] });
    });
    expect(placeholder()).not.toBeInTheDocument();
  });

  it('a commit with NO fetch possible shows the hint box, not the bar', () => {
    /* THE `!loaded` REGRESSION PIN. The gate this replaces latched `true` synchronously at the
       production mount — `participantCount` is 0 at the modal's fresh mount — so a bar keyed on
       it painted where no settle was pending. This fixture IS that mount: invalid params, no
       fetch, no bar. */
    renderSuggestions({ playerCount: 0 });
    expect(placeholder()).not.toBeInTheDocument();
    expect(emptyBox()).toBeInTheDocument();
    expect(api.getGroupSuggestions).not.toHaveBeenCalled();
  });

  it('the bar is aria-hidden and the hint box is NOT', async () => {
    const gate = deferred<{ suggestions: never[] }>();
    api.getGroupSuggestions.mockReturnValue(gate.promise);
    renderSuggestions();
    await runDebounce();
    expect(placeholder()).toHaveAttribute('aria-hidden', 'true');

    await act(async () => {
      gate.resolve({ suggestions: [] });
    });
    expect(emptyBox()).not.toHaveAttribute('aria-hidden');
  });
});

// ---------------------------------------------------------------------------
// The cancelled-generation staleness guard (D-18 (c)).
// ---------------------------------------------------------------------------
describe('QuickSuggestions — the cancelled-generation guard covers resolve, reject AND the bar', () => {
  it('a SUPERSEDED result is not applied; the current one is', async () => {
    const first = deferred<{ suggestions: typeof GAMES }>();
    const second = deferred<{ suggestions: typeof GAMES }>();
    api.getGroupSuggestions.mockReturnValueOnce(first.promise).mockReturnValueOnce(second.promise);

    const { rerender } = renderSuggestions({ playerCount: 4 });
    await runDebounce();

    // A dep change supersedes generation 1 and starts generation 2.
    rerender(
      <QuickSuggestions groupId={GROUP_ID} playerCount={5} duration={120} onSelectGame={vi.fn()} />
    );
    await runDebounce();

    // Generation 1 settles LAST — the arrival order that used to let it win.
    await act(async () => {
      first.resolve({ suggestions: [{ ...GAMES[0], id: 'stale', name: 'StaleGame' }] });
    });
    expect(screen.queryByText('StaleGame')).not.toBeInTheDocument();
    expect(placeholder()).toBeInTheDocument(); // the stale run did not clear the bar either

    await act(async () => {
      second.resolve({ suggestions: GAMES });
    });
    expect(screen.getByText('Catan')).toBeInTheDocument();
  });

  it('a SUPERSEDED failure neither empties the list nor reports', async () => {
    const first = deferred<never>();
    api.getGroupSuggestions
      .mockReturnValueOnce(first.promise)
      .mockResolvedValueOnce({ suggestions: GAMES });

    const { rerender } = renderSuggestions({ playerCount: 4 });
    await runDebounce();
    rerender(
      <QuickSuggestions groupId={GROUP_ID} playerCount={5} duration={120} onSelectGame={vi.fn()} />
    );
    await runDebounce();
    await waitFor(() => expect(screen.getByText('Catan')).toBeInTheDocument());

    await act(async () => {
      first.reject(new ApiError('gone', 'unknown', 500, { secret: 'group roster' }));
    });

    expect(screen.getByText('Catan')).toBeInTheDocument(); // not emptied by the stale rejection
    expect(log.error).not.toHaveBeenCalled(); // the guard is checked BEFORE the report
  });
});

// ---------------------------------------------------------------------------
// The real-failure report (AC-16 (a), as amended by D7 arm A).
// ---------------------------------------------------------------------------
describe('QuickSuggestions — a REAL failure reports, silently to the user', () => {
  it('reports through logger.error while the rendered output stays silent', async () => {
    api.getGroupSuggestions.mockRejectedValue(new ApiError('boom', 'unknown', 500, {}));
    renderSuggestions();
    await runDebounce();

    await waitFor(() => expect(log.error).toHaveBeenCalledTimes(1));
    // Nothing user-facing: the settled-empty content, exactly as a zero-result fetch renders.
    expect(emptyBox()).toBeInTheDocument();
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  it('the PAYLOAD is a wrapped error carrying only the code and the status', async () => {
    /* `logger.error(msg, err)` forwards whatever it is given, WHOLE, and `ApiError`'s fourth
       constructor argument is the entire parsed response body. This pin is what keeps that body
       out of Sentry — `sentry.scrub.js` is the second layer, not the first. */
    const body = { details: { groupName: 'The Thursday Crew', members: ['alice@example.com'] } };
    api.getGroupSuggestions.mockRejectedValue(new ApiError('boom', 'rate_limited', 429, body));
    renderSuggestions();
    await runDebounce();

    await waitFor(() => expect(log.error).toHaveBeenCalledTimes(1));
    const [msg, reported] = log.error.mock.calls[0] as [string, Error & { details?: unknown }];
    expect(msg).toBe('QuickSuggestions: group suggestions fetch failed');
    expect(reported).toBeInstanceOf(Error);
    expect(reported).not.toBeInstanceOf(ApiError);
    expect(reported.name).toBe('QuickSuggestionsFetchError');
    expect(reported.message).toBe('group suggestions fetch failed (code=rate_limited, status=429)');
    expect(reported.details).toBeUndefined();
    // The body cannot be reconstructed from anything that was forwarded.
    expect(JSON.stringify(log.error.mock.calls)).not.toContain('Thursday Crew');
    expect(JSON.stringify(log.error.mock.calls)).not.toContain('alice@example.com');
  });

  it('is LATCHED — a failure across THREE consecutive dep changes reports exactly ONCE per key', async () => {
    /* Without the latch a persistent failure files one Sentry event per debounced cycle, and the
       effect deps re-fire on every create-event form edit — the first of which flushes a full
       Session Replay. */
    api.getGroupSuggestions.mockRejectedValue(new ApiError('boom', 'unknown', 500, {}));
    const { rerender } = renderSuggestions({ duration: 60 });
    await runDebounce();
    await waitFor(() => expect(log.error).toHaveBeenCalledTimes(1));

    for (const duration of [60, 60, 60]) {
      rerender(
        <QuickSuggestions
          groupId={GROUP_ID}
          playerCount={4}
          duration={duration}
          onSelectGame={vi.fn()}
        />
      );
      await runDebounce();
    }

    expect(log.error).toHaveBeenCalledTimes(1);
  });
});

// ---------------------------------------------------------------------------
// The finger-up hold, and its blast radius.
// ---------------------------------------------------------------------------
describe('QuickSuggestions — the finger-up hold, asserted over RENDERED OUTPUT per commit', () => {
  it('a settle landing MID-GESTURE does not change the rendered content until finger-up', async () => {
    const gate = deferred<{ suggestions: typeof GAMES }>();
    api.getGroupSuggestions.mockReturnValue(gate.promise);
    renderSuggestions();
    await runDebounce();
    expect(placeholder()).toBeInTheDocument();

    act(() => setPaintGestureActive(true));
    await act(async () => {
      gate.resolve({ suggestions: GAMES });
    });

    // HELD: the grid must not move under the finger.
    expect(placeholder()).toBeInTheDocument();
    expect(screen.queryByText('Catan')).not.toBeInTheDocument();

    act(() => setPaintGestureActive(false));
    expect(screen.getByText('Catan')).toBeInTheDocument();
    expect(placeholder()).not.toBeInTheDocument();
  });

  it('a RE-FIRE landing mid-gesture is held too, not just the first settle', async () => {
    api.getGroupSuggestions.mockResolvedValueOnce({ suggestions: GAMES });
    const { rerender } = renderSuggestions({ duration: 60 });
    await runDebounce();
    await waitFor(() => expect(screen.getByText('Catan')).toBeInTheDocument());

    const refire = deferred<{ suggestions: typeof GAMES }>();
    api.getGroupSuggestions.mockReturnValue(refire.promise);
    act(() => setPaintGestureActive(true));
    rerender(
      <QuickSuggestions groupId={GROUP_ID} playerCount={4} duration={90} onSelectGame={vi.fn()} />
    );
    await runDebounce();
    await act(async () => {
      refire.resolve({ suggestions: [{ ...GAMES[0], id: 'g-2', name: 'Wingspan' }] });
    });

    expect(screen.getByText('Catan')).toBeInTheDocument();
    expect(screen.queryByText('Wingspan')).not.toBeInTheDocument();

    act(() => setPaintGestureActive(false));
    expect(screen.getByText('Wingspan')).toBeInTheDocument();
  });

  it('the closed BrowseMoreModal tree is NOT rebuilt across a full engage→exit cycle', async () => {
    /* THE BLAST-RADIUS PIN. `BrowseMoreModal` has no closed-state short-circuit, so a render of
       the OUTER component rebuilds its whole element tree — at finger-up, the frame the hold
       exists to protect. Keeping the subscription in the inner slot-only component is what
       contains it. The slot's OWN re-render on the exit edge is intended: that is the held
       change landing. */
    const gate = deferred<{ suggestions: typeof GAMES }>();
    api.getGroupSuggestions.mockReturnValue(gate.promise);
    renderSuggestions();
    await runDebounce();

    act(() => setPaintGestureActive(true));
    await act(async () => {
      gate.resolve({ suggestions: GAMES });
    });
    const modalRendersBeforeExit = counts.browseModal;

    act(() => setPaintGestureActive(false));

    expect(screen.getByText('Catan')).toBeInTheDocument(); // the held change DID land
    expect(counts.browseModal).toBe(modalRendersBeforeExit); // …and the modal tree did not rebuild
  });

  it('gesture ENGAGE re-renders nothing at all', async () => {
    api.getGroupSuggestions.mockResolvedValue({ suggestions: GAMES });
    renderSuggestions();
    await runDebounce();
    await waitFor(() => expect(screen.getByText('Catan')).toBeInTheDocument());
    const before = counts.browseModal;

    act(() => setPaintGestureActive(true));

    expect(counts.browseModal).toBe(before);
  });
});

// ---------------------------------------------------------------------------
// The thumbnail sink (T-88.6-111).
// ---------------------------------------------------------------------------
describe('QuickSuggestions — the BGG thumbnail is on SafeImage', () => {
  it('renders NO <img> for a `javascript:` or `data:` thumbnail', async () => {
    api.getGroupSuggestions.mockResolvedValue({
      suggestions: [
        { ...GAMES[0], id: 'js', name: 'JsGame', thumbnail_url: 'javascript:alert(1)' },
        { ...GAMES[0], id: 'data', name: 'DataGame', thumbnail_url: 'data:image/png;base64,AAAA' },
      ],
    });
    const { container } = renderSuggestions();
    await runDebounce();
    await waitFor(() => expect(screen.getByText('JsGame')).toBeInTheDocument());

    expect(container.querySelectorAll('img')).toHaveLength(0);
  });

  it('renders an <img> for an allowed https thumbnail', async () => {
    api.getGroupSuggestions.mockResolvedValue({ suggestions: GAMES });
    const { container } = renderSuggestions();
    await runDebounce();
    await waitFor(() => expect(screen.getByText('Catan')).toBeInTheDocument());

    expect(container.querySelectorAll('img')).toHaveLength(1);
  });

  it("the chip's accessible name is EXACTLY the game name plus the player count, in BOTH polarities", async () => {
    /* EXACT-STRING, never `toContain`: a substring assertion passes on
       "Image placeholder Catan3-4p", which is precisely the regression the `aria-hidden` wrapper
       exists to prevent — `SafeImage`'s fallback labels itself "Image placeholder" when `alt` is
       falsy, and `aria-hidden` passed as a PROP never reaches that branch. */
    api.getGroupSuggestions.mockResolvedValue({ suggestions: GAMES });
    const withThumb = renderSuggestions();
    await runDebounce();
    await waitFor(() => expect(screen.getByText('Catan')).toBeInTheDocument());
    expect(withThumb.container.querySelector('button')).toHaveAccessibleName('Catan3-4p');
    cleanup();

    api.getGroupSuggestions.mockResolvedValue({
      suggestions: [{ ...GAMES[0], thumbnail_url: null }],
    });
    const withoutThumb = renderSuggestions();
    await runDebounce();
    await waitFor(() => expect(screen.getByText('Catan')).toBeInTheDocument());
    expect(withoutThumb.container.querySelector('button')).toHaveAccessibleName('Catan3-4p');
  });
});

// ---------------------------------------------------------------------------
// The 44px floor on both controls (round-3 #179).
// ---------------------------------------------------------------------------
describe('QuickSuggestions — both controls carry the 44px floor (UI-SPEC §3.5)', () => {
  it('the chip and "Browse more" both take min-h-11 with inline-flex', async () => {
    /* SOURCE-LEVEL, not rendered geometry — jsdom has no layout. The rendered measurement at
       375px lives in the phone Playwright lane. */
    api.getGroupSuggestions.mockResolvedValue({ suggestions: GAMES });
    renderSuggestions();
    await runDebounce();
    await waitFor(() => expect(screen.getByText('Catan')).toBeInTheDocument());

    const chip = screen.getByRole('button', { name: 'Catan3-4p' });
    expect(chip.className).toContain('min-h-11');
    expect(chip.className).toContain('inline-flex');

    const browse = screen.getByRole('button', { name: 'Browse more' });
    expect(browse.className).toContain('min-h-11');
    expect(browse.className).toContain('inline-flex');
    expect(browse.className).toContain('px-1');
    expect(browse.className).toContain('text-content-link');
  });

  it('a chip tap still reaches onSelectGame with the id and name', async () => {
    const onSelectGame = vi.fn();
    api.getGroupSuggestions.mockResolvedValue({ suggestions: GAMES });
    renderSuggestions({ onSelectGame });
    await runDebounce();
    await waitFor(() => expect(screen.getByText('Catan')).toBeInTheDocument());

    fireEvent.click(screen.getByRole('button', { name: 'Catan3-4p' }));

    expect(onSelectGame).toHaveBeenCalledWith({ id: 'g-1', name: 'Catan' });
  });
});

// ---------------------------------------------------------------------------
// Reduced motion (D-18 (d)).
// ---------------------------------------------------------------------------
describe('QuickSuggestions — the slot introduces NO animation', () => {
  it('neither the placeholder bar nor the hint box carries a transition or animation class', async () => {
    // `globals.css`'s reduced-motion contract CAPS transitions at 100ms rather than removing them,
    // so the only safe design is one that adds none. This pin is what keeps it that way.
    const gate = deferred<{ suggestions: never[] }>();
    api.getGroupSuggestions.mockReturnValue(gate.promise);
    renderSuggestions();
    await runDebounce();
    expect(placeholder()!.className).not.toMatch(/transition|animate|duration-/);

    await act(async () => {
      gate.resolve({ suggestions: [] });
    });
    expect(emptyBox()!.className).not.toMatch(/transition|animate|duration-/);
    expect(slot().className).not.toMatch(/transition|animate|duration-/);
  });
});
