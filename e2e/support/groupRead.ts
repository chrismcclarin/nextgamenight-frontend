// The ONE answer for a group's own read, shared by e2e/group-home-games-refresh.spec.ts (R4-A3) and
// the large-text sweep's group rows (e2e/support/largeTextSurfaces/group.ts and dialogs.ts).
// Added by Phase 89.6-17.
//
// WHAT IT STAGES. The group page reads its group whole (the browser calls the same-origin BFF:
// GET /api/groups/<id>, src/lib/api.ts ("getGroup: (group_id: string) =>")). This helper fetches
// the real row from the backend, hands it to transform, and answers with the original response and
// the transformed row: a group icon (a picture or an emoji) or a long name, on screen whatever the
// seed holds. Only the path that ENDS in /groups/<id> matches, so /groups/<id>/library, /users and
// the rest are never touched.
//
// READ-ONLY. Only a GET is answered, after the real read; any other method falls back, so a write
// still reaches the caller's write hold. Nothing is written: a staged field exists only in the
// answer sent to the browser. The body is never logged, printed or attached.
//
// ORDER. Register it AFTER holdWrites or sweepWriteGuard: Playwright runs the newest matching route
// first, so this one answers the group read before the hold sees it.
//
// DECISION Phase 89.6-17 (group-read): one helper answers the group read with the real row plus a
// transform, chosen OVER a made-up group (the page's role and membership checks read the real row)
// and OVER waiting for backend PR #79's seeded icon (the FE fix must land first: a recorded
// deploy-time gate). Changing this is a decision, not a cleanup.
import type { Page } from '@playwright/test';

import { scrubbedFetch } from './scrubbedFetch';

/** A picture icon: a tracked file under public/, so SafeImage takes it as a same-origin path. */
export const GROUP_ICON_PICTURE = '/logo.svg';
/** An emoji icon: the group page draws a stored value that is not a path or URL as text. */
export const GROUP_ICON_EMOJI = '\u{1F3B2}';

export type GroupRow = Record<string, unknown>;

/** A URL predicate for one group's own read: the pathname ends /groups/<id>. */
export const isGroupReadFor =
  (groupId: string) =>
  (url: URL): boolean =>
    url.pathname.endsWith(`/groups/${groupId}`);

/**
 * Answer every GET of group `groupId`'s own read on `page` with the real row as `transform`
 * returns it. Register it after the page's write hold.
 */
export async function routeGroupRead(page: Page, groupId: string, transform: (group: GroupRow) => GroupRow): Promise<void> {
  await page.route(isGroupReadFor(groupId), async (route) => {
    if (route.request().method() !== 'GET') {
      await route.fallback();
      return;
    }
    const response = await scrubbedFetch(route);
    // A refused or failed read reaches the page as it came: there is no row to stage.
    if (!response.ok()) {
      await route.fulfill({ response });
      return;
    }
    const body: unknown = await response.json();
    if (body === null || typeof body !== 'object' || Array.isArray(body)) {
      await route.fulfill({ response, json: body });
      return;
    }
    await route.fulfill({ response, json: transform(body as GroupRow) });
  });
}
