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
  PHOTO_TEXT_STYLE,
  SUBTEXT_MUTED_ON_DARK,
  SUBTEXT_MUTED_ON_LIGHT,
} from '../../lib/colorUtils';
import { safeBgImageStyle } from '../../lib/safeBgImageStyle';
import { useBgImageFailed } from '../../lib/hooks/useBgImageFailed';
import { isGuestEvent } from '../../lib/eventClassification';
import { Button } from '../../components/ui/Button';
import { Heading } from '../../components/ui/Heading';
import { Icon } from '../../components/ui/Icon';
import { GUEST_TILE_EDGE, GUEST_TILE_HOVER } from './GuestPill';
import SafeImage from './SafeImage';

// 88.9-52 (S-B3): the month tiles' guest edge and guest hover are imported from GuestPill.tsx, where the whole guest-edge family and its markers now live (they were literals here: the W14 follow-up, W14 follow-up 2 and S-B1 markers moved with them, word for word).

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

const dayNames = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

/* DECISION Phase 88.9-52 (R22 + R26, owner pick C, 2026-11-17, 88.9-RULINGS.md picture page final
   picks): when the COMPACT day grid is under 14rem wide (the Q62 / X28 threshold: about 200% text
   on a phone; never at normal text, where 14rem is 224px and a 375 phone's grid is 319px) each day
   shows ONE bold count of its nights in place of its tiles and the +N label, chosen OVER the tiles
   as built (A: slivers with half a letter each, and +10 +99 +2 printed as one run) and OVER a
   coloured dot per game (B). The day numbers are held at a size that stays inside their own cell.
   Above the threshold nothing changes, and the full grid takes none of it.
   HOW, and what was rejected:
   - The count is CSS content read from data-count on the day's events box (the mock's own form),
     chosen OVER a second element holding the number: in a test page (no CSS) such an element
     prints a bare 3 beside the day number 3, and every lookup by that text finds two. The count
     is the day number's ink, bold, on the same cell grounds. It is lifted (relative z-10) for the
     reason the +N label is (S-B2: a later cell's ground paints over an overflow).
   - A day with SEVERAL nights hides its tiles and its +N label; its day target is the stop, name
     unchanged (N games. Open this day.).
   - A day with ONE night has no day target (W39 above: its tile is the stop). Hiding that tile
     would leave the day with no button and no spoken name, for exactly the large-text reader this
     threshold serves. So the tile STAYS, as a clear overlay on the count: same name, same
     handlers, its ground and edge switched off and its name text hidden. REJECTED: a second
     button for the count (two buttons with one name in the tree), and turning the day target on
     for one-night days (W39 rejects two stops for one action, and the grid width is not known to
     the script).
   - The overlay's two switches carry Tailwind's important mark, on purpose: the tile's ground
     arms include dark: and hover: forms that Tailwind emits AFTER a container query, so a plain
     @max-[14rem]:bg-transparent loses to them (compiled and read on tailwindcss 4, 2026-11-18).
     REJECTED: stacking a plain override (the winner is emission order).
   - SIZES (arithmetic on capture g's widths, not a rendered read; a cell is (grid - 6 gaps of
     0.25rem) / 7 and text starts 0.25rem + 1px inside it; a plain digit about 0.625em, a bold one
     about 0.63em). Day number: the largest size, never over its scaled 0.75rem and never under
     12px, at which two digits end inside the cell. At 375 / 200% (grid 263px) that is 16.4px
     where it was 24px and ended 7px past its cell (capture g: 20 21 and 29 30 1 ran together);
     on a 320 phone at 200% it is the 12px floor. From 9.5rem up to the threshold the formula
     gives the full 0.75rem, so nothing jumps where the query flips. Count: one digit is the
     mock's 0.75rem; two and three digits take the largest size that ends 4px before the next
     day's count (two digits stay 0.75rem at 375 / 200%; three, a day with 100 nights, 18.4px).
     Four digits are not sized. The owner's own rule from the same sitting (R21): cap it as
     large as fits.
   LOST, recorded: under the threshold a guest night has no visible cue on the grid (the dashed
   tile is gone, as the picked picture showed); a one-night guest day still SPEAKS Guest from its
   tile's name, and the day sheet shows the Guest pill. A screen reader may read the bare count as
   text after the day's name; not measured. Pinned by
   src/app/components/CalendarMonthView.test.tsx ("R22 + R26 (88.9-52): under 14rem the compact grid shows one bold count").
   AMENDED Phase 88.9-52 (G1, round 4, 2026-11-18; the after-build capture r3-l rendered this):
   - THE OVERLAY COVERS THE DAY'S CELL. As built the events box was the positioning box, so the
     one-night overlay was the count's own box: 12.7 x 48px at 375 / 200% and 8 x 48px at 320.
     Now the CELL is the positioning box in a narrow grid (NARROW_CELL) and the events box is
     not positioned at all, chosen OVER growing the events box to the cell (it would move the
     count) and OVER a min size on the overlay (a cell is 22.9px wide on a 320 phone; nothing
     larger than the cell can be honest). The count lets a tap through (pointer-events-none), so
     the whole cell, digit included, is the one named button.
   - A COUNT ENDS INSIDE ITS OWN CELL. The SIZES line above aimed two and three digits at the
     NEXT day's count, on a 0.63em digit; rendered, 12 and 101 ended 2.3 to 7.7px past their
     cell and one digit 0.8px past it on a 320 phone. Measured ink at 24px bold (r3-l): 1 is
     9.7px, 2 is 14.3px, 3 is 14.7px, and 0 is 0.70em, the widest read, so the arithmetic now
     takes 0.71em a digit. The count's line is pulled out to the cell's inner edges (the +N
     label's pull) and its start is a clamp: the day number's start (0.25rem in) wherever the
     count fits from there, further left where it does not, never past the cell's edge. Two and
     three digits take the largest size, never over 0.75rem and never under 12px, whose widest
     form fits that line: at 375 / 200% 19.5px and 13.0px, on a 320 phone 14.0px and the 12px
     floor. Chosen OVER shrinking alone (two digits would be 13.9px beside a 24px single digit)
     and OVER centring every count (the picked picture has it under the day number).
     NOT HELD, and why: three digits (100 or more nights on one day) on a 320 phone at 200%.
     The cell is 22.9px; three of the widest digits need 25.6px at the 12px floor, so the
     widest forms end up to 3.7px past the cell. 101 itself (18.1px) fits.
     Arithmetic on the capture's measured widths, not a rendered read.
   Changing any of this is a decision, not a cleanup. */
const NARROW_COUNT = 'before:hidden @max-[14rem]:before:block before:content-[attr(data-count)] before:relative before:z-10 before:-mx-1 before:pointer-events-none before:font-bold before:text-content-primary before:whitespace-nowrap';
// One arm per digit count: 1, 2, 3 or more. Whole literals (Tailwind emits nothing for a built class name).
// Each arm: the size, then the start (the padding clamp: 0.71em a digit, 1px kept clear at the end).
const NARROW_COUNT_SIZE = [
  'before:text-xs before:pl-[clamp(0px,calc(100%_+_0.5rem_-_0.71em_-_1px),0.25rem)]',
  'before:text-[length:clamp(12px,calc((100cqw_-_1.5rem_-_21px)_/_9.94),0.75rem)] before:leading-4 before:pl-[clamp(0px,calc(100%_+_0.5rem_-_1.42em_-_1px),0.25rem)]',
  'before:text-[length:clamp(12px,calc((100cqw_-_1.5rem_-_21px)_/_14.91),0.75rem)] before:leading-4 before:pl-[clamp(0px,calc(100%_+_0.5rem_-_2.13em_-_1px),0.25rem)]',
];
// G1: the compact cell is the one-night overlay's positioning box, in a narrow grid only.
const NARROW_CELL = '@max-[14rem]:relative';
const NARROW_SOLO_TILE = '@max-[14rem]:absolute @max-[14rem]:inset-0 @max-[14rem]:bg-transparent! @max-[14rem]:border-0!';
const NARROW_DAY_NUMBER = '@max-[14rem]:text-[length:clamp(12px,calc((100cqw_-_3.25rem_-_21px)_/_8.4),0.75rem)]';

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
 * DECISION Phase 88.3-16: this is a MODULE-LEVEL helper taking the image flag
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
 * AMENDED Phase 88.9-28 (owner pick F7a, 88.9-PICKS-B5.json, 2026-11-06): the LIGHT
 * arm of an image tile drops the shadow and the stroke (title 6.46 light, page 5),
 * chosen OVER the shipped dark ink + 0.5px black stroke + 2px/4px black shadow that
 * read as an ink stain; the dark arm is byte-identical. The arm is a third ARGUMENT
 * ('dark' | 'light') from the two call sites, so this helper stays module-level and
 * argument-driven and the image flag still comes only from safeBgImageStyle.
 * AMENDED Phase 88.9-60 (X23a, owner pick page 10a, 2026-11-14): an image tile wears the photo set
 * in BOTH arms with no wash, chosen OVER F7a's dark ink on a 70% wash (it hid the photo, muddy in
 * dark) and OVER X23b's 1px outline; fill vs outline 21:1. The compact fork stands. The set is a
 * SPREAD of the one exported constant (colorUtils), never restated here, and since both arms are
 * the same the third argument F7a added is gone again.
 *
 * The flag is passed as `false` for the COMPACT variant at the call site
 * (`tileHasBgImage`), because that tile deliberately paints no background image —
 * see the "NO BACKGROUND IMAGE HERE" marker further down. Passing a truthy value
 * made a coloured group that ALSO has an image take the heavy image-tuned black
 * shadow over a pale t = 0.70 tint. REJECTED: reading `variant` inside the
 * helper — it is deliberately module-level and argument-driven (marker above),
 * so the variant fork belongs at the call site.
 *
 * AMENDED Phase 88.6-41 (W49 / D-20 (i)): the second parameter is now the
 * already-computed BOOLEAN `hasBgImage`, not the raw `background_image_url`
 * string. Everything above is a NAMING correction only — 88.3-16's
 * anti-memoization rejection and the call-site variant fork both stand
 * unamended. REJECTED: calling `safeBgImageStyle` inside this helper — it runs
 * `new URL()` twice per call and the helper runs twice per tile, so that would
 * turn 1 validation per tile into 3 on a deliberately-unmemoized loop, and it
 * would break `groupColourRendering.test.ts` test 29's `const F = !!X` /
 * `const X = safeBgImageStyle(…)` derivation scan. The cheap boolean already
 * exists at the call site.
 */
const tileTextTreatment = (tileGround, hasBgImage) => {
  if (hasBgImage) {
    // X23a (88.9-60): a picture tile wears the one photo text set, the same in both themes.
    return { ...PHOTO_TEXT_STYLE };
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
 *   - `days` is now {date: Date, isCurrentMonth: boolean}[] — whole weeks, 28, 35 or 42 cells (CS-05, 88.9-25).
 *   - Adjacent-month cells sit on the page ground with their day number muted; nothing in the cell is dimmed (AMENDED Phase 88.9-07, owner picks A4b + O4b; tile dim dropped at the plan review, 2.39 / 2.88 through .6)
 *     but their events use the same tile styling as current-month cells.
 *   - Whole-cell click invokes `onDayClick(date, dayEvents)` — the parent
 *     dispatcher (EventCalendar) decides between empty-day handler,
 *     event-detail navigation, or EventDayModal. Inner event-tile
 *     clicks still call `onEventClick(event)` and stopPropagation.
 *   - `+N more` is a non-button label; the cell click handles the modal (88.9-52 Q62: the compact grid prints `+N`).
 *   - `viewerDbUserId` (88.9-28 D5a): the caller's own Users.id UUID, used only to derive the
 *     guest cue on both tiles (isGuestEvent; the compact tile since 88.9-52 W14); never rendered or logged.
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
  viewerDbUserId = /** @type {string | null | undefined} */ (null),
  // 88.9-39 N1 (R2-45): the Month | List switch EventCalendar passes in; seated beside the Today pill.
  // The JSDoc cast types the prop (a bare null default narrows it to null for TS consumers, 88.9-28 precedent).
  viewSwitch = /** @type {import('react').ReactNode} */ (null),
}) {
  // X6 (88.9-60): the shared picture-load probe, called once here; each tile asks it in its flag.
  const bgImageFailed = useBgImageFailed();
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
          group-page render-tree files. Removing a ring here reds it.
          AMENDED Phase 88.9-28 (owner pick N1): the ring stays on all three controls; Go to Today is now the Today pill.
          AMENDED Phase 88.9-62 (X22, rings): the three controls no longer share one row — the chevrons sit on the month title's line and Today sits below the caption (owner pick C); every ring string above is unchanged. */}
      <div className="@container mb-4">
        {/* Phase 88.6-27: both `.btn btn-primary` nav controls take the primitive, and their
            per-site focus-ring strings retire with the migration — the ring lives ONCE in the
            primitive's cva base (A-2 ARM A, owner ruling 2026-09-15). The 88.3-17 marker above
            is byte-unchanged and still true of what the user sees; only WHERE the ring is
            expressed moved. The "Go to Today" text link between them is NOT a `.btn` and KEEPS
            its own string — it is not a member of the family that marker's ARM A covers.
            AMENDED Phase 88.9-28 (owner pick N1, 88.9-PICKS-B7A.json, 2026-11-07): the two nav
            controls are now secondary iconSquare Buttons (chevrons, names Previous month / Next
            month), chosen OVER the two primary text Buttons; the text link is now the Today pill
            and still keeps its own ring string. The chevron icon is decorative (Icon's default
            aria-hidden): the accessible name is the button's own aria-label, a labelled focusable
            leaf, which is what VoiceOver on iPhone reads. The title keeps Heading's base
            wrap-anywhere and no nowrap, so it is one line whenever it fits and can still wrap at
            enlarged text (WCAG 1.4.4).
            AMENDED Phase 88.9-62 (X22, owner pick C at N13, 2026-11-12, 88.9-RULINGS.md N13 month grid):
            the chevrons sit on the month title's line at the row's edges, with the time-zone caption and
            the Today + Month | List row below, chosen OVER A (the shipped layout: chevrons centred on the
            whole three-line block, level with the caption) and OVER B (chevrons in line with the buttons).
            Tab and reading order follow the picture: Previous month, Next month, Today, the switch.
            DECISION Phase 88.9-62 (X28, container query): the nav block is a size container and, under
            14rem of width (about 200% text on a 375 phone), the title takes its own line below the arrows,
            chosen OVER squeezing it between them, where a month name breaks mid-word (WCAG 1.4.4 asks for
            no loss of content; its Understanding text lets the layout change with the scale). 14rem = two
            2.75rem chevrons + two 0.5rem gaps + the widest month word (September, 6.9rem) + slack; rem in
            a container query follows the root font size. Changing the threshold or the layout is a
            decision, not a cleanup. */}
        <div className="flex flex-wrap items-center justify-between gap-2">
          <Button variant="secondary" size="iconSquare" aria-label="Previous month" onClick={() => onNavigateMonth(-1)}>
            <Icon name="ChevronLeft" size={20} />
          </Button>
          <Heading level={3} size="heading" className="text-content-primary min-w-0 flex-1 text-center @max-[14rem]:order-last @max-[14rem]:basis-full">
            {monthNames[currentDate.getMonth()]} {currentDate.getFullYear()}
          </Heading>
          <Button variant="secondary" size="iconSquare" aria-label="Next month" onClick={() => onNavigateMonth(1)}>
            <Icon name="ChevronRight" size={20} />
          </Button>
        </div>
        {tzLegend && (
          <p className="text-xs text-content-muted mt-0.5 text-center">
            Times shown in {tzLegend}
          </p>
        )}
        {/* 88.9-39 N1, moved by 88.9-62 (X22): Today and the Month | List switch share one centred wrapping row below the caption. */}
        <div className="flex flex-wrap items-center justify-center gap-2">
          <button
            onClick={onGoToday}
            className="mt-1 inline-flex items-center justify-center min-h-11 px-4 rounded-full border border-line bg-surface-card text-sm font-bold text-content-primary hover:bg-surface-hover focus:outline-hidden focus-visible:ring-2 focus-visible:ring-focus-ring focus-visible:ring-offset-2 focus-visible:ring-offset-surface-card"
          >
            Today
          </button>
          {viewSwitch}
        </div>
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
          `88.6-27-SUMMARY.md` rather than taken silently.
          AMENDED Phase 88.9-28 (owner pick C8a, votes-b2 v11, 2026-11-06): folded to 12/700 — ruled,
          chosen OVER the held 14/700; the compact grid at 375 moves with it (one element).
          AMENDED Phase 88.9-62 (X28, weekday letters): 12/700 stands; under 14rem of width (about 200%
          text at 375) each label shows its first letter only, and at every size each cell speaks its
          full day name.
          DECISION Phase 88.9-62 (X28, weekday letters): one letter per day at enlarged text, because
          Wed needs 1.70rem and a column there is under 1rem, chosen OVER labels that overlap (52-X28),
          OVER a grid wider than the card (sideways scroll) and OVER two-letter forms (Mo and We still
          overflow). At 100% the row is unchanged (Sun to Sat). Spoken name (owner ruling M29, Q4 A
          full, 2026-11-14): aria-label = the full day name and tabIndex -1 on the cell, both visible
          spans aria-hidden, the labelled focusable leaf of
          src/app/components/EventHeatmapBackground.js ("AMENDED quick-261020-tz3 (VO-P2-6"),
          chosen OVER bare letters (the owner's iPhone heard a one-letter header as cap S, Saturday and
          Sunday alike, Tuesday and Thursday alike, VO-P2-6) and OVER rebuilding the month as an ARIA
          table (a rebuild; the grid pattern is rejected for this view,
          this file ("The ARIA grid pattern (")); sr-only text stays rejected (VO-P2-4).
          Trade-offs, named: (1) the cell has no role, and ARIA 1.2 prohibits naming a generic:
          axe-core 4.12.1 reports aria-prohibited-attr on exactly this form (probed 2026-11-14), the
          form src/app/components/createEvent.js ("fails this dialog's axe") rejected;
          the month grid's only axe run,
          src/app/components/keyboardOperability.test.tsx ("it('DC-11b. axe agrees"),
          runs nested-interactive and aria-allowed-role only, so no gate catches it. A role was
          weighed: columnheader needs a row inside a grid or table (aria-required-parent), heading
          would add seven rotor headings, img passes axe but announces each day as an image and has no
          device measurement; desktop screen readers may not speak a name on a generic. (2) The iPhone
          result here is inferred (the chart header's owner re-check plus WebKit's Generic branch,
          research APPENDIX-AT AT-1), not measured on this element: an owner iPhone VoiceOver re-check
          after deploy is owed (88.9-53). Changing any of this is a decision, not a cleanup.
          AMENDED Phase 88.9-52 (A-11, code review): each header cell now carries role img, chosen OVER
          the role-less labelled generic above. The review's finding: a desktop screen reader reading
          the page (NVDA, JAWS) may speak nothing for a named generic, so the weekday row went silent
          there, and origin/main spoke it as plain text. With a role the name is allowed, so
          trade-off (1)'s axe aria-prohibited-attr report goes away. Everything else stands: the full
          day name in aria-label, tabIndex -1 (still the labelled focusable leaf of M29), both visible
          spans aria-hidden, no sr-only text. Known cost, as weighed above: a screen reader may say
          image after each day name; rejected again: columnheader (needs a row in a grid or table)
          and heading (seven rotor headings). The day target's name also starts with the weekday now
          (Friday, September 19, 2 games. Open this day.), chosen OVER the month-and-date-only name:
          it is the one place a keyboard or screen-reader user lands on a date. That covers active
          day targets only; a one-game day speaks through its tile and a plain date has no label.
          Not measured on any screen reader; the iPhone re-check owed above (88.9-53) now covers the
          img form. */}
      <div className="@container grid grid-cols-7 gap-1 mb-4">
        {dayNames.map(day => (
          <div key={day} role="img" aria-label={day} tabIndex={-1} className="text-center font-bold text-content-secondary py-2 text-xs">
            <span aria-hidden="true" className="@max-[14rem]:hidden">{day.slice(0, 3)}</span>
            <span aria-hidden="true" className="hidden @max-[14rem]:inline">{day[0]}</span>
          </div>
        ))}
      </div>

      {/* 88.9-52 (Q62): the day grid is a size container so the more label below can read its width. */}
      <div className="@container grid grid-cols-7 gap-1">
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

             AMENDED Phase 88.9-52 (R22 + R26): that tile is why a one-night day keeps its tile as
             a button when a narrow compact grid swaps tiles for a count (NARROW_COUNT at the top of
             this file); this gate is unchanged.

             The narrowing costs nothing — every 1-event day is already fully keyboard-operable
             through its tile — and it holds for every consumer: `<CalendarMonthView` has exactly
             one render site in `src/` (`EventCalendar.js`). This is a decision, not a cleanup. */
          const dayTargetActive = cellClickable && dayEvents.length !== 1;
          const dayNumberLabel = dayTargetActive
            ? `${dayNames[date.getDay()]}, ${monthNames?.[date.getMonth()] ?? ''} ${date.getDate()}`.trim() +
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
                 cleanup.

                 AMENDED Phase 88.9-07, re-amended Phase 88.9-28 (C3): the adjacent-month page
                 ground is a ternary ARM straight after the today arm, with the full-variant past
                 case as a sub-arm inside it, honouring this fence; no painting token is
                 stacked beside the chain.

                 AMENDED Phase 88.9-07 (#204): cursor-pointer joins group as a non-painting token allowed outside the arms, and only for the today and full-variant past cases (clickable cells whose arm carries no pointer); bg-*, border-*, hover:* and transition-colors stay in their arms, fenced as above.

                 AMENDED Phase 88.9-28: the arms stay mutually exclusive; the static run carries no
                 border token; each arm carries its own 1px width AND its own colour
                 (border-transparent, or the today frame's border-line-accent), chosen OVER a static
                 width with arm colours (a colourless width chunk; borderExplicitness test 1) and OVER
                 a PAIRED_ELSEWHERE exemption (a file-wide hole). The width in every arm keeps every
                 cell's box identical, so today's amber frame causes no 1px shift. */
              /* DECISION Phase 88.9-07 (owner picks A4b + O4b, 88.9-PICKS-A.json / 88.9-PICKS-O.json,
                 2026-10-31): adjacent-month cells take the page ground plus the muted day number
                 (5.04 light / 7.32 dark) as the not-this-month cue, chosen OVER the whole-cell
                 opacity-60 (2.69 / 3.13, under 4.5) and OVER A4a / A4c; one arm on every variant
                 (O4b: the full-grid per-variant arm was offered and declined). The arm sits straight
                 after the today arm and carries a full-variant past sub-arm (AMENDED Phase 88.9-28,
                 owner pick C3: it sat after the full-variant past arm until C3 gave that arm the
                 tile-past ground, which would have tiled past adjacent cells): a past adjacent cell on
                 the full grid keeps the no-hover past behaviour on the page ground, chosen OVER a flat
                 adjacency arm with no past fork, which would give leading-overflow past days with
                 events a hover ground no same-month past cell has.
                 The dim is removed from the whole cell, tiles included, chosen OVER dimming only the
                 events container — through a .6 ancestor the untinted compact tile text reads 2.39
                 light / 2.88 dark (wcag.ts, 2026-10-31) and light clears 4.5 only at >= 0.98
                 opacity; the tiles are role=button controls, so WCAG 1.4.3 applies to them. The
                 empty-day + hint keeps its hover-only reveal (DECISION Phase 87.8-12 R10): the pick
                 capture showed it at rest only because the injected CSS overrode its opacity-0 —
                 unchanged: no owner ruling on the adjacent-cell + hint is recorded in 88.9-UI-SPEC.md
                 (read 2026-11-02), so the default (leave the hint byte-unchanged) shipped. With the
                 cell dim gone, the hover/focus + reveal on adjacent cells is 0.40, the same as
                 current-month cells (it was 0.24 through the old cell dim, 0.40 x 0.60); disclosed
                 to the owner through the plan 88.9-16 UAT. Changing this is a decision, not a
                 cleanup.
                 AMENDED Phase 88.9-28 (owner pick C3, 88.9-PICKS-B7A.json, 2026-11-07): this month's
                 cells are soft tiles (bg-surface-tile, past bg-surface-tile-past) with radius 6px and
                 no outline; adjacent cells — leading and trailing — stay untiled on the page ground
                 (the A4b reading), chosen OVER the shipped 1px line outline on a card-white cell. */
              /* #204 (register, routed to the plan that next touches this file, 88.9-07): the today and full-variant past arms precede the clickable arm, so a clickable today or past cell never got the pointer; added here, no look change. */
              className={`group ${variant === 'compact' ? 'min-h-[80px]' : 'min-h-[100px]'} rounded-md p-1 ${variant === 'compact' ? `flex flex-col ${NARROW_CELL}` : ''} ${
                cellClickable && (isCurrentDay || (variant === 'full' && isPastDate)) ? 'cursor-pointer ' : ''
              }${
                !date ? 'bg-surface-page border border-transparent' :
                isCurrentDay ? 'bg-surface-muted border border-line-accent' :
                isAdjacent ? (
                  variant === 'full' && isPastDate ? 'bg-surface-page border border-transparent' :
                  cellClickable ? 'bg-surface-page border border-transparent hover:bg-surface-hover hover:border-line-accent cursor-pointer transition-colors' :
                  'bg-surface-page border border-transparent'
                ) :
                variant === 'full' && isPastDate ? 'bg-surface-tile-past border border-transparent' :
                cellClickable ? 'bg-surface-tile border border-transparent hover:bg-surface-hover hover:border-line-accent cursor-pointer transition-colors' :
                'bg-surface-tile border border-transparent'
              }`}
            >
              {date && (
                <>
                  {/* UI-SPEC §4.5, the EMPHASIS outcome (400 + a colour token): the 500 is
                     deleted rather than promoted, because this element ALREADY forks its colour
                     four ways for exactly the hierarchy the weight was carrying — accent for
                     today, muted for an adjacent-month or past date, primary otherwise — and
                     today's cell additionally has its own ground and accent border. Promoting to
                     700 instead would bold every day number in the grid and flatten that fork
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
                       is reached (isAdjacent selects the page-ground arm, which comes straight AFTER the today arm and holds the full-variant past case inside it — 88.9 A4b, reordered by 88.9-28 C3), and `getDaysInMonth`
                       returns whole weeks (28, 35 or 42 cells; AMENDED Phase 88.9-25 CS-05 — the count only, the per-grid invariant below is unchanged) including any adjacent-month days — so a grid whose OVERFLOW
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
                    className={`${variant === 'compact' ? `text-xs ${NARROW_DAY_NUMBER}` : 'text-sm'} mb-1 ${
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
                    /* 88.9-52 (R22 + R26): the compact events box carries the day's night count for a narrow grid; see NARROW_COUNT at the top of this file. */
                    <div
                      data-count={variant === 'compact' ? dayEvents.length : undefined}
                      className={variant === 'compact' ? `space-y-0.5 ${NARROW_COUNT} ${NARROW_COUNT_SIZE[Math.min(String(dayEvents.length).length, 3) - 1]}` : 'space-y-1'}
                    >
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
                         * DECISION Phase 88.6-41 (W49 / FSEC-03), replacing the
                         * 88.3.1 plan-09 two-flag marker that stood here and whose
                         * REJECTED arm ("converging `tileBgImage` onto the validated
                         * style … converge all of them in one pass with a rendered
                         * check") this plan DISCHARGED. History kept, because the
                         * reasoning that made two flags correct in 88.3.1 is the
                         * record of why the divergence shipped:
                         *
                         * WHY TWO, THEN. `safeBgImageStyle` drops relative/invalid
                         * URLs (FSEC-03), so a truthy-but-rejected URL paints NO
                         * image: that tile IS a plain coloured tile and must get its
                         * ink. Feeding `groupInkVars` the RAW URL would withhold the
                         * ink from exactly those tiles. 88.3.1 fixed the ink half and
                         * deliberately left the TEXT-TREATMENT half raw, because
                         * converging it changes what an invalid-URL tile paints and
                         * that plan was not scoped to re-look at the surface.
                         *
                         * WHY ONE, NOW. This file is the fourth of a five-file family
                         * (`grouplist.js` was already right, and is the reference);
                         * all five now derive the flag from the VALIDATED style, and
                         * the paired raw-URL consumers — the `rgba(255,255,255,0.7)`
                         * overlay below and `tileTextTreatment`'s branch — converged
                         * in the SAME commit, because a treatment converged without
                         * its wash is white text under a still-raw white wash. The
                         * rendered invalid-URL check the old marker demanded is in
                         * `CalendarMonthView.test.tsx` and its three siblings, and the
                         * source-scan that keeps this from silently regressing is
                         * `groupColourRendering.test.ts` test 31 — the raw identifier
                         * may appear TWICE in this file and no more: its own `const`
                         * and the `safeBgImageStyle(` argument.
                         * REJECTED: keeping the raw flag for the text treatment "so
                         * the pixels do not move". The pixels moving IS the fix; a
                         * treatment computed for an image the renderer refused to
                         * apply is the defect. A decision, not a cleanup.
                         *
                         * AMENDED Phase 88.9-60 (X6, owner F1): also false when the picture fails to load (src/lib/hooks/useBgImageFailed.ts); derivation unchanged.
                         */
                        const bgImageStyle = safeBgImageStyle(groupBgImage);
                        const hasValidBgImage = !!bgImageStyle && !bgImageFailed(bgImageStyle);
                        // CR-01 (88.3-cr): the COMPACT tile renders no image, so
                        // it must not take the image-tuned text treatment either.
                        // AMENDED Phase 88.6-41 (W49): the fork now carries the
                        // BOOLEAN (and is named for it) instead of the raw URL. The
                        // FORK ITSELF SURVIVES — dropping it would hand the compact
                        // arm the full tile's flag and reinstate the image-tuned
                        // shadow + stroke over a pale t = 0.70 tint, which is exactly
                        // the regression CR-01 fixed, and nothing in the tree pins it.
                        // REJECTED: `variant === 'compact' ? false : hasValidBgImage`
                        // at the `groupInkVars` argument below — see the marker there;
                        // same expression, different site, different consequence.
                        const tileHasBgImage = variant === 'compact' ? false : hasValidBgImage;
                        /*
                         * DECISION Phase 88.6-41 (W51 item B) — TWO repeated
                         * per-tile costs, ACCEPTED with their magnitude recorded,
                         * in ONE note so they can never later read as two
                         * different measurements of the same loop.
                         *
                         * THE UNIT is the shipped marker's: this loop is bounded
                         * at 84 TILES per render (up to two event tiles across the
                         * ~42 day cells of a month), stated at the module-level
                         * `DECISION Phase 88.3-16` marker. The W51 register says
                         * "~42 tiles per month"; that is the SAME loop counted per
                         * DAY CELL rather than per tile. Any per-render total below
                         * is ARITHMETIC from the tile bound, never a measurement.
                         *
                         * (1) `getEventTileTextColor` is computed on the dark ground
                         *     and on the light tint TWICE — once in `tileTextVars`
                         *     below, once again inside `groupInkVars`'s tile arm.
                         *     Magnitude: 2 extra brightness computations per
                         *     COLOURED tile.
                         * (2) `safeBgImageStyle(groupBgImage)` above runs `new URL()`
                         *     twice per successful call (`safeBgImageStyle.ts:43-44`,
                         *     one ternary arm, and again at `:71`). Its INPUT is
                         *     per-GROUP (`event.Group?.background_image_url`) while it
                         *     is RECOMPUTED per-EVENT on this loop — that asymmetry
                         *     is the whole shape of the cost.
                         *
                         * ACTING ON EITHER IS OUT OF SCOPE THIS PHASE, and recording a
                         * magnitude is not licence to act on it.
                         * REJECTED for (1): stopping the tile emitters being called at
                         * all. `groupColourRendering.test.ts` test 9 requires ground and
                         * ink to turn on and off together, and `surface: 'tile'` must
                         * keep a real production caller; deleting one is what the
                         * `calls >= 6` floors exist to catch (T-88.6-123).
                         * REJECTED for (1): a cache or an optional precomputed-ink
                         * parameter — a mechanism with no problem behind it, to save
                         * three arithmetic operations.
                         * REJECTED for (2): hoisting or caching the validation. Test 29
                         * pins the literal `const F = !!X` / `const X =
                         * safeBgImageStyle(…)` derivation chain, so either reds it.
                         * REJECTED for both: `useMemo`/`useCallback`/`React.memo`, twice
                         * ruled on already — the module-level `DECISION Phase 88.3-16`
                         * marker and its `AMENDED Phase 88.3.1 (plan 09, M26)`
                         * restatement, which stand unamended: `days` and `activeEvents`
                         * change identity on every parent render, so a `useMemo` would
                         * recompute every time and cost strictly more than it saves.
                         */
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
                        /*
                         * DECISION Phase 88.9-60 (X23a, owner pick page 10a, 2026-11-14): on a
                         * PICTURE tile the ground-derived colour below is withheld, past or not,
                         * so the photo set's white stands, chosen OVER letting the past-date or
                         * tile pole override it (a muted or dark ink under a 2px black outline
                         * fails the fill-vs-outline rule and reads as a different treatment from
                         * the card and header). The past cue stays on the cell and its day number.
                         * Every other tile computes its colour exactly as before.
                         */
                        const tileTextVars = themedTextStyleVars(
                          {
                            ...tileTextTreatment(ground, tileHasBgImage),
                            ...(!tileHasBgImage && {
                              color: isPastDate
                                ? (tinted
                                    ? (isDarkBackground(ground) ? SUBTEXT_MUTED_ON_DARK : SUBTEXT_MUTED_ON_LIGHT)
                                    : 'var(--color-content-muted)')
                                : getEventTileTextColor(ground),
                            }),
                          },
                          {
                            ...tileTextTreatment(tinted, tileHasBgImage),
                            ...(!tileHasBgImage && {
                              color: isPastDate
                                ? (tinted
                                    ? (isDarkBackground(tinted) ? SUBTEXT_MUTED_ON_DARK : SUBTEXT_MUTED_ON_LIGHT)
                                    : 'var(--color-content-muted)')
                                : getEventTileTextColor(tinted),
                            }),
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
                          // `aria-label={tileLabel}` copied verbatim would have
                          // SILENCED the compact RsvpCount chip that used to render
                          // below ("3Y 1M 2N") for every screen-reader user — on the
                          // group page, the surface the owner tests on a phone. Built
                          // tile-locally from the same `rs`. Since 88.9-28 E1a the
                          // chip is gone and this label is the ONLY place the count
                          // lives on the compact tile: it stays heard, never seen.
                          const rsvpLabel = hasRsvps && isFutureEvent
                            ? `, ${rs.yes || 0} going, ${rs.maybe || 0} maybe, ${rs.no || 0} can't`
                            : '';
                          // 88.9-52 W14: ONE guest read feeds the edge arm and the name, as on the full tile below.
                          const compactGuest = isGuestEvent(event, viewerDbUserId);
                          const compactName = compactGuest ? `${tileLabel}, Guest` : tileLabel;
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
                               the TEXT treatment: this tile passes `tileHasBgImage` (`false` in the
                               compact variant — `null` until 88.6-41 moved the fork onto the
                               validated boolean), so the image-tuned black shadow can no longer
                               land on a pale t = 0.70 tint just because the group also has a photo.

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

                               AMENDED Phase 88.9-28 (owner pick E1a, 88.9-PICKS-B4.json, 2026-11-06):
                               the compact tile no longer renders the RSVP count chip (it never
                               fitted the 375 cell); the count stays in the tile's accessible name,
                               chosen OVER also dropping the spoken count, which the owner was not
                               shown. The title is now this wrapper's only child; the colour fork
                               stays on the wrapper.

                               AMENDED Phase 88.9-52 (W14, owner 2026-11-16, 88.9-RULINGS.md after-build look
                               page: the tile is too small to read anything; "If the dashed line is visible, it
                               might work. So lets try to add that."): a guest night's compact tile takes the full
                               tile's dashed edge, the one literal in
                               src/app/components/GuestPill.tsx ("export const GUEST_ROW_EDGE"), and the same
                               word in its name (', Guest', before the RSVP counts), chosen OVER the 88.9-28 D5a
                               reading (full tile only, the phone cue is the sheet row). It is a TRY: the owner
                               judges the 375 picture. Only the guest tile carries a border, chosen OVER a
                               transparent 1px border on every compact tile: that would take 2px from every
                               tile's 28px text box at 375 to keep a 1px text shift off the guest tile.
                               Edge against the tile's own fill, wcag.ts formula on the token values: light
                               3.34 (untinted) to 3.74; dark 3.23 (green) to 4.18. Not rendered.
                               AMENDED Phase 88.9-52 (W14 follow-up): the compact tile's dark edge is amber-500 at
                               full strength, its own literal, since S-B3 in GuestPill.tsx, OVER the
                               full tile's 70%; the dark numbers in the lines above are superseded by the marker there.
                               AMENDED Phase 88.9-52 (S-B1): the tinted arm's 90% fade moved OUT of the ground
                               ternary into the last expression of this className, so a guest tile can take the
                               solid-edge hover instead (src/app/components/GuestPill.tsx ("export const GUEST_TILE_HOVER"), the numbers are
                               there). The paragraph above about hover being forked inside the ternary still
                               holds for the part that mattered: the untinted FILL hover stays inside it, and a
                               tinted member tile still fades to 90% exactly as before.

                               AMENDED Phase 88.9-52 (R22 + R26, owner 2026-11-17, pick C): under 14rem of grid
                               width this tile gives way to the day's count. On a day with several nights it is
                               hidden; on a one-night day it stays as a clear overlay on the count with this
                               same name and these same handlers, chosen OVER hiding it (that day has no other
                               button). The choice and the rejected forms are at NARROW_COUNT at the top of
                               this file. The W14 dashed guest edge therefore shows above the threshold only.
                               AMENDED Phase 88.9-52 (G1, round 4): the overlay sizes to the day's CELL (the
                               cell is the positioning box in a narrow grid), not to the count's box.

                               Any of this is a decision, not a cleanup. */
                            <div
                              key={event.id}
                              role="button"
                              tabIndex={0}
                              aria-label={compactName + rsvpLabel}
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
                              className={`min-h-6 text-xs p-0.5 rounded-sm font-bold cursor-pointer transition-[background-color,opacity] focus:outline-hidden focus-visible:ring-2 focus-visible:ring-focus-ring focus-visible:ring-inset ${tinted ? 'bg-[var(--group-ground-light)] dark:bg-[var(--group-ground)]' : 'bg-surface-muted hover:bg-surface-elevated'} ${tinted ? '[color:var(--t-color-l)] dark:[color:var(--t-color)]' : 'text-content-accent'}${compactGuest ? ` ${GUEST_TILE_EDGE} ${GUEST_TILE_HOVER}` : tinted ? ' hover:opacity-90' : ''} ${dayEvents.length === 1 ? NARROW_SOLO_TILE : '@max-[14rem]:hidden'}`}
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
                                 *   `getEventTileTextColor` non-past  6.44-6.50:1 light (10.84-10.94 since 88.9-60 X24: the dark pole)
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
                              <div className={dayEvents.length === 1 ? 'truncate @max-[14rem]:hidden' : 'truncate'}>{event.Game?.name || 'Game Night'}</div>
                            </div>
                          );
                        }

                        // Full variant (user-home)
                        // 88.9-28 D5a: ONE guest read feeds both the border arm and the
                        // accessible name below, never two calls.
                        const guest = isGuestEvent(event, viewerDbUserId);
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
                            aria-label={guest ? `${tileLabel}, Guest` : tileLabel}
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
                            /* DECISION Phase 88.9-28 D5a/O18a (owner pick D5a, votes-b3b v4; O18a re-picked by Q1,
                               88.9-RULINGS.md round 2): a 1px dashed amber-700 #b45309 edge in light (4.0478 on the
                               C3 tile #ebe6e0) and amber-500 #f59e0b at 70% in dark, chosen OVER the picked amber-600
                               (2.5680 on the C3 tile, under the 3:1 non-text floor — the edge is the ONLY visual guest
                               cue on the grid) and OVER a 2px amber-600 edge; full tile only, the phone cue is the
                               sheet row; the guest state is also in the tile's accessible name (', Guest' — the shipped
                               Guest pill's word, chosen OVER minting a phrase; owner-confirmed 2026-11-08, R-W2).
                               DECISION Phase 88.9-28 D5a/O18a (border mechanism): the tile's border moved from the
                               inline style into one class arm, chosen OVER leaving it inline and adding classes (the
                               inline key wins and the edge never paints) and OVER omitting the inline key only for
                               guests (one property, two mechanisms); the rgba values are kept byte-equal, not
                               re-tokenised — that would be a look change. Literal class strings only: Tailwind v4
                               emits nothing for an interpolated class.
                               AMENDED Phase 88.9-63 (X27): the list rows share this edge; the literal lives once in
                               GuestPill.tsx; values and measurements above unchanged.
                               AMENDED Phase 88.9-52 (W14 follow-up 2, a floor): in DARK this tile's edge is amber-500
                               at FULL strength, OVER the ruled 70%: a blue-tinted tile in today's cell or a hovered
                               cell measured 2.9844 on its outer side, under the 3:1 floor this marker holds the edge
                               to. The tile reads the month tiles' own literal at the top of this file (its marker
                               has the numbers); the list rows keep the 70% export. Light is unchanged.
                               AMENDED Phase 88.9-52 (S-B3): that literal and its marker moved to GuestPill.tsx,
                               beside the rows' export (src/app/components/GuestPill.tsx ("export const GUEST_TILE_EDGE")).
                               AMENDED Phase 88.9-52 (S-B1): a guest tile's hover is the solid edge, not the 90%
                               fade (src/app/components/GuestPill.tsx ("export const GUEST_TILE_HOVER")); a member tile keeps the fade. */
                            className={`text-xs p-1 rounded-sm truncate ${guest ? GUEST_TILE_HOVER : 'hover:opacity-90'} transition-opacity flex items-center gap-1 cursor-pointer focus:outline-hidden focus-visible:ring-2 focus-visible:ring-focus-ring focus-visible:ring-inset [color:var(--t-color-l)] dark:[color:var(--t-color)] ${tinted ? 'bg-[var(--group-ground-light)] dark:bg-[var(--group-ground)]' : ''} ${guest ? GUEST_TILE_EDGE : isPastDate ? 'border border-[rgba(0,0,0,0.1)]' : 'border border-[rgba(0,0,0,0.2)]'}`}
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
                               * is accepted rather than fixed. `tileHasBgImage` is `false` when
                               * `variant === 'compact'` (the compact tile paints no image;
                               * spelled `null` until 88.6-41 renamed the local and moved it
                               * onto the boolean — a naming change, not a behaviour change),
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
                               * ternary on the flag itself reds it.
                               *
                               * AMENDED Phase 88.6-41 (W49): the five-site
                               * `hasBackgroundImage` convergence LANDED — all five files now
                               * derive the flag from the validated `safeBgImageStyle` output
                               * and their paired washes/scrims converged with it. The closing
                               * sentence that used to sit here ("Resolve this together with the
                               * five-site convergence … not before") is DISCHARGED and struck.
                               * Everything above it is UNCHANGED and STILL ACCEPTED: the
                               * convergence changed `tileTextTreatment`'s parameter and the
                               * overlay gate, and it moved the compact fork onto the boolean,
                               * but it did NOT touch THIS `groupInkVars` argument — so the
                               * compact-variant caveat, its permanently-zero impact argument
                               * and the REJECTED alternative above all still hold, for the same
                               * reasons. The compact fork at the tile locals above now carries
                               * `variant === 'compact' ? false : hasValidBgImage`; that is a
                               * DIFFERENT SITE feeding `tileTextTreatment`, where the result is
                               * consumed. Changing it did not license changing this one, and
                               * keeping this one does not block that one.
                               */
                              ...groupInkVars(tileGroundPair, {
                                surface: 'tile',
                                hasBackgroundImage: hasValidBgImage,
                              }),
                              ...tileTextVars,
                              ...(hasValidBgImage ? bgImageStyle : null),
                              backgroundSize: 'cover',
                              backgroundPosition: 'center',
                              position: 'relative',
                              zIndex: 1,
                            }}
                            title={tileLabel}
                          >
                            {/* AMENDED Phase 88.6-41 (W49 / D-20 (i)): gated on the
                                VALIDATED flag, not the raw URL. An invalid URL paints
                                no image, so washing that tile at 70% white dulled a
                                plain coloured tile for nothing — and paired with the
                                converged text treatment above it is the white-on-white
                                case. The two convert together, never separately.
                                AMENDED Phase 88.9-60 (X23a): the 70% white wash that sat here
                                is GONE, together with the dark-ink treatment it rescued — the
                                pair changed as one, as the line above requires. A picture tile
                                shows its photo unwashed under the photo text set. Re-adding a
                                wash is a decision, not a cleanup. */}
                            <div className="flex items-center gap-1 relative z-10 flex-1 min-w-0">
                              {groupProfilePic && (
                                <span className="shrink-0 text-xs leading-none">
                                  {groupProfilePic.startsWith('http') || groupProfilePic.startsWith('/') ? (
                                    <SafeImage
                                      src={groupProfilePic}
                                      alt={event.Group?.name || ''}
                                      fallbackIcon="👥"
                                      // 88.9-CR d1: 12px glyph, matching the wrapper span, so the
                                      // dead-URL fallback stays inside this 16px box.
                                      fallbackIconClassName="text-xs leading-none"
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
                                className="truncate font-bold [text-shadow:var(--t-shadow-l)] dark:[text-shadow:var(--t-shadow)] [-webkit-text-stroke:var(--t-stroke-l)] dark:[-webkit-text-stroke:var(--t-stroke)] [paint-order:var(--t-paint-l,normal)] dark:[paint-order:var(--t-paint,normal)] [letter-spacing:var(--t-track-l,normal)] dark:[letter-spacing:var(--t-track,normal)]"
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
                             Caption 12 (§4.2).
                             DECISION Phase 88.9-52 (Q62, owner ruling A, 2026-11-16, 88.9-RULINGS.md after-build
                             look page): the compact grid prints the count alone (+1), chosen OVER +1 more cut off
                             at the column edge (B) and OVER letting it wrap (C, the shipped look: two lines at 375,
                             and at 200% text a 60px word in a 31px column, 15px past the card on Saturdays).
                             One line always (whitespace-nowrap). Under 14rem of grid width (about 200% text at 375)
                             the compact label also starts at the cell edge (-mx-1): a column there is narrower than
                             the count, and the pull keeps +99 clear of the next day's number. ARITHMETIC, not a
                             rendered read (glyph widths scaled from the 2026-11-16 capture): +1 / +9 / +10 / +99 are
                             about 11 / 15 / 20 / 22px at 100% in a 32px cell box, and 23 / 29 / 39 / 44px at 200% in
                             a 30.7px column, where +99 ends 14.5px past its cell, 2.5px short of the next day's
                             number and inside the card's 24px padding on a Saturday; without the pull it would
                             overlap that number by 5.5px.
                             AMENDED Phase 88.9-52 (S-B2, scoped check): the sentence above measured the wrong
                             neighbour. The next day's number sits in the TOP row of its cell and this label
                             in a lower row, so the two never meet; what the overflow meets is the next CELL.
                             Same widths, at 200% (8px gap, 1px border, 8px padding): +10 ends 9.4px past its
                             cell, 1.4px into the next cell; +99 ends 14.5px past, 6.5px into the next cell
                             (and still 7.6px / 2.5px short of where that cell's number column starts). A
                             plain label paints UNDER the next cell's opaque ground (grid items paint in
                             source order), so those 1.4px / 6.5px of the last digit were covered. The compact
                             label is now relative z-10, the form the full tile's contents use, chosen OVER
                             leaving the digit clipped; it stays pointer-events-none, so the lift takes no tap
                             from the next cell. Saturdays have no next cell. NOT FIXED, recorded: when the
                             next day ALSO has three or more games its own label starts 1px inside its cell,
                             so +99 overprints the first 5.5px of it (+10: 0.4px); that needs a day with 12
                             or more games beside a day with 3 or more, at 200% text. Paint order cannot be
                             pinned in jsdom; only the classes are (Q62 test). Not rendered.
                             The full grid keeps the word and drops it only under 32rem of grid width (W18: at 768 the
                             Home month column is as narrow as a phone's and +1 more wrapped), chosen OVER +N everywhere
                             (the ruling names the small calendar only).
                             Spoken name: the ruling's words, N more event(s), from a labelled leaf in the weekday
                             header's form (role img, aria-label, tabIndex -1, printed text aria-hidden), chosen OVER
                             leaving the bare text, which reads as plus 1. Before this the label had no spoken name
                             of its own. Not measured on a device. Changing any of this is a decision, not a cleanup.
                             AMENDED Phase 88.9-52 (R22 + R26, owner 2026-11-17, pick C): under 14rem of grid width
                             the compact label is HIDDEN; the day's one count stands in for the tiles and for it
                             (NARROW_COUNT at the top of this file), chosen OVER the label as built, where
                             capture g measured +10 running 2.3px over +99 and +99 4.5px over +2 at 200% text
                             (worse than the S-B2 arithmetic above; the NOT FIXED case there is closed by this).
                             So the -mx-1 pull and the S-B2 lift no longer show anywhere under the threshold;
                             both classes stay, the lift by instruction, and above 14rem the label, its
                             one line and its spoken name are exactly as Q62 ruled. */
                          role="img"
                          aria-label={`${dayEvents.length - 2} more ${dayEvents.length - 2 === 1 ? 'event' : 'events'}`}
                          tabIndex={-1}
                          className={variant === 'compact'
                            ? 'relative z-10 text-xs text-content-secondary pointer-events-none select-none whitespace-nowrap @max-[14rem]:-mx-1 @max-[14rem]:hidden'
                            : 'text-xs text-content-secondary pointer-events-none select-none whitespace-nowrap'}
                          title={`Tap the day to see all ${dayEvents.length} games`}
                        >
                          <span aria-hidden="true">
                            +{dayEvents.length - 2}
                            {variant === 'compact' ? null : <span className="@max-[32rem]:hidden"> more</span>}
                          </span>
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
