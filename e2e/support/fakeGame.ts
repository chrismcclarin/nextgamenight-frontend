import type { Page, Route } from '@playwright/test';

// The fake custom game that lets a spec reach the game view (/gameDetail?game_id=) in CI.
//
// No game fixture exists in CI, so the game view is served a CUSTOM game for a fixed fake id (the
// custom branch renders the name and no image) and an empty review list; the group's events and
// roster are real, on the real E2E_GROUP_ID. Every other request falls back to the next handler.
//
// DECISION Phase 88.9-36 (refactor-on-touch): ONE shared fake game, chosen OVER a copy per spec (the
// milestone's duplication tenet). Plan 88.6.1-74 wrote it inside e2e/gamedetail-refresh-failed.spec.ts
// and plan 88.9-21 copied the route pair into e2e/touch-targets.spec.ts; both now import it from
// here. A caller that needs its own answer to the game read (the refresh spec's 500-once arm) passes
// onGameGet; a caller that needs its own id passes id and gets the same custom game under it.
// Changing this is a decision, not a cleanup.

const E2E_GROUP_ID = process.env.E2E_GROUP_ID ?? '1';

export const E2E_FAKE_GAME_ID = '0e2e0000-0000-4000-8000-000000000074';
export const E2E_GAME_NAME = 'E2E Custom Game';
export const E2E_GAME_PATH = `/gameDetail?game_id=${E2E_FAKE_GAME_ID}&group_id=${E2E_GROUP_ID}`;

/** The served custom-game body for `id`. */
function fakeGameBody(id: string) {
  return {
    id,
    name: E2E_GAME_NAME,
    is_custom: true,
    bgg_id: null,
    theme: null,
    image_url: null,
    min_players: 2,
    max_players: 4,
    playing_time: 45,
  };
}

export const E2E_GAME = fakeGameBody(E2E_FAKE_GAME_ID);

export interface RouteFakeGameOptions {
  /** The fake game id (default E2E_FAKE_GAME_ID): builds the game GET path, the reviews prefix and the body id. */
  id?: string;
  /** Answer a matching game GET yourself: resolve true when answered, false to serve the fake game. */
  onGameGet?: (route: Route) => Promise<boolean>;
}

/** Routes the fake game and its (empty) reviews: the reviews route first, then the games route. */
export async function routeFakeGameSuccess(page: Page, options: RouteFakeGameOptions = {}): Promise<void> {
  const id = options.id ?? E2E_FAKE_GAME_ID;
  const gameGetPath = new RegExp(`^/api/games/${id}$`);
  const reviewsPrefix = `/api/game-reviews/game/${id}/`;
  const body = id === E2E_FAKE_GAME_ID ? E2E_GAME : fakeGameBody(id);
  await page.route('**/api/game-reviews/**', async (route) => {
    const request = route.request();
    if (request.method() === 'GET' && new URL(request.url()).pathname.startsWith(reviewsPrefix)) {
      await route.fulfill({ json: [] });
      return;
    }
    await route.fallback();
  });
  await page.route('**/api/games/**', async (route) => {
    const request = route.request();
    if (request.method() === 'GET' && gameGetPath.test(new URL(request.url()).pathname)) {
      if (options.onGameGet && (await options.onGameGet(route))) return;
      await route.fulfill({ json: body });
      return;
    }
    await route.fallback();
  });
}
