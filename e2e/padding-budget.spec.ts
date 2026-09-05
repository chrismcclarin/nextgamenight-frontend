import { test, expect, type Locator } from '@playwright/test';

/**
 * Phase 87.8 SPEC R2 — the padding-budget instrument (MOB-02).
 *
 * EXTENDED Phase 88-24 (owner ruling 2026-08-05, option-a): gameDetail,
 * userProfile and friends join the original five. Those three were the surfaces
 * carrying the off-ladder `.card` padding idioms (bare `p-6` = 24px at phone,
 * DOUBLE the ratified 12px rung), and they were exempt from this gate — so the
 * budget could not see the worst offenders. 88-24 converged all 28 `.card` call
 * sites onto `p-3 md:p-6`; these three tests are what stop that convergence
 * being re-lost, per the ruling's "machine-asserted rather than eyeballed".
 *
 * EXTENDED Phase 88-30 in two ways, both closing recorded gaps in what this file
 * could SEE rather than in what it covers:
 *   - DEF-88-16-02: the walker now counts width insets (the 88-16 phone modal
 *     gutter), not padding alone. See the marker inside `measurePaddingChain`.
 *   - DEF-88-24-05: the gameDetail anchor moved. 88-24 anchored on a heading that
 *     the URL it navigates to can never render, so that test timed out at 15s and
 *     read in CI as a padding failure. See the marker on that test.
 * It also gains the DEF-1 desktop assertion, in its own `journeys`-only describe
 * at the bottom of the file.
 *
 * Measures the TOTAL horizontal loss from a body-text node up its ancestor
 * chain to <body> on each of the eight walked surfaces, and fails when the sum
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
// Phase 88-24: same fixture idiom and same URL shape touch-targets.spec.ts:49-50
// already runs green in the phone lane — deliberately NOT a second variable name
// for the same path, so a fixture rename moves both specs together.
const E2E_EVENT_DETAIL_PATH =
  process.env.E2E_EVENT_DETAIL_PATH ?? `/gameDetail?event_id=1&group_id=${E2E_GROUP_ID}`;

interface PaddingLevel {
  tagName: string;
  className: string;
  paddingLeft: number;
  paddingRight: number;
}

interface PaddingChain {
  /** Real horizontal loss: `paddingTotal` + `outsideGap`. This is what the budget gates. */
  total: number;
  /** The ancestor-chain padding sum alone (what this helper measured before 88-30). */
  paddingTotal: number;
  /**
   * Horizontal space lost OUTSIDE the outermost walked element's border box —
   * i.e. viewport width minus that box, split across both sides. See the
   * DEF-88-16-02 marker on the walker.
   */
  outsideGap: number;
  /** Tag of the element the walk terminated on, for diagnosis. */
  terminatedAt: string;
  levels: PaddingLevel[];
}

/**
 * Walk from a body-text node up to and including <body>, summing horizontal
 * padding at every level, then add the space lost outside the outermost box.
 * Returns the per-level breakdown alongside the total — the breakdown is what
 * makes a failure diagnosable without a re-run and what 87.8-BASELINE.md
 * records, so it is NOT optional output.
 */
async function measurePaddingChain(anchor: Locator): Promise<PaddingChain> {
  return anchor.evaluate((start: Element): PaddingChain => {
    const levels: PaddingLevel[] = [];
    let node: Element | null = start;
    let outermost: Element = start;
    while (node) {
      const style = getComputedStyle(node);
      levels.push({
        tagName: node.tagName.toLowerCase(),
        // SVG elements expose className as SVGAnimatedString — normalise.
        className: typeof node.className === 'string' ? node.className : String(node.getAttribute('class') ?? ''),
        paddingLeft: parseFloat(style.paddingLeft) || 0,
        paddingRight: parseFloat(style.paddingRight) || 0,
      });
      outermost = node;
      if (node === document.body) break;
      // DECISION Phase 87.8-12: the chain STOPS at a position:fixed boundary
      // (after counting the fixed element's own padding, which does constrain
      // its children) — chosen OVER summing straight to <body>. A fixed
      // element's containing block is the viewport, so in-flow ancestor
      // padding underneath it (e.g. the page's p-4 under .modal-overlay,
      // globals.css:856-858) never constrains the measured text; counting it
      // failed the Create Event modal at a phantom 80px when its real chain
      // is 48px (first armed run 30833214370). Same principle as the R2
      // availability re-anchor: measure what the spec claims to measure.
      // Removing this break is a regression to that phantom, not a cleanup.
      if (style.position === 'fixed') break;
      node = node.parentElement;
    }
    const paddingTotal = levels.reduce((sum, level) => sum + level.paddingLeft + level.paddingRight, 0);

    /* DECISION Phase 88-30 (DEF-88-16-02): the budget counts the gap between the
       OUTERMOST walked box and the viewport, not padding alone — chosen OVER leaving
       the walker as a pure padding sum (which is what it says on the tin, and is
       therefore exactly what a future reader will "restore").

       Why it had to change: 87.8's 12px phone modal gutter used to BE padding, on
       `.modal-overlay` — the fixed element — so the walk counted it. 88-16 reimplemented
       it faithfully as a WIDTH INSET (`w-[calc(100%-1.5rem)]` on the Radix content,
       Modal.tsx) because the gutter is space OUTSIDE the card, and padding there would
       inset the card's CONTENTS instead. Correct fix, but 24px of real horizontal loss
       dropped straight out of this measurement: a default fleet modal sits at 72px
       against a 75px budget while this helper reported 27px of headroom that does not
       exist. Measuring the padding sum was measuring the implementation, not the person's
       experience.

       Clamped per side: a box WIDER than the viewport (horizontal overflow) yields a
       negative side, and negative space is not headroom to spend. `clientWidth` rather
       than `innerWidth` deliberately — `innerWidth` includes a classic scrollbar, which
       would credit the budget with pixels nobody can use. */
    const viewportWidth = document.documentElement.clientWidth;
    const box = outermost.getBoundingClientRect();
    const outsideGap = Math.max(0, box.left) + Math.max(0, viewportWidth - box.right);

    return {
      total: paddingTotal + outsideGap,
      paddingTotal,
      outsideGap,
      terminatedAt: outermost.tagName.toLowerCase(),
      levels,
    };
  });
}

/** Failure message: surface name, measured total, and the full chain. */
function describeChain(surface: string, chain: PaddingChain): string {
  const breakdown = chain.levels
    .map((l) => `  <${l.tagName}${l.className ? ` class="${l.className}"` : ''}> paddingLeft=${l.paddingLeft}px paddingRight=${l.paddingRight}px`)
    .join('\n');
  return (
    `${surface}: measured ${chain.total}px total horizontal loss against the ${PADDING_BUDGET_PX}px budget (SPEC R2 — 20% of 375px).\n` +
    `  ancestor padding: ${chain.paddingTotal}px\n` +
    `  outside the <${chain.terminatedAt}> border box (width insets, e.g. the DEC-3 modal gutter — DEF-88-16-02): ${chain.outsideGap}px\n` +
    `Per-level chain, innermost body text first, ending at <${chain.terminatedAt}>:\n${breakdown}`
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

test.describe('SPEC R2 — horizontal padding budget on the eight walked surfaces', () => {
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

    /* Phase 88-30 (DEF-88-16-02 + DEF-88-17-01). Two things at once, and both are
       load-bearing:

       (1) ANTI-VACUITY for the walker's new half. The width-inset term is invisible on
           every in-flow surface in this file (the walk ends at <body>, whose border box
           spans the viewport, so the gap is 0). This is the ONE walked surface that
           terminates on a `position: fixed` box, so if the inset accounting silently
           returned 0 — a refactor, a `clientWidth` -> something else — nothing else here
           would notice, and the 72-vs-27 misreport DEF-88-16-02 documents would come
           straight back.

       (2) The DEC-3 phone gutter is now MACHINE-ASSERTED AS GEOMETRY. `Modal.test.tsx`
           pins the class string; this pins that the browser actually renders the card
           inset from both screen edges at 375px. DEF-88-17-01 lost that gutter across
           the whole migrated fleet precisely because no assertion existed at either
           level, and it asked whoever restored it to add the phone assertion "or the
           next migration wave re-loses it".

       Asserted as a lower bound, not an equality: this file's own DECISION marker keeps
       it a CEILING discipline, and pinning 24px exactly would re-decide DEC-3's value
       from a test file. */
    expect(
      chain.outsideGap,
      `Create Event modal: measured ${chain.outsideGap}px of horizontal space outside the fixed <${chain.terminatedAt}> box, expected > 0. Either the 88-16 phone gutter (w-[calc(100%-1.5rem)] md:w-full on Modal.tsx's content, = 87.8 DEC-3's 12px per side) has been lost again — DEF-88-17-01, which cost the whole migrated modal fleet its gutter once already — or measurePaddingChain's width-inset accounting has stopped working, in which case every modal in this file is being measured 24px too generously (DEF-88-16-02). Read the breakdown to tell which:\n${describeChain('Create Event modal', chain)}`,
    ).toBeGreaterThan(0);
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

    // DECISION Phase 87.8 plan 12 (R2 anchor): anchor on GRID body text
    // ("Times shown in:", AvailabilityGrid.js:605-606 — a plain zero-padding
    // <div> whose ancestors up to the form card all carry zero horizontal
    // padding), chosen OVER the original "Start with:" anchor and OVER
    // shrinking the sibling card or excepting the ceiling. The old anchor
    // (AvailabilityForm.js:241) sits inside the :240 pre-fill card — a p-4
    // SIBLING of the grid section, not a grid ancestor — so post-plan-07 it
    // measured 88px (gutter 16 + form card 12 + sibling card 16 per side)
    // while the surface this spec claims to measure, the availability GRID,
    // sums 56px. Rejected fixes: reducing the sibling's p-4 (a design change
    // to a card plan 07 deliberately left boxed) and raising the ceiling for
    // this anchor (breaks the one-budget property). Recorded in the phase's
    // deferred-items.md (plan 07 → plan 12). Still NOT the "I'm unavailable
    // this week" text inside :286: that lives in a px-4 <button>, whose
    // control padding would inflate a body-text measurement by 32px.
    const anchor = page.getByText('Times shown in:');
    await expect(anchor).toBeVisible({ timeout: 15_000 });

    const chain = await measurePaddingChain(anchor);
    expect(chain.levels.length, vacuityMessage('availability grid', chain)).toBeGreaterThanOrEqual(2);
    expect(chain.total, describeChain('availability grid', chain)).toBeLessThanOrEqual(PADDING_BUDGET_PX);
  });

  /* DECISION Phase 88-24 (SPEC Req 2, owner ruling 2026-08-05 = option-a): the three
     tests below are the machine half of that ruling. The owner accepted a visible ~12px
     phone tightening on the bare-`p-6` cards specifically so the result would be gated
     rather than eyeballed — without these, the convergence is a diff nobody re-checks and
     the next plan that touches one of these files silently re-loses it.

     ANCHOR POLICY, and it is load-bearing: each anchors on a heading INSIDE a converged
     `.card p-3 md:p-6`, so the card's own padding is genuinely in the measured chain. An
     anchor above the card (a page title, a breadcrumb) would still pass the 75px budget
     and would assert nothing about the padding this plan changed — a vacuous gate. Moving
     any of these anchors out of its card is a regression to that vacuity, not a cleanup.

     PREDICTED, not observed: these were written against the source chains (the phone lane
     needs CI's Auth0 storageState and cannot run locally — playwright.config.ts:19-21).

     UPDATED 2026-08-05 (DEF-88-24-01, owner ruling). gameDetail was the tight one at a
     predicted 72/75, 48 of which was its PAGE wrapper's bare `p-6`. The owner ruled that
     wrapper down to `p-3 md:p-6` — BOTH branches of the route, since both were bare `p-6`
     — so the predicted chain is now 24 (wrapper) + 24 (card) = 48/75. The headroom went
     from 3px to 27px. If this test still comes back red, the lever is NOT loosening
     PADDING_BUDGET_PX and NOT re-anchoring above the card; read the per-level breakdown
     the failure prints and find the level that is not one of those two.

     AMENDED 2026-08-05 by plan 88-30 — the paragraph above is kept as history and one of
     its sentences is now WRONG in a way worth naming, because it is the sentence a reader
     will otherwise trust. "these were written against the source chains" holds for
     userProfile and friends; for gameDetail the source chain was derived from a heading
     the test's own URL cannot render (DEF-88-24-05), so its 48/75 arithmetic was right by
     coincidence — both route branches happened to carry the same wrapper and card padding.
     The anchor is fixed on the test itself below. The ANCHOR POLICY above is unchanged and
     the replacement obeys it. */

  /* DECISION Phase 88-30 (DEF-88-24-05): this test anchors on the event-view <h1>
     "Game Night", chosen OVER 88-24's "Game Sessions (N)" <h2> and OVER the deferral's
     own suggested replacement. It is not a preference — the other two cannot resolve on
     the URL this test loads.

     What was wrong: `E2E_EVENT_DETAIL_PATH` carries `event_id` and `group_id` but NO
     `game_id`, and `gameDetail/page.js` reads `game_id` from the query string and nowhere
     else, then returns the EVENT-ONLY view early when it is absent. "Game Sessions" lives
     in the game view's return, which that URL never reaches — so the old anchor could only
     ever time out at 15s and be misread in CI as a padding-budget failure, inviting the
     two responses this file's other markers explicitly rule out.

     REJECTED (a): point `E2E_EVENT_DETAIL_PATH` at a URL with a `game_id`. Verified
     against the seed: `scripts/e2e-fixtures.js` creates its Event with no `game_id` and
     emits no game key, so this needs a new backend fixture — and the variable is
     deliberately SHARED with touch-targets.spec.ts (:62-66 above), so changing it moves a
     green spec's surface too.

     REJECTED (b): the deferral's own suggestion, the `Participants (N)` <h2>. Verified
     against the source AND the seed: it is gated on `participants.length > 0`, and
     `participants` comes from `eventData.EventParticipations` — while the fixture seeds
     only `EventRsvp` rows (Diana + Bob) and zero `EventParticipation` rows for that event.
     It would have swapped one guaranteed timeout for another.

     Why THIS anchor holds: the `<h1>` sits in the event-only branch's first
     `card p-3 md:p-6`, unconditionally — no scope, role or count gate above it — so the
     anchor policy (a heading INSIDE the card under test) is kept. Its text is
     fixture-independent because `models/Event.js` has NO `title` column, so
     `singleEvent.title` is always undefined and the `|| 'Game Night'` fallback always
     wins. Predicted chain: 12+12 (card) + 12+12 (page wrapper) = 48 of 75.

     If an Event `title` column is ever added, this locator breaks LOUDLY rather than
     measuring the wrong box — that is the intended failure mode, not a fragility. */
  test('gameDetail event card: padding chain stays within budget', async ({ page }) => {
    await page.goto(E2E_EVENT_DETAIL_PATH);

    const anchor = page.getByRole('heading', { level: 1, name: 'Game Night', exact: true });
    await expect(anchor).toBeVisible({ timeout: 15_000 });

    const chain = await measurePaddingChain(anchor);
    expect(chain.levels.length, vacuityMessage('gameDetail event card', chain)).toBeGreaterThanOrEqual(2);
    expect(chain.total, describeChain('gameDetail event card', chain)).toBeLessThanOrEqual(PADDING_BUDGET_PX);
  });

  test('userProfile theme card: padding chain stays within budget', async ({ page }) => {
    await page.goto('/userProfile');

    // Anchor: the "Theme" <h2> inside its `card p-3 md:p-6`. Unconditional — it
    // renders for every authenticated user, unlike the SMS block
    // (entitlement-gated) or the Google Calendar block (connection-state
    // dependent), either of which would make this test fixture-fragile.
    //
    // CORRECTED Phase 88.8 plan 13 (comment only, no behavioural change). This
    // comment cited `userProfile/page.js:1510` / `:1509`; the real positions were
    // already `:1741` / `:1740` before this plan and have moved again since, because
    // plan 13 mounts the new Email card immediately ABOVE this one. The test itself
    // locates by role and accessible name, so it was never affected — but a stale
    // line anchor sends the next reader to the wrong element, which is how anchor
    // drift bit this phase six times. Line numbers are deliberately not restated.
    const anchor = page.getByRole('heading', { name: 'Theme', exact: true });
    await expect(anchor).toBeVisible({ timeout: 15_000 });

    const chain = await measurePaddingChain(anchor);
    expect(chain.levels.length, vacuityMessage('userProfile theme card', chain)).toBeGreaterThanOrEqual(2);
    expect(chain.total, describeChain('userProfile theme card', chain)).toBeLessThanOrEqual(PADDING_BUDGET_PX);
  });

  test('friends add-friend card: padding chain stays within budget', async ({ page }) => {
    await page.goto('/friends');

    // Anchor: the "Add Friend" <h2> (friends/page.js:486) inside the `card p-3 md:p-6`
    // at :485, converged from bare `p-6` by this plan. Chosen OVER any of the friend-row
    // cards below it, which render only when the seeded user actually has friends /
    // pending requests — this card renders on the empty state too.
    const anchor = page.getByRole('heading', { name: 'Add Friend', exact: true });
    await expect(anchor).toBeVisible({ timeout: 15_000 });

    const chain = await measurePaddingChain(anchor);
    expect(chain.levels.length, vacuityMessage('friends add-friend card', chain)).toBeGreaterThanOrEqual(2);
    expect(chain.total, describeChain('friends add-friend card', chain)).toBeLessThanOrEqual(PADDING_BUDGET_PX);
  });
});

/* SPEC Req 8 acceptance, DEF-1's second half: "a desktop e2e/screenshot assertion covers
   one dense `.btn` row". This is the DESKTOP describe — the inverse guard of the phone one
   above, in the same file because the two halves of D-36 only make sense read together:
   `.btn` is floored at 44px BELOW `md` and deliberately left floorless ABOVE it.

   DECISION Phase 88-30: assert the mechanism's BOUNDARY (< 44 / >= 44), not a pixel band
   around the ~37px `.btn` renders today — chosen OVER pinning a measured height, which is
   what "within an expected band" invites. 44 is the number every part of this decision is
   written in; 37 is an emergent consequence of `.btn`'s `0.5rem` padding on `0.875rem`
   text (globals.css:1001-1013) that a legitimate type or spacing change would move,
   churning this file for no signal. The lower bound is anti-vacuity only.

   The two controls guard each OTHER, which is the point of using a row rather than a
   single button:
     - "Manage Members" is a bare `.btn` with no per-CTA height. If a future blanket
       `min-height` lands on `.btn` — the thing 87.8 AF-2 rejected and 88-01 re-rejected
       for all viewports — it goes >= 44 and this reds.
     - "Plan Game Session" carries `min-h-11`. Every one of the eight D-36 markers warns
       against deleting those "because there is a floor now"; below `md` the two agree, so
       at 1280 this is the ONLY thing holding it at 44 and this is where that deletion
       shows up.
   Both live in the same flex row (`sm:flex-row`) on groupHomePage and are gated only on
   `userRole !== 'pending'`; the fixture user owns the seeded group, so both must render.

   NOT the NotificationBell Accept/Decline pair or RsvpSection's "Save note", which SPEC
   :110 names as the other dense idioms: verified unreachable with the CI seed —
   `scripts/e2e-fixtures.js` hard-deletes every `GroupInvite` for the invite group and
   seeds only accepted friendships, so no notification rows render; and "Save note" is
   gated on the viewer having already selected an RSVP status. */
test.describe('SPEC Req 8 / DEF-1 — a dense `.btn` row stays dense at desktop', () => {
  test.skip(({ isMobile }) => !!isMobile, 'DEF-1 is the DESKTOP half of D-36: below md the phone floor legitimately makes these 44px, so at 375px this assertion would be backwards');

  test('groupHomePage CTA row: the unfloored `.btn` stays < 44px and the per-CTA floor still holds at 1280', async ({ page }) => {
    await page.goto(`/groupHomePage?id=${E2E_GROUP_ID}`);

    const manageMembers = page.getByRole('button', { name: /manage members/i });
    await expect(
      manageMembers,
      'the "Manage Members" CTA did not render — it is gated on userRole !== "pending" and the fixture user OWNS the seeded group, so this is a fixture or locator failure, not a geometry one',
    ).toBeVisible({ timeout: 15_000 });

    const planSession = page.getByRole('link', { name: /plan game session/i });
    await expect(
      planSession,
      'the "Plan Game Session" CTA did not render — same gate as above; a missing control here would make the floor assertion below vacuous',
    ).toBeVisible({ timeout: 15_000 });

    const bare = await manageMembers.boundingBox();
    const floored = await planSession.boundingBox();
    expect(bare, '"Manage Members" boundingBox() returned null').not.toBeNull();
    expect(floored, '"Plan Game Session" boundingBox() returned null').not.toBeNull();
    if (!bare || !floored) return;

    expect(
      bare.height,
      `"Manage Members" measured ${bare.height}px tall at 1280 — it is a bare .btn with NO per-CTA min-h-11, so anything >= 44 means a blanket .btn height floor has appeared. That was rejected in 87.8 (AF-2) and re-rejected for all viewports by 88-01 (D-36) because it deforms square-by-design controls; the phone-only floor is @media (width < 48rem) and must not reach this viewport`,
    ).toBeLessThan(44);
    expect(
      bare.height,
      `"Manage Members" measured ${bare.height}px tall — under 20px means the locator resolved something that is not the rendered CTA, which would make the < 44 assertion above pass vacuously`,
    ).toBeGreaterThanOrEqual(20);

    expect(
      floored.height,
      `"Plan Game Session" measured ${floored.height}px tall at 1280 — its per-CTA min-h-11 is the ONLY thing holding it at 44 above md (the D-36 phone floor stops at 48rem). If this failed, someone deleted that utility as redundant, which is exactly what all eight D-36 markers warn against`,
    ).toBeGreaterThanOrEqual(44);
  });
});
