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
  // Phase 88.6-61 (review round 2 H-1): the tracing egress controls.
  tracesSampler?: (ctx: { parentSampled?: boolean; name?: string }) => number | boolean;
  beforeSendTransaction?: (event: Record<string, unknown>) => Record<string, unknown> | null;
  beforeSendSpan?: (span: Record<string, unknown>) => Record<string, unknown>;
  tracesSampleRate?: number;
  // Phase 88.6.1-08 (Prohibition 5): the error-event egress the logger breadcrumbs ride on.
  beforeSend?: (event: Record<string, unknown>) => Record<string, unknown> | null;
};

const init = vi.fn<(o: InitOptions) => void>();
const replayIntegration = vi.fn((opts: Record<string, unknown>) => ({ name: 'Replay', opts }));
// Phase 88.6.1-08: `src/lib/logger.ts` calls `Sentry.addBreadcrumb`, and vitest throws on a
// mock export that is missing, so the factory carries it too.
const addBreadcrumb = vi.fn<(crumb: Record<string, unknown>) => void>();

vi.mock('@sentry/nextjs', () => ({ init, replayIntegration, addBreadcrumb }));

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

// ---------------------------------------------------------------------------
// Phase 88.6-61 — review round 2 H-1 (owner ruling R2-H1-RULING: fix-now), cross-finding XF-1.
//
// The R-7 gate above never disabled TRACING: a user `integrations` ARRAY is MERGED with the
// defaults (`@sentry/core` integration.js:49-50) and `@sentry/nextjs` puts
// `browserTracingIntegration()` among them. Pageload transactions are named with the raw
// pathname, fetch spans carry the full URL, and standalone INP spans carry the route as a data
// value — none of which `beforeSend` sees. These cases pin that `Sentry.init` is HANDED the
// controls; the scrub functions themselves are pinned in `sentry.scrub.test.ts`. Without this
// file, dropping a hook from the init call leaves every unit test green while the leak returns.
// ---------------------------------------------------------------------------
describe('sentry.client.config.js — tracing egress is gated and scrubbed (R2 H-1)', () => {
  const TOKEN_ROUTES = [
    '/availability-form/abc123',
    '/rsvp/abc123?e=evt-1&u=usr-1&s=yes',
    '/invite/group/abc123',
    '/invite/game/abc123',
    '/restore/group/abc123',
    '/invite/accept?token=abc123',
  ];

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  for (const route of TOKEN_ROUTES) {
    it(`samples NOTHING on ${route.split('?')[0]} — even when a parent trace was sampled — and wires both scrubs`, async () => {
      const opts = await loadConfigAt(route);
      expect(typeof opts.beforeSendTransaction).toBe('function');
      expect(typeof opts.beforeSendSpan).toBe('function');
      expect(typeof opts.tracesSampler).toBe('function');
      // NO `name` in the context: the gate keys on the init-time pathname, never on the
      // sampling name (INP root spans are named by HTML selector and would sample through).
      expect(opts.tracesSampler!({ parentSampled: undefined })).toBe(0);
      // The token gate outranks an upstream sampling decision.
      expect(opts.tracesSampler!({ parentSampled: true })).toBe(0);
    });
  }

  it('an ordinary route samples at the shipped rate: 1.0 outside production, 0.1 in production', async () => {
    const opts = await loadConfigAt('/dashboard');
    expect(typeof opts.tracesSampler).toBe('function');
    expect(opts.tracesSampler!({ parentSampled: undefined })).toBe(1.0);

    vi.stubEnv('NODE_ENV', 'production');
    const prodOpts = await loadConfigAt('/dashboard');
    expect(prodOpts.tracesSampler!({ parentSampled: undefined })).toBe(0.1);
  });

  it('an ordinary route honours the parent sampling decision (XF-3: FE-to-BE trace linking)', async () => {
    const opts = await loadConfigAt('/dashboard');
    expect(typeof opts.tracesSampler).toBe('function');
    expect(opts.tracesSampler!({ parentSampled: true })).toBe(true);
    expect(opts.tracesSampler!({ parentSampled: false })).toBe(false);
  });

  it('tracesSampleRate is NOT passed — the sampler is the only control', async () => {
    const tokenOpts = await loadConfigAt('/availability-form/abc123');
    expect('tracesSampleRate' in tokenOpts).toBe(false);
    const ordinaryOpts = await loadConfigAt('/dashboard');
    expect('tracesSampleRate' in ordinaryOpts).toBe(false);
  });

  it('the wired hooks really scrub: a token transaction name and a searched-email span description', async () => {
    const opts = await loadConfigAt('/dashboard');
    expect(typeof opts.beforeSendTransaction).toBe('function');
    expect(typeof opts.beforeSendSpan).toBe('function');
    const tx = opts.beforeSendTransaction!({
      type: 'transaction',
      transaction: '/availability-form/abc123',
    });
    expect(tx?.transaction).toBe('/availability-form/[REDACTED]');
    const span = opts.beforeSendSpan!({
      description: 'GET https://api.x.app/f?email=bob%40example.com',
      data: {},
    });
    expect(String(span.description)).not.toContain('example.com');
  });
});

// ---------------------------------------------------------------------------
// Phase 88.6.1-08 (SPEC Prohibition 5, AC-34; threat T-88.6.1-167). A diagnostic added
// through the house logger must reach Sentry ONLY through the scrubber.
//
// WHY THE WIRING IS PINNED HERE AND NOT ONLY THE PURE FUNCTION. `logger.info(msg, ctx)` is
// `Sentry.addBreadcrumb({ message, level: 'info', data: ctx })` (`src/lib/logger.ts:53`) and it
// sets NO `category`. Session Replay forwards a breadcrumb only when it has one
// (`@sentry-internal/replay` 8.55.2 `build/npm/esm/index.js:6175`, `isBreadcrumbWithCategory`
// at `:6263-6264`, `return !!breadcrumb.category;`), so replay never carries these. Their ONLY
// egress is attached to the next error event, through the `beforeSend` that
// `sentry.client.config.js` hands to `Sentry.init`. Without this case, dropping `beforeSend`
// from the init call would leave every unit test in `sentry.scrub.test.ts` green while the
// breadcrumb left unscrubbed.
// ---------------------------------------------------------------------------
describe('sentry.client.config.js — logger breadcrumbs leave only through the wired beforeSend (88.6.1-08, Prohibition 5)', () => {
  it('a logger.info breadcrumb carrying id_token / refresh_token pairs and an email is redacted by the beforeSend Sentry.init is handed', async () => {
    // The config FIRST: `loadConfigAt` resets the module registry, so the logger imported
    // below binds to the same mocked `@sentry/nextjs` factory functions.
    const opts = await loadConfigAt('/dashboard');
    expect(typeof opts.beforeSend).toBe('function');
    addBreadcrumb.mockClear();
    // DYNAMIC import, never a top-level static one: a static import evaluates
    // `@sentry/nextjs` before this file's `const addBreadcrumb = vi.fn` line runs, and the
    // mock factory would read it in the temporal dead zone.
    const { logger, errCtx } = await import('./logger');
    logger.info(
      'Failed to refresh the session',
      errCtx(new Error('refresh failed: id_token=eyJabc refresh_token=r3fr35h for alice@example.com'))
    );
    expect(addBreadcrumb).toHaveBeenCalledTimes(1);
    const crumb = addBreadcrumb.mock.calls.at(-1)![0];

    const out = opts.beforeSend!({ breadcrumbs: [crumb] }) as {
      breadcrumbs: Array<{ message: string; data: { name: string; message: string } }>;
    };
    const serialised = JSON.stringify(out);
    expect(serialised).not.toContain('eyJabc');
    expect(serialised).not.toContain('r3fr35h');
    expect(serialised).not.toContain('alice@example.com');
    expect(out.breadcrumbs[0].message).toBe('Failed to refresh the session');
    expect(out.breadcrumbs[0].data.name).toBe('Error');
    expect(out.breadcrumbs[0].data.message).toBe('refresh failed: [REDACTED] [REDACTED] for [REDACTED]');
  });
});

// ---------------------------------------------------------------------------
// Phase 88.6.1-76 (P-09; threats T-88.6.1-1524 / T-88.6.1-1525). Sentry writes every DOM
// selector with the raw aria-label / title / alt value, so a click on a control labelled with
// a group or member name carries that name. `sentry.scrub.js` redacts it (redactNamedAttributes,
// the P-09 marker there).
//
// WHY THIS CASE EXISTS. `src/lib/sentry.scrub.test.ts` pins the pure functions; this case pins
// that the SDK is HANDED them. Without it, swapping `beforeSend` or `beforeAddRecordingEvent`
// for another function would leave every unit test green while the names left unscrubbed. It
// calls the very functions the two mocks received.
// ---------------------------------------------------------------------------
describe('sentry.client.config.js — names in element selectors leave only redacted through the wired hooks (88.6.1-76, P-09)', () => {
  it('W1: a group or invite name in a click selector leaves only its static label prefix, through the beforeSend and beforeAddRecordingEvent the SDK is handed', async () => {
    const opts = await loadConfigAt('/dashboard');
    expect(typeof opts.beforeSend).toBe('function');
    const event = opts.beforeSend!({
      breadcrumbs: [
        { category: 'ui.click', message: 'div.card > button.btn[aria-label="Customize Bob\'s group"][type="button"]' },
      ],
    }) as { breadcrumbs: Array<{ message: string }> };
    expect(event.breadcrumbs[0].message).toBe('div.card > button.btn[aria-label="Customize [REDACTED]"]');

    const beforeAddRecordingEvent = replayIntegration.mock.calls[0][0].beforeAddRecordingEvent as (
      e: Record<string, unknown>
    ) => Record<string, unknown>;
    expect(typeof beforeAddRecordingEvent).toBe('function');
    // Replay's own click breadcrumb is a Custom event (type 5, tag 'breadcrumb'). The name holds a
    // question mark, which the query strip in scrubUrl used to cut the selector at.
    const recorded = beforeAddRecordingEvent({
      type: 5,
      timestamp: 1,
      data: {
        tag: 'breadcrumb',
        payload: {
          category: 'ui.click',
          message: 'li > button[aria-label="Accept invite to Who\'s in?"][type="button"]',
        },
      },
    }) as { data: { payload: { message: string } } };
    expect(recorded.data.payload.message).toBe('li > button[aria-label="Accept invite to [REDACTED]"]');
  });
});
