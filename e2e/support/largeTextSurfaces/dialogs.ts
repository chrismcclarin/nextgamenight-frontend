// Surface rows: Customize Group, Delete group, the feedback dialogs, Start a check-in and the floating feedback button. Owner: plan 89.6-25.
// Every row starts pending. One row per line, each with its census id.
// How a row is turned on: e2e/support/largeTextSurfaces/index.ts ("HOW A SWEEP PLAN TURNS A ROW ON").
import type { SurfaceRow } from './index';

export const rows: SurfaceRow[] = [
  { id: 'D07', census: 'D07', kind: 'dialog', owner: '89.6-25', status: 'pending' },
  { id: 'D08', census: 'D08', kind: 'dialog', owner: '89.6-25', status: 'pending' },
  { id: 'D09', census: 'D09', kind: 'dialog', owner: '89.6-25', status: 'pending' },
  { id: 'D10', census: 'D10', kind: 'dialog', owner: '89.6-25', status: 'pending' },
  { id: 'D11', census: 'D11', kind: 'dialog', owner: '89.6-25', status: 'pending' },
  { id: 'D24', census: 'D24', kind: 'dialog', owner: '89.6-25', status: 'pending' },
  { id: 'O09', census: 'O09', kind: 'overlay', owner: '89.6-25', status: 'pending' },
];
