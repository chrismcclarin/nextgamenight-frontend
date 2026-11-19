// Phase 88.9-33 — LAND-03 (owner Q5): the login handler forwards connection to Auth0 only for
// the exact literal google-oauth2, and the logout allowlist in the same file is unchanged.
//
// Site: src/app/api/auth/[auth0]/route.js ("DECISION Phase 88.9-33 LAND-03").
// The SDK is mocked so handleAuth hands back its routes object and handleLogin / handleLogout
// hand back the options provider they are given; the test calls each provider with a request
// carrying only a URL. Next.js rejects unknown exports from an App Router route file, so the
// provider is reached through the mock, never through an exported helper.
// Threat rows: T-88.9-100 (connection tampering), T-88.9-101 (returnTo open redirect),
// T-88.9-103 (logout allowlist regression).
import { describe, expect, it, vi } from 'vitest';

vi.mock('@auth0/nextjs-auth0', () => ({
  handleAuth: (routes: unknown) => routes,
  handleLogin: (provider: unknown) => provider,
  handleLogout: (provider: unknown) => provider,
}));

import { GET } from './route';

type Provider = (req: { url: string }) => Record<string, unknown>;
const routes = GET as unknown as { login?: Provider; logout?: Provider };

const BASE = 'https://www.nextgamenight.app/api/auth';
const call = (provider: Provider | undefined, path: string) => {
  expect(typeof provider, 'the route has no options provider for this handler').toBe('function');
  return (provider as Provider)({ url: `${BASE}${path}` });
};

describe('Phase 88.9-33 — LAND-03 login connection allowlist', () => {
  it('LAND-03: connection=google-oauth2 forwarded; any other value dropped', () => {
    expect(call(routes.login, '/login?connection=google-oauth2')).toEqual({
      authorizationParams: { connection: 'google-oauth2' },
    });
    for (const q of [
      '?connection=Google-oauth2',
      '?connection=google-oauth2%20',
      '?connection=google-oauth2x',
      '?connection=samlp',
      '?connection=Username-Password-Authentication',
      '?connection=',
      '',
    ]) {
      expect(call(routes.login, `/login${q}`), `connection query ${JSON.stringify(q)}`).toEqual({});
    }
  });

  it("LAND-03: the login options never carry returnTo (the SDK's same-origin check owns it)", () => {
    const opts = call(routes.login, '/login?connection=google-oauth2&returnTo=https://evil.example/x');
    expect(opts).not.toHaveProperty('returnTo');
    expect(opts).toEqual({ authorizationParams: { connection: 'google-oauth2' } });
  });

  it('logout allowlist unchanged: /goodbye and the account_deleted literal only', () => {
    expect(call(routes.logout, '/logout?returnTo=%2Fgoodbye')).toEqual({ returnTo: '/goodbye' });
    expect(call(routes.logout, `/logout?returnTo=${encodeURIComponent('/goodbye?reason=account_deleted')}`)).toEqual({
      returnTo: '/goodbye?reason=account_deleted',
    });
    expect(call(routes.logout, `/logout?returnTo=${encodeURIComponent('/goodbye@evil.example')}`)).toEqual({});
  });
});
