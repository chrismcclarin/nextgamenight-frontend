// Surface rows: the planning page and the heatmap tooltip. Owner: plan 89.6-20.
// Every row starts pending. One row per line, each with its census id.
// How a row is turned on: e2e/support/largeTextSurfaces/index.ts ("HOW A SWEEP PLAN TURNS A ROW ON").
import type { SurfaceRow } from './index';

export const rows: SurfaceRow[] = [
  { id: 'R08', census: 'R08', kind: 'route', owner: '89.6-20', status: 'pending' },
  { id: 'O06', census: 'O06', kind: 'overlay', owner: '89.6-20', status: 'pending' },
];
