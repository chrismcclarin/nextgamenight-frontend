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
//     row of theirs is dropped and one row is appended (status yes, note null). Every other field
//     of the body is left unchanged. A non-JSON body is fulfilled unchanged; a non-GET falls back.
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
    let body: { rsvps?: Array<{ User?: { id?: string } }> } & Record<string, unknown>;
    try {
      body = await response.json();
    } catch {
      await route.fulfill({ response });
      return;
    }
    if (viewerId) {
      const rows = (body.rsvps ?? []).filter((row) => row?.User?.id !== viewerId);
      rows.push({
        id: 'e2e-viewer-rsvp',
        status: 'yes',
        note: null,
        User: { id: viewerId, username: 'E2E viewer' },
      } as { User: { id: string } });
      body = { ...body, rsvps: rows };
    }
    await route.fulfill({ response, json: body });
  });

  return { viewerId: () => viewerId };
}
