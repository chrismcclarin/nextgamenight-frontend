// This file configures the initialization of Sentry on the client.
// The config you add here will be used whenever a users loads a page in their browser.
// https://docs.sentry.io/platforms/javascript/guides/nextjs/

import * as Sentry from "@sentry/nextjs";
import { scrubEvent, scrubRecordingEvent } from "./sentry.scrub.js";

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
  replaysOnErrorSampleRate: 1.0,

  // If the entire session should be sampled, use the following option:
  replaysSessionSampleRate: 0.1,

  // You can remove this option if you're not planning to use the Sentry Session Replay feature:
  integrations: [
    Sentry.replayIntegration({
      // Additional Replay configuration goes in here, for example:
      maskAllText: true,
      blockAllMedia: true,
      // T-84-01 (A1): beforeSend does NOT run on replay events, so scrub recorded
      // navigation/fetch URLs here — magic-link/invite tokens in an on-error
      // replay (replaysOnErrorSampleRate: 1.0) must not egress. Belt-and-suspenders:
      // never capture network bodies and deny token-bearing URL detail.
      beforeAddRecordingEvent: scrubRecordingEvent,
      networkCaptureBodies: false,
      networkDetailDenyUrls: [/token/i, /magic_token/i, /invite/i],
    }),
  ],
});


