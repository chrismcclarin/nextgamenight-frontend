import { test, expect, type Locator, type Page } from '@playwright/test';

/**
 * Phase 87.8 Plan 08 — SPEC R4 (44x44 effective hit areas) + SPEC R6 (pressed-state
 * feedback) coverage, PHONE PROJECT ONLY.
 *
 * PROJECT GUARD: every new spec joins BOTH projects automatically — `journeys` and
 * `phone` share `testMatch: /.*\.spec\.ts/` (playwright.config.ts:44 and :87). This
 * file inverts the guard tailwind-v4-styles.spec.ts:57 uses: it SKIPS the desktop
 * `journeys` project and runs only at phone width, because R4/R6 are phone-tenet
 * requirements measured at the phone viewport (iPhone SE (3rd gen), 375x667 — D-06;
 * was iPhone 13 390x664 when this spec was written under plan 08).
 *
 * CLASSIFY BEFORE DEBUGGING — hover inertness is expected, not a defect.
 * Tailwind v4 wraps every `hover:` utility in `@media (hover: hover)`, which is FALSE
 * on this project's phone emulation (isMobile + hasTouch), so all ~222 hover sites are
 * INERT here — recorded at playwright.config.ts:80-84. If an assertion in this file
 * fails, first determine whether the cause is hover-inertness (expected v4 behaviour;
 * must NOT be "fixed") or a genuine layout/press defect. Pressed-state feedback in this
 * app deliberately does NOT depend on hover: `.btn:active:not(:disabled)` and the
 * per-site `active:opacity-75` utilities fire on :active, which touch does drive.
 *
 * MECHANISM UNDER TEST (R4): each census CTA grows from a PER-CTA `min-h-11` utility
 * added at its own call site by plan 87.8-01 Task 2(a) — NOT from any global `.btn`
 * rule. `.btn` (globals.css:756-767) declares no min-height and no height, which is
 * exactly why the layered utility applies. If a geometry assertion fails, the failure
 * is at that call site's className, not in globals.css.
 *
 * CENSUS SOURCE: the SPEC R4 re-census list in 87.8-01-SUMMARY.md (8 CTAs, file:line +
 * text per row). This spec asserts every phone-reachable census CTA, not a hardcoded
 * two-CTA pair. grouplist.js:103 (error-state "+ Create New Group") shares its
 * accessible name with the main branch and only one renders at a time, so the single
 * role+name locator covers whichever branch is live.
 *
 * SELECTOR POLICY: role/label/text only — never Tailwind classes (invite.spec.ts:18).
 * The add-friend control is located by its DYNAMIC accessible name pattern
 * `Add {username} as a friend` (ClickableMemberName.js aria-label).
 *
 * Fixtures follow the env-const idiom (tailwind-v4-styles.spec.ts:47-49): seeded ids
 * minted by the backend's scripts/e2e-fixtures.js in CI. Do not run locally —
 * credentials are intentionally absent (playwright.config.ts:19-21).
 */

const E2E_GROUP_ID = process.env.E2E_GROUP_ID ?? '1';
const E2E_AVAILABILITY_TOKEN = process.env.E2E_AVAILABILITY_TOKEN ?? 'seed-availability-token';
// gameDetail is where RsvpSection stacks member rows (space-y-1) with the add-friend
// "+" control — the tap-isolation surface. Same URL shape EventCalendar/GroupGamesList
// use: /gameDetail?event_id=<id>&group_id=<id>.
const E2E_EVENT_DETAIL_PATH =
  process.env.E2E_EVENT_DETAIL_PATH ?? `/gameDetail?event_id=1&group_id=${E2E_GROUP_ID}`;

/** Vacuity guard: a zero-count locator would make every assertion after it vacuous —
 *  that is a failure of the LOCATOR (or of fixture seeding), not of the touch-target
 *  work. Assert loudly instead of silently passing. */
async function guardResolved(locator: Locator, what: string, atLeast = 1): Promise<void> {
  // toBeVisible FIRST: it auto-waits, so the count sample below runs against a
  // settled page. locator.count() has NO auto-wait — sampling it first raced the
  // post-fetch render and failed 5 of these guards on the first armed CI run
  // (30833214370) while the CTAs and fixture rows were in fact all present.
  await expect(
    locator.first(),
    `locator for ${what} resolved no visible element — a zero-count locator makes the geometry assertion vacuous; this is a failure of the LOCATOR or the fixture state, not of the touch-target work`,
  ).toBeVisible();
  const count = await locator.count();
  expect(
    count,
    `locator for ${what} resolved ${count} elements (expected >= ${atLeast}) — a zero-count locator makes the geometry assertion vacuous; this is a failure of the LOCATOR or the fixture state, not of the touch-target work`,
  ).toBeGreaterThanOrEqual(atLeast);
}

/** R4 geometry: BOTH dimensions >= 44. Height-only would reproduce the exact gap R4
 *  closes — the fix is `min-h-11`, which sets min-height and NOT min-width, so a
 *  narrow census-added CTA would pass a height-only check while failing R4. */
async function assertMin44(locator: Locator, label: string): Promise<void> {
  const box = await locator.first().boundingBox();
  expect(box, `${label}: boundingBox() returned null — element not rendered`).not.toBeNull();
  if (!box) return;
  const mechanism =
    'grows from the per-CTA min-h-11 utility at its own call site (plan 87.8-01), NOT a global .btn rule — .btn declares no min-height, so a failure here is at the call site className';
  expect(
    box.height,
    `${label} height ${box.height}px < 44px — ${mechanism}`,
  ).toBeGreaterThanOrEqual(44);
  expect(
    box.width,
    `${label} width ${box.width}px < 44px — min-h-11 sets NO min-width, so a narrow CTA fails R4 even at full height; ${mechanism}`,
  ).toBeGreaterThanOrEqual(44);
}

/** R6 pressed-state: drive :active explicitly (pointer down without up), read the
 *  COMPUTED opacity (what the user perceives — never a class name), then release.
 *  The pointer is moved off the element before release so the press never completes
 *  into a click (no navigations / submits / side effects from this probe). */
async function assertPressedOpacity(page: Page, locator: Locator, label: string): Promise<void> {
  const target = locator.first();
  // boundingBox() is viewport-relative (getBoundingClientRect semantics) and raw
  // mouse events do NOT auto-scroll the way locator.click() does — for a below-fold
  // element the press lands outside the 667px viewport and :active never fires
  // (availability submit, first armed run 30833214370: pressed opacity read 1).
  await target.scrollIntoViewIfNeeded();
  const box = await target.boundingBox();
  expect(box, `${label}: boundingBox() null — cannot drive :active`).not.toBeNull();
  if (!box) return;
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  try {
    const opacity = await target.evaluate((el) => getComputedStyle(el).opacity);
    expect(
      parseFloat(opacity),
      `${label} computed opacity while pressed is ${opacity}, expected ~0.75 — the press idiom is an instant opacity dim (.btn:active:not(:disabled) for .btn sites, per-site active:opacity-75 for non-.btn tappables, D-12); hover styles are inert on touch and are NOT the mechanism`,
    ).toBeCloseTo(0.75, 2);
  } finally {
    // Move away before releasing so no click event completes on the element.
    await page.mouse.move(1, 1);
    await page.mouse.up();
  }
}

/** D-11 dark-theme pre-assertion (tailwind-v4-styles.spec.ts:78-86): a computed-style
 *  read in light mode would be meaningless and its failure misdiagnosed. */
async function assertDarkTheme(page: Page): Promise<void> {
  await expect(page.locator('html')).toHaveClass(/dark/);
}

test.describe('Phase 87.8 R4/R6 — touch-target geometry and press feedback (phone project)', () => {
  // Inverse of the tailwind-v4-styles.spec.ts:57 guard: this file is phone-only.
  // Both projects match every spec (playwright.config.ts:44, :87), so without this
  // skip the desktop journeys project would run phone-tenet assertions at 1280px.
  test.skip(({ isMobile }) => !isMobile, 'R4/R6 are phone-tenet requirements — phone project only');

  test('R4: home/group-list census CTAs measure >= 44x44 and press-dim', async ({ page }) => {
    await page.goto('/');
    await assertDarkTheme(page);

    // Census rows 3+4: "+ Create New Group" (aria-label "Create new group") — the
    // error-state and main branches share this name; exactly one renders.
    const createGroup = page.getByRole('button', { name: /create new group/i });
    await guardResolved(createGroup, 'the "+ Create New Group" CTA (grouplist.js census rows 3/4)');
    await assertMin44(createGroup, '"+ Create New Group"');

    // Census row 5: "Invite Member" — one per group card; the fixture user owns at
    // least one group, so at least one must render (guard asserts, no silent skip).
    const inviteMember = page.getByRole('button', { name: /invite member to group/i });
    await guardResolved(inviteMember, 'the per-card "Invite Member" CTA (grouplist.js census row 5)');
    await assertMin44(inviteMember, '"Invite Member"');

    // R6: the surface's primary CTA gives live pressed feedback.
    await assertPressedOpacity(page, createGroup, '"+ Create New Group"');
  });

  test('R4: groupHomePage + Create Event modal census CTAs measure >= 44x44 and press-dim', async ({ page }) => {
    await page.goto(`/groupHomePage?id=${E2E_GROUP_ID}`);
    await assertDarkTheme(page);

    // Census row 6: "Plan Game Session" (a Link styled .btn — inline-flex, so the
    // min-h-11 utility applies to it exactly as to a button).
    const planSession = page.getByRole('link', { name: /plan game session/i });
    await guardResolved(planSession, 'the "Plan Game Session" link (groupHomePage census row 6)');
    await assertMin44(planSession, '"Plan Game Session"');
    await assertPressedOpacity(page, planSession, '"Plan Game Session"');

    // Census row 7: the Create Event modal's submit. Reached the same way the green
    // create-event journey reaches it (tailwind-v4-styles.spec.ts:59-76).
    await page.getByRole('button', { name: /add new game event/i }).click();
    await expect(page.getByRole('heading', { name: /create event/i })).toBeVisible();
    const submit = page.getByRole('button', { name: /^(create|update) event$/i });
    await guardResolved(submit, 'the Create Event submit CTA (createEvent.js census row 7)');
    await assertMin44(submit, '"Create Event" submit');
    await assertPressedOpacity(page, submit, '"Create Event" submit');
  });

  test('R4: groupPlanning census CTAs measure >= 44x44 and press-dim', async ({ page }) => {
    await page.goto(`/groupPlanning?group_id=${E2E_GROUP_ID}`);
    await assertDarkTheme(page);

    // Both census CTAs live inside the collapsible "Check-ins" section
    // (PromptScheduleSection.js) — expand it first. Both are permission-gated
    // (canCreate / canManageSchedules); the fixture user OWNS the seeded group, so
    // both must render — the guard asserts that, with no silent skip path: a
    // non-rendering CTA must read as a fixture/locator failure, never as a pass.
    await page.getByText('Check-ins', { exact: true }).click();

    const startCheckin = page.getByRole('button', { name: /start a check-in/i });
    await guardResolved(startCheckin, 'the "+ Start a check-in" CTA (OpenPollsList.js census row 1)');
    await assertMin44(startCheckin, '"+ Start a check-in"');

    const newSchedule = page.getByRole('button', { name: /new schedule/i });
    await guardResolved(newSchedule, 'the "+ New Schedule" CTA (PromptScheduleManager.js census row 2, inline variant)');
    await assertMin44(newSchedule, '"+ New Schedule"');

    await assertPressedOpacity(page, startCheckin, '"+ Start a check-in"');
  });

  test('R4: availability submit CTA measures >= 44x44 and press-dims', async ({ page }) => {
    await page.goto(`/availability-form/${E2E_AVAILABILITY_TOKEN}`);
    await assertDarkTheme(page);

    // Census row 8: the availability submit (AvailabilityForm.js, w-full + min-h-11).
    const submit = page.getByRole('button', { name: /submit availability|update availability/i });
    await guardResolved(submit, 'the availability submit CTA (AvailabilityForm.js census row 8)');
    await assertMin44(submit, 'availability submit');
    await assertPressedOpacity(page, submit, 'availability submit');
  });

  test('R4: add-friend "+" carries a 44x32 ::after hit extension (owner-accepted asymmetric floor)', async ({ page }) => {
    await page.goto(E2E_EVENT_DETAIL_PATH);
    await assertDarkTheme(page);

    // Located by the DYNAMIC accessible-name pattern — the aria-label names the
    // person (`Add {username} as a friend`), which is the element's entire
    // accessible name (its only visible content is the "+" glyph).
    const addFriend = page.getByRole('button', { name: /^add .+ as a friend$/i });
    await guardResolved(
      addFriend,
      'the add-friend "+" control (needs an RSVP row whose member is not yet a friend — fixture must seed one)',
    );

    // The button's OWN box is 24x24 BY DESIGN (w-6 h-6 — D-13 technique 2: the control
    // must not visibly grow). Do NOT assert on boundingBox(); measure the effective
    // hit area the ::after pseudo-element adds instead.
    const geometry = await addFriend.first().evaluate((el) => {
      const rect = el.getBoundingClientRect();
      const after = getComputedStyle(el, '::after');
      const px = (v: string) => (Number.isFinite(parseFloat(v)) ? parseFloat(v) : 0);
      // Negative insets EXTEND the box: effective = own size + |left| + |right| etc.
      const left = px(after.left);
      const right = px(after.right);
      const top = px(after.top);
      const bottom = px(after.bottom);
      return {
        ownWidth: rect.width,
        ownHeight: rect.height,
        effectiveWidth: rect.width + Math.max(0, -left) + Math.max(0, -right),
        effectiveHeight: rect.height + Math.max(0, -top) + Math.max(0, -bottom),
        insets: { left, right, top, bottom },
      };
    });

    expect(
      geometry.effectiveWidth,
      `add-friend effective width ${geometry.effectiveWidth}px < 44px — expected 24 + 10 + 10 = 44 (own ${geometry.ownWidth}px + 10px -inset-x each side); insets: ${JSON.stringify(geometry.insets)}`,
    ).toBeGreaterThanOrEqual(44);
    expect(
      geometry.effectiveHeight,
      `add-friend effective height ${geometry.effectiveHeight}px < 32px — expected 24 + 4 + 4 = 32 (own ${geometry.ownHeight}px + 4px -inset-y each side; 32 not 44 is the OWNER-ACCEPTED asymmetric floor of 2026-08-02 — the 4px space-y-1 row gap forbids a symmetric extension); insets: ${JSON.stringify(geometry.insets)}`,
    ).toBeGreaterThanOrEqual(32);
  });

  test('D-13: tap isolation on both axes — the extension never steals the username\'s or the adjacent row\'s taps', async ({ page }) => {
    await page.goto(E2E_EVENT_DETAIL_PATH);
    await assertDarkTheme(page);

    // Record any friend-request POST — the side effect that must NOT fire from
    // either probe point.
    const friendRequests: string[] = [];
    page.on('request', (req) => {
      if (req.url().includes('/friendships/request')) friendRequests.push(req.url());
    });

    const addFriend = page.getByRole('button', { name: /^add .+ as a friend$/i });
    await guardResolved(
      addFriend,
      'the add-friend "+" control for tap isolation (fixture must seed a not-yet-friend RSVP row)',
    );

    // WHY THE EDGES AND NEVER THE CENTRES: a mis-sized or regressed extension only
    // ever reaches a few pixels past the boundary it is violating — the CENTRE of the
    // username or of the adjacent row is the one point that failure mode can never
    // reach, so a centre probe cannot fail and is vacuous on BOTH axes. Probe (a) is
    // the username's edge nearest the button (the first point an oversized or
    // mis-signed horizontal extension reaches); probe (b) is the vertically adjacent
    // row's near edge (the first point a mis-sized after:-inset-y reaches). Probe (b)
    // is unconditional: the surface this control renders on (RsvpSection.js) stacks
    // member rows via space-y-1, so the vertical failure mode is always reachable.
    const probes = await addFriend.first().evaluate((btn) => {
      const btnRect = btn.getBoundingClientRect();

      // The adjacent username span is the button's previous sibling inside the same
      // row (ClickableMemberName renders <span>{username}</span> then the "+").
      const username = btn.previousElementSibling as HTMLElement | null;
      const usernameRect = username?.getBoundingClientRect() ?? null;

      // The vertically adjacent row: walk up to the row element (direct child of the
      // space-y-1 stack) and take its sibling row — next if present, else previous.
      let row: HTMLElement | null = btn.parentElement;
      let adjacentRow: HTMLElement | null = null;
      while (row && !adjacentRow) {
        const sibling = (row.nextElementSibling ?? row.previousElementSibling) as HTMLElement | null;
        if (sibling && sibling.getBoundingClientRect().height > 0) {
          const sr = sibling.getBoundingClientRect();
          // A stacked sibling row sits above or below the button's row, not beside it.
          if (sr.top >= btnRect.bottom - 1 || sr.bottom <= btnRect.top + 1) adjacentRow = sibling;
        }
        if (!adjacentRow) row = row.parentElement;
      }
      const adjacentRect = adjacentRow?.getBoundingClientRect() ?? null;

      const hit = (x: number, y: number) => {
        const el = document.elementFromPoint(x, y);
        return {
          x,
          y,
          isButton: el === btn || (el !== null && btn.contains(el)),
          tag: el?.tagName ?? 'none',
          text: (el?.textContent ?? '').slice(0, 40),
          insideUsername: username !== null && el !== null && (el === username || username.contains(el)),
        };
      };

      // (a) username's edge nearest the button: the username precedes the button, so
      // its NEAR edge is its right edge — probe 2px inward from it, vertically centred.
      const probeA = usernameRect
        ? hit(usernameRect.right - 2, usernameRect.top + usernameRect.height / 2)
        : null;

      // (b) the adjacent row's NEAR edge: the horizontal position of the button's
      // centre (where the extension lives), 2px inside the neighbouring row's edge
      // closest to the button.
      let probeB = null;
      if (adjacentRect) {
        const x = btnRect.left + btnRect.width / 2;
        const y =
          adjacentRect.top >= btnRect.bottom - 1
            ? adjacentRect.top + 2 // row below: just inside its top edge
            : adjacentRect.bottom - 2; // row above: just inside its bottom edge
        probeB = hit(x, y);
      }

      return { probeA, probeB, hasUsername: username !== null, hasAdjacentRow: adjacentRow !== null };
    });

    // Vacuity guards for the probe GEOMETRY itself.
    expect(
      probes.hasUsername,
      'no username span found adjacent to the add-friend button — the probe cannot be constructed; DOM shape changed, fix the probe, not the geometry',
    ).toBe(true);
    expect(
      probes.hasAdjacentRow,
      'no vertically adjacent member row found — probe (b) is MANDATORY on this surface (RsvpSection stacks rows via space-y-1); the fixture must seed at least two RSVP-visible members',
    ).toBe(true);

    // (a) Horizontal isolation: the point 2px inside the username's near edge must
    // hit the username (or its contents) — NEVER the add-friend button. The ml-2.5
    // clearance exists precisely so the 10px leftward extension terminates AT the
    // username's edge instead of inside it.
    expect(
      probes.probeA?.isButton,
      `probe (a) at the username's near edge (${probes.probeA?.x},${probes.probeA?.y}) hit the add-friend button — its leftward extension crossed the ml-2.5 clearance into the username's box (hit: ${probes.probeA?.tag} "${probes.probeA?.text}")`,
    ).toBe(false);
    expect(
      probes.probeA?.insideUsername,
      `probe (a) did not land inside the username span (hit: ${probes.probeA?.tag} "${probes.probeA?.text}") — probe geometry is off; fix the probe`,
    ).toBe(true);

    // (b) Vertical isolation: the point 2px inside the adjacent row's near edge must
    // hit that row's own content — NEVER the add-friend button. after:-inset-y-1 is
    // capped at 4px precisely so it terminates at the 4px space-y-1 gap.
    expect(
      probes.probeB?.isButton,
      `probe (b) at the adjacent row's near edge (${probes.probeB?.x},${probes.probeB?.y}) hit the add-friend button — its vertical extension crossed the 4px space-y-1 gap into the neighbouring row (hit: ${probes.probeB?.tag} "${probes.probeB?.text}")`,
    ).toBe(false);

    // Behavioural check: physically tap BOTH probe points; the expected non-friend-
    // request behaviour occurs (the "+" still renders — status never flipped to
    // Pending) and no friend-request side effect fired from either tap.
    if (probes.probeA) await page.touchscreen.tap(probes.probeA.x, probes.probeA.y);
    if (probes.probeB) await page.touchscreen.tap(probes.probeB.x, probes.probeB.y);

    expect(
      friendRequests,
      `taps at the probe points fired ${friendRequests.length} friend-request call(s) — the hit extension is stealing adjacent taps`,
    ).toHaveLength(0);
    // The control still renders as "+" (aria-label intact, no swap to "⏳ Pending"),
    // proving neither tap activated it.
    await expect(addFriend.first()).toBeVisible();
  });

  test('R6: add-friend "+" press-dims via its per-site active:opacity-75', async ({ page }) => {
    await page.goto(E2E_EVENT_DETAIL_PATH);
    await assertDarkTheme(page);

    const addFriend = page.getByRole('button', { name: /^add .+ as a friend$/i });
    await guardResolved(addFriend, 'the add-friend "+" control for the press-feedback probe');
    // Non-.btn tappable: the press mechanism is the per-site active:opacity-75 token
    // plus cursor-pointer (REQUIRED for :active to fire on iOS — this bare button
    // does not use .btn, which is what carries cursor elsewhere). The helper releases
    // the pointer away from the element, so no friend request is sent by this probe.
    await assertPressedOpacity(page, addFriend, 'add-friend "+"');
  });
});
