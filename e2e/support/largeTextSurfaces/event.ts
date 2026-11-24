// Surface rows: Create Event and Edit Event. Owner: plan 89.6-24.
// Every row starts pending. One row per line, each with its census id.
// How a row is turned on: e2e/support/largeTextSurfaces/index.ts ("HOW A SWEEP PLAN TURNS A ROW ON").
import type { SurfaceRow } from './index';

export const rows: SurfaceRow[] = [
  { id: 'D21', census: 'D21', kind: 'dialog', owner: '89.6-24', status: 'pending' },
  { id: 'D22', census: 'D22', kind: 'dialog', owner: '89.6-24', status: 'pending' },
];
