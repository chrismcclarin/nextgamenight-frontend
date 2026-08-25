'use client';

/**
 * PhoneEventBar — the phone-only bottom bar that opens the Upcoming Events
 * sheet (SPEC Req 11a / UI-SPEC S3, phase 88.1 plan 08).
 *
 * `UserHomePage`'s right column is `hidden md:flex`, so below `md` the home page
 * had NO event-discovery surface at all. This bar is the designed phone
 * presentation of that content — one tap to a `BottomSheet`, never the desktop
 * column un-hidden.
 *
 * It renders chrome, not content: the count it shows and the rows the sheet
 * shows are derived from the SAME selector, so they cannot disagree.
 */
import * as React from 'react';

import { Icon } from '@/components/ui/Icon';
import {
  selectUpcomingWithin7Days,
  type UpcomingEventLike,
} from '@/lib/upcomingEvents';

import { usePhoneBottomBarPresence } from './phoneBottomBarPresence';

/** The slice of `useFetchErrorState`'s result this bar reads. */
export interface PhoneEventBarErrorState {
  showError?: boolean;
}

export interface PhoneEventBarProps {
  /** The RAW, unfiltered event list the page already holds. Filtered here. */
  events: readonly UpcomingEventLike[] | null | undefined;
  /**
   * The caller's `upcomingPending` value (`UserHomePage.js:116`) — true while
   * identity is still resolving OR the events fetch is in flight. Suppresses
   * every count claim; see the DECISION marker below.
   */
  pending?: boolean;
  /** The ML-17 identity-failure state (`selfIdentityErrorState`). */
  identityErrorState?: PhoneEventBarErrorState | null;
  /** The 88-18 events-fetch failure state (`upcomingErrorState`). */
  eventsErrorState?: PhoneEventBarErrorState | null;
  /** Fired on tap — the page owns the sheet's open state. */
  onOpen: () => void;
}

/* DECISION Phase 88.1 (Req 11a / UI-SPEC S3) — TWO choices are recorded here, both of
   which a future reader could mistake for an oversight.

   1. STACKING TIER: z index 30, chosen OVER any higher tier. The census is six deep —
      100 HeatmapTooltip, 70 FriendInvitePanel, 60 ClickableMemberName/TutorialOverlay,
      50 the header shell + the shared dialog overlay (`ui/dialog.tsx`), 40 the
      `md:hidden` mobile-nav backdrop (`Header.js:75`), 30 the FAB. This bar must stay
      BELOW the nav backdrop (opening the mobile nav has to cover it) and BELOW the
      dialog overlay (an open sheet has to cover it). Raising it is a decision, not a
      polish. The FAB never renders below `md` (`FeedbackButton.js:163,173-176` —
      its own marker says the below-`md` non-render exists so "there is nothing for
      Phase 88 to re-break"), so the phone bottom edge is free at this tier.

   2. SURFACE: `bg-surface-header` + a strong top rule + inverse text, mirroring the app
      header, chosen OVER a primary-button treatment (the `.btn` accent family). The
      one-anchor rule (UI-SPEC § "The one-anchor rule at 375px") says a 667px viewport
      gets exactly one accent element, and `UserHomePage` already spends it on
      "+ Create New Group" (`grouplist.js:133,177`). A second accent surface here makes
      the page fail that rule. This bar is structural chrome bookending the viewport and
      spends zero accent budget. "Making it stand out more" re-opens the rule.
      AMENDED BY 88.1-17 Task 4: "inverse text" was the wrong reading of "mirroring the app
      header" and shipped an unreadable bar in dark theme — the header itself uses plain
      `text-white` on this surface, not a theme-flipping token. The SURFACE choice this bullet
      records (header chrome over an accent treatment) is unchanged; only the text token moved.
      See the marker at the render below. */
const PhoneEventBar = React.forwardRef<HTMLDivElement, PhoneEventBarProps>(
  function PhoneEventBar(
    { events, pending = false, identityErrorState, eventsErrorState, onOpen },
    ref
  ) {
    // Register with the Footer's spacer store so the Footer reserves 56px only
    // on pages that actually mount this bar. See phoneBottomBarPresence.ts.
    usePhoneBottomBarPresence();

    /* DECISION Phase 88.1 (Req 11a, carrying DECISION Phase 88-33 forward): while the
       events load is PENDING, or while either error state is active, this bar makes NO
       count claim at all — no pill, and an accessible name with no "{n} in the next 7
       days" / "none in the next 7 days" suffix.

       `UserHomePage.js:99-115` records why: `upcomingLoading` starts false and the fetch
       effect early-returns before it ever flips, so for the whole identity-resolution
       window the page holds `events=[]` that means "not fetched yet", not "nothing
       scheduled". Rendering that as "none in the next 7 days" is the exact lie 88-33
       fixed on `UpcomingEventsCard` — a few hundred ms normally, up to ~60s with the
       backend unreachable. Same data, same page, new surface: collapsing this branch
       into a plain `count === 0` check restores the bug. That is a decision, not a
       simplification. */
    const suppressCount =
      pending ||
      Boolean(identityErrorState?.showError) ||
      Boolean(eventsErrorState?.showError);

    /* The count MUST come from the shared selector, never `events.length`: the page
       passes the RAW list on purpose (`UserHomePage.js:66`), so a length-based count
       would advertise a number the sheet does not show.

       ACCEPTED LAG (recorded, not fixed): the window is measured from `new Date()` at
       RENDER time and is not timer-refreshed, so an event crossing the 7-day boundary
       between this render and the sheet opening can make the pill lag the sheet's fresh
       recompute by one row. That is an accepted staleness window, not an impossibility —
       a timer here would re-render the whole page on a clock nobody is watching. */
    const upcomingCount = suppressCount
      ? null
      : selectUpcomingWithin7Days(events).length;

    const showPill = upcomingCount !== null && upcomingCount > 0;

    const accessibleName =
      upcomingCount === null
        ? 'Open upcoming events'
        : upcomingCount > 0
          ? `Open upcoming events, ${upcomingCount} in the next 7 days`
          : 'Open upcoming events, none in the next 7 days';

    /* DECISION Phase 88.1 (plan 17 Task 4) — owner walkthrough 2026-08-24. The bar's text is
       `text-white`, chosen OVER the theme-flipping inverse token (`text-content-INVERSE`,
       capitalised here on purpose so this plan's "the class is gone" grep gate stays honest) —
       which is what shipped and what the owner reported as unreadable ("way too dark and the
       words can't be read"; he "didn't even realize there was an Upcoming events thing on the
       bottom").

       WHY THAT TOKEN IS WRONG HERE: "inverse" text FLIPS with the theme — `--color-text-inverse` is
       `#ffffff` in `:root` but `var(--purple-950)` under `.dark` (globals.css:594 / :770). The
       surface underneath does NOT flip: `--color-bg-header` is `warm-800` in light and `warm-900`
       in dark (globals.css:726 / :824) — dark in BOTH themes. So in dark theme the bar rendered
       near-black text on a near-black surface. Light theme was unaffected, which is why plan 08's
       jsdom pins never saw it.

       `text-white` is the exact pairing `Header.js:204` uses on this same surface, which is what
       choice 2 above ("mirroring the app header") intends. The principled fix would be a
       `text-content-on-header` token, but minting one is a globals.css/design-system change owned
       by Phase 88.3/88.6, not this plan. Swapping this back to a theme-flipping token re-opens the
       owner's walkthrough defect — it is a decision, not a token-consistency cleanup. */
    return (
      <div
        ref={ref}
        className="md:hidden fixed inset-x-0 bottom-0 z-30 h-14 border-t border-line-strong bg-surface-header text-white"
      >
        <button
          type="button"
          onClick={onOpen}
          aria-label={accessibleName}
          // Matches the sibling Calendar trigger (`userHome/UserHomePage.js:248`): this opens a
          // focus-trapping bottom sheet, and a screen-reader user gets no warning of that from
          // "button" alone.
          aria-haspopup="dialog"
          // `min-h-11` is the 44px touch floor; `h-full` fills the 56px bar.
          // Focus ring class set copied from the FAB (`FeedbackButton.js:189`).
          className="flex h-full w-full min-h-11 items-center justify-between gap-2 px-4 text-left focus:outline-hidden focus-visible:ring-2 focus-visible:ring-focus-ring focus-visible:ring-offset-2"
        >
          <span className="flex items-center gap-2">
            <span className="text-sm font-medium">Upcoming events</span>
            {showPill && (
              <span
                // The number is already in the accessible name above, so the
                // pill itself is decorative to assistive tech.
                aria-hidden="true"
                className="rounded-full bg-white/15 px-2 py-0.5 text-xs font-semibold leading-none"
              >
                {upcomingCount}
              </span>
            )}
          </span>
          {/* Decorative — no `title`, so the Icon primitive marks it aria-hidden. */}
          <Icon name="ChevronUp" size={20} />
        </button>
      </div>
    );
  }
);

export { PhoneEventBar };
export default PhoneEventBar;
