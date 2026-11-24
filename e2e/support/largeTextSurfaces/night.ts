// Surface rows: the night page (the event view of census R05), Participants and Delete this session. Owner: plan 89.6-19.
// Every row starts pending. One row per line, each with its census id.
// How a row is turned on: e2e/support/largeTextSurfaces/index.ts ("HOW A SWEEP PLAN TURNS A ROW ON").
import type { SurfaceRow } from './index';

export const rows: SurfaceRow[] = [
  { id: 'R05-event', census: 'R05', kind: 'route', owner: '89.6-19', status: 'pending' },
  { id: 'D27', census: 'D27', kind: 'dialog', owner: '89.6-19', status: 'pending' },
  { id: 'D31', census: 'D31', kind: 'dialog', owner: '89.6-19', status: 'pending' },
];
