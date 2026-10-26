// @vitest-environment node
//
// Pins the body e2e/support/viewerRsvp.ts serves for GET /api/rsvp/event/<id> once it has injected
// the viewer's Yes: it must keep the backend's own shape, or a consumer that reads the flat row
// key or the summary sees a body the backend can never send (code review C-ML2). The backend
// shapes every row with a flat user_id copied from the nested User.id, and counts summary from
// the rows it returns: backend:Sonnet/routes/rsvp.js ("json.user_id = json.User?.id;").
// Line comments only (CF-9).
import { describe, expect, it } from 'vitest';

import { withViewerYesRsvp, type RsvpBody } from '../../e2e/support/viewerRsvp';

const VIEWER = '00000000-0000-4000-8000-00000000000a';
const OTHER = '00000000-0000-4000-8000-00000000000b';

// A row as the backend route returns it.
const row = (userId: string, status: string) => ({
  id: `rsvp-${userId}-${status}`,
  event_id: 'event-1',
  status,
  note: null,
  user_id: userId,
  User: { id: userId, username: `user ${userId.slice(-1)}` },
});

const backendBody = (rows: ReturnType<typeof row>[]): RsvpBody => {
  const summary = { yes: 0, maybe: 0, no: 0 };
  for (const r of rows) summary[r.status as keyof typeof summary] += 1;
  return { rsvps: rows, summary };
};

describe('viewerRsvp — the injected viewer Yes keeps the backend row and summary shape (code review C-ML2)', () => {
  it('the injected row carries the flat user_id beside User.id, and summary counts it', () => {
    const out = withViewerYesRsvp(backendBody([row(OTHER, 'maybe')]), VIEWER);
    const mine = (out.rsvps ?? []).filter((r) => r.User?.id === VIEWER);
    expect(mine).toHaveLength(1);
    expect(mine[0].status).toBe('yes');
    expect(mine[0].user_id, 'the injected row lacks the flat user_id the backend sends on every row').toBe(VIEWER);
    expect(out.summary).toEqual({ yes: 1, maybe: 1, no: 0 });
  });

  it("a prior answer of the viewer's is replaced, and summary moves it from its old status to yes", () => {
    const out = withViewerYesRsvp(backendBody([row(VIEWER, 'no'), row(OTHER, 'yes')]), VIEWER);
    expect((out.rsvps ?? []).filter((r) => r.User?.id === VIEWER || r.user_id === VIEWER)).toHaveLength(1);
    expect(out.summary).toEqual({ yes: 2, maybe: 0, no: 0 });
    // The summary always agrees with the rows, as the backend's does.
    const counted = { yes: 0, maybe: 0, no: 0 };
    for (const r of out.rsvps ?? []) counted[r.status as keyof typeof counted] += 1;
    expect(out.summary).toEqual(counted);
  });

  it('the injected yes sits after the last yes row and before the first maybe or no row, as the backend orders them', () => {
    const third = '00000000-0000-4000-8000-00000000000c';
    const fourth = '00000000-0000-4000-8000-00000000000d';
    const out = withViewerYesRsvp(backendBody([row(OTHER, 'yes'), row(third, 'maybe'), row(fourth, 'no')]), VIEWER);
    expect((out.rsvps ?? []).map((r) => [r.user_id, r.status])).toEqual([
      [OTHER, 'yes'],
      [VIEWER, 'yes'],
      [third, 'maybe'],
      [fourth, 'no'],
    ]);
  });

  it('every other field of the body is left unchanged', () => {
    const body = { ...backendBody([row(OTHER, 'yes')]), extra: { kept: true } };
    const out = withViewerYesRsvp(body, VIEWER);
    expect(out.extra).toEqual({ kept: true });
    expect((out.rsvps ?? [])[0]).toEqual(row(OTHER, 'yes'));
  });
});
