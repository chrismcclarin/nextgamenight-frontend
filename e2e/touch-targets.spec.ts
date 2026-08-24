import { test, expect, type Locator, type Page } from '@playwright/test';
// Plan 88.1-19 MEASUREMENT instruments — read-only attachments, no assertions, and NOT a
// spec file so Playwright cannot collect it as a suite. See `e2e/support/diagnostics.ts`.
import { attachDiagnostics, probeOverflowCulprits, probeViewport } from './support/diagnostics';

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
 *
 * EXTENDED Phase 88-30 (DEF-88-28-02). 88-28 raised the Header hamburger (`p-2` ->
 * `p-2.5`) and the KebabMenu trigger (`px-2 py-1` -> `min-h-11 min-w-11`) BY ARITHMETIC
 * only — RESEARCH logged the pre-change hamburger as assumption A7 ("the arithmetic is
 * sound but it was NOT measured in a browser") and the kebab's own must-have figure was
 * wrong by a factor that mattered (it described the hamburger). Both are now measured at
 * 375px here. 88-30 also adds the D-36 `.btn` phone-floor pair: the floor is live on a
 * shipped bare-`.btn` call site, and the `.btn-compact` opt-out still wins the cascade.
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
  // Deliver the press through hover()'s actionability pipeline — auto-scroll,
  // stability (element in the same position for two consecutive frames), and a
  // hit-target check that the element actually receives the pointer — then press
  // where the pointer already is. Manually captured boundingBox() coordinates
  // went stale under CI load twice: the below-fold availability submit was
  // "pressed" outside the 667px viewport (run 30833214370), and a mid-page
  // layout shift on groupPlanning moved the CTA between capture and press (run
  // 30836863411) — both times the press became a page-wide text drag and the
  // probe read opacity 1 on an element it never touched.
  await target.hover();
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

/** MEASUREMENT ONLY (plan 88.1-19): the IN-PAGE box of a CTA, in CSS pixels. Read-only.
 *  Paired with Playwright's own `boundingBox()`, which is visual-viewport-SCALED, this is
 *  what separates "the button is short" from "the page is scaled". Asserts nothing. */
function readCtaBox(locator: Locator) {
  return locator.first().evaluate((el) => {
    const round = (n: number) => Math.round(n * 1000) / 1000;
    const r = el.getBoundingClientRect();
    const cs = window.getComputedStyle(el);
    return {
      rectWidth: round(r.width),
      rectHeight: round(r.height),
      offsetWidth: (el as HTMLElement).offsetWidth,
      offsetHeight: (el as HTMLElement).offsetHeight,
      computedMinHeight: cs.minHeight,
      computedHeight: cs.height,
      computedTransform: cs.transform,
      className: (typeof el.className === 'string' ? el.className : '').slice(0, 120),
    };
  });
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

  test('R4: groupHomePage + Create Event modal census CTAs measure >= 44x44 and press-dim', async ({ page }, testInfo) => {
    await page.goto(`/groupHomePage?id=${E2E_GROUP_ID}`);
    await assertDarkTheme(page);

    // Census row 6: "Plan Game Session" (a Link styled .btn — inline-flex, so the
    // min-h-11 utility applies to it exactly as to a button).
    const planSession = page.getByRole('link', { name: /plan game session/i });
    await guardResolved(planSession, 'the "Plan Game Session" link (groupHomePage census row 6)');
    await assertMin44(planSession, '"Plan Game Session"');
    await assertPressedOpacity(page, planSession, '"Plan Game Session"');

    // MEASUREMENT ONLY (plan 88.1-19) — the CONTROL half of the submit reading below, and it
    // MUST be sampled HERE, before the modal opens. Radix's DialogContent marks the whole
    // background inert/aria-hidden, so once the Create Event modal is open this role-based
    // locator resolves NOTHING and any read against it hangs until the test timeout. That is
    // not a hypothesis: the first instrumented run (32773229213) timed out at exactly this
    // read placed after the modal opened, and produced no submit measurement at all.
    const planSessionControl = {
      inPage: await readCtaBox(planSession),
      playwrightBoundingBox: await planSession.first().boundingBox(),
    };

    // Census row 7: the Create Event modal's submit. Reached the same way the green
    // create-event journey reaches it (tailwind-v4-styles.spec.ts:59-76).
    await page.getByRole('button', { name: /add new game event/i }).click();
    await expect(page.getByRole('heading', { name: /create event/i })).toBeVisible();
    const submit = page.getByRole('button', { name: /^(create|update) event$/i });
    await guardResolved(submit, 'the Create Event submit CTA (createEvent.js census row 7)');

    // MEASUREMENT ONLY (plan 88.1-19), immediately before the assertion that read 43.835px.
    // Read-only: nothing here scrolls, clicks or writes a style.
    //
    // THE DISCRIMINATOR IS THE PAIR OF HEIGHTS. `getBoundingClientRect().height` is CSS
    // pixels; Playwright's `boundingBox().height` is the VISUAL-VIEWPORT-SCALED number, and
    // the phone project sets `isMobile: true`. So:
    //   - in-page 44 and Playwright 43.835 -> page scale, not CSS. The cause is horizontal
    //     overflow (`docScrollWidth` > `docClientWidth`) shrinking the scale, and
    //     `probeOverflowCulprits` NAMES the element instead of leaving it inferred.
    //   - in-page ALSO 43.835 -> it is CSS, and the fix belongs at the call site
    //     (`createEvent.js:1268`, which already carries `min-h-11`).
    // `planSession` is the CONTROL: it PASSED on the failing run, and whether it passed
    // because it is naturally taller than 44 or because it is unscaled is what makes the
    // submit's reading interpretable at all. It is captured above, pre-modal, for the
    // inert-background reason recorded there.
    await attachDiagnostics(testInfo, 'submit-44px', {
      viewport: await probeViewport(page),
      overflowCulprits: await probeOverflowCulprits(page),
      submitInPage: await readCtaBox(submit),
      submitPlaywrightBoundingBox: await submit.first().boundingBox(),
      planSessionControl,
    });

    await assertMin44(submit, '"Create Event" submit');
    await assertPressedOpacity(page, submit, '"Create Event" submit');

    // 88-CODE-REVIEW D1: the modal fleet's close button. One assertion here covers all 37
    // Modal.Header call sites — every migrated modal renders this exact DialogClose from
    // Modal.tsx's ModalHeader. It wears a REAL min-h-11/min-w-11 box (the 88-28 idiom this
    // spec's own comment at the hamburger records), so assertMin44's boundingBox() read is
    // the correct instrument — a regression to the bare ~15x24px glyph reds here.
    const modalClose = page.getByRole('button', { name: 'Close' });
    await guardResolved(modalClose, "the Create Event modal's close button (Modal.tsx ModalHeader DialogClose)");
    await assertMin44(modalClose, 'modal fleet close button');
  });

  test('R4: groupPlanning census CTAs measure >= 44x44 and press-dim', async ({ page }) => {
    await page.goto(`/groupPlanning?group_id=${E2E_GROUP_ID}`);
    await assertDarkTheme(page);

    // Both census CTAs live inside the "Check-ins" section (PromptScheduleSection.js),
    // which groupPlanning mounts ALREADY EXPANDED (defaultExpanded={true},
    // groupPlanning/page.js:247) once userRole resolves — do NOT click the header
    // "to expand": the header is a TOGGLE, so that click collapses the section.
    // The body hides via max-h-0 with a 200ms transition, so a sample taken
    // mid-transition still reads visible — that made the collapse land between
    // this test's guard and its press in two different ways (phantom press in run
    // 30836863411, hover timeout in run 30838155400). The guards below auto-wait
    // through the section's mount and data load; if the default ever flips to
    // collapsed, they fail loudly and the fixer adds a STATE-AWARE expand here.
    // Both CTAs are permission-gated (canCreate / canManageSchedules); the fixture
    // user OWNS the seeded group, so both must render — no silent skip path: a
    // non-rendering CTA must read as a fixture/locator failure, never as a pass.
    const startCheckin = page.getByRole('button', { name: /start a check-in/i });
    await guardResolved(startCheckin, 'the "+ Start a check-in" CTA (OpenPollsList.js census row 1)');
    await assertMin44(startCheckin, '"+ Start a check-in"');

    /* Census row 2 is STATE-DEPENDENT since 88-18 (DECISION marker on
       PromptScheduleManager.js's create button): with zero schedules the
       "+ New Schedule" button is SUPPRESSED and the EmptyState's "Create a
       schedule" Button carries the action instead — two identical primary
       CTAs a finger-width apart were ruled noise on a phone. The CI fixture
       group seeds no schedules, so EITHER affordance may be the live one;
       exactly ONE must render (both = the 88-18 suppression regressed,
       neither = fixture/locator failure), and whichever renders is measured. */
    const newSchedule = page.getByRole('button', { name: /new schedule/i });
    const emptyCreate = page.getByRole('button', { name: /create a schedule/i });
    await expect(
      newSchedule.or(emptyCreate).first(),
      'no schedule-create affordance rendered at all — fixture or locator failure, never a pass',
    ).toBeVisible();
    const bothCount = (await newSchedule.count()) + (await emptyCreate.count());
    expect(
      bothCount,
      `${bothCount} schedule-create affordances resolved (expected exactly 1) — two means the 88-18 empty-state suppression regressed; zero means the fixture/locator broke`,
    ).toBe(1);
    const liveCreate = (await newSchedule.count()) === 1 ? newSchedule : emptyCreate;
    await assertMin44(liveCreate, 'the schedule-create CTA (census row 2 — "+ New Schedule" or the EmptyState\'s "Create a schedule")');

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

  /* Phase 88-30 (DEF-88-28-02): the two controls plan 88-28 RESIZED are the two whose
     new size was never measured. Both are located by their shipped accessible names —
     "Toggle menu" (Header.js) and "Group actions" (the `ariaLabel` groupHomePage passes
     to KebabMenu) — so the selector policy above holds and a rename fails loudly rather
     than silently measuring nothing.

     The hamburger is `md:hidden`, so this assertion is only meaningful in the phone
     project; the file-level skip already guarantees that. The kebab renders at every
     breakpoint (its own marker says so) but its floor is a phone-tenet requirement, so it
     is asserted here rather than in `journeys`. */
  test('R4: hamburger and KebabMenu trigger measure >= 44x44 at 375px (88-28 geometry, measured not derived)', async ({ page }) => {
    await page.goto('/');
    await assertDarkTheme(page);

    // 88-28: `p-2` -> `p-2.5` = 10 + 24 (the w-6 h-6 svg) + 10 = 44x44. The fix was
    // chosen OVER an invisible `after:` extension precisely so the button's OWN
    // bounding box measures 44 — which is what assertMin44 reads.
    const hamburger = page.getByRole('button', { name: 'Toggle menu' });
    await guardResolved(hamburger, 'the Header hamburger (md:hidden — phone only)');
    await assertMin44(hamburger, 'Header hamburger');

    // The kebab is gated on `userRole && userRole !== 'pending'`; the fixture user owns
    // the seeded group, so it MUST render — a missing kebab is a fixture/locator failure,
    // never a silent skip.
    await page.goto(`/groupHomePage?id=${E2E_GROUP_ID}`);
    await assertDarkTheme(page);
    const kebab = page.getByRole('button', { name: 'Group actions' });
    await guardResolved(kebab, 'the groupHomePage KebabMenu trigger (owner/member only)');
    await assertMin44(kebab, 'KebabMenu trigger');

    // 88-CODE-REVIEW MED#13: the ITEMS behind the trigger — the destructive row
    // actions D-40 routed through this menu — carried the census's ~36px FAIL
    // even after 88-28 floored the trigger. min-h-11 on the item row; all six
    // render sites inherit from the one shared component, so one opened menu
    // is the fleet assertion.
    await kebab.click();
    const firstItem = page.getByRole('menuitem').first();
    await guardResolved(firstItem, 'the first KebabMenu item (opened menu)');
    await assertMin44(firstItem, 'KebabMenu item row');
  });

  /* DECISION Phase 88-30 (D-36 / DEF-1): the `.btn-compact` half of this test measures
     PLANTED probe elements, chosen OVER driving the two shipped `w-8 h-8` steppers in
     `BrowseMoreModal.js` — which is the obvious move and the thing a future reader will
     "fix" this to.

     MEASURED, not assumed: those steppers are UNREACHABLE in CI. `BrowseMoreModal` mounts
     only from `QuickSuggestions` (QuickSuggestions.js:115), whose "Browse more" trigger
     renders only when `suggestions.length > 0` (:161-176). `suggestionService.getSuggestions`
     builds its entire candidate set from `UserGame` rows (services/suggestionService.js:121)
     and returns `{ suggestions: [] }` when that set is empty (:150), and
     `scripts/seed-sample-data.js` creates ZERO `UserGame` rows (grep: no matches). So the
     seeded group has no suggestions, no "Browse more" button, and no steppers. Driving them
     would need a new backend fixture — a cross-repo change that also alters the Create Event
     surface four other green specs walk.

     What the probe DOES claim, and it is the half nothing else can see: that in the EMITTED
     stylesheet at 375px, `.btn-compact` still beats the unlayered `.btn { min-height: 2.75rem }`
     phone floor. That is a pure cascade fact about authoring order (globals.css:1100-1108),
     which jsdom cannot evaluate and which `decisionMarkers.test.ts:120-122` can only pin at
     SOURCE level. The two are complementary: that suite proves the call sites wear the class
     and the rule exists; this proves the browser resolves them the way the marker claims.

     The bare-`.btn` probe alongside it is the anti-vacuity guard: if the media query stopped
     applying (a breakpoint edit, a layering "cleanup"), the compact probe would pass at 32px
     for the WRONG reason. Both probes must disagree, or the test is meaningless. */
  test('D-36: the .btn phone floor is live on a shipped call site, and .btn-compact still opts out', async ({ page }) => {
    await page.goto(`/groupHomePage?id=${E2E_GROUP_ID}`);
    await assertDarkTheme(page);

    // The REAL call site: "Manage Members" is a bare `.btn` with NO per-CTA `min-h-11`
    // (groupHomePage/page.js), so the ONLY thing that can hold it at 44px here is the D-36
    // phone floor. "Plan Game Session" (asserted above) carries its own `min-h-11` and
    // therefore proves nothing about the floor.
    const manageMembers = page.getByRole('button', { name: /manage members/i });
    await guardResolved(manageMembers, 'the "Manage Members" bare-.btn CTA (no per-CTA min-h-11)');
    await assertMin44(manageMembers, '"Manage Members" (bare .btn, floored by D-36 only)');

    const probes = await page.evaluate(() => {
      const make = (className: string) => {
        const el = document.createElement('button');
        el.type = 'button';
        el.className = className;
        el.textContent = '+';
        document.body.appendChild(el);
        return el;
      };
      // Same class list the shipped steppers wear (BrowseMoreModal.js), plus a bare
      // control for the floor. `w-8`/`h-8` are emitted because those steppers use them.
      const compact = make('btn btn-compact btn-secondary w-8 h-8');
      const bare = make('btn btn-secondary');
      const read = (el: HTMLElement) => {
        const r = el.getBoundingClientRect();
        return { width: r.width, height: r.height, minHeight: getComputedStyle(el).minHeight };
      };
      const result = { compact: read(compact), bare: read(bare) };
      compact.remove();
      bare.remove();
      return result;
    });

    // (a) The floor is live at 375px — if this fails, the compact result below means nothing.
    expect(
      probes.bare.height,
      `bare .btn probe measured ${probes.bare.height}px (min-height: ${probes.bare.minHeight}) — the D-36 phone floor is NOT applying at 375px, which makes the .btn-compact assertion below vacuous. Look at globals.css's @media (width < 48rem) block and its authoring order, not at BrowseMoreModal`,
    ).toBeGreaterThanOrEqual(44);

    // (b) The opt-out wins: the stepper stays SQUARE, not stretched into a 32x44 lozenge.
    expect(
      probes.compact.height,
      `.btn.btn-compact probe measured ${probes.compact.height}px tall (min-height: ${probes.compact.minHeight}) — expected 32px. The opt-out lost the cascade: 87.8 AF-2 rejected an all-viewport floor precisely because it deforms these w-8 h-8 steppers into 32x44. Check that .btn-compact is still UNLAYERED and still authored AFTER the media block`,
    ).toBeCloseTo(32, 1);
    expect(
      Math.abs(probes.compact.width - probes.compact.height),
      `.btn.btn-compact probe measured ${probes.compact.width}x${probes.compact.height} — the steppers are square BY DESIGN and a height-only assertion would not have caught a 32x44 deformation`,
    ).toBeLessThanOrEqual(1);
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
      // elementFromPoint only resolves points INSIDE the viewport — the RSVP
      // section sits below the fold at 375x667 and nothing in this test scrolls
      // (assertions don't auto-scroll, only actions do), so unscrolled probes
      // returned null ("hit: none", run 30838155400). Centre the row first;
      // block:'center' also keeps the probe points clear of the sticky header.
      // scrollIntoView is synchronous, so the rects read below are post-scroll.
      btn.scrollIntoView({ block: 'center', inline: 'nearest' });
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

      // Hit-test AND activate in the SAME synchronous tick. Three CI rounds proved
      // that any coordinate crossing an await boundary on this page goes stale:
      // the surface settles asynchronously (self-RSVP banner, summary line, member
      // popovers), so native taps at previously-measured points hit the wrong
      // element under CI load — run 30839631190 (popover overlay), 30840571076
      // (popover mount race), 30843134195 (vertical layout shift between measure
      // and tap). elementFromPoint + el.click() here is the race-free equivalent:
      // the browser hit-tests the point and activates exactly that element, with
      // zero opportunity for the layout to move in between. The gesture pipeline
      // itself is not what D-13 probes — the extension's tap-STEALING property is
      // pure hit-test geometry plus handler wiring, both of which this exercises.
      const hit = (x: number, y: number) => {
        const el = document.elementFromPoint(x, y);
        return {
          x,
          y,
          el: el instanceof HTMLElement ? el : null,
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

      // BOTH hit-tests above ran against the pristine, popover-free layout; only
      // now are the resolved elements ACTIVATED — (b) first (already-friend row,
      // no add-friend action), then (a) (its username click legitimately opens
      // the member popover, asserted present-then-dismissed outside this
      // evaluate). React 18 flushes discrete click handlers synchronously, so
      // (b)'s popover could otherwise mount before (a)'s hit-test and cover it —
      // hit-test-both-THEN-activate-both removes that last ordering hazard.
      // Element references, not coordinates, are what get activated, so nothing
      // here can go stale.
      probeB?.el?.click();
      probeA?.el?.click();

      // The el references must not cross the evaluate boundary (not serialisable).
      const strip = (p: typeof probeA) =>
        p ? { x: p.x, y: p.y, isButton: p.isButton, tag: p.tag, text: p.text, insideUsername: p.insideUsername } : null;
      return { probeA: strip(probeA), probeB: strip(probeB), hasUsername: username !== null, hasAdjacentRow: adjacentRow !== null };
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

    // Behavioural half: the probe activations happened INSIDE the evaluate above
    // (hit-test + el.click() in one synchronous tick — see the comment on hit()).
    // The expected behaviour: the adjacent-row activation carries no add-friend
    // side effect, and the username activation opens the member popover — which
    // must appear (positive proof the point resolved to the username), then be
    // dismissed and proven gone (presence-then-absence; absence-only checks race
    // the popover mount, run 30840571076).
    await expect(
      page.getByRole('button', { name: 'Add friend', exact: true }),
      'the username-edge activation must open the member popover with its "Add friend" action — if this never appears, the probe point did not resolve to the username',
    ).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(page.getByRole('button', { name: 'Add friend', exact: true })).toHaveCount(0);

    // Absence over a window, not an instant: the request pipeline is async (an
    // access-token fetch precedes POST /friendships/request), so a same-tick
    // sample reads 0 vacuously even when a tap DID activate the control. Give the
    // pipeline a bounded settle, then assert nothing fired and nothing swapped.
    await page.waitForTimeout(750);
    expect(
      friendRequests,
      `taps at the probe points fired ${friendRequests.length} friend-request call(s) — the hit extension is stealing adjacent taps`,
    ).toHaveLength(0);
    // The control still renders as "+" (aria-label intact, no swap to "⏳ Pending"),
    // proving neither tap activated it.
    await expect(addFriend.first()).toBeVisible();
    await expect(page.getByText('⏳ Pending')).toHaveCount(0);
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
