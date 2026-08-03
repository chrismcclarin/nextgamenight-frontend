import { test, expect, type Locator } from '@playwright/test';

/**
 * Phase 87.8 SPEC R2 — the padding-budget instrument (MOB-02).
 *
 * Measures the TOTAL horizontal padding from a body-text node up its ancestor
 * chain to <body> on each of the five walked surfaces, and fails when the sum
 * exceeds the UI-SPEC's locked ceiling: 75px, i.e. 20% of a 375px viewport
 * (Verification Contract row V1). Each failure message carries the measured
 * total AND the per-level breakdown, so a red run IS the diagnosis — no re-run
 * with extra logging needed. The same breakdown is what produces the D-05
 * pre-fix baseline (87.8-BASELINE.md).
 *
 * PHONE-ONLY: the describe-level guard below inverts the shape shipped at
 * tailwind-v4-styles.spec.ts:57. Both `journeys` (playwright.config.ts:44) and
 * `phone` (playwright.config.ts:87) collect every e2e/*.spec.ts, so without
 * the guard this file would also run at 1280x720 in `journeys`, where a 75px
 * budget is meaningless and would only add red to the desktop lane.
 *
 * DECISION Phase 87.8 (SPEC R2): this file asserts a pixel SUM against a fixed
 * ceiling — a deliberate, narrow exception to the assertion-shape policy
 * recorded at tailwind-v4-styles.spec.ts:37-40 ("pin WHICH PROPERTY is set,
 * never a pixel value", so Phase 88 can re-space freely). The exception is
 * justified because (a) the R2 budget IS a pixel sum by definition — there is
 * no property-shaped way to state "no more than 20% of the viewport", and
 * (b) it is a CEILING, not an exact value, so Phase 88 can still change
 * spacing freely underneath it without churning this file. The exception
 * applies to this file only; every other spec keeps the never-pin-pixels
 * policy. "Fixing" this to a property assertion is a decision, not a cleanup.
 *
 * SELECTOR POLICY (e2e/invite.spec.ts:18): role, label and text only — never
 * Tailwind classes. The helper below READS class strings for the diagnostic
 * breakdown, but no locator selects by class.
 *
 * THEME: the D-11 dark-theme pre-assertion (tailwind-v4-styles.spec.ts:78-86)
 * is deliberately omitted — computed padding is theme-independent (both themes
 * share the same box model; only colours differ), so no surface here needs the
 * theme resolved before layout settles. Re-adding it would be harmless but
 * asserts nothing this file depends on.
 *
 * NOTE ON THE GATE: tsconfig.json excludes `e2e/`, so `tsc --noEmit` does NOT
 * typecheck this file (same caveat as tailwind-v4-styles.spec.ts:42-44).
 */

// The UI-SPEC's locked ceiling: 20% of a 375px viewport (SPEC R2 / V1).
const PADDING_BUDGET_PX = 75;

// Seeded fixtures minted by the backend's scripts/e2e-fixtures.js in CI — same
// obviously-fake fallback idiom as tailwind-v4-styles.spec.ts:47-49 and
// rsvp.spec.ts:16 / availability-submit.spec.ts:15 / invite.spec.ts:21.
const E2E_GROUP_ID = process.env.E2E_GROUP_ID ?? '1';
const E2E_AVAILABILITY_TOKEN = process.env.E2E_AVAILABILITY_TOKEN ?? 'seed-availability-token';
const E2E_INVITE_GROUP_NAME = process.env.E2E_INVITE_GROUP_NAME ?? 'E2E Invite Group';

interface PaddingLevel {
  tagName: string;
  className: string;
  paddingLeft: number;
  paddingRight: number;
}

interface PaddingChain {
  total: number;
  levels: PaddingLevel[];
}

/**
 * Walk from a body-text node up to and including <body>, summing horizontal
 * padding at every level. Returns the per-level breakdown alongside the total
 * — the breakdown is what makes a failure diagnosable without a re-run and
 * what 87.8-BASELINE.md records, so it is NOT optional output.
 */
async function measurePaddingChain(anchor: Locator): Promise<PaddingChain> {
  return anchor.evaluate((start: Element): PaddingChain => {
    const levels: PaddingLevel[] = [];
    let node: Element | null = start;
    while (node) {
      const style = getComputedStyle(node);
      levels.push({
        tagName: node.tagName.toLowerCase(),
        // SVG elements expose className as SVGAnimatedString — normalise.
        className: typeof node.className === 'string' ? node.className : String(node.getAttribute('class') ?? ''),
        paddingLeft: parseFloat(style.paddingLeft) || 0,
        paddingRight: parseFloat(style.paddingRight) || 0,
      });
      if (node === document.body) break;
      node = node.parentElement;
    }
    const total = levels.reduce((sum, level) => sum + level.paddingLeft + level.paddingRight, 0);
    return { total, levels };
  });
}

/** Failure message: surface name, measured total, and the full chain. */
function describeChain(surface: string, chain: PaddingChain): string {
  const breakdown = chain.levels
    .map((l) => `  <${l.tagName}${l.className ? ` class="${l.className}"` : ''}> paddingLeft=${l.paddingLeft}px paddingRight=${l.paddingRight}px`)
    .join('\n');
  return (
    `${surface}: measured ${chain.total}px total horizontal padding against the ${PADDING_BUDGET_PX}px budget (SPEC R2 — 20% of 375px).\n` +
    `Per-level chain, innermost body text first, ending at <body>:\n${breakdown}`
  );
}

/** Vacuity-guard message, in the tailwind-v4-styles.spec.ts:139-143 style. */
function vacuityMessage(surface: string, chain: PaddingChain): string {
  return (
    `${surface}: the ancestor chain resolved to ${chain.levels.length} element(s) — fewer than 2 means the locator did not ` +
    `find the intended body-text node (it may have landed on <body> itself or a detached root), so every padding assertion ` +
    `below would be vacuous. This is a failure of the LOCATOR, not of the padding work — fix the anchor, do not touch the CSS.`
  );
}

test.describe('SPEC R2 — horizontal padding budget on the five walked surfaces', () => {
  // Runs ONLY in the `phone` project. Inverse of the guard at
  // tailwind-v4-styles.spec.ts:57 — that file opts OUT of phone; this file
  // opts out of everything EXCEPT phone. Both `journeys`
  // (playwright.config.ts:44) and `phone` (playwright.config.ts:87) collect
  // every e2e/*.spec.ts, so this is a runtime skip, not a collection filter.
  test.skip(({ isMobile }) => !isMobile, 'SPEC R2: the 75px budget is 20% of a PHONE viewport — meaningless at 1280px, so this spec runs only in the phone project');

  test('home / group list: padding chain stays within budget', async ({ page }) => {
    await page.goto('/');

    // Anchor: a group card's group-name heading — grouplist.js:224 renders
    // group.name as an <h3>. The seeded user owns E2E_INVITE_GROUP_NAME
    // (backend scripts/e2e-fixtures.js; same fixture invite.spec.ts relies on),
    // so its card is guaranteed to be in the list.
    const anchor = page.getByRole('heading', { name: E2E_INVITE_GROUP_NAME });
    await expect(anchor).toBeVisible({ timeout: 15_000 });

    const chain = await measurePaddingChain(anchor);
    expect(chain.levels.length, vacuityMessage('home / group list', chain)).toBeGreaterThanOrEqual(2);
    expect(chain.total, describeChain('home / group list', chain)).toBeLessThanOrEqual(PADDING_BUDGET_PX);
  });

  test('groupHomePage calendar body: padding chain stays within budget', async ({ page }) => {
    // The param is `id`, not `groupId` — see tailwind-v4-styles.spec.ts:59-69.
    await page.goto(`/groupHomePage?id=${E2E_GROUP_ID}`);

    // Anchor: the calendar body, NOT the identity header (the header is
    // already compliant and UI-SPEC-exempt — RESEARCH C-3). EventCalendar
    // renders its title as an <h2> inside the `card p-6` box
    // (EventCalendar.js:190-192); groupHomePage passes title="Calendar"
    // (groupHomePage/page.js:436).
    const anchor = page.getByRole('heading', { name: 'Calendar', exact: true });
    await expect(anchor).toBeVisible({ timeout: 15_000 });

    const chain = await measurePaddingChain(anchor);
    expect(chain.levels.length, vacuityMessage('groupHomePage calendar', chain)).toBeGreaterThanOrEqual(2);
    expect(chain.total, describeChain('groupHomePage calendar', chain)).toBeLessThanOrEqual(PADDING_BUDGET_PX);
  });

  test('Create Event modal: padding chain stays within budget', async ({ page }) => {
    // Same four-step journey tailwind-v4-styles.spec.ts:59-76 runs green in CI:
    // group home → "Add New Game Event" → "Create Event" heading → manual entry
    // (the start_date label renders only on the manual-entry branch).
    await page.goto(`/groupHomePage?id=${E2E_GROUP_ID}`);
    await page.getByRole('button', { name: /add new game event/i }).click();
    await expect(page.getByRole('heading', { name: /create event/i })).toBeVisible();
    await page.getByRole('button', { name: /switch to manual entry/i }).click();

    // Anchor: the start_date <label> element itself (createEvent.js:851) — a
    // text locator, because getByLabel would resolve to the <input>, whose own
    // control padding would pollute a body-text measurement.
    const anchor = page.getByText(/start date & time/i);
    await expect(anchor).toBeVisible({ timeout: 15_000 });

    const chain = await measurePaddingChain(anchor);
    expect(chain.levels.length, vacuityMessage('Create Event modal', chain)).toBeGreaterThanOrEqual(2);
    expect(chain.total, describeChain('Create Event modal', chain)).toBeLessThanOrEqual(PADDING_BUDGET_PX);
  });

  test('groupPlanning availability polls: padding chain stays within budget', async ({ page }) => {
    // Param name verified against source THIS session: groupPlanning/page.js:26
    // reads `searchParams.get('group_id')` — NOT `?id=` like groupHomePage.
    // RESEARCH M-09 records the ?id=/?group_id= inconsistency as Phase 88's to
    // fix; if Phase 88 renames the param, update this goto alongside it.
    await page.goto(`/groupPlanning?group_id=${E2E_GROUP_ID}`);

    // Anchor: body text inside the availability-poll card
    // (groupPlanning/page.js:239-241 → PromptScheduleSection →
    // PromptScheduleManager.js:185/:191 — the level RESEARCH C-2 found missing
    // from every upstream artifact). The CI fixture seeds no recurring
    // schedules (backend scripts/e2e-fixtures.js creates an AvailabilityPrompt
    // only), so ScheduleList renders its empty state (ScheduleList.js:41-43).
    // NOTE: the empty-state chain ends one level ABOVE a populated schedule
    // card (ScheduleList.js:67, p-4 = +32px total) — the baseline doc must
    // state this when comparing against RESEARCH C-3's populated-chain 168px.
    const anchor = page.getByText(/no schedules yet/i);
    await expect(anchor).toBeVisible({ timeout: 15_000 });

    const chain = await measurePaddingChain(anchor);
    expect(chain.levels.length, vacuityMessage('groupPlanning availability polls', chain)).toBeGreaterThanOrEqual(2);
    expect(chain.total, describeChain('groupPlanning availability polls', chain)).toBeLessThanOrEqual(PADDING_BUDGET_PX);
  });

  test('availability grid (magic-link form): padding chain stays within budget', async ({ page }) => {
    // Public magic-link route — no auth needed (FeedbackButton returns null
    // logged-out; RESEARCH C-3 notes).
    await page.goto(`/availability-form/${E2E_AVAILABILITY_TOKEN}`);

    // Anchor: the "Start with:" body text (AvailabilityForm.js:241) — a plain
    // <p> directly inside a p-4 section card, sitting on the same
    // page.js:234 → page.js:256 → p-4 chain RESEARCH C-3 traced (112px).
    // Deliberately NOT the "I'm unavailable this week" text inside :286's
    // section: that text lives inside a px-4 <button>, whose control padding
    // would inflate a body-text measurement by 32px.
    const anchor = page.getByText('Start with:');
    await expect(anchor).toBeVisible({ timeout: 15_000 });

    const chain = await measurePaddingChain(anchor);
    expect(chain.levels.length, vacuityMessage('availability grid', chain)).toBeGreaterThanOrEqual(2);
    expect(chain.total, describeChain('availability grid', chain)).toBeLessThanOrEqual(PADDING_BUDGET_PX);
  });
});
