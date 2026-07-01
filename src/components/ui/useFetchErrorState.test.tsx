/**
 * useFetchErrorState behavior — the PRIM-03 error surface + error-only refocus
 * recovery (D-02). This is the behavioral proof the plan requires: the query
 * auto-refetches on window refocus WHILE erroring, and does NOT refetch on
 * refocus when successful — without any dependency on the global
 * `refetchOnWindowFocus: false` default (the hook takes a plain query result,
 * so no global config is in play).
 */
import { describe, it, expect, vi, afterEach } from 'vitest';
import { renderHook, cleanup } from '@testing-library/react';
import type { UseQueryResult } from '@tanstack/react-query';
import { useFetchErrorState } from './useFetchErrorState';
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
