// Surface rows: the not-found page (R17, enforced by plan 89.6-08 as the sweep's tracer) and the
// link-only and document pages plan 89.6-23 turns on. One row per line, each with its census id.
// How a row is turned on: e2e/support/largeTextSurfaces/index.ts ("HOW A SWEEP PLAN TURNS A ROW ON").
import type { SurfaceRow } from './index';

// R17 is any URL with no route (src/app/not-found.tsx). The root is the page's main: the header
// strip and the footer around it are rows of their own (the chrome module).
const reachNotFound: SurfaceRow['reach'] = async (page) => {
  await page.goto('/large-text-sweep-no-such-page');
  await page.getByRole('heading', { level: 1, name: 'This page took a wrong turn' }).waitFor({ state: 'visible' });
  return { root: page.locator('main') };
};

export const rows: SurfaceRow[] = [
  { id: 'R17', census: 'R17', kind: 'route', owner: '89.6-08', status: 'enforced', reach: reachNotFound },
  { id: 'R02', census: 'R02', kind: 'route', owner: '89.6-23', status: 'pending' },
  { id: 'R03', census: 'R03', kind: 'route', owner: '89.6-23', status: 'pending' },
  { id: 'R06', census: 'R06', kind: 'route', owner: '89.6-23', status: 'pending' },
  { id: 'R09', census: 'R09', kind: 'route', owner: '89.6-23', status: 'pending' },
  { id: 'R10', census: 'R10', kind: 'route', owner: '89.6-23', status: 'pending' },
  { id: 'R11', census: 'R11', kind: 'route', owner: '89.6-23', status: 'pending' },
  { id: 'R12', census: 'R12', kind: 'route', owner: '89.6-23', status: 'pending' },
  { id: 'R13', census: 'R13', kind: 'route', owner: '89.6-23', status: 'pending' },
  { id: 'R14', census: 'R14', kind: 'route', owner: '89.6-23', status: 'pending' },
  { id: 'R15', census: 'R15', kind: 'route', owner: '89.6-23', status: 'pending' },
  { id: 'D35', census: 'D35', kind: 'dialog', owner: '89.6-23', status: 'pending' },
];
