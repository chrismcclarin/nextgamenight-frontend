// Phase 88.9-26 pins for FetchErrorBanner (round 2):
//   BANNER-01 — the optional thing prop composes the title Couldn't load {thing}
//               (straight apostrophe, no We, no trailing period); a passed title still wins.
//   R073      — the compact Retry's halo is its HOST's ground through the typed hostGround key
//               (src/components/ui/hostGround.ts ("export const HOST_GROUND_HALO")), card by default.
//   O22d      — for code unauthorized the FULL banner's action is a Sign in link to
//               /api/auth/login?returnTo=<path + search + hash> IN PLACE OF Try again, 44px at every
//               width; every other code keeps Try again; the compact notice keeps its Retry. The link
//               arms the same focus watch as Try again, and a pressed retry that turns 401 lands on it.
//
// Testing rules (.planning/codebase/FE-TESTING-CONVENTIONS.md): line comments only (CF-9); these
// are class / DOM pins (SPEC Edge R4 empty: no new text-over-colour pair is introduced here).
import * as React from 'react';
import { readdirSync, readFileSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';
import { act, render, screen, cleanup, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
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

// The 25 members of ApiErrorCode, as src/components/ui/FetchErrorBanner.refresh.test.tsx ("const ALL_CODES: FetchErrorCode[] = [") lists them.
const ALL_CODES: FetchErrorCode[] = [
  'unknown',
  'validation',
  'unauthorized',
  'forbidden',
  'not_found',
  'rate_limited',
  'token_invalid',
  'prompt_closed',
  'prompt_deadline_expired',
  'reminder_cooldown',
  'owner_of_active_groups',
  'account_deleted',
  'already_restored',
  'window_expired',
  'already_used',
  'invalid_token',
  'gone',
  'conflict',
  'already_member',
  'invite_pending',
  'not_provisioned',
  'unsupported_address',
  'internal',
  'network',
  'config',
];

const X1 = 'Your session may have expired. Sign in again to continue.';

/** A host with a section heading, passed as the banner's focusTarget (the D-05 fallback). */
function HeadedBanner({ state }: { state: FetchErrorState }) {
  const headingRef = React.useRef<HTMLHeadingElement>(null);
  return (
    <>
      <h2 ref={headingRef} tabIndex={-1}>
        Groups
      </h2>
      <FetchErrorBanner state={state} focusTarget={headingRef} />
    </>
  );
}

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

    // AMENDED Phase 88.9-30 (owner picks B3a + B1a): the map grows from four keys to six (warning,
    // the T box ground; group, the G host variable), each still one whole focus-visible literal.
    expect(HOST_GROUND_HALO, 'exactly the six host grounds, each one whole literal').toEqual({
      card: 'focus-visible:ring-offset-surface-card',
      page: 'focus-visible:ring-offset-surface-page',
      elevated: 'focus-visible:ring-offset-surface-elevated',
      muted: 'focus-visible:ring-offset-surface-muted',
      warning: 'focus-visible:ring-offset-status-warning-subtle',
      group: 'focus-visible:ring-offset-surface-group-halo',
    });
  });

  it('O22d (88.9): an unauthorized banner shows Sign in to /api/auth/login?returnTo=<this path>, 44px tall, in place of Try again, and no other code does', () => {
    window.history.pushState({}, '', '/groupHomePage?groupId=7#members');
    let utils = render(<FetchErrorBanner state={failed('unauthorized')} />);
    const link = screen.getByRole('link', { name: 'Sign in' });
    expect(link.getAttribute('href'), 'returnTo is this path + search + hash, encoded').toBe(
      '/api/auth/login?returnTo=%2FgroupHomePage%3FgroupId%3D7%23members'
    );
    for (const cls of ['min-h-11', 'min-w-11', 'inline-flex', 'items-center', 'text-content-link', 'underline']) {
      expect(link, `Sign in carries ${cls}`).toHaveClass(cls);
    }
    expect(link, 'Sign in takes the elevated halo of the Banner it sits in').toHaveClass(
      'focus-visible:ring-offset-surface-elevated'
    );
    expect(link, '44px at every width: no desktop reset').not.toHaveClass('md:min-h-0');
    expect(screen.queryByRole('button', { name: 'Try again' }), 'Sign in is IN PLACE OF Try again').toBeNull();
    const alert = screen.getByRole('alert');
    expect(alert.textContent, 'the X1 sentence still reads').toContain(X1);
    expect(alert.closest('.border-l-4'), 'AMBER vs RED: the warning stripe stays').toHaveClass('border-l-status-warning');
    utils.unmount();

    for (const code of ALL_CODES.filter((c) => c !== 'unauthorized')) {
      utils = render(<FetchErrorBanner state={failed(code)} />);
      expect(screen.getByRole('button', { name: 'Try again' }), `${code}: Try again stays`).toBeInTheDocument();
      expect(screen.queryByRole('link', { name: 'Sign in' }), `${code}: no Sign in`).toBeNull();
      utils.unmount();
    }

    render(<FetchErrorBanner compact state={failed('unauthorized')} />);
    expect(screen.getByRole('button', { name: 'Retry' }), 'the compact notice keeps its Retry').toBeInTheDocument();
    expect(screen.queryByRole('link', { name: 'Sign in' }), 'the compact notice shows no Sign in').toBeNull();
  });

  it('O22d focus (88.9): Sign in is watched like Try again, and a retry that turns 401 lands on Sign in', async () => {
    // (a) A focused Sign in withdrawn by a refresh nobody pressed lands on the host target, never <body>.
    const first = render(<HeadedBanner state={failed('unauthorized')} />);
    const link = screen.getByRole('link', { name: 'Sign in' });
    act(() => link.focus());
    expect(document.activeElement, '(a) setup: Sign in holds focus').toBe(link);
    first.rerender(<HeadedBanner state={failed('unauthorized', { showError: false })} />);
    const heading = screen.getByRole('heading', { level: 2, name: 'Groups' });
    await waitFor(() => expect(document.activeElement, '(a) focus lands on the host heading').toBe(heading));
    expect(document.activeElement, '(a) never the page body').not.toBe(document.body);
    first.unmount();

    // (b) A pressed Try again whose retry turns into a 401 lands on the Sign in that replaced it.
    const user = userEvent.setup();
    const second = render(<HeadedBanner state={failed('internal')} />);
    const tryAgain = screen.getByRole('button', { name: 'Try again' });
    await user.click(tryAgain);
    await waitFor(() => expect(tryAgain, '(b) the retry has settled').not.toHaveAttribute('aria-disabled'));
    second.rerender(<HeadedBanner state={failed('unauthorized')} />);
    await waitFor(() =>
      expect(document.activeElement, '(b) focus lands on Sign in').toBe(screen.getByRole('link', { name: 'Sign in' }))
    );
  });
});

describe('FetchErrorBanner — R073 mount grounds (88.9-50)', () => {
  // DECISION Phase 88.9-50 R073: MOUNT_GROUNDS reads the mount files with fs and a local comment strip, chosen OVER the sourceScan import and a drift-registry row — registration would turn this unit file into a registered gate with a min count to keep in lockstep for a one-test table pin; plan 88.9-35 keeps KebabMenu.test, BallotSection.test and RsvpSection.statusOnly unregistered the same way. Changing it is a decision, not a cleanup.
  //
  // One row per compact mount, walked by hand at the branch head to the nearest painting ancestor.
  // anchor: a snippet that occurs once in the comment-stripped file; the mount is the tag that
  // contains it, else the first FetchErrorBanner tag after it. key card = the mount passes no
  // hostGround (the default). No mount changes ground at 768px, so no row names a fromMd.
  type MountRow = { file: string; anchor: string; key: 'card' | 'page'; fromMd?: 'page' };
  const MOUNT_GROUNDS: MountRow[] = [
    // the Modal panel paints bg-card
    { file: 'src/app/components/ManageMembers.js', anchor: '<FetchErrorBanner state={selfIdentityErrorState} compact', key: 'card' },
    // bg-surface-page from md; surface-flat-phone below it, and the UserHomePage host is unpainted to the body
    { file: 'src/app/components/grouplist.js', anchor: '<FetchErrorBanner state={selfIdentityErrorState} compact', key: 'page' },
    // the min-h-screen bg-surface-page page root
    { file: 'src/app/friends/page.js', anchor: '<FetchErrorBanner state={groupsErrorState} compact', key: 'page' },
    // the event view's unpainted wrapper, so the body's page ground
    { file: 'src/app/gameDetail/page.js', anchor: '<TimezoneNudgeBanner />', key: 'page' },
    // the reviews card
    { file: 'src/app/gameDetail/page.js', anchor: '<div className="card p-3 md:p-6">', key: 'card' },
    // the unpainted Loading group gate, so the body's page ground
    { file: 'src/app/groupHomePage/page.js', anchor: '<FetchErrorBanner state={selfIdentityErrorState} compact', key: 'page' },
    // the unpainted page wrapper, so the body's page ground
    { file: 'src/app/groupPlanning/page.js', anchor: '<FetchErrorBanner state={personalControlsErrorState} compact', key: 'page' },
    // the desktop-only column (hidden below md), unpainted to the body
    { file: 'src/app/userHome/UserHomePage.js', anchor: '{pageSessionState ? null : selfIdentityErrorState.showError ? (', key: 'page' },
    // the phone BottomSheet panel paints bg-surface-card
    { file: 'src/app/userHome/UserHomePage.js', anchor: 'bodyClassName="flex min-h-0 flex-col overflow-hidden"', key: 'card' },
    // the four profile mounts sit inside card p-3 md:p-6 sections
    { file: 'src/app/userProfile/page.js', anchor: '<FetchErrorBanner state={selfIdentityErrorState} compact />', key: 'card' },
    { file: 'src/app/userProfile/page.js', anchor: 'compact focusTarget={schedulesHeadingRef}', key: 'card' },
    { file: 'src/app/userProfile/page.js', anchor: 'compact focusTarget={overridesHeadingRef}', key: 'card' },
    { file: 'src/app/userProfile/page.js', anchor: 'compact focusTarget={collectionHeadingRef}', key: 'card' },
  ];

  const stripComments = (src: string) =>
    src.replace(/\/\*[\s\S]*?\*\/|(^|[^:])\/\/[^\n]*/g, (m, lead) =>
      m.startsWith('/*') ? m.replace(/[^\n]/g, ' ') : (lead ?? ''),
    );
  const fromRoot = (rel: string) => stripComments(readFileSync(resolve(process.cwd(), rel), 'utf8'));
  const tagFrom = (src: string, start: number) => {
    const end = src.indexOf('/>', start);
    return src.slice(start, end === -1 ? src.length : end + 2);
  };
  const COMPACT = /\scompact(?=[\s/>])/;

  it('R073 mounts (88.9-50): every compact mount on a page ground passes its host', () => {
    for (const row of MOUNT_GROUNDS) {
      const src = fromRoot(row.file);
      const where = `${row.file} (${row.anchor})`;
      expect(src.split(row.anchor).length - 1, `${where}: the anchor occurs once`).toBe(1);
      const at = src.indexOf(row.anchor);
      const before = src.lastIndexOf('<FetchErrorBanner', at);
      const start =
        before !== -1 && src.indexOf('/>', before) >= at + row.anchor.length
          ? before
          : src.indexOf('<FetchErrorBanner', at);
      expect(start, `${where}: a FetchErrorBanner tag at the anchor`).toBeGreaterThan(-1);
      const tag = tagFrom(src, start);
      expect(tag, `${where}: the tag is a compact mount`).toMatch(COMPACT);
      if (row.key === 'card') {
        expect(tag, `${where}: a card mount keeps the default`).not.toMatch(/\bhostGround=/);
      } else {
        expect(tag, `${where}: passes its ${row.key} ground`).toContain(`hostGround="${row.key}"`);
      }
      if (row.fromMd) expect(tag, `${where}: passes its desktop ground`).toContain(`hostGroundFromMd="${row.fromMd}"`);
      else expect(tag, `${where}: no desktop companion`).not.toMatch(/\bhostGroundFromMd=/);
    }

    // Completeness: every compact FetchErrorBanner tag in src is a table row, file by file.
    const counts = new Map<string, number>();
    const walk = (dir: string) => {
      for (const entry of readdirSync(dir, { withFileTypes: true })) {
        const full = join(dir, entry.name);
        if (entry.isDirectory()) walk(full);
        else if (/\.(js|jsx|ts|tsx)$/.test(entry.name) && !/\.(test|spec)\./.test(entry.name)) {
          const src = stripComments(readFileSync(full, 'utf8'));
          const open = /<FetchErrorBanner\b/g;
          let hit: RegExpExecArray | null;
          while ((hit = open.exec(src)) !== null) {
            if (COMPACT.test(tagFrom(src, hit.index))) {
              const rel = relative(process.cwd(), full).split('\\').join('/');
              counts.set(rel, (counts.get(rel) ?? 0) + 1);
            }
          }
        }
      }
    };
    walk(resolve(process.cwd(), 'src'));
    const expected = new Map<string, number>();
    for (const row of MOUNT_GROUNDS) expected.set(row.file, (expected.get(row.file) ?? 0) + 1);
    const differ = [...new Set([...counts.keys(), ...expected.keys()])]
      .filter((f) => (counts.get(f) ?? 0) !== (expected.get(f) ?? 0))
      .map((f) => `${f}: src ${counts.get(f) ?? 0}, table ${expected.get(f) ?? 0}`);
    expect(differ, 'files whose compact mount count differs from MOUNT_GROUNDS').toEqual([]);
    expect([...counts.values()].reduce((a, b) => a + b, 0)).toBe(MOUNT_GROUNDS.length);
  });
});
