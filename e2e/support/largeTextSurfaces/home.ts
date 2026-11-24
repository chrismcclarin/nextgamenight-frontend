// Surface rows: Home, the Create a new Group dialog and the Calendar sheet. Owner: plan 89.6-16.
// Every row starts pending. One row per line, each with its census id.
// How a row is turned on: e2e/support/largeTextSurfaces/index.ts ("HOW A SWEEP PLAN TURNS A ROW ON").
import type { SurfaceRow } from './index';

export const rows: SurfaceRow[] = [
  { id: 'R01', census: 'R01', kind: 'route', owner: '89.6-16', status: 'pending' },
  { id: 'D01', census: 'D01', kind: 'dialog', owner: '89.6-16', status: 'pending' },
  { id: 'D04', census: 'D04', kind: 'dialog', owner: '89.6-16', status: 'pending' },
];
