/**
 * The drift-gate registry — the ONLY home of its rows (Phase 88.6.2-26, CONTEXT D-12/D-14).
 *
 * Read by scripts/drift-gate-registry.mjs inside the REQUIRED drift-gate-registry CI job, and by
 * src/lib/ci-grep-gate.fixture.test.ts in quality. One row per line.
 *
 *   gates       { file, min, why }  a suite that guards by assertion; min is its floor of it( / test( lines
 *   helperOnly  { file, why }       imports the shared scanner only to read a named file; not a tree gate
 *   helpers     [path]              the shared scanner the importer check resolves to
 *   notGates    { file, why }       recorded as NOT a gate; the runner reds if one starts importing the scanner
 *
 * The three non-gate lists say what a file is NOT: helperOnly files use the scanner on named
 * files, not over a tree, so a floor would guard nothing the suite's own assertions do not;
 * helpers is the scanner itself; notGates records a file someone might expect here, and why it
 * is absent. Every file that imports the scanner must sit in gates or helperOnly, or the runner
 * prints UNREGISTERED (DECISION Phase 88.6.2-26 (D-13), in the runner).
 *
 * FLOORS. Every gates min is the file's live count of it( / test( lines by the runner's COUNT_RE
 * (/^[ \t]*(it|test)\(/gm), measured at FE e87c996 on 2026-10-24 (Phase 88.6.2-26, C-10; the
 * fixture test's own row re-measured at 69 after that plan's Task 4 added its tests), so every
 * row is zero-margin: adding a test is never a red build, removing one is. A floor is raised in
 * the same commit that adds tests, and lowered only with a recorded decision beside the row,
 * never to make a red build green. Why the rows live here and not in ci.yml: the marker
 * DECISION Phase 88.6.2-26 (D-12) on the drift-gate-registry job in .github/workflows/ci.yml.
 * The amendment notes beside the rows are history, moved verbatim from ci.yml; the floors they
 * quote are the floors of their day.
 */

export const helpers = ['src/test-utils/sourceScan.ts'];

export const gates = [
  { file: 'src/app/components/controlSizeFloor.test.tsx', min: 11, why: 'Phase 88 Req 1 — the 16px control floor' },
  { file: 'src/app/cardPaddingIdiom.test.ts', min: 4, why: 'Phase 88 Req 2 — the card padding idiom' },
  { file: 'src/app/typeScaleTouchedSurfaces.test.ts', min: 23, why: 'Phase 88 CD-006 — the heading type scale' },
  { file: 'src/app/borderExplicitness.test.ts', min: 12, why: 'Phase 88 Req 16 — explicit border colours' },
  { file: 'src/app/tintTreatment.test.ts', min: 10, why: 'Phase 88 Req 17 — opaque tints' },
  { file: 'src/app/fetchErrorTreatment.test.ts', min: 15, why: 'Phase 88 Req 14 — the fetch-error treatment' },
  { file: 'src/app/focusAndMotionTreatment.test.ts', min: 21, why: 'Phase 88 Req 4 — focus rings and reduced motion' },
  { file: 'src/app/components/keyboardOperability.test.tsx', min: 73, why: 'Phase 88 Req 4 (DES-03) — the two once pointer-only controls stay keyboard-operable' },
  { file: 'src/app/components/availabilityGridColumns.test.ts', min: 6, why: 'Phase 88 Req 4 phone geometry — the six aligned AvailabilityGrid column widths stay in lockstep' },
  { file: 'src/app/decisionMarkers.test.ts', min: 23, why: 'Phase 88 D-36 / D-37 — the decision markers Phase 88 overrode say so, in place' },
  { file: 'src/app/rawColorValues.test.ts', min: 7, why: 'Phase 88 Req 2 — no raw hex or black shadows' },
  { file: 'src/app/tokenContrast.test.ts', min: 65, why: 'Phase 88.3 Req 1-8 — the token-layer WCAG floors' },
  { file: 'src/app/surfaceHoverSweep.test.ts', min: 12, why: 'Phase 88.3 Req 1 / D-02 — the hover and sunken sweep' },
  { file: 'src/app/darkChromeLegibility.test.ts', min: 8, why: 'Phase 88.3 Req 7/8 — dark-chrome ring, muted-label corrections, mobile-panel inert guard' },
  { file: 'src/app/accentSweep.test.ts', min: 7, why: 'Phase 88.3 Req 4/5 — the text-safe accent sweep, incl. the today number' },
  { file: 'src/app/statusTextSweep.test.ts', min: 6, why: 'Phase 88.3 Req 6 / OI-1 — the status text sweep' },
  { file: 'src/app/legacyOverlayClass.test.ts', min: 5, why: 'Phase 88 Req 9 — the legacy overlay class stays gone' },
  { file: 'src/app/nativeDialogs.test.ts', min: 8, why: 'Phase 88 Req 11 — no native browser dialogs' },
  { file: 'src/app/groupColourRendering.test.ts', min: 35, why: 'Phase 88.3 Req 9 / D-09 — group-colour rendering; the tint never reaches the save path' },

  // AMENDMENT Z — Phase 88.3.1 plan 01 (M21, owner-ruled 2026-08-29). Two rows added:
  // `src/lib/colourDistance.test.ts` and `src/lib/groupColourPresets.test.ts`. The first
  // is the FE half of a CROSS-REPO fixture: the same four ΔE2000 rows are asserted in
  // backend tests/unit/colourDistance.test.js, and that pair of suites is the only thing
  // standing between a divergent CIEDE2000 implementation and a permanently wrong
  // `Groups.background_color` remap (margins of 0.65 and 0.72). Unregistered, the FE half
  // was deletable with no red build — which would have left the backend asserting a
  // contract with nobody on the other end. The second owns the eight-preset palette's
  // ΔE / hue-gap / contrast floors.
  //
  // SEQUENCING, so nobody "fixes" this the wrong way: `groupColourPresets.test.ts` is
  // minted by plan 88.3.1-03, which runs in wave 2 of the SAME phase branch. Between
  // wave 1 and wave 2 this row is deliberately ahead of the file, and the existence check
  // below (plus its lockstep twin in ci-grep-gate.fixture.test.ts) is RED on purpose.
  // That red is the gate working. Do NOT delete the row to make it green — land plan 03.
  // Floors since raised to live counts (Phase 88.6.2-26, C-10).
  { file: 'src/lib/colourDistance.test.ts', min: 9, why: 'Phase 88.3.1-01 — the FE half of the cross-repo CIEDE2000 fixture (Amendment Z)' },
  { file: 'src/lib/groupColourPresets.test.ts', min: 20, why: 'Phase 88.3.1-03 — the eight-preset palette floors: deltaE, hue gap, contrast (Amendment Z)' },

  // AMENDMENT — Phase 88.8 plan 13 (owner-ruled 2026-09-04). Two rows added:
  // `src/lib/syntheticAddress.test.ts` and
  // `src/app/components/EmailAddressSection.test.tsx`.
  //
  // The helper's suite is the one that MUST be here, and it is registered on the
  // same argument Amendment Z used for colourDistance.test.ts. It is the ONLY thing
  // in either repo pinning the BROAD `@auth0` test against a later narrowing to
  // `@auth0.local`. `DECISION Phase 88.2 NIX-AUTH0` is a WRITTEN decision, not an
  // enforced one — nothing else reds if someone "tidies" the helper to the narrow
  // test, and the narrow test silently stops guarding every `@auth0`-shaped
  // placeholder that is not exactly `.local`. The consequence is not cosmetic: the
  // provisioning sentinel would be rendered in the profile header, rendered in the
  // Email section, and transmitted as the admin mail's Reply-To. Unregistered, that
  // guard was deletable with a fully green build.
  //
  // No `grep` gate is added on the helper's IMPLEMENTATION, deliberately:
  // `'@auth0.local'` contains `'@auth0'`, so a substring grep is satisfied by exactly
  // the narrow form it would be meant to forbid. The suite's bare-`@auth0` case is
  // the gate.
  //
  // The section's own suite is registered for the ordinary reason: it is the only
  // coverage of the eight-state machine, of the four outcome literals that must not
  // collapse into one another, and of the DR-C no-native-`disabled` sweep.
  // Floors since raised to live counts (Phase 88.6.2-26, C-10).
  { file: 'src/lib/syntheticAddress.test.ts', min: 8, why: 'Phase 88.8 R12 — the broad @auth0 placeholder guard (DECISION Phase 88.2 NIX-AUTH0)' },
  { file: 'src/app/components/EmailAddressSection.test.tsx', min: 143, why: 'Phase 88.8-13 — the Email section eight-state machine, its four outcome literals and the DR-C sweep' },

  // AMENDMENT — Phase 88.6 plan 55 (owner-ruled 2026-09-28, NEW OWNER ITEM 4). Five rows
  // added — the source-scan gates Phase 88.6 itself minted, none of which was registered:
  //   src/app/groundInk.test.ts                  plan 09 — ground-aware ink (D-16)       floor 8
  //   src/app/errorEnvelopeReads.test.ts         plan 14 — default-deny envelope reads   floor 16
  //   src/app/components/btnCensus.test.tsx      plan 10 — the .btn element census       floor 21
  //   src/app/shadowTier.test.ts                 plan 12 — off-tier shadow families       floor 8
  //   src/app/interpolatedClassCensus.test.ts    plan 47 — interpolated Tailwind classes  floor 4
  // Each floor is MEASURED, not quoted: `grep -cE '^[[:space:]]*(it|test)\(' <file>` (the
  // same regex this loop uses) on FE e882822, 2026-09-28. Unregistered, each was deletable
  // with a green build — the exact hole this step exists to close, reopened by the phase
  // that was converging on it. Ledger rows R103 / R104 / H08 in 88.6-46-SUMMARY.md.
  // Floors since raised to live counts (Phase 88.6.2-26, C-10).
  { file: 'src/app/groundInk.test.ts', min: 8, why: 'Phase 88.6-09 D-16 — ground-aware ink' },
  { file: 'src/app/errorEnvelopeReads.test.ts', min: 16, why: 'Phase 88.6-14 R9 — default-deny error-envelope reads' },
  { file: 'src/app/components/btnCensus.test.tsx', min: 24, why: 'Phase 88.6-10 — the legacy .btn element census' },
  { file: 'src/app/shadowTier.test.ts', min: 9, why: 'Phase 88.6-12 — off-tier shadow families' },
  { file: 'src/app/interpolatedClassCensus.test.ts', min: 4, why: 'Phase 88.6-47 — interpolated Tailwind classes that emit no CSS' },

  // AMENDMENT — Phase 88.6 close (2026-09-29, gsd-verifier finding on plans 58/60). Two rows
  // added — the guards the review fix-now set minted, unregistered exactly as plan 55's five were:
  //   src/components/ui/Button.e2eReplica.test.ts               plan 58 — E10 replica lockstep (H1)          floor 5
  //   src/app/components/CalendarListView.emptyStates.test.tsx  plan 60 — desktop 'No events' + loading arms  floor 1
  // Floors MEASURED with this loop's regex on FE d69e681, 2026-09-29. Button.e2eReplica is H1's ONLY
  // durable guard: unregistered, deleting it would have re-opened the stale-replica hole with a green build.
  // Floors since raised to live counts (Phase 88.6.2-26, C-10).
  { file: 'src/components/ui/Button.e2eReplica.test.ts', min: 5, why: 'Phase 88.6-58 H1 — the E10 planted-replica lockstep, its only durable guard' },
  { file: 'src/app/components/CalendarListView.emptyStates.test.tsx', min: 1, why: 'Phase 88.6-60 — the desktop No events and loading arms of CalendarListView' },

  // AMENDMENT — Phase 88.6 gap plan 61 (review round 2 #18 + H-1, owner-ruled 2026-09-29 R2-FIXNOW-SET-RULING).
  // Two rows added — the guards on the magic-link Sentry egress fixes:
  //   src/lib/sentryClientReplayGate.test.ts   R-7 (cb5c403) + plan 61 H-1 — replay gate + tracing wiring  floor 9
  //   src/lib/sentry.scrub.test.ts             Phase 84 T-84-01 + plan 61 H-1 — the scrub functions         floor 39
  // Floors MEASURED with this loop's regex after plan 61's edits (FE branch over 1eb23fd), 2026-09-29.
  // They are R-7's and H-1's ONLY durable guards: unregistered, either file was deletable with a green
  // build, exactly as the two rows `85b0263` registered were.
  // Floors since raised to live counts (Phase 88.6.2-26, C-10).
  { file: 'src/lib/sentryClientReplayGate.test.ts', min: 13, why: 'Phase 88.6 R-7 + 88.6-61 H-1 — Sentry init is handed the replay and tracing gates' },
  { file: 'src/lib/sentry.scrub.test.ts', min: 61, why: 'Phase 84 T-84-01 + 88.6-61 H-1 — the Sentry scrub functions' },
  { file: 'src/app/breadcrumbNavOverflow.test.ts', min: 12, why: 'Phase 88.6 UAT3-D1 — breadcrumb pills cap at their container; a tree walk over src' },
  { file: 'src/app/copyTable886_1.test.ts', min: 8, why: 'Phase 88.6.1-64 AC-33 — the owner-ratified copy table; a roster and sweep over src' },
  { file: 'src/app/loggerCtxShape.test.ts', min: 10, why: 'Phase 88.6.1 ACCEPT 14 — the one logger-context scanner (T-84-01); every file under src' },
  { file: 'src/app/rawStatusPalette.test.ts', min: 3, why: 'Phase 88.6 Top Fix 1 — no raw red palette on error ink; a scan over src (SPEC R6)' },
  { file: 'src/app/reactBigCalendarRemoval.test.ts', min: 6, why: 'Phase 88.1 Req 9 — react-big-calendar stays gone; its own walk with withoutComments' },
  { file: 'src/lib/hooks/selfIdentityErrorSource.test.tsx', min: 8, why: 'Phase 88.6.1-79 AC-29 — identity failed means failed and no row held; a census over src' },
  { file: 'src/lib/hooks/usePhoneViewport.test.ts', min: 9, why: 'Phase 88.6.1-09 D-16 — the one phone-viewport hook stays the only one; a census over src' },
  { file: 'src/test-utils/exemption.test.ts', min: 12, why: 'Phase 88.6.2 D-19 — the exemption schema, and test-utils never shipped from src' },
  { file: 'src/test-utils/sourceScan.parity.test.ts', min: 9, why: 'Phase 88.6.2-08 — the scanner lexer parity, tree-wide over src' },
  { file: 'src/app/citeRatchet.test.ts', min: 5, why: 'Phase 88.6.2-04 D-06 — the line-cite ratchet over src and e2e; imports no scanner' },
  { file: 'src/app/anchorCites.test.ts', min: 2, why: 'Phase 88.6.2-07 A19 (owner ruling V2-a, permanent) — the anchor-cite check on every PR' },
  { file: 'src/test-utils/scrubSessionHeaders.test.ts', min: 5, why: 'Phase 88.6.2-20 R8 — the e2e fetch-error session scrub, with a walk of e2e' },
  { file: 'src/lib/ci-grep-gate.fixture.test.ts', min: 71, why: 'Phase 88-29 / 88.6.2-26 — the registry lockstep itself (the 88-32 turtle); 88.6.2-27 added the age-ciphertext pairing and P3 tests' },
];

export const helperOnly = [
  { file: 'src/app/components/DangerZoneDeleteAccount.test.tsx', why: 'withoutComments over its own subject, the proxy route and api.ts; no tree scan' },
  { file: 'src/app/components/Modal.test.tsx', why: 'withoutComments over Modal.tsx only; no tree scan' },
  { file: 'src/app/components/heatmap/usePaintGesture.test.ts', why: 'withoutComments over paintGestureActiveStore.ts only; no tree scan' },
  { file: 'src/app/goodbye/page.test.tsx', why: 'withoutComments over two named files; no tree scan' },
  { file: 'src/app/groupHomePage/groupHomePage.identity.test.tsx', why: 'readOpeningTag and withoutComments over its own page.js; no tree scan' },
  { file: 'src/components/ui/Button.test.tsx', why: 'withoutComments over Button.tsx only; no tree scan' },
  { file: 'src/lib/api.test.ts', why: 'withoutComments over the proxy route file only; no tree scan' },
  { file: 'src/lib/schemas/identity.contract.test.ts', why: 'withoutComments over three named schema files; no tree scan' },
];

export const notGates = [
  { file: 'src/app/components/ResponseDashboard.test.tsx', why: 'imports no scan helper; SPEC R6, verified 2026-10-21 and 2026-10-23' },
];
