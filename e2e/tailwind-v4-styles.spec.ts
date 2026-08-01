import { test, expect } from '@playwright/test';

/**
 * Phase 87.7 D-10 LAYER 2 — the two render-only hazards no grep can see.
 *
 * The phase's other two validation layers are static: the hazard greps (layer 1) prove
 * no stale v3 utility survived the codemod, and the emitted-CSS diff (layer 3) proves no
 * selector was lost between the v3 baseline and the migrated build. Neither can prove
 * what an element actually COMPUTES in a browser, and that is exactly where these two
 * hazards live:
 *
 *   1. v4's preflight DROPS v3's `border-color: #e5e7eb` default, so every unpaired bare
 *      border-width site would fall back to `currentColor` — a border the same colour as
 *      its own text. 43 such sites are enumerated in 87.7-STYLE-AUDIT.md § Border audit.
 *      An `@layer base` shim in src/app/globals.css repairs it. Test 1 proves it is live.
 *   2. v4's `space-y` flipped selector AND property: v3 put the gap on children 2..n as a
 *      physical `margin-top` via a sibling combinator; v4 puts it on children 1..n-1 as a
 *      logical `margin-block-end` via `:not(:last-child)`. Tests 2 and 3 prove the flip.
 *
 * Runs auth-free via the cached storageState the `setup` project produces (D-05), on the
 * create-event modal — a surface e2e/create-event.spec.ts already proves reachable in
 * green CI, which is why both exemplars were taken from it (T-87.7-10-01).
 *
 * SELECTOR POLICY — and a deliberate amendment to it.
 * Every other spec in this directory opens with "role/label/text/name-attribute only —
 * never Tailwind classes". This file keeps that rule and adds one `data-testid`.
 *
 * DECISION Phase 87.7 Plan 10: the locators here are one `data-testid` plus one existing
 * label locator, chosen OVER two rejected alternatives. REJECTED (a): a Tailwind-class
 * locator — self-defeating in the one phase whose entire job is rewriting class names, so
 * the locator would churn with the thing it is meant to measure. REJECTED (b): a role
 * locator for the `space-y` container — it is a structural `<form>` with no usable
 * accessible role, so no such locator exists. The `data-testid` is therefore an addition
 * the policy does not currently mention, not a violation of it; "fixing" it back to a role
 * locator is a decision, not a cleanup.
 *
 * DECISION Phase 87.7 Plan 10 (assertion shape): every assertion pins WHICH PROPERTY is
 * set — never a pixel value — chosen OVER pinning measured pixels, so Phase 88's redesign
 * can change spacing and colour freely without churning this file. D-12 rules out
 * screenshot baselines this phase for the same reason.
 *
 * NOTE ON THE GATE: tsconfig.json excludes `e2e/`, so `tsc --noEmit` does NOT typecheck
 * this file. It was typechecked explicitly (see 87.7-10-SUMMARY.md); do not read a green
 * `npm run typecheck` as covering this directory.
 */

// Seeded group minted by the backend's scripts/e2e-fixtures.js in CI — same env fallback
// convention as e2e/create-event.spec.ts:17.
const E2E_GROUP_ID = process.env.E2E_GROUP_ID ?? '1';

test.describe('Tailwind v4 migration — computed-style spot checks (D-10 layer 2)', () => {
  // Excluded from the `phone` project. `testMatch: /.*\.spec\.ts/` would otherwise pick
  // this file up in BOTH projects (playwright.config.ts:42,85). D-19 / RESEARCH Open
  // Question 3: phone-width computed-style assertions add noise to Plan 12's exploratory
  // run without adding signal — the two hazards are viewport-independent. Phase 87.8 can
  // opt this in when it arms the phone project.
  test.skip(({ isMobile }) => isMobile, 'D-19: viewport-independent hazards; excluded from the phone project this phase (Phase 87.8 may opt in)');

  test.beforeEach(async ({ page }) => {
    // The same four-step journey e2e/create-event.spec.ts:20-33 already runs green in CI.

    // 1. Group home hosts the create-event entry point (param is `id`, not `groupId`).
    await page.goto(`/groupHomePage?id=${E2E_GROUP_ID}`);

    // 2. "Add New Game Event" opens the modal (groupHomePage surface).
    await page.getByRole('button', { name: /add new game event/i }).click();

    // 3. The "Create Event" heading confirms createEvent.js is mounted (its h2 at L666).
    await expect(page.getByRole('heading', { name: /create event/i })).toBeVisible();

    // 4. createEvent.js opens in VISUAL-CALENDAR mode (`useVisualCalendar` initialises to
    //    true, L32), and the `start_date` input Test 1 locates renders only on the
    //    manual-entry branch (L854). This toggle (L732-738) is how the green create-event
    //    journey itself reaches that input. Test 2/3's form test id sits on the OUTER
    //    form (L700) and is reachable in either mode, so it does not depend on this step.
    await page.getByRole('button', { name: /switch to manual entry/i }).click();

    // D-11, and this ordering is not negotiable: assert the THEME before asserting any
    // style. playwright.config.ts pins `colorScheme: 'dark'`, but that is only half the
    // mechanism — e2e/auth.setup.ts:65 calls storageState({ path: AUTH_FILE }), which
    // bakes localStorage into the reused .auth/user.json, so a stored next-themes `theme`
    // key outranks ThemeProvider's defaultTheme="dark" regardless of what the config
    // emulates. A style assertion that ran in light mode would be meaningless, and its
    // failure would be misdiagnosed as a migration bug. Removing either half is a
    // decision, not a cleanup.
    await expect(page.locator('html')).toHaveClass(/dark/);
  });

  test('bare `border` does not silently inherit currentColor — the shim is live', async ({ page }) => {
    // Call site: src/app/components/createEvent.js L854-862, the manual-entry `start_date`
    // datetime-local input. Its class string is a bare border-width utility with no
    // companion border-colour token — site 8 on 87.7-STYLE-AUDIT.md's unpaired list.
    // Located via its own <label htmlFor="start_date"> (L851), the identical locator
    // e2e/create-event.spec.ts:36 already resolves in green CI.
    const startDateInput = page.getByLabel(/start date & time/i);
    await expect(startDateInput).toBeVisible();

    const computed = await startDateInput.evaluate((node) => {
      const style = getComputedStyle(node);
      return { borderTopColor: style.borderTopColor, color: style.color };
    });

    // WHY these two facts prove the shim is live. v4's preflight emits
    // `border: 0 solid` with NO colour, which makes the border-color initial value
    // `currentColor` — i.e. identical to the element's own text colour, which is what
    // makes the regression invisible to every grep. The repair is the `@layer base` rule
    // at src/app/globals.css L418-424 (`border-color: var(--color-gray-200, currentcolor)`
    // on *, ::after, ::before, ::backdrop, ::file-selector-button), which reproduces v3's
    // #e5e7eb exactly (DI-87.7-20 records the OKLCH round-trip proof). So:
    //   - border != text  ⇒ something other than the currentColor fallback set the colour,
    //     which on this element can only be that shim; if the shim is deleted these two
    //     values collapse to the same string.
    //   - border != transparent ⇒ the shim did not resolve to an empty/invalid value.
    // Deliberately NOT asserting the literal #e5e7eb: Phase 88 gives these 43 sites
    // explicit colours and deletes the rule, and this file must not churn when it does.
    expect(
      computed.borderTopColor,
      'start_date input border colour equals its text colour — the globals.css @layer base border-color shim is missing or was overridden, so the bare border-width utility fell back to currentColor (v4 preflight drops v3\'s #e5e7eb default)',
    ).not.toBe(computed.color);

    expect(
      computed.borderTopColor,
      'start_date input border colour resolved to fully transparent — the shim\'s var(--color-gray-200, currentcolor) produced no usable colour',
    ).not.toBe('rgba(0, 0, 0, 0)');
    expect(computed.borderTopColor).not.toBe('transparent');
  });

  test('`space-y` sets a trailing margin on all but the last child', async ({ page }) => {
    // Call site: src/app/components/createEvent.js L700, the `space-y-4` <form>. Its
    // direct children are five unconditional <div> wrappers (game / time / participants /
    // comments / submit-row) — deliberately not <p> or headings, whose UA default margins
    // are 16px and on which RESEARCH's own probe run failed.
    const spaceYForm = page.getByTestId('tw4-space-y-exemplar');
    const directChildren = spaceYForm.locator('> *');

    // GUARD: a single-child container renders IDENTICALLY under v3 and v4 — v3's rule
    // needs a preceding sibling, and v4's `:not(:last-child)` excludes the only child — so
    // every assertion below would pass vacuously (T-87.7-10-02).
    const childCount = await directChildren.count();
    expect(
      childCount,
      'tw4-space-y-exemplar (the space-y-4 <form> in createEvent.js) rendered fewer than 2 direct children — every assertion in this test would be vacuous, so this is a failure of the EXEMPLAR, not of the migration',
    ).toBeGreaterThanOrEqual(2);

    // THE DISCRIMINATOR is the SECOND child's margin-top, not the first child's.
    // The first child's margin-top is 0px under BOTH versions (neither ever sets
    // margin-top on child 1), so asserting it proves nothing about which version is live —
    // RESEARCH § Validation Layer 4's fail-signal line says otherwise and is wrong on this
    // point. v3 applied margin-top to every child AFTER the first
    // (`.space-y-4 > :not([hidden]) ~ :not([hidden])`), so a surviving v3 rule leaves this
    // non-zero; v4 sets margin-top on nobody, so under v4 it is 0px.
    await expect(directChildren.nth(1)).toHaveCSS('margin-top', '0px');

    // v4 puts the gap on children 1..n-1 as `margin-block-end`, which getComputedStyle
    // resolves to `margin-bottom` in LTR. Asserting non-zero rather than a pixel value so
    // Phase 88 can re-space this form without touching this file.
    await expect(directChildren.first()).not.toHaveCSS('margin-bottom', '0px');

    // The last child is excluded by `:not(:last-child)` — no trailing margin at the
    // container's bottom edge.
    await expect(directChildren.last()).toHaveCSS('margin-bottom', '0px');
  });

  test('the emitted `space-y` rule has v4 shape, not v3 (count-independent)', async ({ page }) => {
    // This assertion exists ALONGSIDE the computed-style one because it cannot be made
    // vacuous by how many children happen to render — it reads the stylesheet, not the
    // DOM. It is therefore the stronger guard against the space-y flip specifically
    // (T-87.7-10-02).
    const spaceYForm = page.getByTestId('tw4-space-y-exemplar');

    // Read the token off the element rather than hardcoding `space-y-4`, so a Phase 88
    // re-spacing of this form does not silently turn the test into a no-op.
    const classAttribute = (await spaceYForm.getAttribute('class')) ?? '';
    const spaceYToken = /\bspace-y-[^\s"']+/.exec(classAttribute)?.[0];
    expect(
      spaceYToken,
      `tw4-space-y-exemplar carries no space-y-* class (class="${classAttribute}") — the exemplar moved and this test can no longer see its subject`,
    ).toBeTruthy();

    const matchingRules = await page.evaluate((token) => {
      const found: string[] = [];

      const walk = (rules: CSSRuleList) => {
        for (const rule of Array.from(rules)) {
          // Check the selector AND recurse: the rule lives inside `@layer utilities`
          // (a CSSLayerBlockRule), and in Chromium CSSStyleRule ALSO exposes .cssRules
          // (CSS nesting), so an early `continue` on "has nested rules" would skip every
          // style rule in the document.
          const selector = (rule as CSSStyleRule).selectorText;
          if (typeof selector === 'string' && selector.includes(token)) {
            found.push(rule.cssText);
          }
          const nested = (rule as CSSGroupingRule).cssRules;
          if (nested && nested.length > 0) walk(nested);
        }
      };

      for (const sheet of Array.from(document.styleSheets)) {
        try {
          if (sheet.cssRules) walk(sheet.cssRules);
        } catch {
          // A cross-origin stylesheet throws SecurityError on .cssRules. Skip it —
          // Tailwind's output is same-origin, so this can only ever hide a third party.
        }
      }

      return found.join('\n');
    }, spaceYToken as string);

    expect(
      matchingRules,
      `no stylesheet rule was found whose selector mentions .${spaceYToken} — either the utility was not emitted at all, or every candidate stylesheet was unreadable`,
    ).not.toBe('');

    // v4: `:where(.space-y-4 > :not(:last-child)) { … margin-block-end: … }`
    expect(matchingRules).toContain(':not(:last-child)');
    expect(matchingRules).toContain('margin-block-end');

    // v3: `.space-y-4 > :not([hidden]) ~ :not([hidden]) { margin-top: … }`. Its presence
    // would mean a v3-era stylesheet is still being served alongside the v4 build.
    expect(matchingRules).not.toContain(':not([hidden])');
  });
});
