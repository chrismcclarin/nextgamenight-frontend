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
 */

export const helpers = ['src/test-utils/sourceScan.ts'];

export const gates = [
  { file: 'src/app/components/controlSizeFloor.test.tsx', min: 5, why: 'Phase 88 Req 1 — the 16px control floor' },
  { file: 'src/app/cardPaddingIdiom.test.ts', min: 4, why: 'Phase 88 Req 2 — the card padding idiom' },
  { file: 'src/app/typeScaleTouchedSurfaces.test.ts', min: 7, why: 'Phase 88 CD-006 — the heading type scale' },
  { file: 'src/app/borderExplicitness.test.ts', min: 12, why: 'Phase 88 Req 16 — explicit border colours' },
  { file: 'src/app/tintTreatment.test.ts', min: 8, why: 'Phase 88 Req 17 — opaque tints' },
  { file: 'src/app/fetchErrorTreatment.test.ts', min: 8, why: 'Phase 88 Req 14 — the fetch-error treatment' },
  { file: 'src/app/focusAndMotionTreatment.test.ts', min: 18, why: 'Phase 88 Req 4 — focus rings and reduced motion' },
  { file: 'src/app/components/keyboardOperability.test.tsx', min: 7, why: 'Phase 88 Req 4 (DES-03) — the two once pointer-only controls stay keyboard-operable' },
  { file: 'src/app/components/availabilityGridColumns.test.ts', min: 6, why: 'Phase 88 Req 4 phone geometry — the six aligned AvailabilityGrid column widths stay in lockstep' },
  { file: 'src/app/decisionMarkers.test.ts', min: 11, why: 'Phase 88 D-36 / D-37 — the decision markers Phase 88 overrode say so, in place' },
  { file: 'src/app/rawColorValues.test.ts', min: 7, why: 'Phase 88 Req 2 — no raw hex or black shadows' },
  { file: 'src/app/tokenContrast.test.ts', min: 28, why: 'Phase 88.3 Req 1-8 — the token-layer WCAG floors' },
  { file: 'src/app/surfaceHoverSweep.test.ts', min: 7, why: 'Phase 88.3 Req 1 / D-02 — the hover and sunken sweep' },
  { file: 'src/app/darkChromeLegibility.test.ts', min: 7, why: 'Phase 88.3 Req 7/8 — dark-chrome ring, muted-label corrections, mobile-panel inert guard' },
  { file: 'src/app/accentSweep.test.ts', min: 6, why: 'Phase 88.3 Req 4/5 — the text-safe accent sweep, incl. the today number' },
  { file: 'src/app/statusTextSweep.test.ts', min: 5, why: 'Phase 88.3 Req 6 / OI-1 — the status text sweep' },
  { file: 'src/app/legacyOverlayClass.test.ts', min: 5, why: 'Phase 88 Req 9 — the legacy overlay class stays gone' },
  { file: 'src/app/nativeDialogs.test.ts', min: 7, why: 'Phase 88 Req 11 — no native browser dialogs' },
  { file: 'src/app/groupColourRendering.test.ts', min: 10, why: 'Phase 88.3 Req 9 / D-09 — group-colour rendering; the tint never reaches the save path' },
  { file: 'src/lib/colourDistance.test.ts', min: 9, why: 'Phase 88.3.1-01 — the FE half of the cross-repo CIEDE2000 fixture (Amendment Z)' },
  { file: 'src/lib/groupColourPresets.test.ts', min: 12, why: 'Phase 88.3.1-03 — the eight-preset palette floors: deltaE, hue gap, contrast (Amendment Z)' },
  { file: 'src/lib/syntheticAddress.test.ts', min: 8, why: 'Phase 88.8 R12 — the broad @auth0 placeholder guard (DECISION Phase 88.2 NIX-AUTH0)' },
  { file: 'src/app/components/EmailAddressSection.test.tsx', min: 50, why: 'Phase 88.8-13 — the Email section eight-state machine, its four outcome literals and the DR-C sweep' },
  { file: 'src/app/groundInk.test.ts', min: 8, why: 'Phase 88.6-09 D-16 — ground-aware ink' },
  { file: 'src/app/errorEnvelopeReads.test.ts', min: 16, why: 'Phase 88.6-14 R9 — default-deny error-envelope reads' },
  { file: 'src/app/components/btnCensus.test.tsx', min: 21, why: 'Phase 88.6-10 — the legacy .btn element census' },
  { file: 'src/app/shadowTier.test.ts', min: 8, why: 'Phase 88.6-12 — off-tier shadow families' },
  { file: 'src/app/interpolatedClassCensus.test.ts', min: 4, why: 'Phase 88.6-47 — interpolated Tailwind classes that emit no CSS' },
  { file: 'src/components/ui/Button.e2eReplica.test.ts', min: 5, why: 'Phase 88.6-58 H1 — the E10 planted-replica lockstep, its only durable guard' },
  { file: 'src/app/components/CalendarListView.emptyStates.test.tsx', min: 1, why: 'Phase 88.6-60 — the desktop No events and loading arms of CalendarListView' },
  { file: 'src/lib/sentryClientReplayGate.test.ts', min: 9, why: 'Phase 88.6 R-7 + 88.6-61 H-1 — Sentry init is handed the replay and tracing gates' },
  { file: 'src/lib/sentry.scrub.test.ts', min: 39, why: 'Phase 84 T-84-01 + 88.6-61 H-1 — the Sentry scrub functions' },
  { file: 'src/app/breadcrumbNavOverflow.test.ts', min: 12, why: 'Phase 88.6 UAT3-D1 — breadcrumb pills cap at their container; a tree walk over src' },
  { file: 'src/app/cascadeOrder.test.ts', min: 11, why: 'Phase 88.6-05/06 — cascade order and the focus-ring home; a ring census over src' },
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
  { file: 'src/lib/ci-grep-gate.fixture.test.ts', min: 61, why: 'Phase 88-29 / 88.6.2-26 — the registry lockstep itself (the 88-32 turtle)' },
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
