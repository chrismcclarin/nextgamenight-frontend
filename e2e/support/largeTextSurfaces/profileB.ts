// Surface rows: the rest of Profile (census R16), Delete your account and the combobox listbox. Owner: plan 89.6-27.
// Every row starts pending. One row per line, each with its census id.
// How a row is turned on: e2e/support/largeTextSurfaces/index.ts ("HOW A SWEEP PLAN TURNS A ROW ON").
import type { SurfaceRow } from './index';

export const rows: SurfaceRow[] = [
  { id: 'R16-rest', census: 'R16', kind: 'route', owner: '89.6-27', status: 'pending' },
  { id: 'D34', census: 'D34', kind: 'dialog', owner: '89.6-27', status: 'pending' },
  { id: 'O07', census: 'O07', kind: 'overlay', owner: '89.6-27', status: 'pending' },
];
