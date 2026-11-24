// Surface rows: Browse games, Games to Bring and the suggestion rows of the group and planning pages. Owner: plan 89.6-18.
// Every row starts pending. One row per line, each with its census id.
// How a row is turned on: e2e/support/largeTextSurfaces/index.ts ("HOW A SWEEP PLAN TURNS A ROW ON").
import type { SurfaceRow } from './index';

export const rows: SurfaceRow[] = [
  { id: 'D23', census: 'D23', kind: 'dialog', owner: '89.6-18', status: 'pending' },
  { id: 'D28', census: 'D28', kind: 'dialog', owner: '89.6-18', status: 'pending' },
  { id: 'R07-suggestions', census: 'R07', kind: 'route', owner: '89.6-18', status: 'pending' },
  { id: 'R08-suggestions', census: 'R08', kind: 'route', owner: '89.6-18', status: 'pending' },
];
