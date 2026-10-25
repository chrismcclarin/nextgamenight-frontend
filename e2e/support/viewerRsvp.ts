import { type Page } from '@playwright/test';

import { scrubbedFetch } from './scrubbedFetch';

// Phase 88.6.2-22 (R8): the shared viewer-Yes read injection. CI's viewer has no RSVP on the
// seeded detail event, so a spec that needs the viewer answered Yes on load injects it into the
// two reads the page derives that status from, in the browser:
//   - GET /api/users/<one segment> (the self-identity read) passes through scrubbedFetch; the
//     handler reads ONLY the JSON id into a closure and fulfils with the unchanged response. It
//     never logs or attaches the body. Any other request under /api/users/, and any non-GET,
//     falls back.
//   - GET /api/rsvp/event/<id> passes through scrubbedFetch; once the viewer's id is known, any
//     row of theirs is dropped and one row is inserted after the last yes row (status yes, note
//     null, the viewer's id in both user_id and User.id), and summary is recounted from the rows,
//     as the backend does.
//     Every other field of the body is left unchanged. A non-JSON body is fulfilled unchanged; a
//     non-GET falls back.
// Call it before the navigation that sends those reads. It never navigates.
//
// DECISION Phase 88.6.2-22 (viewer-rsvp): one shared viewer-Yes read injection, chosen over a
// second spec-local copy of the same two routes (the milestone's duplication tenet, the same
// reason as e2e/support/inFlight.ts ("DECISION Phase 88.6.1-43 (tenet: one helper)"): two copies
// drift). It touches reads only: every write still reaches the caller's own route or its write
// backstop (route.fallback, never route.continue). Changing this is a decision, not a cleanup.

/** What injectViewerYesRsvp hands back. */
export interface ViewerRsvpInjection {
  /** The viewer's id once the self read has passed through, else null. */
  viewerId: () => string | null;
}

/** One row of the GET /api/rsvp/event/<id> body, as far as this helper reads it. */
type RsvpRow = { status?: unknown; user_id?: unknown; User?: { id?: unknown } & Record<string, unknown> } & Record<string, unknown>;

/** The GET /api/rsvp/event/<id> body, as far as this helper reads it. */
export type RsvpBody = { rsvps?: RsvpRow[]; summary?: unknown } & Record<string, unknown>;

/**
 * The body with the viewer answered yes, in the backend's own shape: every row carries the flat
 * user_id beside the nested User.id, and summary counts the rows returned
 * (backend:Sonnet/routes/rsvp.js ("json.user_id = json.User?.id;")). Any row of the viewer's is
 * dropped, one yes row is inserted after the last yes row, summary is recounted from the rows
 * the way the route counts it, and every other field is left unchanged. Pinned by the unit test
 * src/test-utils/viewerRsvp.test.ts ("the injected row carries the flat user_id beside User.id, and summary counts it").
 */
export function withViewerYesRsvp(body: RsvpBody, viewerId: string): RsvpBody {
  const rows = (body.rsvps ?? []).filter((row) => row?.User?.id !== viewerId && row?.user_id !== viewerId);
  // Backend order: yes, maybe, no, then createdAt ascending (backend:Sonnet/routes/rsvp.js ("yes first, maybe second, no third")).
  // The injected yes is the newest yes, so it goes after the last yes row and before the first maybe or no row.
  const firstNonYes = rows.findIndex((row) => row.status !== 'yes');
  rows.splice(firstNonYes === -1 ? rows.length : firstNonYes, 0, {
    id: 'e2e-viewer-rsvp',
    status: 'yes',
    note: null,
    user_id: viewerId,
    User: { id: viewerId, username: 'E2E viewer' },
  });
  const summary = { yes: 0, maybe: 0, no: 0 };
  for (const row of rows) {
    if (row.status === 'yes' || row.status === 'maybe' || row.status === 'no') summary[row.status] += 1;
  }
  return { ...body, rsvps: rows, summary };
}

/** Registers the two read routes that make the viewer's RSVP read as yes. */
export async function injectViewerYesRsvp(page: Page): Promise<ViewerRsvpInjection> {
  let viewerId: string | null = null;

  await page.route('**/api/users/**', async (route) => {
    const request = route.request();
    const path = new URL(request.url()).pathname;
    const rest = path.split('/api/users/')[1] ?? '';
    if (request.method() !== 'GET' || rest === '' || rest.includes('/')) {
      await route.fallback();
      return;
    }
    const response = await scrubbedFetch(route);
    try {
      const body = (await response.json()) as { id?: unknown };
      if (typeof body?.id === 'string') viewerId = body.id;
    } catch {
      // Not JSON: leave the id unknown; the caller's own expectation names the failure.
    }
    await route.fulfill({ response });
  });

  await page.route('**/api/rsvp/event/**', async (route) => {
    if (route.request().method() !== 'GET') {
      await route.fallback();
      return;
    }
    const response = await scrubbedFetch(route);
    let body: RsvpBody;
    try {
      body = await response.json();
    } catch {
      await route.fulfill({ response });
      return;
    }
    if (viewerId) body = withViewerYesRsvp(body, viewerId);
    await route.fulfill({ response, json: body });
  });

  return { viewerId: () => viewerId };
}
