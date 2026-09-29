// This file configures the initialization of Sentry on the client.
// The config you add here will be used whenever a users loads a page in their browser.
// https://docs.sentry.io/platforms/javascript/guides/nextjs/

import * as Sentry from "@sentry/nextjs";
import { scrubEvent, scrubRecordingEvent } from "./sentry.scrub.js";
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
   Re-registering replay on these routes is a decision, not a cleanup. */
const onTokenRoute =
  typeof window !== 'undefined' && isTokenBearingPath(window.location.pathname);

Sentry.init({
  dsn: process.env.NEXT_PUBLIC_SENTRY_DSN,

  // Adjust this value in production, or use tracesSampler for greater control
  tracesSampleRate: process.env.NODE_ENV === 'production' ? 0.1 : 1.0,

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


