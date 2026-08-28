'use client';
import { getEventsForDate, isToday } from '../../lib/calendarUtils';
import {
  getEventTileTextColor,
  getBrightness,
  lightTintGroupBackgroundColor,
  resolveGroupBackgroundColor,
  themedTextStyleVars,
  SUBTEXT_MUTED_ON_DARK,
  SUBTEXT_MUTED_ON_LIGHT,
} from '../../lib/colorUtils';
import { safeBgImageStyle } from '../../lib/safeBgImageStyle';
import SafeImage from './SafeImage';
import RsvpCount from './RsvpCount';

const isPast = (date) => {
  if (!date) return false;
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const checkDate = new Date(date);
  checkDate.setHours(0, 0, 0, 0);
  return checkDate < today;
};

const isFuture = (date) => {
  if (!date) return false;
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const checkDate = new Date(date);
  checkDate.setHours(0, 0, 0, 0);
  return checkDate > today;
};

const dayNames = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

/*
 * The tile's text TREATMENT (shadow + stroke) for a given rendered ground.
 *
 * DECISION Phase 88.3 (R2-6) — MOVED here from inside the per-event `.map`
 * closure by plan 88.3-16, reasoning preserved verbatim: the past-date colour
 * THEME-FORKS. It used to resolve `SUBTEXT_MUTED_ON_LIGHT` in BOTH themes
 * whenever the tile had a group colour — theme-independent by construction.
 * That was already wrong on a dark ground and became unreadable once this phase
 * re-pointed that pole to `#374151` (~1.4:1 on navy), so the dark half takes
 * `SUBTEXT_MUTED_ON_DARK` and the light half keeps the (now darker) light pole,
 * measured 5.35-5.65:1 on the tints.
 * REJECTED: one theme-independent pole, and a `useTheme` read — the fork rides
 * the same custom-property + `dark:` mechanism as the ground, per the shipped
 * DECISION at EventScheduler.tsx. A decision, not a cleanup.
 *
 * DECISION Phase 88.3-16: this is a MODULE-LEVEL helper taking `groupBgImage`
 * as an explicit second argument, chosen OVER the inner arrow function that
 * closed over it and was re-declared once per event inside
 * `dayEvents.slice(0, 2).map`. Both tile variants now need it, and one
 * definition is what keeps the two tiles provably identical in their text
 * treatment. REJECTED: wrapping it (or the per-event ground computation) in
 * `useMemo`/`useCallback` — the array is bounded at 84 tiles per render of pure
 * hex arithmetic, and `days`/`activeEvents` change identity on every parent
 * render anyway, so memoization here is dead weight that reads as a performance
 * claim nobody measured.
 *
 * DECISION Phase 88.3-cr (CR-01, code-adversarial-review 2026-08-27):
 * DEF-88.3-10-02 IS FIXED HERE, reversing plan 88.3-16's "carry it verbatim"
 * and its routing to Phase 88.6. The image branch used to assign the image URL
 * to `WebkitTextStroke`, which is not a stroke value. That was inert while it
 * lived in an inline IIFE — an invalid inline declaration is dropped and the
 * element simply had no stroke. THE HOIST MADE IT WORSE, not merely relocated:
 * the return value now flows through `themedTextStyleVars` into
 * `--t-stroke`/`--t-stroke-l`, and a custom property accepts any token, so the
 * URL is carried all the way to `[-webkit-text-stroke:var(--t-stroke)]` and is
 * only rejected there — invalid at computed-value time, which resets the
 * property to `none` and poisons the `--t-stroke` pair for anything else
 * reading it. Deferring an inert defect is cheap; deferring a live one into a
 * shared custom-property channel is not. The stroke is now the same
 * `'0.5px rgba(0, 0, 0, 0.9)'` the dark-ground branch below already uses,
 * which is what this comment always claimed the image branch did.
 * REJECTED: keeping the deferral to 88.6 — the repair is one literal, and the
 * hoist is precisely what changed its blast radius. Gate B test 7 now asserts
 * that no identifier is ever assigned to `WebkitTextStroke` in these files.
 *
 * `groupBgImage` is passed as `null` for the COMPACT variant at the call site
 * (`tileBgImage`), because that tile deliberately paints no background image —
 * see the "NO BACKGROUND IMAGE HERE" marker further down. Passing the URL made
 * a coloured group that ALSO has an image take the heavy image-tuned black
 * shadow over a pale t = 0.70 tint. REJECTED: reading `variant` inside the
 * helper — it is deliberately module-level and argument-driven (marker above),
 * so the variant fork belongs at the call site.
 */
const tileTextTreatment = (tileGround, groupBgImage) => {
  if (groupBgImage) {
    return {
      textShadow: '2px 2px 4px rgba(0, 0, 0, 0.9), -1px -1px 2px rgba(0, 0, 0, 0.9)',
      WebkitTextStroke: '0.5px rgba(0, 0, 0, 0.9)',
    };
  }
  // No group colour: the tile is on the themed month
  // cell, and a text shadow tuned for a coloured ground
  // only muddies it there.
  if (!tileGround) return {};
  const brightness = getBrightness(tileGround);
  return {
    textShadow: brightness > 128
      ? '1px 1px 2px rgba(255, 255, 255, 0.9)'
      : '2px 2px 4px rgba(0, 0, 0, 0.8), -1px -1px 2px rgba(0, 0, 0, 0.8)',
    WebkitTextStroke: brightness <= 128 ? '0.5px rgba(0, 0, 0, 0.9)' : 'none',
  };
};

/**
 * Monthly grid renderer.
 *
 * Phase 64-02 (CAL-01 / CAL-04 / CAL-05):
 *   - `days` is now {date: Date, isCurrentMonth: boolean}[] (42 cells).
 *   - Adjacent-month cells render with subtle muting (`opacity-60`)
 *     but their events use the same tile styling as current-month cells.
 *   - Whole-cell click invokes `onDayClick(date, dayEvents)` — the parent
 *     dispatcher (EventCalendar) decides between empty-day handler,
 *     event-detail navigation, or EventDayModal. Inner event-tile
 *     clicks still call `onEventClick(event)` and stopPropagation.
 *   - `+N more` is a non-button label; the cell click handles the modal.
 */
export default function CalendarMonthView({
  days,
  activeEvents,
  currentDate,
  variant,
  onDayClick,
  onEventClick,
  onNavigateMonth,
  onGoToday,
  showEmptyDayHint = false,
  monthNames,
  tzLegend,
}) {
  return (
    <>
      {/* Month Navigation.
          DECISION Phase 88.3-17 (DEF-88.3-13-04, owner ruling A, 2026-08-27):
          all three controls in this row gain the project focus ring — the SAME
          four-utility string the two event tiles below and the three group-page
          header CTAs already carry, chosen OVER minting a nav-specific
          treatment. Not decoration: the owner's phone UAT (test 8c)
          reported "when tabbing around the screen like this it's a blue circle,
          which is readable on some items, and not readable on others. I wasn't
          sure I tabbed to today until I hit enter." That blue circle is the
          BROWSER DEFAULT outline, and it painted here because `.btn` defines no
          `focus-visible` style and there is no global one (recorded verbatim at
          `groupHomePage/page.js`'s marker), so these three controls had no ring at
          all. `ring-*` compiles to `box-shadow`, so it survives the unlayered
          `.btn { border: none }` that eats border utilities on the two `.btn`
          sites. `ring-offset-2` over `ring-inset`: these are free-standing
          controls inside the calendar card's 12px phone padding, not full-bleed
          rows, so the offset has room at 375px and reads better on the small
          "Go to Today" text link.
          WHY NO GATE CAUGHT THIS: a MISSING focus style produces a browser
          default, which no contrast probe reads as a failure, and
          `focusAndMotionTreatment.test.ts` only ever forbade VISIBLE bare
          `focus:` treatments — it never required a ring on every focusable.
          Task 2(B) of this plan adds that positive scan across the five
          group-page render-tree files. Removing a ring here reds it. */}
      <div className="flex justify-between items-center mb-4">
        <button
          onClick={() => onNavigateMonth(-1)}
          className="btn btn-primary focus:outline-hidden focus-visible:ring-2 focus-visible:ring-focus-ring focus-visible:ring-offset-2"
        >
          &larr; Previous
        </button>
        <div className="text-center">
          <h3 className="text-xl font-semibold text-content-primary">
            {monthNames[currentDate.getMonth()]} {currentDate.getFullYear()}
          </h3>
          {tzLegend && (
            <p className="text-xs text-content-muted mt-0.5">
              Times shown in {tzLegend}
            </p>
          )}
          <button
            onClick={onGoToday}
            className="text-sm text-content-link hover:text-content-link-hover mt-1 focus:outline-hidden focus-visible:ring-2 focus-visible:ring-focus-ring focus-visible:ring-offset-2"
          >
            Go to Today
          </button>
        </div>
        <button
          onClick={() => onNavigateMonth(1)}
          className="btn btn-primary focus:outline-hidden focus-visible:ring-2 focus-visible:ring-focus-ring focus-visible:ring-offset-2"
        >
          Next &rarr;
        </button>
      </div>

      {/* Calendar Grid */}
      <div className="grid grid-cols-7 gap-1 mb-4">
        {dayNames.map(day => (
          <div key={day} className="text-center font-semibold text-content-secondary py-2 text-sm">
            {day}
          </div>
        ))}
      </div>

      <div className="grid grid-cols-7 gap-1">
        {days.map((cell, index) => {
          // CAL-01: cells are {date, isCurrentMonth} — adjacent-month cells
          // have isCurrentMonth=false, never null.
          const date = cell?.date || null;
          const isCurrentMonth = !!cell?.isCurrentMonth;
          const dayEvents = getEventsForDate(date, activeEvents);
          const isCurrentDay = isToday(date);
          const isPastDate = isPast(date);
          const isEmpty = date && dayEvents.length === 0;
          const isAdjacent = !isCurrentMonth;

          const cellClickable = !!date && (dayEvents.length > 0 || (isEmpty && showEmptyDayHint));

          return (
            <div
              key={index}
              onClick={() => {
                if (date) onDayClick(date, dayEvents);
              }}
              className={`${variant === 'compact' ? 'min-h-[80px]' : 'min-h-[100px]'} border border-line rounded-sm p-1 ${variant === 'compact' ? 'flex flex-col' : ''} ${
                isAdjacent ? 'opacity-60 ' : ''
              }${
                !date ? 'bg-surface-page' :
                isCurrentDay ? 'bg-surface-card-hover border-line-accent' :
                variant === 'full' && isPastDate ? 'bg-surface-page' :
                cellClickable ? 'bg-surface-card hover:bg-surface-hover hover:border-line-accent cursor-pointer transition-colors group' :
                'bg-surface-card'
              }`}
            >
              {date && (
                <>
                  <div className={`${variant === 'compact' ? 'text-xs' : 'text-sm'} font-medium mb-1 ${
                    isCurrentDay ? 'text-content-accent' :
                    isAdjacent ? 'text-content-muted' :
                    variant === 'full' && isPastDate ? 'text-content-muted' :
                    'text-content-primary'
                  }`}>
                    {date.getDate()}
                  </div>
                  {dayEvents.length > 0 ? (
                    <div className={variant === 'compact' ? 'space-y-0.5' : 'space-y-1'}>
                      {dayEvents.slice(0, 2).map(event => {
                        // HOISTED by plan 88.3-16 so BOTH tile variants read ONE
                        // set of values. Duplicating the ground gate per variant
                        // would inflate tests 7 and 9's per-file counts without
                        // adding coverage; hoisting keeps them meaningful.
                        // CONSEQUENCE, stated rather than discovered: the group
                        // page now runs this computation for every rendered
                        // COMPACT tile, where before it ran none. Bounded at 84
                        // tiles of pure hex arithmetic per render — not a hot
                        // path, and deliberately not memoized (see the
                        // tileTextTreatment marker at module level).
                        //
                        // null when the group has no colour of its own (D-28) —
                        // the tile then keeps the themed month-cell ground.
                        const groupBgColor = resolveGroupBackgroundColor(event.Group?.background_color);
                        /*
                         * DECISION Phase 88.3 (D-09, cascade fix): the tile's
                         * ground is a MUTUALLY EXCLUSIVE ternary gated on
                         * `tinted`, chosen OVER stacking the tint pair beside a
                         * permanently-present background class. Compile-verified
                         * on tailwindcss@4.3.3, `.bg-[var(--group-ground-light)]`
                         * emits BEFORE every `.bg-surface-*` and
                         * `.dark:bg-[var(--group-ground)]` emits last — same
                         * property, same specificity, source order decides — so
                         * a stacked className renders the themed surface in
                         * light mode for every coloured group.
                         *
                         * NOTE the false branch here is EMPTY, not
                         * `bg-surface-card` as at this plan's four other render
                         * sites. That is deliberate and is this tile's shipped
                         * D-28 null semantics: an uncoloured tile has NO ground
                         * of its own and sits directly on the themed month cell.
                         * Giving it a card surface would be a visual change, not
                         * a consistency fix.
                         *
                         * ALSO REJECTED: gating on `groupBgColor` alone — a hex
                         * that fails to tint must withhold BOTH custom
                         * properties (T-88.3-43). This is a decision, not a
                         * cleanup.
                         */
                        const tinted = lightTintGroupBackgroundColor(groupBgColor);
                        const ground = tinted ? groupBgColor : null;
                        const groupProfilePic = event.Group?.profile_picture_url;
                        const groupBgImage = event.Group?.background_image_url;
                        // CR-01 (88.3-cr): the COMPACT tile renders no image, so
                        // it must not take the image-tuned text treatment either.
                        const tileBgImage = variant === 'compact' ? null : groupBgImage;
                        // The R2-6 past-date theme-fork reasoning now lives with
                        // `tileTextTreatment` at module level (plan 88.3-16).
                        /*
                         * DECISION Phase 88.3-cr (CR-02, code-adversarial-review
                         * 2026-08-27): both arms are fed the TINT-GATED values —
                         * `ground` for dark, `tinted` for light — never the
                         * stored hex and never `tinted || <stored hex>`. Same
                         * change as `grouplist.js` / `CalendarListView.js` /
                         * `EventDayModal.js`, mirroring `groupHomePage/page.js`,
                         * which has always gated both the ground AND the text
                         * style on the tint succeeding. Gating only the ground
                         * was the exact asymmetry the T-88.3-43 marker warns
                         * about: a stored value `resolveGroupBackgroundColor`
                         * passes through but the tint rejects (anything not a
                         * 6-digit hex) dropped the FULL tile back to the themed
                         * cell while its text was still computed against the
                         * malformed string, where `getBrightness` returns 255.
                         * Unreachable for new writes (BE validator is
                         * `^#[0-9A-Fa-f]{6}$`), so this is consistency, not a
                         * live bug — but "withhold both grounds together" has to
                         * mean the text too.
                         *
                         * NOT IN THE ORIGINAL CR-02 FINDING, which enumerated
                         * only the other three files. This site was found by
                         * censusing the `tinted || ` idiom while adding the Gate
                         * B pin, and the pin cannot be file-complete without it.
                         * The `isPastDate` truthiness gates below still read
                         * `groupBgColor` deliberately: they ask "does this group
                         * have a colour at all", not "what ground is painted",
                         * and re-pointing them would change the past-date pole
                         * on an untinted-but-coloured tile. A decision, not a
                         * cleanup.
                         */
                        const tileTextVars = themedTextStyleVars(
                          {
                            ...tileTextTreatment(ground, tileBgImage),
                            color: isPastDate
                              ? (groupBgColor ? SUBTEXT_MUTED_ON_DARK : 'var(--color-content-muted)')
                              : getEventTileTextColor(ground),
                          },
                          {
                            ...tileTextTreatment(tinted, tileBgImage),
                            color: isPastDate
                              ? (groupBgColor ? SUBTEXT_MUTED_ON_LIGHT : 'var(--color-content-muted)')
                              : getEventTileTextColor(tinted),
                          },
                        );
                        const tileLabel = `${event.Game?.name || 'Game Night'} - ${event.Group?.name || 'Group'}`;

                        if (variant === 'compact') {
                          const rs = event.rsvp_summary;
                          const hasRsvps = rs && (rs.yes > 0 || rs.maybe > 0 || rs.no > 0);
                          const isFutureEvent = event.start_date && new Date(event.start_date) >= new Date();
                          // The accessible name must carry the RSVP counts. On a
                          // `role="button"` element `aria-label` REPLACES the name
                          // computed from the subtree, so the full tile's
                          // `aria-label={tileLabel}` copied verbatim would SILENCE
                          // the `<RsvpCount variant="compact">` child below ("3Y 1M
                          // 2N") for every screen-reader user — on the group page,
                          // the surface the owner tests on a phone. Built tile-
                          // locally from the same `rs` the tile already renders, so
                          // the shared `RsvpCount` (and its CalendarListView.js call
                          // site) stays byte-identical.
                          const rsvpLabel = hasRsvps && isFutureEvent
                            ? `, ${rs.yes || 0} going, ${rs.maybe || 0} maybe, ${rs.no || 0} can't`
                            : '';
                          return (
                            /* DECISION Phase 88.3-16 (owner ruling 5, Req 12 tests 8c(iii) and 11a):
                               the COMPACT tile — the variant the GROUP page actually mounts
                               (`groupHomePage/page.js` passes `variant="compact"` to `EventCalendar`,
                               which forwards it here) — now gets the group tint AND the four R3-C
                               accessibility attributes the FULL tile received in plan 10. The owner,
                               on his phone: the compact tile was untinted (11a) and not tabbable
                               (8c(iii)). This is an IN-SCOPE Req 9 + R3-C MISS, not new scope: Req 9
                               names the calendar month view and R3-C names the tiles. No gate could
                               have caught it, because Gate B test 8 anchored with `.find()` on the
                               FIRST tint-carrying className and the compact tile had no tint to
                               anchor on — test 8 now loops every one, with a >= 2 floor.

                               THE COLOUR FORK LIVES ON THIS WRAPPER, NOT ON THE `truncate` TITLE.
                               `RsvpCount` below is a SIBLING of the title inside this wrapper, so
                               the wrapper is the only element both children can inherit one
                               tint-pole colour through. REJECTED: putting the fork on the title div
                               — the wrapper's `text-content-accent` would then stay, and `RsvpCount`
                               would have nothing correct to inherit.

                               `tileTextVars` is spread ONLY when `tinted`, deliberately unlike the
                               full tile, which spreads it unconditionally because its null branch is
                               empty (D-28). `getEventTileTextColor` resolves an uncoloured group to
                               `UNSET_BG_TILE_TEXT` (warm-900), so spreading it here would silently
                               recolour the UNCOLOURED tile's title from amber-800 to warm-900 — a
                               visual change on a surface the owner has not been asked about. Same
                               reason the null ground branch stays `bg-surface-card-hover` rather
                               than going empty like the full tile's.

                               HOVER IS FORKED INSIDE THE TERNARY, and that is load-bearing.
                               `.hover\:bg-surface-elevated:hover` is (0,2,0) and beats
                               `.bg-[var(--group-ground-light)]` at (0,1,0), so leaving it outside
                               would make a tinted tile LOSE its group colour under the pointer
                               (white in light, purple-800 in dark) while its text stayed on the
                               tint-derived poles — this file's own cascade-order defect, and an
                               inconsistency with the full tile, which uses `hover:opacity-90` over
                               its tint. Keeping it inside is also what lets Gate B test 3's
                               cross-expression negative stay STRICT: the whole ternary is stripped
                               before the `bg-surface-` check runs, so nothing had to be loosened to
                               admit this shape. `transition-colors` becomes
                               `transition-[background-color,opacity]` so the tinted arm's opacity
                               change animates the way the full tile's does.

                               NO BACKGROUND IMAGE HERE, on purpose. Hoisting put `groupBgImage`
                               (API-controlled) in scope for this tile, and it must not paint it. If
                               one is ever added it MUST go through `safeBgImageStyle` exactly as the
                               full tile does — never a raw `url()`. The new Gate B `it(` asserts
                               every `url(`/`backgroundImage` in this file sits inside a
                               `safeBgImageStyle(` call. CR-01 (88.3-cr) extends the same rule to
                               the TEXT treatment: this tile passes `tileBgImage` (null in the
                               compact variant), so the image-tuned black shadow can no longer land
                               on a pale t = 0.70 tint just because the group also has a photo.

                               TARGET SIZE — INHERITED, disclosed, not resized (owner ruling
                               2026-08-27). `role="button"` promotes this to a first-class
                               interactive element at one line of `text-xs` plus `p-0.5`: roughly
                               16-20px tall and ~45px wide inside an 80px day cell at 375px, under
                               the project's 44x44 floor. The DAY CELL (min-h 80px) is the touch
                               surface. It is inherited from R3-C rather than introduced here — the
                               full tile has the same shape (`p-1`, ~24px) and shipped with no size
                               ruling — and WCAG 2.1 AA has no target-size criterion (2.5.5 is AAA;
                               2.2's 2.5.8 24px minimum is the eventual bar). PHASE 88.6's
                               calendar/tile pass owns the size question.

                               THE DAY CELL STAYS POINTER-ONLY THIS PHASE, DELIBERATELY (owner ruling
                               B, 2026-08-27). After this change a keyboard user can open an EVENT
                               from the month grid but not the DAY: the cell above is still a bare
                               `<div onClick>` with no role/tabIndex/key handler. The owner ruled
                               "accept as is" for 88.3; Phase 88.6 owns it. Its absence is a recorded
                               decision, not an oversight — do not add a keyboard path to the cell.

                               Any of this is a decision, not a cleanup. */
                            <div
                              key={event.id}
                              role="button"
                              tabIndex={0}
                              aria-label={tileLabel + rsvpLabel}
                              onKeyDown={(e) => {
                                if (e.key === 'Enter' || e.key === ' ') {
                                  e.preventDefault();
                                  e.stopPropagation();
                                  onEventClick(event);
                                }
                              }}
                              className={`text-xs p-0.5 rounded-sm font-medium cursor-pointer transition-[background-color,opacity] focus:outline-hidden focus-visible:ring-2 focus-visible:ring-focus-ring focus-visible:ring-inset ${tinted ? 'bg-[var(--group-ground-light)] dark:bg-[var(--group-ground)] hover:opacity-90' : 'bg-surface-card-hover hover:bg-surface-elevated'} ${tinted ? '[color:var(--t-color-l)] dark:[color:var(--t-color)]' : 'text-content-accent'}`}
                              style={{
                                ...(tinted && {
                                  '--group-ground': ground,
                                  '--group-ground-light': tinted,
                                }),
                                ...(tinted && tileTextVars),
                              }}
                              title={tileLabel}
                              onClick={(e) => {
                                e.stopPropagation();
                                onEventClick(event);
                              }}
                            >
                              <div className="truncate">{event.Game?.name || 'Game Night'}</div>
                              {hasRsvps && isFutureEvent && (
                                <RsvpCount
                                  rsvpSummary={rs}
                                  variant="compact"
                                  inheritColor={!!tinted}
                                  className="text-[10px] leading-tight mt-0.5"
                                />
                              )}
                            </div>
                          );
                        }

                        // Full variant (user-home)
                        return (
                          /* DECISION Phase 88.3 (R3-C, owner ruling 2026-08-25):
                             this tile is keyboard-operable, matching the shipped
                             shape at CalendarListView.js's EventRow rather than
                             inventing a new one. REJECTED: leaving it
                             mouse-only, which is what it was — an identical
                             interaction one file over has been reachable by
                             keyboard all along. `ring-inset` because the tile is
                             ~49px wide inside a month cell and an outset ring
                             clips. A decision, not a cleanup. */
                          <div
                            key={event.id}
                            onClick={(e) => {
                              e.stopPropagation();
                              onEventClick(event);
                            }}
                            role="button"
                            tabIndex={0}
                            aria-label={tileLabel}
                            onKeyDown={(e) => {
                              if (e.key === 'Enter' || e.key === ' ') {
                                e.preventDefault();
                                e.stopPropagation();
                                onEventClick(event);
                              }
                            }}
                            className={`text-xs p-1 rounded-sm truncate hover:opacity-90 transition-opacity flex items-center gap-1 font-medium cursor-pointer focus:outline-hidden focus-visible:ring-2 focus-visible:ring-focus-ring focus-visible:ring-inset [color:var(--t-color-l)] dark:[color:var(--t-color)] ${tinted ? 'bg-[var(--group-ground-light)] dark:bg-[var(--group-ground)]' : ''}`}
                            style={{
                              ...(tinted && {
                                '--group-ground': ground,
                                '--group-ground-light': tinted,
                              }),
                              ...tileTextVars,
                              ...safeBgImageStyle(groupBgImage),
                              backgroundSize: 'cover',
                              backgroundPosition: 'center',
                              position: 'relative',
                              zIndex: 1,
                              border: `1px solid ${isPastDate ? 'rgba(0,0,0,0.1)' : 'rgba(0,0,0,0.2)'}`,
                            }}
                            title={tileLabel}
                          >
                            {groupBgImage && (
                              <div style={{
                                position: 'absolute',
                                top: 0,
                                left: 0,
                                right: 0,
                                bottom: 0,
                                backgroundColor: 'rgba(255, 255, 255, 0.7)',
                                borderRadius: '0.25rem',
                                zIndex: 0,
                              }} />
                            )}
                            <div className="flex items-center gap-1 relative z-10 flex-1 min-w-0">
                              {groupProfilePic && (
                                <span className="shrink-0 text-xs leading-none">
                                  {groupProfilePic.startsWith('http') || groupProfilePic.startsWith('/') ? (
                                    <SafeImage
                                      src={groupProfilePic}
                                      alt={event.Group?.name || ''}
                                      fallbackIcon="👥"
                                      className="w-4 h-4 rounded-full object-cover border border-line"
                                    />
                                  ) : (
                                    <span className="text-sm">{groupProfilePic}</span>
                                  )}
                                </span>
                              )}
                              {/* The shadow/stroke fork moved to `tileTextVars`
                                  on the tile root (custom properties inherit) and
                                  is carried here as classes. The inline keys are
                                  gone deliberately: an inline declaration beats a
                                  `dark:` class, so a merely-overridden inline
                                  value would leave the light arm inert. */}
                              <span
                                className="truncate font-semibold [text-shadow:var(--t-shadow-l)] dark:[text-shadow:var(--t-shadow)] [-webkit-text-stroke:var(--t-stroke-l)] dark:[-webkit-text-stroke:var(--t-stroke)]"
                              >
                                {event.Game?.name || 'Game Night'}
                              </span>
                            </div>
                          </div>
                        );
                      })}
                      {dayEvents.length > 2 && (
                        <div
                          className="text-xs text-content-link font-medium pointer-events-none select-none"
                          title={`Tap the day to see all ${dayEvents.length} games`}
                        >
                          +{dayEvents.length - 2} more
                        </div>
                      )}
                    </div>
                  ) : (isEmpty && showEmptyDayHint) ? (
                    /* DECISION Phase 87.8-12 R10 (owner, 2026-08-03): the empty-day "+" hint
                       stays HOVER-ONLY, which means invisible on touch — v4 wraps group-hover
                       in @media (hover: hover), false on phones. ACCEPTED over an always-visible
                       low-opacity hint (rejected: adds a "+" to every empty cell of an already
                       dense 375px grid the design reference records as unusable below 480px —
                       DESIGN-SYSTEM-REFERENCE-2026.md:216), over an empty-state prompt (fails
                       partially-filled months) and over first-use coaching here (v2.1 tutorial
                       phase owns coaching). The cell itself STAYS tappable (cellClickable above)
                       and the v2.1 tutorial is expected to teach tap-to-create (todo:
                       2026-08-03-tutorial-teach-empty-day-tap-to-create). Making this hint
                       touch-visible is a decision, not a cleanup. */
                    <div className="flex items-center justify-center flex-1 opacity-0 group-hover:opacity-40 transition-opacity">
                      <span className="text-2xl text-content-muted select-none">+</span>
                    </div>
                  ) : null}
                </>
              )}
            </div>
          );
        })}
      </div>
    </>
  );
}
