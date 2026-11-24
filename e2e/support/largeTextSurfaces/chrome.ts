// Surface rows: the phone menu, its dim layer, Notifications, the action menu and the toaster. Owner: plan 89.6-26.
// Every row starts pending. One row per line, each with its census id.
// How a row is turned on: e2e/support/largeTextSurfaces/index.ts ("HOW A SWEEP PLAN TURNS A ROW ON").
import type { SurfaceRow } from './index';

export const rows: SurfaceRow[] = [
  { id: 'O01', census: 'O01', kind: 'overlay', owner: '89.6-26', status: 'pending' },
  { id: 'O02', census: 'O02', kind: 'overlay', owner: '89.6-26', status: 'pending' },
  { id: 'O03', census: 'O03', kind: 'overlay', owner: '89.6-26', status: 'pending' },
  { id: 'O04', census: 'O04', kind: 'overlay', owner: '89.6-26', status: 'pending' },
  { id: 'O08', census: 'O08', kind: 'overlay', owner: '89.6-26', status: 'pending' },
];
