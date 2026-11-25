// Surface rows: Home, the Create a new Group dialog and the Calendar sheet. Owner: plan 89.6-16.
// One row per line, each with its census id.
// How a row is turned on: e2e/support/largeTextSurfaces/index.ts ("HOW A SWEEP PLAN TURNS A ROW ON").
import type { SurfaceRow } from './index';

// R01 is the signed-in Home page (src/app/userHome/UserHomePage.js). The root is the page's main:
// the header strip and the footer around it are rows of their own (the chrome module). The seeded
// login has groups, so the list is loaded when its first card shows.
const reachHome: SurfaceRow['reach'] = async (page) => {
  await page.goto('/');
  await page.getByRole('heading', { level: 2, name: 'Your Groups' }).waitFor({ state: 'visible', timeout: 15_000 });
  await page.getByTestId('group-card').first().waitFor({ state: 'visible', timeout: 15_000 });
  return { root: page.locator('main') };
};

export const rows: SurfaceRow[] = [
  { id: 'R01', census: 'R01', kind: 'route', owner: '89.6-16', status: 'enforced', reach: reachHome },
  { id: 'D01', census: 'D01', kind: 'dialog', owner: '89.6-16', status: 'pending' },
  // The Calendar sheet is the second half of the 89.6-16 block (orchestrator split, 2026-11-23).
  { id: 'D04', census: 'D04', kind: 'dialog', owner: '89.6-40', status: 'pending' },
];
