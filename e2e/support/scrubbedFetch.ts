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
// code line. AMENDED code review C-WR-01 (2026-10-25): it also reads where a context comes
// from, so request.newContext, a renamed request fixture and an alias of a .request property
// are offenders outside e2e/support/, and so is every verb call on the name each one binds.
// A call reached through an alias it cannot read is not seen: a destructured fetch or verb, a
// call built from a string, a context passed in as a parameter or returned from a function, an
// import alias (import { request as pw } then pw.newContext()), a plain reassignment
// (const http = request; then http.post(); scoped check S-4, 0 uses of either today), or
// a source statement split across lines.
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
