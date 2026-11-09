// Phase 88.9-26 pins for FetchErrorBanner (round 2):
//   BANNER-01 — the optional thing prop composes the title Couldn't load {thing}
//               (straight apostrophe, no We, no trailing period); a passed title still wins.
//   R073      — the compact Retry's halo is its HOST's ground through the typed hostGround key
//               (src/components/ui/hostGround.ts ("export const HOST_GROUND_HALO")), card by default.
//
// Testing rules (.planning/codebase/FE-TESTING-CONVENTIONS.md): line comments only (CF-9); these
// are class / DOM pins (SPEC Edge R4 empty: no new text-over-colour pair is introduced here).
import * as React from 'react';
import { render, screen, cleanup } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { FetchErrorBanner } from './FetchErrorBanner';
import { HOST_GROUND_HALO } from './hostGround';
import { getFetchErrorMessage } from './useFetchErrorState';
import type { FetchErrorCode, FetchErrorState } from './useFetchErrorState';
import { ApiError } from '@/lib/api';

afterEach(() => {
  cleanup();
  window.history.pushState({}, '', '/');
});

const STATUS_BY_CODE: Partial<Record<FetchErrorCode, number>> = { unauthorized: 401, internal: 500 };

/** A full, permanently failed state for one code, its message derived the way the host derives it. */
const failed = (code: FetchErrorCode = 'internal', extra: Partial<FetchErrorState> = {}): FetchErrorState => ({
  showError: true,
  message: getFetchErrorMessage(new ApiError('x', code, STATUS_BY_CODE[code] ?? 500)),
  code,
  retry: vi.fn().mockResolvedValue(undefined),
  ...extra,
});

/** The Banner title span inside the one assertive region (null when no title renders). */
const titleText = () => screen.getByRole('alert').querySelector('span.font-bold')?.textContent ?? null;

describe('FetchErrorBanner — 88.9-26 title, halo and sign-in pins', () => {
  it("BANNER-01 (88.9): thing composes Couldn't load {thing} with no trailing period; title still wins when passed", () => {
    let utils = render(<FetchErrorBanner state={failed()} thing="your groups" />);
    const composed = titleText();
    expect(composed, 'thing composes the title').toBe("Couldn't load your groups");
    expect(composed, 'a straight apostrophe (U+0027)').toContain(String.fromCharCode(0x27));
    expect(composed, 'never a curly one (U+2019)').not.toContain(String.fromCharCode(0x2019));
    expect(composed, 'no trailing period').not.toMatch(/\.$/);
    expect(composed, 'no We').not.toMatch(/\bWe\b/);
    utils.unmount();

    utils = render(<FetchErrorBanner state={failed()} title="Custom" thing="x" />);
    expect(titleText(), 'a passed title still wins over thing').toBe('Custom');
    utils.unmount();

    utils = render(<FetchErrorBanner state={failed()} />);
    expect(titleText(), 'with neither, the default stays').toBe('Something went wrong');
    utils.unmount();

    render(<FetchErrorBanner state={failed()} thing="" />);
    expect(titleText(), 'an empty thing reads as no thing').toBe('Something went wrong');
  });

  it("R073 (88.9): the compact Retry halo comes from hostGround — card by default, the host's ground when passed", () => {
    let utils = render(<FetchErrorBanner compact state={failed()} />);
    const byDefault = screen.getByRole('button', { name: 'Retry' }).className;
    expect(byDefault, 'no prop: the card halo').toContain('focus-visible:ring-offset-surface-card');
    utils.unmount();

    utils = render(<FetchErrorBanner compact state={failed()} hostGround="page" />);
    const onPage = screen.getByRole('button', { name: 'Retry' }).className;
    expect(onPage, 'hostGround page: the page halo').toContain('focus-visible:ring-offset-surface-page');
    expect(onPage, 'hostGround page: the card halo is merged away').not.toContain('ring-offset-surface-card');
    utils.unmount();

    expect(Object.keys(HOST_GROUND_HALO).sort(), 'exactly the four host grounds').toEqual([
      'card',
      'elevated',
      'muted',
      'page',
    ]);
    for (const [key, value] of Object.entries(HOST_GROUND_HALO)) {
      expect(value, `${key}: one whole literal`).toBe(`focus-visible:ring-offset-surface-${key}`);
    }
  });
});
