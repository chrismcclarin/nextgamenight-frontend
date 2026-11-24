// Surface rows: Friends, the two invite panels and the member-name popover. Owner: plan 89.6-21.
// Every row starts pending. One row per line, each with its census id.
// How a row is turned on: e2e/support/largeTextSurfaces/index.ts ("HOW A SWEEP PLAN TURNS A ROW ON").
import type { SurfaceRow } from './index';

export const rows: SurfaceRow[] = [
  { id: 'R04', census: 'R04', kind: 'route', owner: '89.6-21', status: 'pending' },
  { id: 'D02', census: 'D02', kind: 'dialog', owner: '89.6-21', status: 'pending' },
  { id: 'D03', census: 'D03', kind: 'dialog', owner: '89.6-21', status: 'pending' },
  { id: 'O05', census: 'O05', kind: 'overlay', owner: '89.6-21', status: 'pending' },
];
