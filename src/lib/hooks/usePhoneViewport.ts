'use client';

/**
 * usePhoneViewport — the ONE phone-viewport hook (Phase 88.6.1 plan 09, D-16).
 *
 * Returns `false` on the server and on the first client render, then the live answer to
 * {@link PHONE_MEDIA_QUERY}. No arguments, no options. Every phone/desktop render fork that
 * branches its copy or its geometry on the viewport reads THIS hook.
 *
 * THE BREAKPOINT (moved here from EventScheduler.tsx by 88.6.1-09): the line every
 * phone/desktop render fork that reads this hook branches on — Tailwind's `md`, so "md and below"
 * is `max-width: 767px`. The same query is also read imperatively by the game title's two expand
 * handlers, both gated on the state src/app/gameDetail/page.js ("const [titleOverflows, setTitleOverflows] = useState(false);")
 * declares: a one-shot read of the current match inside a click, with no state and no
 * subscription — the same query, NOT the same shape.
 *
 * A VIEWPORT breakpoint, not a container query, and deliberately so: `md` is this codebase's
 * phone/desktop line and every sibling on these surfaces switches on it (`UserHomePage.js`,
 * `FeedbackButton.js`, `CalendarListView.js`). A container query would be the repo's first and
 * would need its own decision, not a drive-by adoption inside a rebuild.
 */

/* DECISION Phase 88.1-11 (moved here from EventScheduler.tsx by 88.6.1-09; shape unchanged,
   re-pointed not reversed): every phone/desktop render fork that reads this hook is a matchMedia
   STATE fork, chosen OVER rendering both strings and hiding one with responsive utility classes.

   WHY THE CSS FORK LOSES: it puts BOTH instructions in the DOM at once, and jsdom applies no
   stylesheet — so no vitest pin could tell the two arms apart, and the plan's requirement to
   assert the RENDERED STRING (P7 forbids reading layout) would be unsatisfiable. It also ships
   two contradictory instructions to any consumer that reads the DOM rather than the cascade.

   The shape is the repo's own: `useState(false)` + a mount effect, exactly as
   src/app/components/createEvent.js ("window.matchMedia('(hover: none)')") detects `(hover: none)`.
   The second precedent, MergedHeatmapGrid.js, was DELETED by plan 88.1-16 (FE commit `a31fd40`)
   — the idiom stands, the citation is archival. Starting FALSE is deliberate — every consumer is
   an SSR'd client component, so the initial render must match the server's, and the desktop
   arm is the safe pre-measurement state. */

/* DECISION Phase 88.6.1-09 (D-16): ONE hook, read by EventScheduler (now), the check-in grid
   (plan 88.6.1-39, AvailabilityGrid.js) and the tutorial + its schedule demo (plan 88.6.1-51,
   TutorialOverlay.js + ScheduleDemo.js).

   REJECTED:
   (a) a copy of this subscription in each consumer — the duplication tenet; research CP-5
       counted three copies if each surface grew its own;
   (b) responsive utility classes — the DECISION Phase 88.1-11 reason above: jsdom applies no
       stylesheet, so no unit pin could tell the arms apart;
   (c) reading the query in a lazy state initialiser — the server render has no window and the
       first client render must equal it (VP-1 in usePhoneViewport.test.ts pins this);
   (d) moving gameDetail's two click-time reads onto this hook — a subscription would re-render
       that page on every viewport change for a value read only inside a click.

   The media-query sites that are NOT this hook, and stay (both census rosters in
   usePhoneViewport.test.ts cite this marker): `src/app/components/createEvent.js` subscribes to
   `(hover: none)`, input modality gating swipe — a different media feature from the viewport
   width this hook owns; `src/app/gameDetail/page.js` makes the two click-time reads above, which
   also write the breakpoint inline.

   NOT CHOSEN in this extraction: React's `useSyncExternalStore` with a `false` server snapshot.
   It would let a mount that happens after hydration read the real arm on its first render and
   drop the one-frame cost DECISION Phase 88.1-12 discloses (EventScheduler.tsx) — but it changes
   what phones paint first, so it is a behaviour change kept out of a behaviour-identical move.
   Switching is a decision, not a cleanup.

   Re-inlining this subscription in a component is a decision, not a cleanup. */

/* CONSUMER CONTRACT.
   (1) The value starts false and flips after mount, so a phone arm can paint one desktop frame
       first (DECISION Phase 88.1-12's KNOWN COST, EventScheduler.tsx).
   (2) A consumer that renders its phone sentence inside a live region must not let that flip be
       announced. AvailabilityGrid was the site this named; plan 88.6.1-39 took its phone hint out
       of the live region — it is plain text at
       src/app/components/AvailabilityGrid.js ("<div data-testid={GRID_SUMMARY_LINE_TESTID}"), and
       the grid's live region is the separate sr-only summary after it.
   (3) Unit tests choose the arm with a media stub installed BEFORE render (EventScheduler.test.tsx
       `stubMatchMedia`); jsdom's global stub answers false (`vitest.setup.ts:23-35`), so a test
       with no stub renders the desktop arm. */

import { useEffect, useState } from 'react';

/** Tailwind `md` and below — the phone/desktop line (see the docblock above). */
export const PHONE_MEDIA_QUERY = '(max-width: 767px)';

/** `false` on the server and the first client render, then the live phone-viewport match. */
export function usePhoneViewport(): boolean {
  const [isPhoneViewport, setIsPhoneViewport] = useState(false);
  useEffect(() => {
    if (typeof window === 'undefined' || !window.matchMedia) return undefined;
    const mq = window.matchMedia(PHONE_MEDIA_QUERY);
    setIsPhoneViewport(mq.matches);
    const handler = (event: MediaQueryListEvent) => setIsPhoneViewport(event.matches);
    if (mq.addEventListener) {
      mq.addEventListener('change', handler);
      return () => mq.removeEventListener('change', handler);
    }
    // Safari before 14 has only the legacy listener pair.
    mq.addListener(handler);
    return () => mq.removeListener(handler);
  }, []);
  return isPhoneViewport;
}
