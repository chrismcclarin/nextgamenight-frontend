import { type APIResponse, type Route } from '@playwright/test';

import { scrubError } from '../../src/test-utils/scrubSessionHeaders';

/**
 * Phase 88.6.2-20 (R8): the one way an e2e route handler passes a request through to the real
 * server. A failing Playwright route.fetch throws an error whose call log lists every request
 * header (the logged-in session cookie among them) and every response header, and the FE
 * repo's Actions logs are public. This re-throws that error scrubbed.
 */
// DECISION Phase 88.6.2-20 (scrub): a call-site wrapper OVER a reporter-level filter or
// error-output setting, because another reporter, or a print outside the reporter, would still
// show the raw error; the scrub runs before anything can read the value.
// A fresh Error (scrubError) OVER re-throwing Playwright's own with an edited message. The cost:
// a TargetClosedError loses Playwright's unrouteAll hint and its instanceof. No e2e code tests
// either (measured 0 at plan time).
// Every Playwright route.fetch in e2e/ goes through this file, and the census arm in
// src/test-utils/scrubSessionHeaders.test.ts enforces it: it flags any .fetch( call and any
// APIRequestContext verb call (request, page.request, context.request, a ...Context) on a
// code line. A call reached through an alias it cannot read (a destructured fetch, a call
// built from a string) is not seen.
// No logging and no retry here: this file only scrubs.
// Changing this is a decision, not a cleanup.
export async function scrubbedFetch(
  route: Route,
  options?: Parameters<Route['fetch']>[0],
): Promise<APIResponse> {
  try {
    return await route.fetch(options);
  } catch (error) {
    throw scrubError(error);
  }
}
