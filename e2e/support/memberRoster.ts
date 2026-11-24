// The ONE roster answer for a group's members read, shared by e2e/manage-members-refresh.spec.ts
// and the large-text sweep's members rows (e2e/support/largeTextSurfaces/members.ts).
// Hoisted by Phase 89.6-11 out of the spec, where Phase 88.6.1-50 had already made it the one
// augmentation of that file: two copies of fetch-and-rewrite would drift, so there is one.
//
// WHAT IT DOES. Every members GET of the group (the browser calls the same-origin BFF:
// GET /api/groups/<id>/users) is fetched from the real backend, handed to transform, and answered
// with the original response and the transformed rows. Any other method on that path falls back,
// so a write still reaches the caller's write hold. transform runs AFTER the real read and BEFORE
// the answer, so a caller can hold a read there by awaiting a promise it releases later.
//
// IT WRITES NOTHING. A synthetic row exists only in the answer sent to the browser; its id is in
// no database.
import type { APIResponse, Page, Route } from '@playwright/test';

import { scrubbedFetch } from './scrubbedFetch';

/** A URL predicate for one group's members read: the pathname ends /groups/<id>/users. */
export const isMembersReadFor =
  (groupId: string) =>
  (url: URL): boolean =>
    url.pathname.endsWith(`/groups/${groupId}/users`);

/** The real roster from the backend, as an array (an empty one if the read was not a roster). */
async function realRoster(route: Route): Promise<{ response: APIResponse; body: unknown[] }> {
  const response = await scrubbedFetch(route);
  const json: unknown = await response.json();
  return { response, body: Array.isArray(json) ? json : [] };
}

/**
 * Answer every members GET of `groupId` on `page` with the real roster as `transform` returns it.
 * Register it after the page's write hold (Playwright runs the newest matching route first).
 */
export async function routeMemberRoster(
  page: Page,
  groupId: string,
  transform: (rows: unknown[]) => unknown[] | Promise<unknown[]>,
): Promise<void> {
  await page.route(isMembersReadFor(groupId), async (route) => {
    if (route.request().method() !== 'GET') {
      await route.fallback();
      return;
    }
    const { response, body } = await realRoster(route);
    const rows = await transform(body);
    await route.fulfill({ response, json: rows });
  });
}
