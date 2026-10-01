// This file configures the initialization of Sentry on the client.
// The config you add here will be used whenever a users loads a page in their browser.
// https://docs.sentry.io/platforms/javascript/guides/nextjs/

import * as Sentry from "@sentry/nextjs";
import { scrubEvent, scrubRecordingEvent, scrubTransaction, scrubSpanJson } from "./sentry.scrub.js";
import { isTokenBearingPath } from "./src/lib/scrubFeedbackPageUrl";

/* DECISION Phase 88.6 R-7 (code-adversarial-review N1; owner check 2026-09-29 found no
   token-route replay in 90 days; ruling "fix-now"). Session Replay is NOT registered when the
   page loads on a magic-link route. WHY: replay's rrweb Meta event records
   `window.location.href` and its DOM snapshots keep `href` attributes, and NEITHER reaches
   `beforeAddRecordingEvent` (Custom events only — marker (v) in sentry.scrub.js). On
   `/availability-form/<token>`, `/rsvp/<token>?u=<sub>`, `/invite/…` the recording would
   carry the live credential outside every scrub layer. The magic-link pages are entered by
   full page load from an SMS or email, so the init-time pathname is the right gate; there is
   no client-side navigation INTO them from elsewhere in the app. Chosen OVER scrubbing the
   Meta href (no hook for it in @sentry-internal/replay 8.55.2) and OVER `beforeErrorSampling`
   (session sampling ignores it). Pinned by `src/lib/sentryClientReplayGate.test.ts`.
   Re-registering replay on these routes is a decision, not a cleanup.
   [AMENDED 2026-09-29 — plan 88.6-61, review round 2 H-1: this gate never disabled TRACING.
   The empty `integrations` array below is MERGED with the SDK defaults, which include
   `browserTracingIntegration()` (`@sentry/core` 8.55.2 build/cjs/integration.js:49-50), so
   token-route pageloads still produced transactions. Tracing on these routes is gated by the
   `tracesSampler` below, keyed on this same `onTokenRoute`.] */
const onTokenRoute =
  typeof window !== 'undefined' && isTokenBearingPath(window.location.pathname);

// The shipped performance sample rate, unchanged — hoisted so the sampler below reads it.
const RATE = process.env.NODE_ENV === 'production' ? 0.1 : 1.0;

Sentry.init({
  dsn: process.env.NEXT_PUBLIC_SENTRY_DSN,

  /* DECISION Phase 88.6-61 (review round 2 H-1, owner ruling R2-H1-RULING). Performance tracing
     is gated here and scrubbed by the two hooks beside `beforeSend` below.
     (a) Keyed on the INIT-TIME pathname (`onTokenRoute`), chosen OVER `samplingContext.name`
         (REJECTED): standalone INP root spans are named by HTML selector
         (`@sentry-internal/browser-utils` 8.55.2 build/cjs/metrics/inp.js:87), so a name check
         samples them straight through on a token route.
     (b) `parentSampled ?? RATE`, chosen OVER a bare rate (REJECTED): no `sentry-trace` meta is
         emitted today (no `instrumentation.ts`), but a bare rate silently breaks FE-to-BE trace
         linking the day Phase 90 lands server init. The token gate still outranks a parent.
     (c) `tracesSampleRate` DELETED, not kept: `@sentry/core` 8.55.2 build/cjs/tracing/sampling.js:36-41
         never reads it while a sampler exists, and a dead rate beside the sampler reads as the
         control. Tracing stays ON with the sampler alone (utils/hasTracingEnabled.js:22).
     (d) REJECTED: the `integrations` FUNCTION form filtering `browserTracingIntegration` out on
         token routes — same egress result, but it breaks R-7's pinned empty-array shape
         (`src/lib/sentryClientReplayGate.test.ts`, the `toEqual([])` arm) and keys on an SDK
         integration NAME that can change between versions.
     (e) The two scrub hooks run on EVERY route, not only token routes: ordinary pages carry
         `?email=` fetch URLs (CR-501), and a client navigation can still name a token path.
     Re-adding `tracesSampleRate` or a name-keyed sampler is a decision, not a cleanup. */
  tracesSampler: ({ parentSampled }) => (onTokenRoute ? 0 : (parentSampled ?? RATE)),

  // Setting this option to true will print useful information to the console while you're setting up Sentry.
  debug: false,

  // Environment
  environment: process.env.NODE_ENV || 'development',

  // T-84-01: pattern-redact PII (email/token/JWT/secret/phone) from message,
  // exception values, breadcrumb URLs, request URL/query_string, and
  // extra/contexts (by pattern, regardless of key name) before egress.
  beforeSend(event) {
    return scrubEvent(event);
  },

  // Review round 2 H-1: `beforeSend` never runs on transactions or spans. Transactions (pageload /
  // navigation names are the raw pathname) and spans (fetch URLs incl. query; standalone INP/CLS
  // spans, which ONLY this hook reaches) get the same scrub — see the DECISION above the sampler.
  beforeSendTransaction(event) {
    return scrubTransaction(event);
  },
  beforeSendSpan(span) {
    return scrubSpanJson(span);
  },

  // Replay can be used to record user sessions
  /* DECISION Phase 88.6-13 (D2, owner ruling 2026-09-13): the on-error replay sample is
     BOUNDED here, at the rate value — chosen OVER a `beforeErrorSampling` predicate inside
     `replayIntegration({...})` below, and OVER leaving it at 1.0.
     WHY A BOUND AND NOT A PREDICATE: `beforeErrorSampling` is a per-event judgement where
     the ruling asked for a bound, and adding it would drift the integrations-array anchor
     (`:34-46`) that five 88.6 plans cite read-only.
     WHY NOT 1.0: AC-2 retires ~100 raw `console.*` calls onto the house logger. At 1.0 every
     captured event in a buffering session flushes the replay buffer and converts that
     session to continuous recording and upload for its remainder — against a plan quota the
     owner records as 50 replays/month (his figure, 2026-09-13; not measured here).
     THE COST, ACCEPTED DELIBERATELY: "you always get a replay with the failure that
     triggered it" no longer holds — at 0.1, roughly nine in ten error sessions upload no
     replay.
     THE RATE IS CONSOLIDATOR-PROPOSED, NOT OWNER-CHOSEN. Changing it is a decision, not a
     cleanup.
     PAIRED WITH: AC-2's convert-on-touch level, amended the same day to `logger.info` (a
     breadcrumb, which creates no event), so this gate bounds the error traffic this phase
     does NOT create as well as the traffic it does. Neither half is sufficient alone.
     NOT the always-on session sample at `:31` — that is untouched and unaffected. */
  replaysOnErrorSampleRate: 0.1,

  // If the entire session should be sampled, use the following option:
  replaysSessionSampleRate: 0.1,

  // You can remove this option if you're not planning to use the Sentry Session Replay feature:
  // R-7 (above): an EMPTY integrations array on a token route — replay is never constructed there.
  integrations: onTokenRoute
    ? []
    : [
        Sentry.replayIntegration({
          // Additional Replay configuration goes in here, for example:
          maskAllText: true,
          blockAllMedia: true,
          // R-7: `href` joins the masked attributes so a link to a token route rendered on
          // an ORDINARY page (e.g. an invite link shown in a group's settings) is masked in
          // the DOM snapshot. Sentry's default is ['title', 'placeholder'].
          maskAttributes: ['title', 'placeholder', 'href'],
          // T-84-01 (A1): beforeSend does NOT run on replay events, so scrub recorded
          // navigation/fetch URLs here (Custom events only — see marker (v) in
          // sentry.scrub.js; the Meta `href` is outside this hook, which is why the route
          // gate above exists — R-7, shipped 2026-09-29) — magic-link/invite tokens in an
          // on-error replay must not egress — the on-error sample is BOUNDED above, no longer 1.0.
          // networkCaptureBodies:false holds; networkDetailDenyUrls below is INERT, not a control.
          beforeAddRecordingEvent: scrubRecordingEvent,
          networkCaptureBodies: false,
          networkDetailDenyUrls: [/token/i, /magic_token/i, /invite/i],
        }),
      ],
});


