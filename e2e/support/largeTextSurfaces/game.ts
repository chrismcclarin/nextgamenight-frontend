// Surface rows: the game page (the game view of census R05) and the two review dialogs. Owner: plan 89.6-29.
// Every row starts pending. One row per line, each with its census id.
// How a row is turned on: e2e/support/largeTextSurfaces/index.ts ("HOW A SWEEP PLAN TURNS A ROW ON").
import type { SurfaceRow } from './index';

export const rows: SurfaceRow[] = [
  { id: 'R05-game', census: 'R05', kind: 'route', owner: '89.6-29', status: 'pending' },
  { id: 'D29', census: 'D29', kind: 'dialog', owner: '89.6-29', status: 'pending' },
  { id: 'D30', census: 'D30', kind: 'dialog', owner: '89.6-29', status: 'pending' },
];
