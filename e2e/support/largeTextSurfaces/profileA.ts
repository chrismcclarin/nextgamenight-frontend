// Surface rows: the availability part of Profile (census R16), the schedule forms, Disconnect Google Calendar and the BGG import. Owner: plan 89.6-22.
// Every row starts pending. One row per line, each with its census id.
// How a row is turned on: e2e/support/largeTextSurfaces/index.ts ("HOW A SWEEP PLAN TURNS A ROW ON").
import type { SurfaceRow } from './index';

export const rows: SurfaceRow[] = [
  { id: 'R16-availability', census: 'R16', kind: 'route', owner: '89.6-22', status: 'pending' },
  { id: 'D25', census: 'D25', kind: 'dialog', owner: '89.6-22', status: 'pending' },
  { id: 'D26', census: 'D26', kind: 'dialog', owner: '89.6-22', status: 'pending' },
  { id: 'D32', census: 'D32', kind: 'dialog', owner: '89.6-22', status: 'pending' },
  { id: 'D33', census: 'D33', kind: 'dialog', owner: '89.6-22', status: 'pending' },
];
