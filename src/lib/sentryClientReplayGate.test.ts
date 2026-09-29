// Phase 88.6 — R-7 (code-adversarial-review N1, owner ruling "fix-now" 2026-09-29).
//
// WHY THIS FILE EXISTS. Sentry Session Replay records the page URL in the rrweb Meta event
// (`href: window.location.href`) and keeps `href` attributes in DOM snapshots. Neither reaches
// our `beforeAddRecordingEvent` scrub — in the installed `@sentry-internal/replay` that hook
// runs on Custom events only (see marker (v) in `sentry.scrub.js`). So a replay-sampled session
// that LANDS on a magic-link route would carry the live credential in the recording, outside
// every scrub layer this app has. The magic-link pages are entered by full page load from an
// SMS or email, so the init-time pathname is the right gate: on a token route the replay
// integration is not registered at all, and everywhere else `href` joins the masked attributes.
//
// The config module runs `Sentry.init` at import, so each case resets the module registry,
// sets the jsdom location, imports fresh, and reads what `init` was handed. `@sentry/nextjs`
// is mocked wholesale — no network, no DSN.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

type InitOptions = {
  integrations?: unknown[];
  replaysSessionSampleRate?: number;
  replaysOnErrorSampleRate?: number;
};

const init = vi.fn<(o: InitOptions) => void>();
const replayIntegration = vi.fn((opts: Record<string, unknown>) => ({ name: 'Replay', opts }));

vi.mock('@sentry/nextjs', () => ({ init, replayIntegration }));

async function loadConfigAt(pathname: string): Promise<InitOptions> {
  vi.resetModules();
  init.mockClear();
  replayIntegration.mockClear();
  window.history.pushState({}, '', pathname);
  await import('../../sentry.client.config.js');
  expect(init, 'sentry.client.config.js must call Sentry.init exactly once at import').toHaveBeenCalledTimes(1);
  return init.mock.calls[0][0];
}

beforeEach(() => {
  window.history.pushState({}, '', '/');
});

afterEach(() => {
  window.history.pushState({}, '', '/');
});

describe('sentry.client.config.js — replay is gated off the magic-link routes (R-7)', () => {
  const TOKEN_ROUTES = [
    '/availability-form/abc123',
    '/rsvp/abc123?e=evt-1&u=usr-1&s=yes',
    '/invite/group/abc123',
    '/invite/game/abc123',
    '/restore/group/abc123',
    // Token in the QUERY string, not the path: the Meta href still carries it.
    '/invite/accept?token=abc123',
  ];

  for (const route of TOKEN_ROUTES) {
    it(`registers NO replay integration when the page loads on ${route.split('?')[0]}`, async () => {
      const opts = await loadConfigAt(route);
      expect(replayIntegration, 'replayIntegration() must not even be constructed on a token route').not.toHaveBeenCalled();
      expect(opts.integrations ?? []).toEqual([]);
    });
  }

  it('registers the replay integration on an ordinary route, with href masked', async () => {
    const opts = await loadConfigAt('/dashboard');
    expect(replayIntegration).toHaveBeenCalledTimes(1);
    expect(opts.integrations).toHaveLength(1);
    const replayOpts = replayIntegration.mock.calls[0][0];
    expect(replayOpts.maskAttributes, 'DOM href attributes are masked in snapshots').toEqual(
      expect.arrayContaining(['title', 'placeholder', 'href'])
    );
    // The pre-existing privacy settings survive the edit.
    expect(replayOpts.maskAllText).toBe(true);
    expect(replayOpts.blockAllMedia).toBe(true);
    expect(replayOpts.networkCaptureBodies).toBe(false);
    expect(typeof replayOpts.beforeAddRecordingEvent).toBe('function');
  });

  it('a route that merely CONTAINS a token word is not gated (prefix match, not substring)', async () => {
    // `/rsvpx` and `/groups/invite-history` must keep replay: the gate is on the route prefix.
    const opts = await loadConfigAt('/groups/invite-history');
    expect(opts.integrations).toHaveLength(1);
  });

  it('the sample rates are unchanged by the gate (DECISION 88.6-13 D2 stands)', async () => {
    const opts = await loadConfigAt('/dashboard');
    expect(opts.replaysOnErrorSampleRate).toBe(0.1);
    expect(opts.replaysSessionSampleRate).toBe(0.1);
  });
});
