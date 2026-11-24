// Surface rows: the day popup and Share Game QR. Owner: plan 89.6-28.
// Every row starts pending. One row per line, each with its census id.
// How a row is turned on: e2e/support/largeTextSurfaces/index.ts ("HOW A SWEEP PLAN TURNS A ROW ON").
import type { SurfaceRow } from './index';

export const rows: SurfaceRow[] = [
  { id: 'D05', census: 'D05', kind: 'dialog', owner: '89.6-28', status: 'pending' },
  { id: 'D06', census: 'D06', kind: 'dialog', owner: '89.6-28', status: 'pending' },
];
