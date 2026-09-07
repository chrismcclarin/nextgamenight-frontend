/**
 * isSyntheticAddress — the FRONTEND half of the synthetic-address guard
 * (Phase 88.8 plan 13, BOPS-05 / SPEC R12).
 *
 * THE HAZARD. Provisioning mints `<sub>@auth0.local` into `Users.email` when
 * Auth0 hands us no usable address. That value is a SENTINEL, not a contact
 * handle: nothing is reachable at it and nobody should ever see it. The backend
 * treats it as such and guards it in NINETEEN places
 * (`grep -rn -E "includes\('@auth0'\)|@auth0'"` over `routes/` and `services/`);
 * the frontend guarded it in ZERO (`grep -rni 'auth0\.local' periodictabletop/src`
 * returned 0, and there was no broad `@auth0` test either).
 *
 * WHY THIS FILE EXISTS NOW, AND WHY IT IS NOT GOLD-PLATING. That asymmetry was
 * harmless only while NO frontend surface rendered `Users.email` — every one of
 * them rendered the Auth0 SESSION email, which is always a real address. Plan
 * 13 Task 3 switches three of them to `Users.email`, which is precisely where
 * the sentinel lives. Without this helper that change REGRESSES a synthetic-row
 * user's profile header from a working address to
 * `google-oauth2-105...@auth0.local`, renders the same string in the new Email
 * section, and sends it as the admin mail's Reply-To. The guard exists because
 * the value being displayed changed, not because someone wanted a utility.
 *
 * THE RULE IS THE BROAD `@auth0` SUBSTRING, NEVER `@auth0.local` ALONE.
 * `DECISION Phase 88.2 NIX-AUTH0` (owner, 2026-07-27) records that the broad
 * form is deliberate — it matches the sibling dispatcher skips and the legacy
 * placeholder shapes — and that re-narrowing it to the `.local` suffix is a
 * DECISION, NOT A CLEANUP. The governing marker is at
 * `periodictabletopbackend_v2/Sonnet/services/groupOwnershipOfferService.js:97-114`;
 * the backend predicate it pairs with is
 * `services/provisioningService.js:138-143`. `syntheticAddress.test.ts` pins the
 * bare-`@auth0`-with-no-`.local` row, which is the ONE case a narrowed
 * implementation fails, and that suite is registered in the ci.yml drift-gate
 * registry so it cannot be deleted with a green build.
 *
 * ONE DELIBERATE DIVERGENCE FROM THE BACKEND PREDICATE. The backend returns
 * TRUE for null / undefined / empty, because its callers are asking "may I mail
 * this?" and the answer for an absent address is no. This one returns FALSE for
 * all three, because its callers are asking "is this string a sentinel I must
 * not print?". Absence is already handled separately at every call site (a
 * falsy address renders the same no-address copy without consulting this
 * predicate at all), and folding absence in here would make the two questions
 * indistinguishable at the one place they differ. Harmonising them is a
 * decision, not a cleanup.
 *
 * THE RULE IS SHARED WITH THE BACKEND AND BOTH SIDES SAY SO. `88.8-09-PLAN.md`
 * Task 4 applies the same broad test to BOTH `routes/feedback.js` writers — the
 * authenticated one drops a synthetic SERVER-DERIVED address, the public one
 * drops a synthetic CLIENT-SUPPLIED one — so a synthetic value reaches neither
 * feedback sink from either direction. Neither repo's CI can see the other, so
 * the pairing is named here rather than assumed.
 *
 * THREE CALL SITES, AND NO FOURTH:
 *   1. the profile header address line (`src/app/userProfile/page.js`, the
 *      `<p>` under the username heading),
 *   2. `EmailAddressSection.tsx`'s idle state,
 *   3. `FeedbackForm.js`'s `user_email`.
 *
 * DELIBERATELY EXCLUDED — the DISPLAY-NAME fallbacks in
 * `src/app/userProfile/page.js` that derive a name from the SESSION email's
 * local part (the three `user?.email?.split('@')[0]` chains and the effect
 * dependency array that keeps two of them reactive). Those consume a NAME, not
 * an address; the session email is never synthetic (the sentinel lives in
 * `Users.email`, not in the Auth0 claim); and applying this helper there would
 * spread the address rule onto a name path and plant a third spelling of the
 * fallback. That non-change is recorded at the site too, and the two records
 * must agree. Do not "finish the job".
 *
 * File shape mirrors `src/lib/scrubFeedbackPageUrl.ts` — a small typed
 * `src/lib` module whose docblock states the hazard, the rule and the cross-repo
 * pairing, with a colocated `*.test.ts`.
 */

/** The broad marker. NOT `'@auth0.local'` — see the docblock. */
const SYNTHETIC_ADDRESS_MARKER = '@auth0';

/**
 * True when `value` is a provisioning SENTINEL rather than a real address.
 *
 * Case-insensitive: the sentinel is minted lowercase, but a value that has been
 * round-tripped through an uppercasing form or an old import is still a
 * sentinel, and printing it would be the same defect.
 */
export function isSyntheticAddress(value: string | null | undefined): boolean {
  if (typeof value !== 'string') return false;
  return value.toLowerCase().includes(SYNTHETIC_ADDRESS_MARKER);
}
