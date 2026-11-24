// Surface rows: the group page, one row per part of the page (census R07). Owner: plan 89.6-17.
// Every row starts pending. One row per line, each with its census id.
// How a row is turned on: e2e/support/largeTextSurfaces/index.ts ("HOW A SWEEP PLAN TURNS A ROW ON").
import type { SurfaceRow } from './index';

export const rows: SurfaceRow[] = [
  { id: 'R07-games', census: 'R07', kind: 'route', owner: '89.6-17', status: 'pending' },
  { id: 'R07-library', census: 'R07', kind: 'route', owner: '89.6-17', status: 'pending' },
  { id: 'R07-checkins', census: 'R07', kind: 'route', owner: '89.6-17', status: 'pending' },
  { id: 'R07-history', census: 'R07', kind: 'route', owner: '89.6-17', status: 'pending' },
];
