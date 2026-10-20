import { expect, type Locator, type Page } from '@playwright/test';
import type { Route } from '@playwright/test';

import { assertTheme } from './contrast';

// Shared helpers for specs that press a control which WRITES and then inspect it while the
// write is in flight. Phase 88.6.1-43 moved them here from plan 88.6.1-22's
// e2e/account-delete-pending.spec.ts so the second spec (group-settings-pending-focus.spec.ts)
// imports them instead of copying them.
//
// holdWrites(page, options?) — ONE catch-all route that keeps every write in the browser.
//   GET and HEAD are handed back to normal routing (route.fallback) unless options.answerGet
//   returns a value for that URL, in which case the read is answered in the browser with
//   status 200 and that JSON. EVERY other method is pushed onto `held` and NEVER answered: no
//   fulfil, no abort, nothing handed on. That is what makes it safe to press a destructive
//   control against the shared CI fixture: the request exists only inside the browser.
//   count(method, pattern) reports how many held requests had that method and a URL pathname
//   matching the pattern, so a test can prove the hold caught exactly the request it pressed.
//   A CORS preflight never reaches this handler: Playwright answers intercepted OPTIONS
//   preflights itself, so a held cross-origin write is still issued (and held).
//   REGISTER IT BEFORE THE FIRST NAVIGATION — a route added after page.goto misses whatever
//   the page sent while loading.
//
// expectGatedPair(page, control, variant, theme) — the gated (aria-disabled) colour pair check.
//   Asserts the theme first (a style read in the wrong theme measures nothing), waits for the
//   control's colour transition to settle (.btn transitions background-color and color over
//   0.25s through --theme-transition, so an early read lands mid-transition and fails a correct
//   tree), then in ONE evaluate reads the control's computed background, colour and opacity,
//   resolves --color-btn-<variant>-gated-bg / -text through a throwaway probe element placed
//   beside it, removes the probe, and asserts the control paints exactly the pair, at opacity 1.
//
// DECISION Phase 88.6.1-43 (tenet: one helper): one shared write hold and one gated-colour
// probe, chosen over a second inline copy in the new spec (the milestone's duplication tenet:
// two copies of a safety hold drift, and the copy that drifts is the one that lets a write
// through). Changing this is a decision, not a cleanup.
// AMENDED Phase 88.6.1-44: the release-capable hold for ONE write under test lives here too, chosen
// over a spec-local copy (duplication tenet).

export interface HeldRequest {
  method: string;
  url: string;
}

export interface WriteHold {
  held: HeldRequest[];
  count: (method: string, pathPattern: RegExp) => number;
}

export interface HoldWritesOptions {
  /** Answer a GET/HEAD in the browser: return the JSON body, or undefined to let it through. */
  answerGet?: (url: URL) => unknown;
}

export async function holdWrites(page: Page, options: HoldWritesOptions = {}): Promise<WriteHold> {
  const held: HeldRequest[] = [];
  await page.route('**/*', async (route) => {
    const request = route.request();
    const method = request.method();
    if (method === 'GET' || method === 'HEAD') {
      const answer = options.answerGet?.(new URL(request.url()));
      if (answer !== undefined) {
        await route.fulfill({ status: 200, json: answer });
        return;
      }
      await route.fallback();
      return;
    }
    // Held: never answered, never handed on.
    held.push({ method, url: request.url() });
  });
  const count = (method: string, pathPattern: RegExp): number =>
    held.filter(
      (request) => request.method === method && pathPattern.test(new URL(request.url).pathname),
    ).length;
  return { held, count };
}

/**
 * The write backstop's afterEach, shared so every spec that holds writes fails the same way when a
 * write it did not mock reached the hold. A describe-level `test.skip` (a project the spec does not
 * run in) still runs afterEach for the skipped tests with beforeEach never having set the hold, so an
 * unset hold means "nothing ran, nothing to check" (runs 38983292066 and 38986410775: six
 * TypeErrors from two specs reading `hold.held` on undefined). Added at the wave 5 CI gate
 * (orchestrator, 2026-10-16).
 */
export function expectNoApiWrites(hold: WriteHold | undefined): void {
  if (!hold) return;
  const apiWrites = hold.held.filter((request) => new URL(request.url).pathname.startsWith('/api/'));
  expect(apiWrites, 'an /api write reached the backstop: mock that exact path in this spec').toEqual([]);
}

/**
 * Wait until every running animation under `locator` has finished before reading geometry.
 * `boundingBox()` reads the TRANSFORMED box, and the house dialog opens with dialog.tsx's
 * `zoom-in-95` over `duration-200`, so a read mid-animation measured 44px controls at 43.07px
 * (run 38983292066, Start poll) and 43.35-43.96px (run 38878098281, the invite panel's close).
 * Infinite animations (a spinner) are skipped because their `finished` never settles; a cancelled
 * one rejects and counts as done (it no longer transforms anything). Added at the wave 5 CI gate
 * (orchestrator, 2026-10-16) as the one shared wait, replacing plan 88.6.1-27's inline copy.
 */
export async function settleAnimations(locator: Locator): Promise<void> {
  await locator.evaluate((el) =>
    Promise.all(
      el
        .getAnimations({ subtree: true })
        .filter((a) => a.effect?.getComputedTiming().iterations !== Infinity)
        .map((a) => a.finished.catch(() => undefined)),
    ),
  );
}

/** What holdUntilReleased hands back. */
export interface ReleasableHold {
  /** How many requests with the held method and a matching pathname have arrived. */
  count: () => number;
  /** Resolves when the first matching request arrives. */
  arrived: Promise<void>;
  /** Answers every kept request in the browser, and any later match at once. */
  release: (json: unknown, status?: number) => Promise<void>;
}

/**
 * The release-capable hold for the ONE write a test is about (Phase 88.6.1-44; plans 59, 60, 67 and
 * 68 import it too). It registers on a URL predicate over the pathname, so a request whose pathname
 * does not match never enters this handler; inside it, a matching request of another method is
 * handed back with route.fallback(). A match is counted, the first one resolves `arrived`, and
 * every match is kept unanswered until `release(json, status = 200)`, which answers each kept
 * request in the browser and every later match at once. Nothing is ever sent to the network.
 * Register it AFTER holdWrites: Playwright runs the newest matching handler first, so a write this
 * hold does not match falls back into the net and is held there. Why a second helper beside
 * holdWrites: these tests must RELEASE the write to see what happens after a success, and the net
 * never answers a write, by design.
 */
export async function holdUntilReleased(
  page: Page,
  method: string,
  pathPattern: RegExp,
): Promise<ReleasableHold> {
  const kept: Route[] = [];
  let matched = 0;
  let answer: { json: unknown; status: number } | null = null;
  let markArrived!: () => void;
  const arrived = new Promise<void>((resolve) => {
    markArrived = resolve;
  });
  await page.route(
    (url) => pathPattern.test(url.pathname),
    async (route) => {
      if (route.request().method() !== method) {
        await route.fallback();
        return;
      }
      matched += 1;
      if (matched === 1) markArrived();
      if (answer) {
        await route.fulfill({ status: answer.status, json: answer.json });
        return;
      }
      kept.push(route);
    },
  );
  const release = async (json: unknown, status = 200): Promise<void> => {
    answer = { json, status };
    const waiting = kept.splice(0);
    await Promise.all(waiting.map((route) => route.fulfill({ status, json })));
  };
  return { count: () => matched, arrived, release };
}

export type GatedVariant = 'primary' | 'secondary' | 'danger' | 'accent';

export async function expectGatedPair(
  page: Page,
  control: Locator,
  variant: GatedVariant,
  theme: 'light' | 'dark',
): Promise<void> {
  await assertTheme(page, theme);

  // Settle the colour transition: every finite animation awaited, then two consecutive
  // matching reads (the readShadow idiom in e2e/touch-targets.spec.ts).
  await control.evaluate(async (node) => {
    const running = (node as HTMLElement)
      .getAnimations()
      .filter((animation) => animation.effect?.getTiming().iterations !== Infinity);
    await Promise.all(running.map((animation) => animation.finished.catch(() => undefined)));
  });
  let previous: string | null = null;
  await expect
    .poll(
      async () => {
        const now = await control.evaluate((node) => {
          const cs = getComputedStyle(node as HTMLElement);
          return `${cs.backgroundColor}|${cs.color}`;
        });
        const stable = previous !== null && now === previous;
        previous = now;
        return stable;
      },
      {
        message: `the ${variant} control's computed colours never stopped changing; .btn transitions them over 0.25s — do not remove the settle and read the interpolated value instead`,
        timeout: 5_000,
        intervals: [50, 50, 100, 100, 250],
      },
    )
    .toBe(true);

  const read = await control.evaluate((node, name) => {
    const element = node as HTMLElement;
    const cs = getComputedStyle(element);
    const probe = document.createElement('span');
    probe.style.backgroundColor = `var(--color-btn-${name}-gated-bg)`;
    probe.style.color = `var(--color-btn-${name}-gated-text)`;
    element.insertAdjacentElement('afterend', probe);
    const ps = getComputedStyle(probe);
    const result = {
      background: cs.backgroundColor,
      ink: cs.color,
      opacity: cs.opacity,
      probeBackground: ps.backgroundColor,
      probeInk: ps.color,
    };
    probe.remove();
    return result;
  }, variant);

  const measured = JSON.stringify(read);
  // Anti-vacuity: an unresolved token would leave the probe transparent.
  expect(read.probeBackground, `the gated ${variant} fill token did not resolve (${measured})`).not.toBe(
    'rgba(0, 0, 0, 0)',
  );
  expect(read.background, `the control paints the gated ${variant} fill (${measured})`).toBe(read.probeBackground);
  expect(read.ink, `the control paints the gated ${variant} ink (${measured})`).toBe(read.probeInk);
  expect(read.opacity, `the gated state is colour, never an opacity wash (${measured})`).toBe('1');
}
