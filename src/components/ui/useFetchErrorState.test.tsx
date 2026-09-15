/**
 * useFetchErrorState behavior — the PRIM-03 error surface + error-only refocus
 * recovery (D-02). This is the behavioral proof the plan requires: the query
 * auto-refetches on window refocus WHILE erroring, and does NOT refetch on
 * refocus when successful — without any dependency on the global
 * `refetchOnWindowFocus: false` default (the hook takes a plain query result,
 * so no global config is in play).
 */
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, renderHook, screen, cleanup } from '@testing-library/react';
import type { UseQueryResult } from '@tanstack/react-query';
import { useFetchErrorState, getFetchErrorMessage } from './useFetchErrorState';
import { FetchErrorBanner } from './FetchErrorBanner';
import type { FetchErrorState } from './useFetchErrorState';
import { ApiError } from '@/lib/api';

afterEach(() => cleanup());

/** Dispatch a visibilitychange with the document in the given state. */
function fireVisibility(state: 'visible' | 'hidden') {
  Object.defineProperty(document, 'visibilityState', { value: state, configurable: true });
  document.dispatchEvent(new Event('visibilitychange'));
}

/** Minimal UseQueryResult stub — only the read fields matter to the hook. */
function queryStub(over: Record<string, unknown>): UseQueryResult {
  return { isError: false, error: null, refetch: vi.fn(), ...over } as unknown as UseQueryResult;
}

describe('useFetchErrorState — error-only refocus recovery', () => {
  it('refetches on window refocus WHILE erroring', () => {
    const refetch = vi.fn();
    renderHook(() =>
      useFetchErrorState(queryStub({ isError: true, error: new ApiError('boom', 'network', 0), refetch }))
    );
    fireVisibility('visible');
    expect(refetch).toHaveBeenCalledTimes(1);
  });

  it('does NOT refetch on refocus when successful', () => {
    const refetch = vi.fn();
    renderHook(() => useFetchErrorState(queryStub({ isError: false, error: null, refetch })));
    fireVisibility('visible');
    expect(refetch).not.toHaveBeenCalled();
  });

  it('does NOT refetch when the tab goes hidden while erroring', () => {
    const refetch = vi.fn();
    renderHook(() =>
      useFetchErrorState(queryStub({ isError: true, error: new ApiError('boom', 'network', 0), refetch }))
    );
    fireVisibility('hidden');
    expect(refetch).not.toHaveBeenCalled();
  });

  it('tears the listener down once the error clears (no refetch after recovery)', () => {
    const refetch = vi.fn();
    const { rerender } = renderHook(
      ({ isError }) =>
        useFetchErrorState(
          queryStub({ isError, error: isError ? new ApiError('boom', 'network', 0) : null, refetch })
        ),
      { initialProps: { isError: true } }
    );
    rerender({ isError: false }); // error recovered
    fireVisibility('visible');
    expect(refetch).not.toHaveBeenCalled();
  });
});

describe('useFetchErrorState — code/message derivation', () => {
  it('surfaces err.code from ApiError without re-parsing a body', () => {
    const { result } = renderHook(() =>
      useFetchErrorState(queryStub({ isError: true, error: new ApiError('nope', 'rate_limited', 429) }))
    );
    expect(result.current.showError).toBe(true);
    expect(result.current.code).toBe('rate_limited');
    expect(result.current.message).toMatch(/going a little fast/i);
  });

  it('falls back to unknown for a non-ApiError failure', () => {
    const { result } = renderHook(() =>
      useFetchErrorState(queryStub({ isError: true, error: new Error('raw') }))
    );
    expect(result.current.code).toBe('unknown');
  });

  it('reports showError=false and no code churn on success', () => {
    const { result } = renderHook(() => useFetchErrorState(queryStub({ isError: false })));
    expect(result.current.showError).toBe(false);
  });
});

/**
 * getFetchErrorMessage — the ACTION-path half of the same derivation (Phase 88-25,
 * Req 14 / T-88-25-01). Toasts and inline field errors cannot use the hook (they
 * have no query and no retry), which is why ~20 of them shipped the
 * `error.message || 'Failed to X'` idiom and painted raw upstream text at the user.
 *
 * The load-bearing assertion is the FIRST one: the upstream message must never
 * come back out, whatever it says.
 */
describe('getFetchErrorMessage — designed copy for action-path failures', () => {
  it('NEVER returns the upstream message, even when one is present', () => {
    const upstream = 'HTTP error! status: 500 — user_id=abc123 not permitted on groups.owner';
    const out = getFetchErrorMessage(new ApiError(upstream, 'internal', 500));
    expect(out).not.toContain('HTTP error');
    expect(out).not.toContain('abc123');
    expect(out).toMatch(/on our end/i);
  });

  it('derives from the code, not the prose', () => {
    expect(getFetchErrorMessage(new ApiError('x', 'network', 0))).toMatch(/reach the server/i);
    expect(getFetchErrorMessage(new ApiError('x', 'rate_limited', 429))).toMatch(/little fast/i);
    expect(getFetchErrorMessage(new ApiError('x', 'forbidden', 403))).toMatch(/access/i);
  });

  it('uses the surface fallback ONLY when the failure carries no code', () => {
    const fallback = "We couldn't do the thing. Please try again.";
    // No ApiError -> code `unknown` -> the surface's own copy wins.
    expect(getFetchErrorMessage(new Error('raw'), { fallback })).toBe(fallback);
    // A real code -> the designed copy for that code wins over the fallback,
    // because the code says something more specific than the caller could.
    expect(getFetchErrorMessage(new ApiError('x', 'network', 0), { fallback })).not.toBe(fallback);
  });

  it('byCode overrides a single outcome without reopening interpolation', () => {
    const out = getFetchErrorMessage(new ApiError('duplicate key', 'validation', 400), {
      fallback: 'generic',
      byCode: { validation: 'That username is taken.' },
    });
    expect(out).toBe('That username is taken.');
    expect(out).not.toContain('duplicate key');
  });

  // 88-CODE-REVIEW D2: 'conflict' (code-less 409) carries designed generic copy,
  // and a byCode map with BOTH conflict and forbidden arms serves each outcome —
  // the OpenPollsList shape, where the remedy check found the forbidden copy was
  // convention-pinned only. This is the MECHANISM pin; the SOURCE pin below it
  // holds the component's actual map (delta review 2026-08-06: this pin alone
  // duplicated the literal and could not see the component's map drift).
  it("conflict (409) has designed generic copy and byCode maps keep sibling arms live", () => {
    expect(getFetchErrorMessage(new ApiError('Already friends', 'conflict', 409))).toMatch(
      /already be settled/i
    );
    const byCode = {
      conflict: 'This check-in is already closed.',
      forbidden: 'Only the poll creator and group admins can end a check-in.',
    };
    expect(
      getFetchErrorMessage(new ApiError('Poll is already closed', 'conflict', 409), { byCode })
    ).toBe('This check-in is already closed.');
    expect(
      getFetchErrorMessage(new ApiError('nope', 'forbidden', 403), { byCode })
    ).toBe('Only the poll creator and group admins can end a check-in.');
  });

  it("OpenPollsList's end-check-in byCode map really carries BOTH ratified arms (source pin)", () => {
    // Delta review 2026-08-06: the mechanism pin above uses its own copy of the
    // literals, so the component's map could drop an arm (the exact defect the
    // D2 remedy check flagged) with every suite green. This reads the source.
    const { readFileSync } = require('fs') as typeof import('fs');
    const { resolve } = require('path') as typeof import('path');
    const src = readFileSync(
      resolve(__dirname, '../../app/components/OpenPollsList.js'),
      'utf8'
    );
    expect(src).toContain("conflict: 'This check-in is already closed.'");
    expect(src).toContain(
      "forbidden: 'Only the poll creator and group admins can end a check-in.'"
    );
  });

  it('a bare unknown failure with no options still returns designed copy, never empty', () => {
    const out = getFetchErrorMessage(undefined);
    expect(out.length).toBeGreaterThan(0);
    expect(out).toMatch(/something went wrong/i);
  });
});

// ---------------------------------------------------------------------------
// Phase 88.6-13 task 3 — the three R1 edge rows the SPEC marks explicit.
//
// WHY THEY LIVE HERE AND NOT IN `src/app/fetchErrorTreatment.test.ts`, which is the
// file plan 13 otherwise owns: that file is STRICTLY a source scanner. Its own docblock
// carries the heading "WHY A SOURCE SCAN AND NOT A RENDER TEST", it imports only
// `node:fs` / `node:path` / vitest / the test-utils, and it renders nothing. Putting the
// first RTL render in the repo's most-cited scan suite would contradict the decision that
// file was written to record. This suite already renders (`renderHook`), already owns
// `getFetchErrorMessage`'s derivation, and is the second file in plan 13 task 3's own
// verify command — so the convention says here. The SINK-SET tripwire that accompanies
// arm 1 is a source scan and correctly stays in the scanner file.
// ---------------------------------------------------------------------------

/** A `FetchErrorState` with a caller-supplied message — the render arms' subject. */
const errorState = (message: string): FetchErrorState => ({
  showError: true,
  message,
  code: 'unknown',
  retry: vi.fn().mockResolvedValue(undefined),
});

describe('FetchErrorBanner — SPEC Edge Coverage (R1)', () => {
  // SPEC Edge Coverage row: ENCODING / R1.
  it('renders a markup payload as TEXT — no element is created from it', () => {
    // The threat is an upstream `message` containing markup reaching the DOM. The
    // derivation layer is supposed to stop it ever arriving (see "NEVER returns the
    // upstream message" above); THIS arm pins the second line of defence — that even if
    // one did arrive, React escapes it. Non-ASCII rides along: the same escaping path is
    // what mangles it if anyone reaches for an HTML sink.
    const payload = '<b>bold</b> & "quoted" — naïve ✓ <img src=x onerror=boom>';
    const { container } = render(<FetchErrorBanner state={errorState(payload)} />);

    // The literal characters, angle brackets included, are present AS TEXT.
    expect(screen.getByText(payload)).toBeTruthy();
    // …and no element was created from any of it.
    expect(container.querySelector('b')).toBeNull();
    expect(container.querySelector('img')).toBeNull();
  });

  // SPEC Edge Coverage row: EMPTY / R1.
  it('an error with neither code nor message renders the ratified `unknown` copy', () => {
    // A network failure, or an HTML 5xx body: nothing to derive from. P1 forbids
    // authoring copy in a test, so the expected string is READ FROM THE MODULE rather
    // than transcribed — `getFetchErrorMessage(undefined)` is the register's own answer
    // for "no code at all".
    const ratifiedUnknown = getFetchErrorMessage(undefined);

    const { result } = renderHook(() =>
      useFetchErrorState(queryStub({ isError: true, error: new Error('') }))
    );
    expect(result.current.code).toBe('unknown');
    expect(result.current.message).toBe(ratifiedUnknown);

    render(<FetchErrorBanner state={result.current} />);
    const shown = screen.getByText(ratifiedUnknown);
    expect(shown.textContent).toBe(ratifiedUnknown);
    // The two failure shapes this row exists to catch, named rather than implied.
    expect(shown.textContent).not.toBe('');
    expect(shown.textContent).not.toBe('undefined');
  });

  // UI-SPEC §6.2 row: exactly one live region per failure.
  it('mounts exactly ONE assertive and ONE polite live region', () => {
    // WHAT THIS PROVES, and it is narrower than it looks: no SECOND region is added by a
    // sweep. Banner's internal StatusRegion announces assertively on the warning tone;
    // FetchErrorBanner adds a POLITE sr-only sibling for transient "Retrying…" text, and
    // the two must never nest or duplicate.
    //
    // WHAT IT DOES NOT PROVE: that the failure is ANNOUNCED. The UI-SPEC §6.2
    // ANNOUNCEMENT row is NOT marked verified by this arm, and plan 88.6-13 does not
    // satisfy it. The reason is EMPTY-FIRST: `StatusRegion.tsx:9-12` records that screen
    // readers announce CHANGES to a MOUNTED live region, not the conditional mount of a
    // new one — while `FetchErrorBanner.tsx:58` is `if (!state.showError) return null;`,
    // so the whole banner, its assertive region included, enters the DOM together with
    // its text. Routed durably, NOT left as an observation:
    // `.planning/deferred/phase-88.9.md`, with plan 88.6-36 (the plan that declares
    // FetchErrorBanner.tsx) named as the in-phase home if the owner wants it sooner.
    // No shared primitive is edited here — FetchErrorBanner has 29 call sites.
    const { container } = render(<FetchErrorBanner state={errorState('boom')} />);

    expect(container.querySelectorAll('[aria-live="assertive"]')).toHaveLength(1);
    expect(container.querySelectorAll('[aria-live="polite"]')).toHaveLength(1);
    // Sibling, never nested — a nested live region announces twice.
    const assertive = container.querySelector('[aria-live="assertive"]');
    expect(assertive?.querySelector('[aria-live]')).toBeNull();
  });
});
