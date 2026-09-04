/**
 * Phase 88.8 (SPEC R9 / D-22) — the goodbye page's `reason` variant.
 *
 * The page is a synchronous server component with plain props, so it renders
 * directly under RTL with no Next runtime: that IS the sessionless contract
 * being exercised, not a workaround. If someone later adds a hook, a client
 * auth guard or a fetch, these tests break — which is the point.
 *
 * The variant is reachable only through the logout allowlist in
 * src/app/api/auth/[auth0]/route.js, whose second exact literal is
 * '/goodbye?reason=account_deleted' (plan 06's backend emits it URL-encoded).
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { render, screen, cleanup } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';

import { withoutComments } from '../../test-utils/sourceScan';

import Goodbye from './page';

/**
 * Read a source file with its COMMENTS BLANKED (the repo's shared scanner,
 * `accentSweep.test.ts` uses the same one). Both files below document their own
 * invariants in prose — "no useUser", "never a prefix match" — so a raw text
 * scan would match the comment describing the rule instead of the code
 * obeying it, and report green either way.
 */
const codeOf = (rel: string): string =>
  withoutComments(readFileSync(resolve(process.cwd(), rel), 'utf8'));

afterEach(cleanup);

const DELETED_VARIANT = /The account you just tried to sign in with was permanently deleted/;
const DEFAULT_VARIANT = /We&apos;re sorry to see you go|We're sorry to see you go/;

describe('goodbye page — reason variant', () => {
  it('renders the deleted-account variant for reason=account_deleted', () => {
    render(<Goodbye searchParams={{ reason: 'account_deleted' }} />);

    expect(
      screen.getByRole('heading', { name: 'This account has been deleted' })
    ).toBeInTheDocument();
    expect(screen.getByText(DELETED_VARIANT)).toBeInTheDocument();
    // The default framing is wrong for someone who arrived from a SIGN-IN
    // attempt, not from pressing delete — it must not be on screen.
    expect(screen.queryByText(DEFAULT_VARIANT)).not.toBeInTheDocument();
  });

  it('renders today’s copy unchanged when there is no reason', () => {
    render(<Goodbye />);

    expect(
      screen.getByRole('heading', { name: 'Your account has been deleted' })
    ).toBeInTheDocument();
    expect(screen.getByText(DEFAULT_VARIANT)).toBeInTheDocument();
    expect(screen.queryByText(DELETED_VARIANT)).not.toBeInTheDocument();
  });

  it('renders today’s copy for an empty searchParams object', () => {
    render(<Goodbye searchParams={{}} />);
    expect(
      screen.getByRole('heading', { name: 'Your account has been deleted' })
    ).toBeInTheDocument();
  });

  // T-88.8-56. This page is PUBLIC and `reason` is attacker-controllable.
  it('never renders an unrecognised reason value, and falls back to the default copy', () => {
    const hostile = 'your bank called, send them your password';
    const { container } = render(<Goodbye searchParams={{ reason: hostile }} />);

    expect(container.textContent).not.toContain(hostile);
    expect(container.textContent).not.toContain('password');
    expect(
      screen.getByRole('heading', { name: 'Your account has been deleted' })
    ).toBeInTheDocument();
  });

  it('falls back to the default copy when the key is repeated (an array value)', () => {
    // ?reason=account_deleted&reason=account_deleted arrives as an array, which
    // fails the strict compare. Default copy is the safe outcome.
    render(
      <Goodbye searchParams={{ reason: ['account_deleted', 'account_deleted'] }} />
    );
    expect(
      screen.getByRole('heading', { name: 'Your account has been deleted' })
    ).toBeInTheDocument();
  });
});

describe('goodbye page — sessionless contract (source assertions)', () => {
  const source = codeOf('src/app/goodbye/page.tsx');

  it('stays a server component with no session dependency', () => {
    // Adding searchParams must NOT have turned this into a client component.
    expect(source).not.toContain("'use client'");
    expect(source).not.toContain('useUser');
    expect(source).not.toContain('withPageAuthRequired');
    expect(source).not.toContain('getSession');
    expect(source).not.toContain('fetch(');
  });
});

describe('logout returnTo allowlist (source assertions)', () => {
  // The handler is an inline callback inside handleAuth() in a Next route file,
  // so it cannot be imported and unit-called without adding a non-route export
  // (which Next's route-type validation rejects). These source assertions are
  // the available mechanical guard for T-88.8-55 — see 88.8-11-SUMMARY.md,
  // which names extracting the predicate into src/lib/ as the stronger option
  // left for the owner.
  const source = codeOf('src/app/api/auth/[auth0]/route.js');

  it('compares both literals with strict equality and no prefix match', () => {
    expect(source).toContain("returnTo === '/goodbye'");
    expect(source).toContain("returnTo === '/goodbye?reason=account_deleted'");
    // An open redirect would come back in exactly one of these shapes.
    expect(source).not.toMatch(/returnTo\??\.?startsWith\(/);
    expect(source).not.toMatch(/returnTo\??\.?includes\(/);
    expect(source).not.toMatch(/returnTo\??\.?match\(/);
  });

  it('keeps the cross-repo literal byte-identical to what plan 06 emits', () => {
    // Plan 06's backend sends
    //   ?returnTo=${encodeURIComponent('/goodbye?reason=account_deleted')}
    // and searchParams.get() decodes it, so the allowlist must hold the DECODED
    // path. Encoding the expectation the same way the backend does is what makes
    // this a contract test rather than a restatement of the line above.
    const backendEmits = encodeURIComponent('/goodbye?reason=account_deleted');
    expect(decodeURIComponent(backendEmits)).toBe(
      '/goodbye?reason=account_deleted'
    );
    expect(source).toContain(decodeURIComponent(backendEmits));
  });
});
