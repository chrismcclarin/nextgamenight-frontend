'use client';
import { getEventsForDate, isToday } from '../../lib/calendarUtils';
import {
  getEventTileTextColor,
  getBrightness,
  groupInkVars,
  isDarkBackground,
  resolveGroupGround,
  storedGroupColour,
  themedTextStyleVars,
  SUBTEXT_MUTED_ON_DARK,
  SUBTEXT_MUTED_ON_LIGHT,
} from '../../lib/colorUtils';
import { safeBgImageStyle } from '../../lib/safeBgImageStyle';
import { Button } from '../../components/ui/Button';
import { Heading } from '../../components/ui/Heading';
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
 * AMENDED Phase 88.3.1 (plan 09, M26), everything above KEPT AS HISTORY. The
 * rejection above rests on a MEASURED premise — "pure hex arithmetic" — and this
 * plan changed what the per-tile work actually is, so the premise has to be
 * restated rather than left pointing at code that no longer runs.
 *
 * WHAT THE PER-TILE WORK IS NOW. `resolveGroupGround(storedGroupColour(group))`
 * replaces the old `resolveGroupBackgroundColor` + `lightTintGroupBackgroundColor`
 * pair. For a PRESET group it is one `??`, one `trim().toLowerCase()` and one
 * `Map.get` — a table lookup returning stored literals, with NO channel maths at
 * all. `groupInkVars(..., { surface: 'tile' })` adds two `getEventTileTextColor`
 * calls (one `getBrightness`, i.e. three multiplies each) plus two constants.
 * For a LEGACY hex group the old six-channel tint still runs, once, inside the
 * resolver — exactly the arithmetic that used to run here.
 *
 * SO THE REJECTION STILL HOLDS, and it holds MORE strongly than when it was
 * written: on the path every group takes after the Req 6 migration, a table
 * lookup is CHEAPER than the arithmetic it replaced. Nothing here got hotter,
 * and the second half of the original argument is untouched — `days` and
 * `activeEvents` still change identity on every parent render, so a `useMemo`
 * would recompute every time and cost strictly more than it saves. REJECTED,
 * again and for the same reason: memoizing this loop.
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
        {/* Phase 88.6-27: both `.btn btn-primary` nav controls take the primitive, and their
            per-site focus-ring strings retire with the migration — the ring lives ONCE in the
            primitive's cva base (A-2 ARM A, owner ruling 2026-09-15). The 88.3-17 marker above
            is byte-unchanged and still true of what the user sees; only WHERE the ring is
            expressed moved. The "Go to Today" text link between them is NOT a `.btn` and KEEPS
            its own string — it is not a member of the family that marker's ARM A covers. */}
        <Button variant="primary" onClick={() => onNavigateMonth(-1)}>
          &larr; Previous
        </Button>
        <div className="text-center">
          <Heading level={3} size="heading" className="text-content-primary">
            {monthNames[currentDate.getMonth()]} {currentDate.getFullYear()}
          </Heading>
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
        <Button variant="primary" onClick={() => onNavigateMonth(1)}>
          Next &rarr;
        </Button>
      </div>

      {/* Calendar Grid */}
      {/* UI-SPEC §4.5: the weekday header below is HIERARCHY, so 600 -> 700.
          THE SIZE IS HELD AT 14 DELIBERATELY, and the reason is a premise check rather than an
          omission. Plan 88.6-26's D-03 correction folded two OTHER weekday header rows to
          12/700 over 12/400 on the stated ground that the header and the row beneath it "share
          text-content-muted, so weight is the only hierarchy left". That premise is FALSE here:
          this header is `text-content-secondary` while the day number below it forks its ink
          four ways (accent for today, muted for an adjacent-month or past date, primary
          otherwise), so colour is already carrying the hierarchy and this is not the one-ink
          case D-03 addresses. Nothing in this plan's text asks for a size reduction here
          either. Folding this row to 12 is therefore a DECISION for /gsd-ui-review or Phase
          88.9, not a cleanup — and it is disclosed as an open question in
          `88.6-27-SUMMARY.md` rather than taken silently. */}
      <div className="grid grid-cols-7 gap-1 mb-4">
        {dayNames.map(day => (
          <div key={day} className="text-center font-bold text-content-secondary py-2 text-sm">
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

          /* DECISION Phase 88.6-40 (W39, SPEC R5 / AC-5): the day's keyboard target is gated on
             `cellClickable && dayEvents.length !== 1`, NOT on `cellClickable` alone.

             REJECTED — gating on `cellClickable` alone. `cellClickable` is TRUE on a 1-event
             day, and on a 1-event day the CELL's dispatch IS the TILE's: `EventCalendar.js`'s
             `handleDayClick` forwards a single-event day straight into `handleEventClick`
             (`if (dayEvents.length === 1) { handleEventClick(dayEvents[0]); return; }`), the
             very handler the tile's `onEventClick` is bound to — and that tile is ALREADY
             `role="button" tabIndex={0}`. So the rejected arm ships a SECOND tab stop for ONE
             action, and a worse one, because the day target's name promises a day modal the
             user is never taken to.

             ALSO CONSIDERED AND NOT TAKEN: keeping the target on every clickable cell and
             branching its `aria-label` on `dayEvents.length` the way `handleDayClick` branches.
             That fixes the wrong NAME but leaves two stops for one action.

             The narrowing costs nothing — every 1-event day is already fully keyboard-operable
             through its tile — and it holds for every consumer: `<CalendarMonthView` has exactly
             one render site in `src/` (`EventCalendar.js`). This is a decision, not a cleanup. */
          const dayTargetActive = cellClickable && dayEvents.length !== 1;
          const dayNumberLabel = dayTargetActive
            ? `${monthNames?.[date.getMonth()] ?? ''} ${date.getDate()}`.trim() +
              (dayEvents.length > 0
                ? `, ${dayEvents.length} games. Open this day.`
                : '. Add an event on this day.')
            : undefined;

          return (
            <div
              key={index}
              onClick={() => {
                if (date) onDayClick(date, dayEvents);
              }}
              /* DECISION Phase 88.6-40 (W39 / T-88.6-116): `group` is HOISTED here, onto the
                 wrapper's static class string, out of the `cellClickable` arm of the ground
                 ternary below where it used to be this file's only occurrence.

                 WHY IT HAD TO MOVE: the ternary is ordered `!date` -> `isCurrentDay` ->
                 past-date -> `cellClickable`, so an empty TODAY cell — which IS `cellClickable`
                 — resolves at the `isCurrentDay` arm and carried no `group` at all. Its
                 `group-hover:opacity-40` "+" hint was therefore dead on HOVER too: a SHIPPED
                 defect this plan surfaces rather than introduces, and the new
                 `group-focus-within:` reveal would have inherited exactly the same dead ancestor.

                 UNCONDITIONAL, chosen OVER a `${cellClickable ? ' group' : ''}` interpolation:
                 the two are equivalent by construction (the only `group-*` utility anywhere in
                 this cell's subtree is the "+" hint, which renders only under
                 `isEmpty && showEmptyDayHint`, a disjunct of `cellClickable`), and the
                 unconditional form adds no fourth template interpolation — which REMOVES the
                 88.6-09 chunk-walker hazard instead of merely warning about it.

                 FENCED: `group` PAINTS NOTHING, which is the whole reason it may leave the
                 ternary. `cursor-pointer`, `transition-colors` and every `bg-*` / `border-*` /
                 `hover:*` token STAY in their arms and the arms stay mutually exclusive — see
                 the `DECISION Phase 88.3` (D-09 cascade fix) marker below, which records that
                 stacking a permanent PAINTING ground beside a conditional one is REJECTED for
                 this file (an emission-order paint bug jsdom cannot see). Hoisting `group` is
                 not that pattern; FLATTENING the chain would be. This is a decision, not a
                 cleanup. */
              className={`group ${variant === 'compact' ? 'min-h-[80px]' : 'min-h-[100px]'} border border-line rounded-sm p-1 ${variant === 'compact' ? 'flex flex-col' : ''} ${
                isAdjacent ? 'opacity-60 ' : ''
              }${
                !date ? 'bg-surface-page' :
                isCurrentDay ? 'bg-surface-muted border-line-accent' :
                variant === 'full' && isPastDate ? 'bg-surface-page' :
                cellClickable ? 'bg-surface-card hover:bg-surface-hover hover:border-line-accent cursor-pointer transition-colors' :
                'bg-surface-card'
              }`}
            >
              {date && (
                <>
                  {/* UI-SPEC §4.5, the EMPHASIS outcome (400 + a colour token): the 500 is
                     deleted rather than promoted, because this element ALREADY forks its colour
                     four ways for exactly the hierarchy the weight was carrying — accent for
                     today, muted for an adjacent-month or past date, primary otherwise — and
                     today's cell additionally has its own ground and accent border. Promoting to
                     700 instead would bold all 42 day numbers in the grid and flatten that fork
                     rather than support it. */}
                  {/* DECISION Phase 88.6-40 (W39, SPEC R5 / AC-5): THE DAY'S KEYBOARD TARGET IS
                      THIS ELEMENT, not the cell that wraps it.

                      REJECTED — `role`/`tabIndex`/`onKeyDown` on the cell `<div>`, and rejected
                      again as a native `<button>` wrapper. The cell WRAPS two `role="button"
                      tabIndex={0}` event tiles; promoting the wrapper is axe
                      `nested-interactive` (WCAG 4.1.2), children-presentational hides the tiles
                      from assistive tech, and it is the verbatim 88.3 run-3 H1 regression
                      recorded in `groupColourRendering.test.ts`'s test 8. This is EventDayModal's
                      H1 remedy — the same one plan 88.6-21 applied to the group card's title
                      block, reused rather than forked into a second idiom.

                      REJECTED — a native `<button>` here. A native button SYNTHESISES a bubbling
                      click on Enter/Space, which would reach the cell's `onClick` and fire
                      `handleDayClick` TWICE. A div + role synthesises neither, so each key is
                      handled exactly once. For the same reason this element carries NO `onClick`
                      of its own: a pointer click bubbles to the cell and fires once.

                      NO 24px FLOOR IS DECLARED HERE, and the evidence is stated rather than the
                      conclusion. WCAG 2.2 SC 2.5.8's "Equivalent" exception is CONDITIONAL — a
                      target below 24x24 is exempt only when another control on the same page
                      achieving the SAME FUNCTION does meet the minimum. That precondition is
                      satisfied and readable from the class string above: the equivalent control
                      is the day CELL itself, which carries the `onClick` for this same function
                      and is `min-h-[80px]` in the compact variant, and which — as one of seven
                      columns in `grid-cols-7 gap-1` — is ~53px wide at a 375px viewport
                      (ARITHMETIC, not a measured render). Both axes clear 24 comfortably.
                      REJECTED ARM: declaring `min-h-6` on the day number. It would move the tile
                      stack down in every phone cell of the grid for a target that is already
                      exempt on a checked precondition.

                      The ARIA grid pattern (`heatmap/WeekGrid.tsx` + `useHeatmapCell.ts`) was
                      also REJECTED: it requires the event tiles at `tabIndex={-1}`, which test 8
                      pins against, and plan 41 edits those tiles next wave.

                      Any of this is a decision, not a cleanup. */}
                  <div
                    {...(dayTargetActive
                      ? {
                          role: 'button',
                          tabIndex: 0,
                          'aria-label': dayNumberLabel,
                          onKeyDown: (e) => {
                            if (e.key === 'Enter' || e.key === ' ') {
                              e.preventDefault();
                              e.stopPropagation();
                              onDayClick(date, dayEvents);
                            }
                          },
                        }
                      : {})}
                    /* DECISION Phase 88.6-40 (W41): `aria-current="date"` rides THIS element,
                       UNCONDITIONALLY on `cellClickable`, driven by the SAME `isCurrentDay`
                       boolean as the cell tint above and the `text-content-accent` ink below.

                       REJECTED — on the CELL wrapper. The cell `<div>` is role-less and has no
                       accessible name, and ARIA has no ancestor-to-descendant state propagation:
                       a screen reader in focus mode announces the FOCUSED node's role, name and
                       states, so `aria-current` on the wrapper would never be conveyed when the
                       inner day target takes focus — the user would hear the name and "button"
                       and never "current date". The shipped sibling `SchedulerWeekStrip.tsx`
                       puts the attribute on the NAMED `role="tab"` control (`aria-current={today
                       ? 'date' : undefined}`) and tints an INNER span, with `EventScheduler`'s
                       own suite asserting that pair by CONTAINMENT. The month grid INVERTS the
                       nesting direction — attribute inner, tint outer — because here the named
                       control IS the inner element; the RELATION (containment, on one boolean)
                       is identical, and it is the shipped house idiom rather than a second one.

                       REJECTED — gating `aria-current` on `cellClickable`: it would strip the
                       semantic from exactly the cells that most need it (an empty TODAY cell on
                       a calendar with no create hint). ACCEPTED CONSEQUENCE (owner ruling
                       2026-09-14, #52): on every cell that exposes no keyboard target the
                       attribute therefore sits on a ROLE-LESS generic. Role-less but NOT
                       unnamed — its content is `{date.getDate()}`, the date itself — and WCAG
                       4.1.2 applies to components WITH a role, so no SC is failed and the result
                       is strictly better than the tint-only status quo. NOT READ: no AT was run;
                       "exposed by most AT" is the ARIA mapping for `aria-current` on a named
                       generic, not an observed announcement.

                       NEITHER HALF IS GATED ON `isCurrentMonth`, and that is FORBIDDEN rather
                       than merely unchosen. `isCurrentDay` is computed from the date ALONE, the
                       cell's ground ternary awards the today treatment BEFORE the adjacent branch
                       is reached (`isAdjacent` only prefixes `opacity-60`), and `getDaysInMonth`
                       returns 42 cells including adjacent-month days — so a grid whose OVERFLOW
                       contains today ALREADY renders that overflow cell tinted as today. The
                       invariant is therefore per rendered GRID, not per month: exactly ONE
                       `aria-current="date"` per grid, INSIDE the tinted cell. The tint must not
                       be gated because P6 pins the visual treatment unchanged, and desyncing the
                       pair is the failure this rule exists to prevent.

                       NO `sr-only` NODE is added: the date text already serves as this element's
                       accessible name, and a screen-reader-only text node would be this file's
                       first (counted live: zero). No "Today" segment is added to the
                       `aria-label` above either — the state now sits on the focused node and a
                       name segment would double-announce. This is a decision, not a cleanup. */
                    aria-current={isCurrentDay ? 'date' : undefined}
                    className={`${variant === 'compact' ? 'text-xs' : 'text-sm'} mb-1 ${
                      dayTargetActive
                        ? 'rounded-sm focus:outline-hidden focus-visible:ring-2 focus-visible:ring-focus-ring focus-visible:ring-inset '
                        : ''
                    }${
                      isCurrentDay ? 'text-content-accent' :
                      isAdjacent ? 'text-content-muted' :
                      variant === 'full' && isPastDate ? 'text-content-muted' :
                      'text-content-primary'
                    }`}
                  >
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
                        /*
                         * AMENDED Phase 88.3.1 (plan 09, AMENDMENT J): the ACCESSOR
                         * is `storedGroupColour(event.Group)`, never
                         * `event.Group?.background_color`. Plan 88.3.1-05 migrates
                         * every coloured group to `color_preset='<id>',
                         * background_color=NULL`, so reading the legacy column alone
                         * would render every migrated group's tiles UNCOLOURED — a
                         * failure with a fully green suite, because no test in this
                         * tree reads a computed style.
                         * REJECTED: a per-site `color_preset ?? background_color`
                         * ternary — six copies of one rule (project tenet). A
                         * decision, not a cleanup.
                         */
                        const tileGroundPair = resolveGroupGround(storedGroupColour(event.Group));
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
                         *
                         * AMENDED Phase 88.3.1 (plan 09), the whole block above
                         * KEPT AS HISTORY. Its Tailwind source-order argument, its
                         * empty-false-branch D-28 note and its T-88.3-43 rejection
                         * are all UNCHANGED in substance. Two mechanical facts under
                         * it moved: `groupBgColor` no longer exists (its "ALSO
                         * REJECTED: gating on `groupBgColor` alone" now reads against
                         * `tileGroundPair`), and the hand-written
                         * `const ground = tinted ? … : null` gate is gone — not
                         * dropped, PROMOTED: T-88.3-43 became a property of
                         * `resolveGroupGround`'s return type (`{dark, light, …}` or
                         * `null`, never half a pair) instead of a gate six callers
                         * each rewrite, so the two locals below are destructured from
                         * ONE object and cannot drift apart.
                         */
                        const ground = tileGroundPair?.dark ?? null;
                        const tinted = tileGroundPair?.light ?? null;
                        const groupProfilePic = event.Group?.profile_picture_url;
                        const groupBgImage = event.Group?.background_image_url;
                        /*
                         * DECISION Phase 88.3.1 (plan 09, AMENDMENT AC — the same
                         * two-flag shape plan 08 shipped at `CalendarListView.js`
                         * and `EventDayModal.js`): a SECOND image flag derived from
                         * the VALIDATED `safeBgImageStyle` result, read ONLY by
                         * `groupInkVars`.
                         *
                         * WHY TWO. `safeBgImageStyle` drops relative/invalid URLs
                         * (FSEC-03), so a truthy-but-rejected URL paints NO image:
                         * that tile IS a plain coloured tile and must get its ink.
                         * Feeding `groupInkVars` the raw `groupBgImage` would
                         * withhold the ink from exactly those tiles.
                         * REJECTED: converging `tileBgImage` onto the validated
                         * style here — it CHANGES WHAT AN INVALID-URL TILE PAINTS
                         * (the image-tuned black shadow/stroke gives way to the
                         * plain treatment) on a surface this plan was not scoped to
                         * re-look at, and the same divergence is live at three
                         * sibling files. Registered as one 4-site family in
                         * `.planning/deferred/phase-88.6.md`; converge all of them in
                         * one pass with a rendered check. Deleting either flag here
                         * is a decision, not a cleanup.
                         */
                        const bgImageStyle = safeBgImageStyle(groupBgImage);
                        const hasValidBgImage = !!bgImageStyle;
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
                         *
                         * ——— AMENDED Phase 88.3.1 (plan 09), everything above KEPT
                         * VERBATIM AS HISTORY ———
                         *
                         * THE `isPastDate` GATES ARE REVERSED HERE, deliberately and
                         * under authority: SPEC Req 8 and UI-SPEC 3.5 name exactly
                         * these two arms as the third of three "the pole is chosen by
                         * 'has a colour' instead of 'is the rendered ground dark'"
                         * sites. This is not a cleanup that ignored the paragraph
                         * above; it is the paragraph's premise expiring.
                         *
                         * WHY THE PREMISE EXPIRED. "Does this group have a colour at
                         * all" was a SAFE proxy for "is the ground dark" only while
                         * every coloured ground WAS dark. Phase 88.3.1 ships eight
                         * LIGHT surfaces (`groupColourPresets.ts`), so the proxy
                         * breaks by construction. It was already broken for legacy
                         * data: on a pre-59-05 light stored hex (`#e3f2fd`,
                         * `#e8f5e9`, `#f5f5f5`, `#fffde7`) in DARK mode the tile
                         * paints that near-white hex and the old dark arm asked for
                         * 70%-white on top of it — about **1.1:1**, i.e. invisible.
                         * Those presets left the picker at `5bb69a6` but were never
                         * migrated out of the database, and the backend validator
                         * checks hex SHAPE only. Registered by the owner 2026-08-28
                         * ("register and stop. We already have a thing to fix
                         * colors") and routed to this phase because this phase is
                         * what makes the light case ordinary rather than legacy.
                         *
                         * THE REPLACEMENT IS PER-ARM, and that is the load-bearing
                         * detail rather than a formality: the DARK arm asks
                         * `isDarkBackground(ground)` — the dark band, which is what
                         * dark mode paints — and the LIGHT arm asks
                         * `isDarkBackground(tinted)` — the light surface, which is
                         * what light mode paints. One shared predicate would be wrong
                         * in one theme by definition. It is the same predicate the
                         * NON-past path in this very file already uses via
                         * `getEventTileTextColor`.
                         *
                         * WHAT IS **NOT** CHANGING, named so the next reader does not
                         * finish the job: the non-past
                         * `getEventTileTextColor(ground)` / `(tinted)` pair, and the
                         * half of the marker above that defends it. Re-pointing THOSE
                         * would change the pole on an untinted-but-coloured tile —
                         * a different decision, which this phase is not making
                         * (UI-SPEC 3.5, "Do not touch").
                         * REJECTED: deleting the block above and writing a fresh one.
                         * The reasoning that was correct in 88.3-cr is the record of
                         * why the old shape shipped; losing it loses the audit trail
                         * that shows this reversal was made knowingly.
                         */
                        const tileTextVars = themedTextStyleVars(
                          {
                            ...tileTextTreatment(ground, tileBgImage),
                            color: isPastDate
                              ? (tinted
                                  ? (isDarkBackground(ground) ? SUBTEXT_MUTED_ON_DARK : SUBTEXT_MUTED_ON_LIGHT)
                                  : 'var(--color-content-muted)')
                              : getEventTileTextColor(ground),
                          },
                          {
                            ...tileTextTreatment(tinted, tileBgImage),
                            color: isPastDate
                              ? (tinted
                                  ? (isDarkBackground(tinted) ? SUBTEXT_MUTED_ON_DARK : SUBTEXT_MUTED_ON_LIGHT)
                                  : 'var(--color-content-muted)')
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
                               reason the null ground branch stays `bg-surface-muted` rather
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

                               AMENDED Phase 88.6-40 — BOTH HALVES ABOVE ARE KEPT AS HISTORY.

                               (a) KEYBOARD. 88.3 ruling B's "accept as is" ownership is
                               DISCHARGED here, under SPEC 88.6 R5 / AC-5. The CELL IS STILL
                               POINTER-ONLY — the sentence above stays literally true — but now
                               for a DIFFERENT and stronger reason: the cell wraps these
                               `role="button"` tiles, so promoting it would be axe
                               `nested-interactive` (WCAG 4.1.2) and would hide the tiles from
                               assistive tech under children-presentational. The day's keyboard
                               path lives on the INNER day-number element instead (see its
                               `DECISION Phase 88.6-40 (W39)` marker above), and it is withheld on
                               a 1-EVENT day, whose stop for that same action is THIS tile. "Do
                               not add a keyboard path to the cell" therefore still stands, and is
                               now enforced by `groupColourRendering.test.ts`'s rewritten test 23.

                               (b) SIZE — plan 88.6-40 task 3. "PHASE 88.6's calendar/tile pass
                               owns the size question" is DISCHARGED here, not left to a later
                               plan: this tile now DECLARES `min-h-6` (24px) on its own
                               `className`, under the D-13 per-control pattern and citing WCAG 2.2
                               SC 2.5.8 — see the marker at that `className`, which also records
                               why 44 (SC 2.5.5, AAA) was REJECTED. The "roughly 16-20px tall"
                               figure above is HISTORY; re-derived at this commit the pre-fix
                               height was ~20px (16px `text-xs` line box + 2px `p-0.5` each side,
                               ARITHMETIC not a rendered read). The paragraph's other half —
                               "the DAY CELL (min-h 80px) is the touch surface" — is unchanged and
                               is exactly the WCAG 2.2 "Equivalent" precondition the day-number
                               target's own marker leans on.

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
                              /* §4.5 HIERARCHY -> 700: this span IS the compact tile's game
                                 name, its primary content. `text-xs` STAYS — a month tile is a
                                 dense-grid cell and Caption 12 is its ratified role (§4.2), so
                                 this is one of the sites that must NOT be swept to 14.

                                 DECISION Phase 88.6-40 (W40, D-13 pattern): `min-h-6` (24px)
                                 DECLARED here, citing WCAG 2.2 SC 2.5.8 (Target Size, Minimum),
                                 whose binding floor is 24x24 CSS px. It is DECLARED rather than
                                 inherited because this is a `role="button"` div, not a `.btn` and
                                 not a `<Button>`, so neither `globals.css`'s phone-only
                                 `.btn { min-height: 2.75rem }` nor the primitive's cva base
                                 reaches it — the same per-site pattern the 87.8 D-13 floor
                                 markers record.

                                 REJECTED — a 44px floor (SC 2.5.5, which is AAA). Seven of these
                                 sit across a `grid-cols-7` row at 375px inside a cell that is
                                 `min-h-[80px]`, and two tiles stack per cell: a 44px floor would
                                 deform the month grid outright. 24 is the correct floor for THIS
                                 element and 44 would be the wrong one, which is precisely why
                                 D-13's pattern is a per-control declaration.

                                 MEASURED BEFORE: ~20px (ARITHMETIC, not a rendered read — 16px
                                 `text-xs` line box + 2px `p-0.5` top and bottom). This is a
                                 decision, not a cleanup. */
                              className={`min-h-6 text-xs p-0.5 rounded-sm font-bold cursor-pointer transition-[background-color,opacity] focus:outline-hidden focus-visible:ring-2 focus-visible:ring-focus-ring focus-visible:ring-inset ${tinted ? 'bg-[var(--group-ground-light)] dark:bg-[var(--group-ground)] hover:opacity-90' : 'bg-surface-muted hover:bg-surface-elevated'} ${tinted ? '[color:var(--t-color-l)] dark:[color:var(--t-color)]' : 'text-content-accent'}`}
                              style={{
                                ...(tinted && {
                                  '--group-ground': ground,
                                  '--group-ground-light': tinted,
                                }),
                                /*
                                 * DECISION Phase 88.3.1 (plan 09, SPEC Req 4 / UI-SPEC 3.3
                                 * and 3.4): this tile takes **PLAIN** ink —
                                 * `groupInkVars(pair, { surface: 'tile' })` — from the SAME
                                 * one function the four CARD surfaces call, differing by ONE
                                 * ARGUMENT rather than by a second copy.
                                 *
                                 * PLAIN, NOT TINTED, IS AN OWNER RULING, not an oversight:
                                 * "when it's small like that, you need the text to be more
                                 * distinct." A month tile is one line of `text-xs` in a ~49px
                                 * cell, so it takes the high-contrast poles rather than the
                                 * card ink's chromatic 8.00-8.08:1.
                                 *
                                 * MEASURED ON THE SHIPPED BANDS (2026-08-29, this tree's
                                 * `lib/wcag.ts`), not inherited — the figures in this phase's
                                 * own documents have been wrong twice:
                                 *   `getEventTileTextColor` non-past  6.44-6.50:1 light
                                 *                                     11.29-15.40:1 dark
                                 *   past-date muted poles             7.61-7.68:1 light
                                 *                                     6.33-8.10:1 dark
                                 * NOTE the dark low ends. Both are `green`, whose dark band
                                 * sits at CIE L* 24.6 by owner direction (BAND EXCEPTION 1 in
                                 * `groupColourPresets.ts`) rather than at the 12-20 target.
                                 * UI-SPEC 3.5 publishes "7.27-8.10:1 dark" for the past-date
                                 * pole; on this tree it is **6.33**-8.10, because green pulls
                                 * it. Everything still clears AA with room, but green is now
                                 * the binding row on a FOURTH reading — the palette marker
                                 * already says nobody may brighten it further without
                                 * re-running UI-SPEC 2.4, and this is one more reason.
                                 * REJECTED: `surface: 'card'` here,
                                 * and equally a second `tileInkVars` beside the card one —
                                 * UI-SPEC 3.4 is explicit that one function with one
                                 * parameter is the contract, and duplication is never a peer
                                 * option in this project.
                                 *
                                 * `hasBackgroundImage` is passed EXPLICITLY and is the
                                 * VALIDATED flag: this is a `.js` file, so an omitted option
                                 * degrades silently to `false` — the UNSAFE direction.
                                 *
                                 * WHY THE TILE'S `color` STILL COMES FROM `--t-color*` AND
                                 * NOT FROM `--group-ink*`, stated because it looks like an
                                 * unfinished wiring and is not. `groupInkVars`'s tile muted
                                 * rungs (`--group-ink-muted*`) are THEME-keyed constants —
                                 * `SUBTEXT_MUTED_ON_DARK` on the `dark:` arm, always. A
                                 * past-date tile that consumed them would ask for 70%-white
                                 * in dark mode on a legacy LIGHT stored hex, which is
                                 * precisely the ~1.1:1 defect the amended CR-02 block above
                                 * just closed. The past-date pole has to be chosen per arm
                                 * from the ground ACTUALLY PAINTED IN THAT ARM, and only JS
                                 * can do that — which is why UI-SPEC 3.5 locates this site's
                                 * Req 8 fix at `tileTextVars`, in this file, and not in the
                                 * ink function. REJECTED: forking the className on
                                 * `isPastDate` so the non-past arm could read `--group-ink*`
                                 * — it renders byte-identical pixels (the tile ink IS
                                 * `getEventTileTextColor`) for a second colour channel and a
                                 * weaker gate. The ink is emitted so the ground and its ink
                                 * turn on and off together (test 9) and so `surface: 'tile'`
                                 * has a real production caller; changing any of this is a
                                 * decision, not a cleanup.
                                 */
                                ...groupInkVars(tileGroundPair, {
                                  surface: 'tile',
                                  hasBackgroundImage: hasValidBgImage,
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
                                  /* D-01: `text-[10px]` folds UP to the 12px floor. An arbitrary
                                     value is off the rung set by definition, and 10px is below
                                     the app's floor. `text-xs` is the Caption rung and a
                                     per-cell RSVP counter is on §4.2's closed role list.

                                     V-7 MEASURED, and it found something — reported here rather
                                     than fixed, because the finding is PRE-EXISTING and its
                                     element is plan 40's. Chromium, 375x812, two identical
                                     settled reads over a stylesheet compiled from the live
                                     `globals.css`, markup dumped from a real jsdom render of
                                     this component in its COMPACT variant:

                                       realistic `3Y 1M 2N`: content 50px BEFORE the fold and
                                       58px after, in a 28px box.
                                       worst case `12Y 12M 12N`: 67px -> 78px, same 28px box.

                                     So this row has NEVER fitted its cell at phone width — the
                                     three spans are a `flex gap-1` with no wrap, no truncation
                                     and no `overflow-hidden` on either the tile or the day cell,
                                     so they bleed to the right over the neighbouring cell. The
                                     fold WIDENS an existing bleed by ~8px; it does not create
                                     one, and reverting to 10px would not close it.

                                     NO VERTICAL REFLOW: the tile grows 34.5px -> 37px inside an
                                     80px `min-h` cell, and the grid measures 500px tall before
                                     AND after. That is the reflow half of V-7, and it passes.

                                     NOT FIXED HERE, and not left as a comment beside itself:
                                     every candidate remedy (truncating the counts, clipping the
                                     tile, dropping to two counts) is a LOOK change on the day
                                     cell with no ruling behind it, and the day cell is plan 40's
                                     element (W39/W41). Routed with the full table to
                                     `.planning/deferred/phase-88.6.md` and recorded in
                                     `.planning/WINDOWS.md`. */
                                  className="text-xs leading-tight mt-0.5"
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
                            /* §4.5: the 500 here is DELETED rather than resolved to a weight,
                               because it governs no text. The only text inside this container is
                               the game-name span below, which declares its own weight, and the
                               emoji fallback, where weight is meaningless. `text-xs` STAYS —
                               dense-grid cell, Caption 12 (§4.2). */
                            className={`text-xs p-1 rounded-sm truncate hover:opacity-90 transition-opacity flex items-center gap-1 cursor-pointer focus:outline-hidden focus-visible:ring-2 focus-visible:ring-focus-ring focus-visible:ring-inset [color:var(--t-color-l)] dark:[color:var(--t-color)] ${tinted ? 'bg-[var(--group-ground-light)] dark:bg-[var(--group-ground)]' : ''}`}
                            style={{
                              ...(tinted && {
                                '--group-ground': ground,
                                '--group-ground-light': tinted,
                              }),
                              /*
                               * The FULL tile's half of the tile-ink decision — full
                               * marker at the compact tile above, not repeated here.
                               * One difference is real and worth naming: this variant
                               * DOES paint the background image, so on a group that has
                               * both a colour and a valid photo `groupInkVars` returns
                               * `{}` (plan 06 AMENDMENT 7) and `getTextStyle`'s
                               * owner-ruled white/stroke/shadow treatment stands
                               * untouched. That is why the flag must be the VALIDATED
                               * `hasValidBgImage` and not the raw URL: a URL the
                               * allowlist rejects paints no image, so that tile IS a
                               * plain coloured tile and must get its ink. REJECTED:
                               * `!!groupBgImage`. A decision, not a cleanup.
                               *
                               * CAVEAT, recorded 2026-08-30 (code review #2/#28): the rule
                               * stated above does NOT hold for the COMPACT variant, and that
                               * is accepted rather than fixed. `tileBgImage` is `null` when
                               * `variant === 'compact'` (the compact tile paints no image),
                               * yet `hasValidBgImage` is derived from the FULL image — so a
                               * compact tile of an image-bearing group is handed
                               * `hasBackgroundImage: true` and gets `{}` back, i.e. it is
                               * treated as an image surface while painting no image.
                               * The impact is PERMANENTLY zero, not merely invisible today:
                               * month tiles never consume `--group-ink*` at all, by owner
                               * ruling (UI-SPEC 3.3, "when it's small like that, you need the
                               * text to be more distinct"), and `groupColourRendering.test.ts`
                               * :1470-1476 asserts a tile's colour expression never contains
                               * `--group-ink` because consuming it would re-open SPEC Req 8 on
                               * past dates at ~1.1:1. So the argument this flag feeds cannot
                               * reach a rendered pixel on this surface.
                               * REJECTED: passing `variant === 'compact' ? false :
                               * hasValidBgImage`. It would make the flag honest but changes a
                               * call whose result is provably discarded, and test 9's
                               * derivation scan requires the literal
                               * `const F = !!X` / `const X = safeBgImageStyle(…)` chain — a
                               * ternary on the flag itself reds it. Resolve this together with
                               * the five-site `hasBackgroundImage` convergence that Phase 88.6
                               * already owns (`.planning/deferred/phase-88.6.md`), not before.
                               */
                              ...groupInkVars(tileGroundPair, {
                                surface: 'tile',
                                hasBackgroundImage: hasValidBgImage,
                              }),
                              ...tileTextVars,
                              ...bgImageStyle,
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
                                /* §4.5 HIERARCHY -> 700: the full tile's game name, the twin of
                                   the compact tile's above. One control, one weight. */
                                className="truncate font-bold [text-shadow:var(--t-shadow-l)] dark:[text-shadow:var(--t-shadow)] [-webkit-text-stroke:var(--t-stroke-l)] dark:[-webkit-text-stroke:var(--t-stroke)]"
                              >
                                {event.Game?.name || 'Game Night'}
                              </span>
                            </div>
                          </div>
                        );
                      })}
                      {dayEvents.length > 2 && (
                        <div
                          /* DECISION Phase 88.6-27 (D-16, SPEC Req 8): `text-content-link` ->
                             `text-content-secondary`. This span is `pointer-events-none
                             select-none` — definitively NOT a link — and the link ink measured
                             3.9909 on the `bg-surface-muted` day-cell ground (`:249`), below the
                             4.5 AA floor. `text-content-secondary` measures 6.9620 on the same
                             ground.
                             REJECTED: making it an actual link/button to justify the ink. The
                             day CELL already handles the tap (`onDayClick`), and a nested
                             control inside a `role`-less clickable cell is the children-
                             presentational trap `EventDayModal`'s H1 remedy exists for.
                             The 500 weight goes with it, §4.5's EMPHASIS outcome: 400 plus the
                             colour token that is now correct, rather than weight standing in for
                             an ink that could not be read. `text-xs` STAYS — dense-grid cell,
                             Caption 12 (§4.2). */
                          className="text-xs text-content-secondary pointer-events-none select-none"
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
                       touch-visible is a decision, not a cleanup.

                       AMENDED Phase 88.6-40 (W39 / T-88.6-116) — THE PARAGRAPH ABOVE IS KEPT AS
                       HISTORY AND IS NOT REVERSED. Two things changed under it, and the owner is
                       entitled to see both named.

                       (1) A KEYBOARD PATH NOW EXISTS. Plan 88.6-40 makes the day-number element
                       inside this cell a keyboard target, and `cellClickable`'s second branch is
                       `isEmpty && showEmptyDayHint` — so empty days are now keyboard-reachable
                       while this "+" was their ONLY affordance and was hover-gated. A
                       `group-focus-within:opacity-40` reveal is added ALONGSIDE the existing
                       `group-hover:` one, at the same opacity.

                       WORDED ON THE RIGHT AXIS, DELIBERATELY: THE REVEAL FOLLOWS **FOCUS**, NOT
                       "KEYBOARD ONLY". Adding the keyboard path is the REASON for it, but a tap
                       or a click on the `tabIndex={0}` day-number target focuses that target
                       too, so the "+" appears momentarily on the TAPPED cell — by the same tap
                       that activates it, so it is still not a discoverable PRE-TAP affordance
                       and R10's accepted cost ("invisible on touch") is unchanged. R10 was
                       decided on the TOUCH axis, which is exactly what a "keyboard only"
                       sentence here would misstate.

                       `focus-within` AND NOT `focus-visible`: the keyboard target is the INNER
                       day-number element, not the cell that carries `group`, so a
                       `group-focus-visible:` variant on the wrapper would never fire.

                       (2) A LATENT DEFECT IS DISCLOSED, NOT INTRODUCED. The `group` marker this
                       hint depends on used to live in the `cellClickable` arm of the cell's
                       ground ternary — an arm `isCurrentDay` is reached BEFORE — so today's
                       EMPTY cell carried no `group` and has never revealed this "+" on HOVER
                       either. It was silently excluded from the owner's hover-only decision. The
                       hoist restores it. Still ONE hovered-or-focused cell at a time; the
                       REJECTED always-visible low-opacity hint is NOT reinstated.

                       (3) The glyph's ink moves `text-content-muted` -> `text-content-secondary`
                       — see the `DECISION Phase 88.6-40 (D-16)` note at the span below. */
                    <div className="flex items-center justify-center flex-1 opacity-0 group-hover:opacity-40 group-focus-within:opacity-40 transition-opacity">
                      {/* DECISION Phase 88.6-40 (D-16, owner ARM A): `text-content-secondary`
                          (6.9620) replaces `text-content-muted` (4.3725). `groundInk.test.ts`
                          rostered this pairing as debt that was not renderable while the dead
                          `group` arm kept the hint at opacity-0 on a today cell, and recorded
                          that PLAN 40'S HOIST WOULD MAKE IT LIVE. It is now live, so the ink is
                          fixed in the same commit as the hoist and the roster entry is deleted
                          rather than carried. REJECTED: moving the day cell's muted GROUND
                          instead — that ground is one arm of a five-arm ternary the tint
                          decision (P6) pins, and it is the OI-5 exclusion shape. Honest residual:
                          the glyph renders at `opacity-40`, so its COMPOSITED contrast is below
                          AA either way; this fixes the token the gate measures and improves the
                          hovered/focused reading, and the opacity is R10's accepted cost, not
                          this plan's to reverse. */}
                      <span className="text-2xl text-content-secondary select-none">+</span>
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
