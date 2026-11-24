// Surface rows: the shared dialog shell, read on three dialogs (the shell extras; census D07, D12 and D19). Owner: plan 89.6-10.
// Every row starts pending. One row per line, each with its census id.
// How a row is turned on: e2e/support/largeTextSurfaces/index.ts ("HOW A SWEEP PLAN TURNS A ROW ON").
import type { SurfaceRow } from './index';

export const rows: SurfaceRow[] = [
  { id: 'D07-shell', census: 'D07', kind: 'dialog', owner: '89.6-10', status: 'pending' },
  { id: 'D12-shell', census: 'D12', kind: 'dialog', owner: '89.6-10', status: 'pending' },
  { id: 'D19-shell', census: 'D19', kind: 'dialog', owner: '89.6-10', status: 'pending' },
];
