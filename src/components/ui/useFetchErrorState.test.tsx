/**
 * useFetchErrorState behavior — the PRIM-03 error surface + error-only refocus
 * recovery (D-02). This is the behavioral proof the plan requires: the query
 * auto-refetches on window refocus WHILE erroring, and does NOT refetch on
 * refocus when successful — without any dependency on the global
 * `refetchOnWindowFocus: false` default (the hook takes a plain query result,
 * so no global config is in play).
 */
import * as React from 'react';
import { describe, it, expect, vi, afterEach } from 'vitest';
import { act, render, renderHook, screen, cleanup, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { UseQueryResult } from '@tanstack/react-query';
import { Modal } from '@/app/components/Modal';
import { useFetchErrorState, getFetchErrorMessage } from './useFetchErrorState';
import { FetchErrorBanner } from './FetchErrorBanner';
import type { FetchErrorState, FetchErrorCode } from './useFetchErrorState';
import { ApiError } from '@/lib/api';
import { logger } from '@/lib/logger';

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

// The proxy's CSRF rejection, built the way apiFetch builds it: code-less 403, so the code is the
// status-derived 'forbidden', and `details` is the WHOLE body. Producer: the CSRF gate in
// src/app/api/[...path]/route.ts (`csrf_rejected: true`). Plan 88.6.1-07 (D-24).
function csrfRejection(): ApiError {
  return new ApiError('Cross-origin request rejected', 'forbidden', 403, {
    error: 'Cross-origin request rejected',
    csrf_rejected: true,
  });
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
  // A CSRF-flagged 403 never reaches this arm since 88.6.1-07 (D-24); real backend 403s still do.
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

  // Phase 88.6-54 (R071 (d), WINDOWS 122): the two registry rows 88.8 added with NO behaviour
  // test. Each is asserted as the LITERAL copy — MESSAGE_BY_CODE is module-private and this plan
  // adds tests only, so it is not exported to be imported here. Deleting either row makes its
  // code fall back to `unknown` ("Something went wrong…"), which reds the matching case.
  // Demonstrated RED that way at execution (2026-09-28), then GREEN on restore.
  it('unsupported_address (the synthetic-target 400) resolves to its own designed copy', () => {
    expect(getFetchErrorMessage(new ApiError('x', 'unsupported_address', 400))).toBe(
      "That address can't be used with this app — the domain is reserved by our sign-in system."
    );
  });

  it('not_provisioned (the never-provisioned 404) resolves to its own designed copy', () => {
    expect(getFetchErrorMessage(new ApiError('x', 'not_provisioned', 404))).toBe(
      "Your account isn't set up yet. Reload the page and try again."
    );
  });

  // Phase 88.6.1-07 (D-30, copy row X1, 88.6.1-COPY-TABLE.html:161 column 5): the shared
  // `unauthorized` line is asserted LITERALLY, as the 88.6-54 arms above are. That is allowed
  // because COPY-RULING: A (88.6.1-SPEC.md:47-48) replaced 88.6's no-authored-copy rule: a
  // ratified row may be pinned byte for byte. X1-c is the control: a surface's own override
  // (the BGG search toast) still wins over the register.
  it('X1-a: unauthorized (401) resolves to the ratified X1 sentence', () => {
    expect(getFetchErrorMessage(new ApiError('', 'unauthorized', 401))).toBe(
      'Your session may have expired. Sign in again to continue.'
    );
  });

  it('X1-b: the hook surfaces the same X1 sentence for a 401', () => {
    const { result } = renderHook(() =>
      useFetchErrorState(queryStub({ isError: true, error: new ApiError('', 'unauthorized', 401) }))
    );
    expect(result.current.message).toBe('Your session may have expired. Sign in again to continue.');
  });

  it('X1-c: a surface override for unauthorized still wins over the register (control)', () => {
    expect(
      getFetchErrorMessage(new ApiError('', 'unauthorized', 401), { byCode: { unauthorized: 'x' } })
    ).toBe('x');
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
    // WHAT IT DOES NOT PROVE: that the failure is ANNOUNCED at a real call site.
    // REWRITTEN IN PLACE, Phase 88.6.1-21 (AC-11 / D-42): the assertive region now PRE-EXISTS
    // in the component — the full branch's render keeps its Banner mounted (visually hidden
    // while healthy), so the failure is text injected into a mounted region (the C1 arm below
    // pins the node identity). In production, though, every full mount is caller-gated (22
    // after wave 4: CT-2a's 21 plus plan 88.6.1-25's event-view banner), so the region is
    // INSERTED together with its text — which IS announced for `role="alert"` (D-42;
    // `StatusRegion.tsx:9-17`, the EMPTY-FIRST bullet's alert carve-out). FetchErrorBanner
    // has 33 mounts, re-countable from periodictabletop/ with
    //   grep -rn '<FetchErrorBanner' src --include='*.js' --include='*.tsx' | grep -v '\.test\.'
    // (38 lines at FE a4f38aa, 5 of them comment prose).
    const { container } = render(<FetchErrorBanner state={errorState('boom')} />);

    expect(container.querySelectorAll('[aria-live="assertive"]')).toHaveLength(1);
    expect(container.querySelectorAll('[aria-live="polite"]')).toHaveLength(1);
    // Sibling, never nested — a nested live region announces twice.
    const assertive = container.querySelector('[aria-live="assertive"]');
    expect(assertive?.querySelector('[aria-live]')).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Phase 88.6-36 task 3 — the `compact` branch's EMPTY-FIRST region (T-88.6-102, W38 class).
//
// WHAT THESE ARMS PROVE, and it is narrower than it looks: the COMPONENT is empty-first — its
// compact live region is mounted, empty and `sr-only` BEFORE the failure, and the notice arrives
// as a text CHANGE to that same node. They do NOT prove that any CONSUMER announces. Six of the
// twelve `compact` call sites gate the banner on `showError` at the CALLER, so the whole
// component is created by the failure and a component-level render like the one below passes
// green at all twelve regardless. Those six are named by `file:line` in
// `.planning/deferred/phase-88.6.md`. This is the same honesty clause the single-live-region arm
// above already carries; it is restated here because this is the arm most likely to be cited as
// if it closed the whole row.
//
// Three things are pinned, because a presence-only check stays green while React tears the region
// down and rebuilds it — which is exactly the failure mode the fix is about:
//   (a) POSITION  — the region is the FIRST child and a SIBLING of the visible compact wrapper,
//                   never nested inside it, so the wrapper's own mount cannot carry it;
//   (b) IDENTITY  — the element reference is CAPTURED before the transition and asserted to be
//                   the SAME node afterwards (`toBe`), not merely present in both states;
//   (c) VISIBILITY— `sr-only` in BOTH states, asserted mechanically. `StatusRegion` supplies no
//                   default visibility (`StatusRegion.tsx:102-106`, anchor `className={cn(`:
//                   'text-sm', then className, then only the opt-in srOnlyWhenEmpty, default
//                   false; re-anchored Phase 88.6.1-21), so an unstated className would ship a
//                   visible empty node on every consumer.
// ---------------------------------------------------------------------------

/** The healthy twin of `errorState` — same shape, `showError` false. */
const healthyState = (): FetchErrorState => ({
  showError: false,
  message: '',
  code: 'unknown',
  retry: vi.fn().mockResolvedValue(undefined),
});

describe('FetchErrorBanner — the compact branch announces (plan 88.6-36)', () => {
  it('mounts the compact region EMPTY and sr-only before the failure, and keeps the SAME node after it', () => {
    const { container, rerender } = render(
      <FetchErrorBanner compact state={healthyState()} />
    );

    // (a) POSITION, healthy: exactly one live region, and it is the FIRST child of the render.
    const before = container.querySelectorAll('[aria-live]');
    expect(before, 'exactly one live region in the compact branch').toHaveLength(1);
    const region = before[0] as HTMLElement;
    expect(region, 'the region is the first rendered node, not nested in the visible wrapper')
      .toBe(container.firstElementChild);

    // EMPTY-FIRST: mounted with no text to announce.
    expect(region.textContent).toBe('');
    // (c) VISIBILITY, healthy.
    expect(region).toHaveClass('sr-only');
    expect(region).toHaveAttribute('role', 'status');
    expect(region).toHaveAttribute('aria-live', 'polite');
    // The VISIBLE copy has NOT moved above the guard — only the announcing node did.
    expect(container.textContent).toBe('');
    expect(screen.queryByRole('button', { name: 'Retry' })).toBeNull();

    rerender(<FetchErrorBanner compact state={errorState('boom')} />);

    const after = container.querySelectorAll('[aria-live]');
    expect(after, 'still exactly one live region — the notice is a CHANGE, not a second region')
      .toHaveLength(1);
    // (b) IDENTITY — the load-bearing assertion. A remount here would make the fix a no-op
    // while every presence check above still passed. PROVEN NON-VACUOUS at plan 88.6-36's
    // commit by planting a `key` that changes with `showError` on the region: this line is the
    // one that reds ("the SAME DOM node carries the notice … Object.is equality"). Measured in
    // the same sitting and recorded because the component's marker was first drafted with the
    // opposite claim: the `if (!showError) return <StatusRegion/>` early-return shape does NOT
    // remount — React reconciles a single-element child against the first child of an array by
    // position — so this arm does not distinguish that refactor, and does not claim to.
    expect(after[0], 'the SAME DOM node carries the notice').toBe(region);
    expect(region.textContent).toBe('Some personal controls are unavailable.');
    // (c) VISIBILITY, failed.
    expect(region).toHaveClass('sr-only');
    // (a) POSITION, failed: still first, and the visible wrapper is its SIBLING.
    expect(region).toBe(container.firstElementChild);
    const visible = container.children[1] as HTMLElement;
    expect(visible.querySelector('[aria-live]'), 'the visible wrapper holds no live region')
      .toBeNull();
    expect(visible).not.toHaveAttribute('role', 'status');
    expect(screen.getByRole('button', { name: 'Retry' })).toBeInTheDocument();
  });

  it('adds no region to the FULL branch — the gate on `compact` is what keeps plan 13 green', () => {
    // An UNGATED hoist of the compact region would add a SECOND polite region to the full branch,
    // beside the one composed there. That is the exact shape the arm above ("mounts exactly ONE
    // assertive and ONE polite") goes red on; this is its positive control from the other side.
    // REWRITTEN IN PLACE, Phase 88.6.1-21 (AC-11 / D-42): the healthy full branch no longer
    // renders nothing — it keeps its Banner mounted (visually hidden) so the failure arrives as a
    // change to a mounted assertive region. What stays pinned is the count: still exactly ONE
    // polite region, so the compact region has not leaked into this branch.
    const { container } = render(<FetchErrorBanner state={healthyState()} />);
    const assertive = container.querySelectorAll('[aria-live="assertive"]');
    const polite = container.querySelectorAll('[aria-live="polite"]');
    expect(assertive, 'the healthy full branch mounts ONE assertive region').toHaveLength(1);
    expect(polite, 'and ONE polite region').toHaveLength(1);
    expect(assertive[0].textContent, 'both empty while healthy').toBe('');
    expect(polite[0].textContent).toBe('');
    expect(container.querySelectorAll('[role="status"][aria-live="polite"]')).toHaveLength(1);
    expect(container.querySelectorAll('button'), 'no control while healthy').toHaveLength(0);
  });

  it('carries no weight utility on any of the three link-buttons, colour and underline intact', () => {
    // UI-SPEC §4.5 names these three sites as the EMPHASIS case. CLASS-LEVEL on purpose: this
    // suite is jsdom, which performs no layout and loads no stylesheet, so a computed
    // `fontWeight` reads the UA default identically before and after the deletion and would
    // prove nothing (the D28 rule). The rendered-weight half is a browser measurement this
    // plan does not claim to have taken.
    const { unmount } = render(<FetchErrorBanner compact state={errorState('boom')} />);
    const compactRetry = screen.getByRole('button', { name: 'Retry' });
    expect(compactRetry).not.toHaveClass('font-medium');
    expect(compactRetry).toHaveClass('text-content-link');
    expect(compactRetry).toHaveClass('underline');
    unmount();

    render(<FetchErrorBanner state={errorState('boom')} />);
    for (const name of ['Try again', 'Report this']) {
      const button = screen.getByRole('button', { name });
      expect(button, `${name}: 500 is a §4.5 prohibition outside Button`).not.toHaveClass(
        'font-medium'
      );
      expect(button, `${name}: the emphasis is the colour`).toHaveClass('text-content-link');
      expect(button, `${name}: and the underline`).toHaveClass('underline');
    }
  });
});

// ---------------------------------------------------------------------------
// Phase 88.6-14 task 2 — the INCOMPLETE-ENVELOPE arms (R9 / SPEC Edge Coverage
// rows `empty / R9` and `encoding / R9`).
//
// Phase 93 deletes the `body.error` alias and the top-level `errors[]` mirror.
// What this file has to pin is the other half of that: what this function does
// when the envelope that arrives is incomplete — a `code` with no `message`, a
// code the register has never heard of, or no error object at all.
//
// HONEST SCOPE — the malformed-`details` arms below are VACUOUS BY CONSTRUCTION
// today, and they are kept as regression guards rather than counted as coverage.
// [AMENDED Phase 88.6.1-07 (D-24): no longer vacuous. `getFetchErrorMessage` now reads ONE
// strict key off `details` through api.ts's `isCsrfRejection` (an ApiError, status 403,
// a non-null object, `csrf_rejected === true`), so these arms now pin "malformed `details`
// never throws and never changes the answer". The sentences below describe the pre-07 tree.]
// `getFetchErrorMessage` calls `deriveCode` (useFetchErrorState.ts, anchor `function deriveCode`) and
// nothing else, and `deriveCode` reads `error.code` off an `ApiError`. It never
// dereferences `details` at all, so no amount of mangling that shape can make
// these arms fail. They WOULD red if someone later taught this function to
// re-parse the body — which the DECISION marker above `getFetchErrorMessage`
// forbids — and that is the whole of their value. They do NOT pin AC-9's
// "never throws" claim, and nothing in plan 88.6-14 does.
//
// The real `details` consumer is `extractFieldErrors` in `lib/api.ts` (:411, anchor
// `function extractFieldErrors`; called at :593, anchor `const fieldErrors = extractFieldErrors`),
// where a `[{}]` element renders the literal `undefined: undefined` into user-facing copy
// through the `.map` at :596 (anchor `.map(fieldErrorText)`; lines read at 88.6.1-07). That surface belongs to plan
// 42's `api.test.ts` consumer matrix and is deliberately NOT reached from here.
// ---------------------------------------------------------------------------

describe('getFetchErrorMessage — incomplete envelope (R9)', () => {
  it('a code with NO message resolves through the register, identically to one with a message', () => {
    // The Phase 93 shape: the backend stops sending `error`/`message` aliases and
    // the FE has only `code` to go on. P1 forbids authoring copy in a test, so the
    // expected value is not transcribed — it is the SAME code's answer when a
    // message IS present. Equal means the message was never consulted.
    const withMessage = getFetchErrorMessage(new ApiError('Forbidden: groups.owner', 'forbidden', 403));
    const withoutMessage = getFetchErrorMessage(new ApiError('', 'forbidden', 403));

    expect(withoutMessage).toBe(withMessage);
    expect(withoutMessage).toMatch(/access/i);
    expect(withoutMessage).not.toContain('groups.owner');
    expect(withoutMessage).not.toBe('');
    expect(withoutMessage).not.toBe('undefined');
  });

  it('a caller `byCode` arm wins over the register for a code with no message', () => {
    const custom = 'You are not on this list.'; // caller-supplied test value, not app copy
    const out = getFetchErrorMessage(new ApiError('', 'forbidden', 403), {
      byCode: { forbidden: custom },
    });
    expect(out).toBe(custom);
    // …and it did not silently also pick up the register entry.
    expect(out).not.toBe(getFetchErrorMessage(new ApiError('', 'forbidden', 403)));
  });

  it('an UNKNOWN code with no message returns the ratified `unknown` copy — never the code', () => {
    // A code the register has never heard of is exactly what a backend that ships
    // a new code before the FE does produces. `MESSAGE_BY_CODE[code] ?? unknown`
    // (the register lookup in `getFetchErrorMessage`) is the arm under test. The expected string is read from the module
    // via the register's own answer for "no code at all", never transcribed.
    const ratifiedUnknown = getFetchErrorMessage(undefined);
    const bogus = 'teapot_overheated' as FetchErrorCode;

    const out = getFetchErrorMessage(new ApiError('', bogus, 418));
    expect(out).toBe(ratifiedUnknown);
    expect(out).not.toContain('teapot');
    expect(out).not.toBe('');
    expect(out).not.toBe('undefined');
  });

  it('`fallback` applies ONLY when the resolved code is `unknown`', () => {
    // useFetchErrorState.ts, getFetchErrorMessage's gate — `if (code === 'unknown' && options.fallback)`.
    // This is the assertion the two rewritten docblocks in `useFetchErrorState.ts`
    // point at (plan 88.6-14 task 3), so it is what makes those docblocks checkable
    // rather than a second sentence that can drift from the first.
    const fallback = 'A surface-specific line.'; // caller-supplied test value

    // A real code -> the register wins; the caller's fallback is ignored entirely.
    const forbidden = getFetchErrorMessage(new ApiError('', 'forbidden', 403), { fallback });
    expect(forbidden).not.toBe(fallback);
    expect(forbidden).toBe(getFetchErrorMessage(new ApiError('', 'forbidden', 403)));

    // No code at all -> `unknown` -> the caller's fallback wins.
    expect(getFetchErrorMessage(new Error('raw'), { fallback })).toBe(fallback);

    // FINDING (plan 88.6-14 task 2, 2026-09-15) — an UNRECOGNISED code does NOT
    // take the fallback, even though the user SEES the `unknown` copy. `deriveCode`
    // (anchor `if (error instanceof ApiError) return error.code;`) returns an ApiError's code
    // VERBATIM, so the `code === 'unknown' && options.fallback` gate compares
    // 'teapot_overheated' against 'unknown' and fails, while the register lookup
    // (`MESSAGE_BY_CODE[code] ?? MESSAGE_BY_CODE.unknown`) falls through to the unknown line. The RESOLVED CODE and the
    // RENDERED COPY diverge, and this is the one path where a caller who asked for a
    // surface-specific line gets the generic one instead. Reachable: `mapErrorToCode`
    // casts `body.code as ApiErrorCode` unchecked (api.ts:348, anchor `body.code as ApiErrorCode`), so any backend code
    // the FE union has not caught up with lands here.
    //
    // PINNED AS SHIPPED, NOT FIXED. This is a gate task; plan 88.6-14 forbids
    // changing `getFetchErrorMessage` for anything short of a real throw or a real
    // blank, and this is neither — the user gets ratified copy. Routed durably as an
    // amendment to the 88-CODE-REVIEW MED#10 entry in `.planning/deferred/phase-93.md`,
    // which already owns the general "`fallback` only fires for 'unknown'" question.
    // Changing this is a decision, not a cleanup.
    const ratifiedUnknown = getFetchErrorMessage(undefined);
    expect(
      getFetchErrorMessage(new ApiError('', 'teapot_overheated' as FetchErrorCode, 418), { fallback })
    ).toBe(ratifiedUnknown);
  });

  it('every non-ApiError input returns register copy — never blank, never the literal `undefined`', () => {
    const ratifiedUnknown = getFetchErrorMessage(undefined);
    const inputs: unknown[] = [
      new Error('raw'),
      null,
      undefined,
      {},
      { code: 'forbidden' }, // a bare object is NOT an ApiError — `code` must not be read off it
      'a string',
      0,
    ];
    for (const input of inputs) {
      const out = getFetchErrorMessage(input);
      expect(out, `input ${JSON.stringify(input)}`).toBe(ratifiedUnknown);
      expect(out).not.toBe('');
      expect(out).not.toBe('undefined');
    }
  });

  it('malformed `details` shapes cannot change the answer (RETAINED regression guard)', () => {
    // READ THE BLOCK COMMENT ABOVE THIS DESCRIBE BEFORE TRUSTING THIS ARM.
    // [AMENDED Phase 88.6.1-07 (D-24): `details` IS dereferenced now, for one strict key via
    // `isCsrfRejection`, so this arm pins "malformed `details` never throws and never changes
    // the answer". The next six lines describe the pre-07 tree.]
    // `getFetchErrorMessage` reaches only `deriveCode`, which reads `error.code`.
    // `details` is never dereferenced, so this arm CANNOT fail against the current
    // implementation however the shape is mangled. It is kept because it WOULD red
    // if this function were ever taught to re-parse the body, and deleted the day
    // that becomes impossible by type. It is not evidence of a never-throws
    // guarantee — plan 42's `api.test.ts` matrix over `extractFieldErrors` is where
    // the shape is actually walked.
    const expected = getFetchErrorMessage(new ApiError('', 'validation', 400));
    const malformed: unknown[] = [
      undefined,
      null,
      {},
      { errors: null },
      { errors: 'not an array' },
      { errors: [{}] },
      { errors: [{ field: undefined, message: undefined }] },
      [],
      'string details',
      0,
    ];
    for (const details of malformed) {
      const out = getFetchErrorMessage(new ApiError('', 'validation', 400, details));
      expect(out, `details ${JSON.stringify(details)}`).toBe(expected);
      expect(out).not.toBe('');
      expect(out).not.toBe('undefined');
    }
  });
});

// ---------------------------------------------------------------------------
// Phase 88.6.1-07 (D-24 (a2), MEDLOW-9 = R2 #8; copy row X2).
//
// The BFF proxy's CSRF gate is a SECOND source of a code-less 403 on every unsafe-method call,
// and mapErrorToCode resolves it to 'forbidden' exactly like a backend refusal. Before this plan
// the message function therefore printed a ROLE refusal ("Only the poll creator...") or the
// register's permission line for a request the backend never saw. The fix routes the MESSAGE of
// a proxy-flagged 403 through the `unknown` arm (byCode.unknown, else the caller's fallback, else
// the register's unknown line) while the CODE stays the honest 'forbidden' (a2 over a1).
//
// The role sentence and the fallback below are existing shipped copy (OpenPollsList's end-check-in
// call, and StartPollModal's start call), not new strings. C4 is the anti-vacuity control: a real
// backend 403 still prints the role sentence, so the change is keyed on the flag, not on 403.
// ---------------------------------------------------------------------------
describe('getFetchErrorMessage — a proxy CSRF 403 never prints a role refusal (88.6.1-07, D-24)', () => {
  const ROLE = 'Only the poll creator and group admins can end a check-in.';
  const FALLBACK = "We couldn't end that check-in. Please try again.";

  it('C1: a CSRF 403 with a fallback and a forbidden override prints the fallback', () => {
    expect(getFetchErrorMessage(csrfRejection(), { fallback: FALLBACK, byCode: { forbidden: ROLE } })).toBe(
      FALLBACK
    );
  });

  it('C2: a CSRF 403 with no options prints the register unknown line, not the forbidden line', () => {
    const ratifiedUnknown = getFetchErrorMessage(undefined);
    const out = getFetchErrorMessage(csrfRejection());
    expect(out).toBe(ratifiedUnknown);
    expect(out).not.toBe(getFetchErrorMessage(new ApiError('', 'forbidden', 403)));
  });

  it('C3: the StartPollModal shape (override, no fallback) prints the register unknown line', () => {
    const out = getFetchErrorMessage(csrfRejection(), {
      byCode: { forbidden: 'You must be an active group member to start a poll.' },
    });
    expect(out).toBe(getFetchErrorMessage(undefined));
  });

  it('C4: a backend 403 WITHOUT the flag still prints the role sentence (control)', () => {
    const backend = new ApiError('x', 'forbidden', 403, { error: 'Access denied' });
    expect(getFetchErrorMessage(backend, { fallback: FALLBACK, byCode: { forbidden: ROLE } })).toBe(ROLE);
  });

  it('C5: the hook keeps the honest code (forbidden) while its message is the unknown line', () => {
    const { result } = renderHook(() =>
      useFetchErrorState(queryStub({ isError: true, error: csrfRejection() }))
    );
    expect(result.current.code).toBe('forbidden');
    expect(result.current.message).toBe(getFetchErrorMessage(undefined));
  });

  it('C6: a malformed flag on a real 403 keeps the forbidden line and never throws', () => {
    const forbiddenLine = getFetchErrorMessage(new ApiError('', 'forbidden', 403));
    const malformed: unknown[] = [
      { csrf_rejected: 'true' },
      { csrf_rejected: 1 },
      { csrf_rejected: false },
      [],
      'csrf_rejected',
      null,
      undefined,
    ];
    for (const details of malformed) {
      let out = '';
      expect(() => {
        out = getFetchErrorMessage(new ApiError('', 'forbidden', 403, details));
      }, `details ${JSON.stringify(details)} must not throw`).not.toThrow();
      expect(out, `details ${JSON.stringify(details)}`).toBe(forbiddenLine);
    }
  });
});

// ---------------------------------------------------------------------------
// Phase 88.6.1-21 — the shared error surface's retries (R123 / W064, AC-9), the Req 5
// success-retry focus floor, and (Tasks 2-3) the retry OUTCOME both branches share.
//
// Testing rules this block follows (FE-TESTING-CONVENTIONS): every RED half is an ATTRIBUTE, a
// CALL COUNT or a removal-driven document.activeElement, never a blur (C-11: jsdom never blurs a
// disabled element); focus is asserted against a NAMED node (C-5); waits are for a POSITIVE
// signal (CF-26); comments are line comments only (CF-9).
//
// THE LATER COMMIT IS DRIVEN BY HAND. TanStack commits a query's outcome one macrotask after its
// refetch promise resolves (notifyManager.js:3, systemSetTimeoutZero). The hosts below model that
// with a commit the TEST releases (controls.setFailed) rather than a setTimeout(0), because
// React's async act itself yields a macrotask while it drains, which would let a zero-delay timer
// land inside the act and make the "after the settle, before the commit" checkpoint flaky. The
// order the arms pin (settle first, commit after) is the same; the timing is deterministic.
// ---------------------------------------------------------------------------

/** A promise whose settlement the test drives. */
function deferred<T = unknown>() {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}
type Deferred = ReturnType<typeof deferred>;

/** A whole opacity utility under any variant prefix (the 88.8 colour rule forbids it here). */
const OPACITY_TOKEN = /(^|\s|:)opacity-\d/;

/** A failed state whose retry is the given function. */
const failingState = (retry: () => Promise<unknown>): FetchErrorState => ({
  showError: true,
  message: 'boom',
  code: 'unknown',
  retry,
});

const HOST_TITLE = "Couldn't load the plan";

interface RetryHostControls {
  setFailed?: (failed: boolean) => void;
}

interface RetryHostProps {
  d: Deferred;
  compact?: boolean;
  // 'caller': the host mounts the banner only while failed (the 22 full / 6 compact caller-gated
  // mounts); 'component': the banner is always mounted and its showError follows the host.
  gate: 'caller' | 'component';
  // What the host does to its failure flag. `atPress`: it clears the flag when the retry starts
  // (a never-loaded TanStack query reports pending, so showError is false for the whole retry).
  // `onResolved`: what it does once the retry's promise resolves, BEFORE the banner settles —
  // 'clear' (success), 'fail' (the failure commits again), or 'none' (the test commits later by
  // hand through `controls`).
  atPress?: boolean;
  onResolved?: 'clear' | 'fail' | 'none';
  controls?: RetryHostControls;
}

function RetryHost({ d, compact = false, gate, atPress = false, onResolved = 'none', controls }: RetryHostProps) {
  const [failed, setFailed] = React.useState(true);
  if (controls) controls.setFailed = setFailed;
  const retry = async () => {
    if (atPress) setFailed(false);
    const result = await d.promise;
    if (onResolved === 'clear') setFailed(false);
    if (onResolved === 'fail') setFailed(true);
    return result;
  };
  const state: FetchErrorState = {
    showError: gate === 'component' ? failed : true,
    message: 'boom',
    code: 'unknown',
    retry,
  };
  const banner = <FetchErrorBanner compact={compact} title={HOST_TITLE} state={state} />;
  return (
    <main>
      <h1>Game night</h1>
      {gate === 'caller' ? failed && banner : banner}
    </main>
  );
}

describe('FetchErrorBanner — R123 retries and the success-retry focus floor (plan 88.6.1-21)', () => {
  it('A1: the full Try again issues ONE retry for two presses in one tick and stays focusable with aria-disabled', async () => {
    const d = deferred();
    const retry = vi.fn(() => d.promise);
    render(<FetchErrorBanner state={failingState(retry)} />);
    const button = screen.getByRole('button', { name: 'Try again' });

    // Two activations in one tick: a state-only guard reads stale state here; the ref latch does not.
    act(() => {
      button.click();
      button.click();
    });
    expect(retry, 'two presses in one tick issue exactly ONE retry').toHaveBeenCalledTimes(1);
    expect(button).toHaveAttribute('aria-disabled', 'true');
    expect(button, 'never the native gate: it would drop focus from the pressed control').not.toHaveAttribute('disabled');
    expect(button).toHaveTextContent('Retrying…');

    await act(async () => {
      d.resolve(undefined);
    });
    expect(button, 'at rest the attribute is ABSENT, not "false"').not.toHaveAttribute('aria-disabled');
    expect(button).toHaveTextContent('Try again');
  });

  it('A2: the compact Retry issues ONE retry for two presses in one tick and stays focusable with aria-disabled', async () => {
    const d = deferred();
    const retry = vi.fn(() => d.promise);
    render(<FetchErrorBanner compact state={failingState(retry)} />);
    const button = screen.getByRole('button', { name: 'Retry' });

    act(() => {
      button.click();
      button.click();
    });
    expect(retry, 'two presses in one tick issue exactly ONE retry').toHaveBeenCalledTimes(1);
    expect(button).toHaveAttribute('aria-disabled', 'true');
    expect(button).not.toHaveAttribute('disabled');
    expect(button).toHaveTextContent('Retrying…');

    await act(async () => {
      d.resolve(undefined);
    });
    expect(button).not.toHaveAttribute('aria-disabled');
    expect(button).toHaveTextContent('Retry');
  });

  it('A3: at rest neither retry carries aria-disabled, and each is colour-gated, never opacity-gated', () => {
    const { unmount } = render(<FetchErrorBanner compact state={errorState('boom')} />);
    const compactRetry = screen.getByRole('button', { name: 'Retry' });
    expect(compactRetry).not.toHaveAttribute('aria-disabled');
    expect(compactRetry.className.split(/\s+/)).toContain('aria-disabled:text-content-muted');
    expect(compactRetry.className).not.toMatch(OPACITY_TOKEN);
    unmount();

    render(<FetchErrorBanner state={errorState('boom')} />);
    const fullRetry = screen.getByRole('button', { name: 'Try again' });
    expect(fullRetry).not.toHaveAttribute('aria-disabled');
    expect(fullRetry.className.split(/\s+/)).toContain('aria-disabled:text-content-muted');
    expect(fullRetry.className).not.toMatch(OPACITY_TOKEN);
  });

  it('B1: a successful full retry at a caller-gated mount lands focus on the page heading, never <body>', async () => {
    const user = userEvent.setup();
    const d = deferred();
    render(<RetryHost d={d} gate="caller" onResolved="clear" />);
    const heading = screen.getByRole('heading', { level: 1, name: 'Game night' });

    await user.click(screen.getByRole('button', { name: 'Try again' }));
    await act(async () => {
      d.resolve({ isError: false });
    });
    expect(screen.queryByRole('button', { name: /^(Try again|Retrying…)$/ })).toBeNull();
    await waitFor(() => expect(document.activeElement).toBe(heading));
  });

  it('B2: a successful full retry at an in-component mount lands focus on the page heading, never <body>', async () => {
    const user = userEvent.setup();
    const d = deferred();
    render(<RetryHost d={d} gate="component" onResolved="clear" />);
    const heading = screen.getByRole('heading', { level: 1, name: 'Game night' });

    await user.click(screen.getByRole('button', { name: 'Try again' }));
    await act(async () => {
      d.resolve({ isError: false });
    });
    expect(screen.queryByRole('button', { name: /^(Try again|Retrying…)$/ })).toBeNull();
    await waitFor(() => expect(document.activeElement).toBe(heading));
  });

  it('B3: a successful compact retry at a caller-gated mount lands focus on the page heading, never <body>', async () => {
    const user = userEvent.setup();
    const d = deferred();
    render(<RetryHost d={d} compact gate="caller" onResolved="clear" />);
    const heading = screen.getByRole('heading', { level: 1, name: 'Game night' });

    await user.click(screen.getByRole('button', { name: 'Retry' }));
    await act(async () => {
      d.resolve({ isError: false });
    });
    expect(screen.queryByRole('button', { name: /^(Retry|Retrying…)$/ })).toBeNull();
    await waitFor(() => expect(document.activeElement).toBe(heading));
  });

  it('B4: a successful compact retry at an in-component mount lands focus on the page heading, never <body>', async () => {
    const user = userEvent.setup();
    const d = deferred();
    render(<RetryHost d={d} compact gate="component" onResolved="clear" />);
    const heading = screen.getByRole('heading', { level: 1, name: 'Game night' });

    await user.click(screen.getByRole('button', { name: 'Retry' }));
    await act(async () => {
      d.resolve({ isError: false });
    });
    expect(screen.queryByRole('button', { name: /^(Retry|Retrying…)$/ })).toBeNull();
    await waitFor(() => expect(document.activeElement).toBe(heading));
  });

  it('B5 (R5 ordering backstop): focus moves only after the removal commits, not at the settle', async () => {
    const user = userEvent.setup();
    const d = deferred();
    const controls: RetryHostControls = {};
    render(<RetryHost d={d} gate="caller" onResolved="none" controls={controls} />);
    const heading = screen.getByRole('heading', { level: 1, name: 'Game night' });
    const button = screen.getByRole('button', { name: 'Try again' });

    await user.click(button);
    await act(async () => {
      d.resolve({ isError: false });
    });
    // Settled, removal not yet committed (the TanStack shape): the pressed retry keeps focus.
    expect(button.isConnected).toBe(true);
    expect(document.activeElement).toBe(button);

    act(() => controls.setFailed?.(false));
    await waitFor(() => expect(document.activeElement).toBe(heading));
    expect(button.isConnected).toBe(false);
  });

  it('B6 (pin): a failed retry at a host that keeps the banner mounted leaves focus on the retry, back at rest', async () => {
    // Green both ways: a pin, not a red half. What it does NOT cover: a caller that swaps the
    // banner out DURING the retry (a never-loaded TanStack query reports pending, so showError is
    // false from the press to the outcome; Routed finding 1, Phase 92) — there the floor catches
    // focus at the press, and nothing hands it back to the retry after the failure.
    const user = userEvent.setup();
    const d = deferred();
    render(<RetryHost d={d} gate="caller" onResolved="fail" />);
    const button = screen.getByRole('button', { name: 'Try again' });

    await user.click(button);
    await act(async () => {
      d.resolve({ isError: true });
    });
    expect(button.isConnected).toBe(true);
    expect(document.activeElement).toBe(button);
    expect(button).toHaveTextContent('Try again');
  });

  it('B7: a successful retry inside a Modal lands focus on the dialog title, never the container or <body>', async () => {
    const user = userEvent.setup();
    const d = deferred();
    function DialogHost() {
      const [failed, setFailed] = React.useState(true);
      const state = failingState(async () => {
        const result = await d.promise;
        setFailed(false);
        return result;
      });
      return (
        <Modal open onClose={() => {}}>
          <Modal.Header>Members</Modal.Header>
          <Modal.Body>
            {failed && <FetchErrorBanner title={HOST_TITLE} state={state} />}
            <p>Member list</p>
          </Modal.Body>
        </Modal>
      );
    }
    render(<DialogHost />);
    const title = screen.getByRole('heading', { name: 'Members' });

    await user.click(screen.getByRole('button', { name: 'Try again' }));
    await act(async () => {
      d.resolve({ isError: false });
    });
    await waitFor(() => expect(document.activeElement).toBe(title));
    expect(document.activeElement).not.toBe(screen.getByRole('dialog'));
    expect(document.activeElement).not.toBe(document.body);
  });
});

// ---------------------------------------------------------------------------
// Phase 88.6.1-21 Task 2 — the full branch keeps its Banner mounted (AC-11 / D-42), its buttons
// leave the atomic alert (Banner's `actions` slot), and a FAILED retry is told through the polite
// region — with ONE outcome rule shared with the compact branch: the outcome is read from the
// retry's OWN result and takes effect only once the committed state agrees.
// ---------------------------------------------------------------------------

/** A retry that hands back a fresh deferred on every call, so each press is driven separately. */
function pressableRetry() {
  const pending: Deferred[] = [];
  const retry = vi.fn(() => {
    const d = deferred();
    pending.push(d);
    return d.promise;
  });
  return { retry, pending };
}

describe('FetchErrorBanner — the full branch region and the retry outcome (plan 88.6.1-21, AC-11 / D-42)', () => {
  it('C1: the assertive region is mounted EMPTY while healthy and the SAME node carries the failure', () => {
    const { container, rerender } = render(<FetchErrorBanner title={HOST_TITLE} state={healthyState()} />);

    const assertives = container.querySelectorAll('[aria-live="assertive"]');
    expect(assertives, 'one assertive region exists BEFORE the failure').toHaveLength(1);
    const region = assertives[0] as HTMLElement;
    expect(region).toHaveAttribute('role', 'alert');
    expect(region.textContent, 'empty first (Edge R3 empty)').toBe('');
    const root = container.firstElementChild as HTMLElement;
    expect(root, 'the healthy banner is visually hidden').toHaveClass('sr-only');
    expect(container.textContent, 'nothing to see or hear while healthy').toBe('');
    expect(container.querySelectorAll('button')).toHaveLength(0);

    rerender(<FetchErrorBanner title={HOST_TITLE} state={errorState('boom')} />);

    expect(container.querySelector('[aria-live="assertive"]'), 'the SAME node (Edge R3 ordering)').toBe(region);
    expect(region).toHaveTextContent(HOST_TITLE);
    expect(region).toHaveTextContent('boom');
    expect(container.firstElementChild).toBe(root);
    expect(root).not.toHaveClass('sr-only');
    expect(container.querySelectorAll('[aria-live="assertive"]')).toHaveLength(1);
    expect(container.querySelectorAll('[aria-live="polite"]')).toHaveLength(1);
    for (const live of Array.from(container.querySelectorAll('[aria-live]'))) {
      expect(live.querySelector('[aria-live]'), 'never nested (Edge R3 adjacency)').toBeNull();
    }
    // At least one, never a fixed count: plan 88.6.1-69 makes `Report this` conditional.
    const buttons = screen.getAllByRole('button');
    expect(buttons.length).toBeGreaterThan(0);
    for (const button of buttons) {
      expect(button.closest('[aria-live]'), `${button.textContent}: outside every live region`).toBeNull();
    }
  });

  it('C2: every failed retry says Retrying… and then the title, each as a NEW node', async () => {
    const user = userEvent.setup();
    const { retry, pending } = pressableRetry();
    const { container } = render(<FetchErrorBanner title={HOST_TITLE} state={failingState(retry)} />);
    const polite = container.querySelector('[aria-live="polite"]') as HTMLElement;
    const button = screen.getByRole('button', { name: 'Try again' });

    let settledNode: ChildNode | null = null;
    for (const round of [0, 1]) {
      await user.click(button);
      expect(polite.textContent, `failure ${round + 1}: in flight`).toBe('Retrying…');
      const inFlightNode = polite.firstChild;
      if (settledNode) {
        expect(inFlightNode, `failure ${round + 1}: the press is a node addition, not a text rewrite`).not.toBe(settledNode);
      }
      await act(async () => {
        pending[round].resolve({ isError: true });
      });
      expect(polite.textContent, `failure ${round + 1}: settled`).toBe(HOST_TITLE);
      expect(polite.firstChild, `failure ${round + 1}: the outcome is a NEW node`).not.toBe(inFlightNode);
      settledNode = polite.firstChild;
    }
  });

  it('C3: a success-shaped or an unknown result never puts the title in the polite region', async () => {
    const user = userEvent.setup();
    for (const result of [{ isError: false }, undefined]) {
      const { retry, pending } = pressableRetry();
      const { container, unmount } = render(<FetchErrorBanner title={HOST_TITLE} state={failingState(retry)} />);
      const polite = container.querySelector('[aria-live="polite"]') as HTMLElement;
      await user.click(screen.getByRole('button', { name: 'Try again' }));
      expect(polite.textContent).toBe('Retrying…');
      await act(async () => {
        pending[0].resolve(result);
      });
      expect(polite.textContent, `result ${JSON.stringify(result)}: no failure is announced`).toBe('');
      unmount();
    }
  });

  it('C4: a success whose state commits one macrotask later is never announced as a failure', async () => {
    const user = userEvent.setup();
    const d = deferred();
    const controls: RetryHostControls = {};
    const { container } = render(<RetryHost d={d} gate="component" onResolved="none" controls={controls} />);
    const polite = container.querySelector('[aria-live="polite"]') as HTMLElement;

    await user.click(screen.getByRole('button', { name: 'Try again' }));
    await act(async () => {
      d.resolve({ isError: false });
    });
    // Settled, but the committed state still shows the failure (the TanStack lag).
    expect(screen.getByText('boom')).toBeInTheDocument();
    expect(polite.textContent, 'never the title between the settle and the commit').toBe('');

    act(() => controls.setFailed?.(false));
    expect(screen.queryByText('boom')).toBeNull();
    expect(polite.textContent).toBe('');
    expect(container.querySelector('[aria-live="assertive"]')?.textContent).toBe('');
  });

  it('C5: a REJECTED retry is caught, reported once with the errCtx shape, never announced, and releases the latch', async () => {
    const warn = vi.spyOn(logger, 'warn').mockImplementation(() => {});
    try {
      const user = userEvent.setup();
      const { retry, pending } = pressableRetry();
      const { container } = render(<FetchErrorBanner title={HOST_TITLE} state={failingState(retry)} />);
      const polite = container.querySelector('[aria-live="polite"]') as HTMLElement;
      const button = screen.getByRole('button', { name: 'Try again' });

      await user.click(button);
      await act(async () => {
        pending[0].reject(new TypeError('adapter bug'));
      });
      expect(button, 'the latch released').toHaveTextContent('Try again');
      expect(button).not.toHaveAttribute('aria-disabled');
      expect(polite.textContent, 'an unknown outcome never speaks the title').toBe('');
      expect(warn).toHaveBeenCalledTimes(1);
      expect(warn.mock.calls[0][1], 'name and message only (T-84-01)').toEqual({
        name: 'TypeError',
        message: 'adapter bug',
      });

      await user.click(button);
      expect(retry, 'a second press retries again').toHaveBeenCalledTimes(2);
      await act(async () => {
        pending[1].resolve(undefined);
      });
    } finally {
      warn.mockRestore();
    }
  });

  it('C6: when the assertive region itself empties and refills during the flight, the polite title is skipped', async () => {
    const user = userEvent.setup();
    const d = deferred();
    const { container } = render(<RetryHost d={d} gate="component" atPress onResolved="fail" />);
    const assertive = container.querySelector('[aria-live="assertive"]') as HTMLElement;
    const polite = container.querySelector('[aria-live="polite"]') as HTMLElement;

    await user.click(screen.getByRole('button', { name: 'Try again' }));
    expect(assertive.textContent, 'the never-loaded shape empties the assertive region at the press').toBe('');
    await act(async () => {
      d.resolve({ isError: true });
    });
    expect(container.querySelector('[aria-live="assertive"]')).toBe(assertive);
    expect(assertive, 'the refill already speaks the title').toHaveTextContent(HOST_TITLE);
    expect(assertive).toHaveTextContent('boom');
    expect(polite.textContent, 'so the polite region does not repeat it').toBe('');
  });
});
