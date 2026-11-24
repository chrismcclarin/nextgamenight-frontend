// Surface rows: Manage Group Members, Members and the dialogs they open. Owner: plan 89.6-11.
// Every row starts pending. One row per line, each with its census id.
// How a row is turned on: e2e/support/largeTextSurfaces/index.ts ("HOW A SWEEP PLAN TURNS A ROW ON").
// D18 (Remove member) opens only from md up, so it is reached at 768 and then read through the cells (FL-17c).
import type { SurfaceRow } from './index';

export const rows: SurfaceRow[] = [
  { id: 'D12', census: 'D12', kind: 'dialog', owner: '89.6-11', status: 'pending' },
  { id: 'D13', census: 'D13', kind: 'dialog', owner: '89.6-11', status: 'pending' },
  { id: 'D16', census: 'D16', kind: 'dialog', owner: '89.6-11', status: 'pending' },
  { id: 'D17', census: 'D17', kind: 'dialog', owner: '89.6-11', status: 'pending' },
  { id: 'D18', census: 'D18', kind: 'dialog', owner: '89.6-11', status: 'pending', reachAt: { width: 768, height: 1024 } },
  { id: 'D19', census: 'D19', kind: 'dialog', owner: '89.6-11', status: 'pending' },
  { id: 'D20', census: 'D20', kind: 'dialog', owner: '89.6-11', status: 'pending' },
];
