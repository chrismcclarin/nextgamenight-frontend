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
      {/* Month Navigation */}
      <div className="flex justify-between items-center mb-4">
        <button
          onClick={() => onNavigateMonth(-1)}
          className="btn btn-primary"
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
            className="text-sm text-content-link hover:text-content-link-hover mt-1"
          >
            Go to Today
          </button>
        </div>
        <button
          onClick={() => onNavigateMonth(1)}
          className="btn btn-primary"
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
                        if (variant === 'compact') {
                          const rs = event.rsvp_summary;
                          const hasRsvps = rs && (rs.yes > 0 || rs.maybe > 0 || rs.no > 0);
                          const isFutureEvent = event.start_date && new Date(event.start_date) >= new Date();
                          return (
                            <div
                              key={event.id}
                              className="text-xs p-0.5 bg-surface-card-hover text-content-accent rounded-sm font-medium cursor-pointer hover:bg-surface-elevated transition-colors"
                              onClick={(e) => {
                                e.stopPropagation();
                                onEventClick(event);
                              }}
                            >
                              <div className="truncate">{event.Game?.name || 'Game Night'}</div>
                              {hasRsvps && isFutureEvent && (
                                <RsvpCount rsvpSummary={rs} variant="compact" className="text-[10px] leading-tight mt-0.5" />
                              )}
                            </div>
                          );
                        }
                        // Full variant (user-home)
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
                        /*
                         * DECISION Phase 88.3 (R2-6): the past-date colour now
                         * THEME-FORKS. It used to resolve `SUBTEXT_MUTED_ON_LIGHT`
                         * in BOTH themes whenever the tile had a group colour —
                         * theme-independent by construction. That was already
                         * wrong on a dark ground and became unreadable once this
                         * phase re-pointed that pole to `#374151` (~1.4:1 on
                         * navy), so the dark half takes `SUBTEXT_MUTED_ON_DARK`
                         * and the light half keeps the (now darker) light pole,
                         * measured 5.35-5.65:1 on the tints.
                         * REJECTED: one theme-independent pole, and a `useTheme`
                         * read — the fork rides the same custom-property +
                         * `dark:` mechanism as the ground, per the shipped
                         * DECISION at EventScheduler.tsx. A decision, not a cleanup.
                         */
                        const tileTextTreatment = (tileGround) => {
                          if (groupBgImage) {
                            return {
                              textShadow: '2px 2px 4px rgba(0, 0, 0, 0.9), -1px -1px 2px rgba(0, 0, 0, 0.9)',
                              WebkitTextStroke: groupBgImage,
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
                        const tileTextVars = themedTextStyleVars(
                          {
                            ...tileTextTreatment(groupBgColor),
                            color: isPastDate
                              ? (groupBgColor ? SUBTEXT_MUTED_ON_DARK : 'var(--color-content-muted)')
                              : getEventTileTextColor(groupBgColor),
                          },
                          {
                            ...tileTextTreatment(tinted || groupBgColor),
                            color: isPastDate
                              ? (groupBgColor ? SUBTEXT_MUTED_ON_LIGHT : 'var(--color-content-muted)')
                              : getEventTileTextColor(tinted || groupBgColor),
                          },
                        );
                        const tileLabel = `${event.Game?.name || 'Game Night'} - ${event.Group?.name || 'Group'}`;

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
