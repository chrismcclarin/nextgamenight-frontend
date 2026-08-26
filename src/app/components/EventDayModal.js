'use client';
import { useState } from 'react';
import {
  getSubtitleStyle,
  getTextStyle,
  isDarkBackground,
  lightTintGroupBackgroundColor,
  resolveGroupBackgroundColor,
  themedTextStyleVars,
  SUBTEXT_MUTED_ON_LIGHT,
  SUBTEXT_ON_LIGHT,
  TEXT_ON_DARK,
  TEXT_ON_LIGHT,
} from '../../lib/colorUtils';
import { safeBgImageStyle } from '../../lib/safeBgImageStyle';
import { formatTime, formatLongDate } from '../../lib/datetime';
import { useTimezone } from '../components/TimezoneProvider';
import SafeImage from './SafeImage';
import QRCodeModal from './QRCodeModal';
import TimezoneNudgeBanner from './TimezoneNudgeBanner';
import { eventsAPI } from '../../lib/api';
import { Modal } from './Modal';

export default function EventDayModal({
  selectedDay,
  onClose,
  onEventClick,
  onCreateEventOnDay = null, // CAL-04: optional "+ New event on this day" callback
}) {
  const { timezone } = useTimezone();
  const [showGameQR, setShowGameQR] = useState(false);
  const [gameInviteUrl, setGameInviteUrl] = useState('');
  const [gameQRLoading, setGameQRLoading] = useState(false);
  const [qrEventId, setQrEventId] = useState(null);

  if (!selectedDay) return null;

  const handleShowGameQR = async (e, event) => {
    e.stopPropagation(); // Prevent navigating to event detail
    setGameQRLoading(true);
    setQrEventId(event.id);
    try {
      const data = await eventsAPI.getEventInviteToken(event.id);
      setGameInviteUrl(data.invite_url);
      setShowGameQR(true);
    } catch (err) {
      console.error('Failed to get game invite token:', err);
    } finally {
      setGameQRLoading(false);
      setQrEventId(null);
    }
  };

  return (
    <>
      {/* DECISION Phase 88-17 (Req 9): hosted on the shared <Modal> — the
          hand-rolled backdrop, the `onClick={onClose}` / `stopPropagation` pair
          and the untitled close glyph are GONE rather than ported. The glyph
          carried only `title="Close"`, which is not an accessible name; the
          header close affordance <Modal> supplies carries a real `aria-label`
          (SPEC Req 4). The 80vh cap is deliberately preserved via className
          (the primitive's default is 90vh) — this surface is a scrolling day
          list and its shorter cap is a shipped choice, not a leftover.

          QRCodeModal moves OUT of the overlay to a SIBLING of <Modal>. It used
          to live inside the backdrop div; nesting one Radix dialog inside
          another's content would put the QR dialog inside this dialog's focus
          scope. As siblings, each portals to <body> in mount order and the QR
          dialog layers above the day list, which is the shipped behaviour.
          Re-nesting it is a decision, not a cleanup. */}
      <Modal open onClose={onClose} className="max-w-2xl max-h-[80vh]">
        <Modal.Header>{formatLongDate(selectedDay.date)}</Modal.Header>
        <Modal.Body>
          {/* Phase 62-02: nudge user to set profile TZ if not yet set so the
              displayed times below have a stable canonical reference. */}
          <TimezoneNudgeBanner />
          {/* CAL-04: "+ New event on this day" — only rendered when the
              parent surface supplies a creation callback (group calendar).
              On the home calendar onCreateEventOnDay is null and the
              affordance stays hidden. */}
          {onCreateEventOnDay && (
            <div className="mb-4">
              <button
                type="button"
                onClick={() => onCreateEventOnDay(selectedDay.date)}
                className="btn btn-primary w-full sm:w-auto"
              >
                + New event on this day
              </button>
            </div>
          )}
          {selectedDay.events.length === 0 ? (
            <p className="text-content-secondary text-center py-8">No events on this day.</p>
          ) : (
            <div className="space-y-3">
              {selectedDay.events.map(event => {
                const eventDate = new Date(event.start_date);
                const isPastEvent = eventDate < new Date();
                // null when the group has no colour of its own (D-28).
                const groupBgColor = resolveGroupBackgroundColor(event.Group?.background_color);
                const groupProfilePic = event.Group?.profile_picture_url;
                const groupBgImage = event.Group?.background_image_url;
                // No image and no group colour: the row is on the themed
                // surface, so the shared fallback resolution owns its text.
                const isThemedRow = !groupBgImage && !groupBgColor;
                /*
                 * DECISION Phase 88.3 (D-09, cascade fix): the row's ground is a
                 * MUTUALLY EXCLUSIVE ternary gated on `tinted`, chosen OVER
                 * stacking the tint pair beside the always-present
                 * `bg-surface-card`. Compile-verified on this tree's
                 * tailwindcss@4.3.3: `.bg-[var(--group-ground-light)]` emits at
                 * line 1426, `.bg-surface-card` at 1543,
                 * `.dark:bg-[var(--group-ground)]` at 2894 — same property,
                 * same specificity, source order wins, so a stacked className
                 * paints the white card surface over the tint in light mode.
                 * ALSO REJECTED: gating on `groupBgColor` alone; `ground` is
                 * gated on the TINT succeeding so both custom properties turn
                 * on or off together (T-88.3-43). A decision, not a cleanup.
                 */
                const tinted = lightTintGroupBackgroundColor(groupBgColor);
                const ground = tinted ? groupBgColor : null;
                const hasBgImage = !!groupBgImage;
                /*
                 * DECISION Phase 88.3 (R2-6): the title and subtitle treatments
                 * are computed TWICE — against the stored hex for dark mode and
                 * against the rendered tint for light — and handed to the
                 * cascade as `--t-*` properties, chosen OVER the single
                 * `isDark` fork this replaces. That fork asked
                 * `isDarkBackground` about the STORED hex, and every shipped
                 * preset is dark, so it never flipped: these rows painted
                 * near-white text with a black shadow and stroke on a pale
                 * tint. REJECTED: a `useTheme` read (the shipped DECISION at
                 * EventScheduler.tsx rejected it for this exact problem) and
                 * layering a `dark:` class over the inline keys (an inline
                 * declaration beats any class — the plan-07 inert-override
                 * trap), which is why those keys are DELETED here, not
                 * overridden. A decision, not a cleanup.
                 */
                const rowTitleTreatment = (rowGround) => {
                  if (isThemedRow) return getTextStyle(false, null);
                  const onDarkGround = !hasBgImage && isDarkBackground(rowGround);
                  return {
                    color: onDarkGround ? TEXT_ON_DARK : TEXT_ON_LIGHT,
                    textShadow: hasBgImage
                      ? '1px 1px 2px rgba(255, 255, 255, 0.9)'
                      : (onDarkGround
                        ? '2px 2px 4px rgba(0, 0, 0, 0.8), -1px -1px 2px rgba(0, 0, 0, 0.8)'
                        : '1px 1px 2px rgba(255, 255, 255, 0.9)'),
                    WebkitTextStroke: onDarkGround ? '0.5px rgba(0, 0, 0, 0.9)' : 'none',
                  };
                };
                const rowSubtitleTreatment = (rowGround) => {
                  if (isThemedRow) return getSubtitleStyle(false, null);
                  const onDarkGround = !hasBgImage && isDarkBackground(rowGround);
                  return {
                    color: hasBgImage
                      ? SUBTEXT_ON_LIGHT
                      : (onDarkGround ? 'rgba(255,255,255,0.9)' : SUBTEXT_MUTED_ON_LIGHT),
                    textShadow: hasBgImage
                      ? '1px 1px 2px rgba(255, 255, 255, 0.9)'
                      : (onDarkGround
                        ? '1px 1px 3px rgba(0, 0, 0, 0.8)'
                        : '1px 1px 2px rgba(255, 255, 255, 0.9)'),
                    WebkitTextStroke: onDarkGround ? '0.3px rgba(0, 0, 0, 0.9)' : 'none',
                  };
                };
                const rowTitleVars = themedTextStyleVars(
                  rowTitleTreatment(groupBgColor),
                  rowTitleTreatment(tinted || groupBgColor),
                );
                const rowSubtitleVars = themedTextStyleVars(
                  rowSubtitleTreatment(groupBgColor),
                  rowSubtitleTreatment(tinted || groupBgColor),
                );
                const rowLabel = `${event.Game?.name || 'Game Night'} - ${event.Group?.name || 'Unknown Group'}`;

                return (
                  /* DECISION Phase 88.3 (R3-C, owner ruling 2026-08-25): this
                     row is keyboard-operable, matching the shipped shape at
                     CalendarListView.js's EventRow rather than inventing a new
                     one. REJECTED: leaving it mouse-only — the identical
                     interaction one file over has been keyboard-reachable all
                     along. A decision, not a cleanup. */
                  <div
                    key={event.id}
                    onClick={() => onEventClick(event)}
                    role="button"
                    tabIndex={0}
                    aria-label={rowLabel}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' || e.key === ' ') {
                        e.preventDefault();
                        onEventClick(event);
                      }
                    }}
                    className={`p-4 border border-line rounded-lg transition-all hover:shadow-md cursor-pointer focus:outline-hidden focus-visible:ring-2 focus-visible:ring-focus-ring focus-visible:ring-offset-2 ${tinted ? 'bg-[var(--group-ground-light)] dark:bg-[var(--group-ground)]' : 'bg-surface-card'}`}
                    style={{
                      ...(tinted && {
                        '--group-ground': ground,
                        '--group-ground-light': tinted,
                      }),
                      ...safeBgImageStyle(groupBgImage),
                      backgroundSize: 'cover',
                      backgroundPosition: 'center',
                      position: 'relative',
                      zIndex: 1,
                      borderColor: isPastEvent ? 'rgba(0,0,0,0.1)' : 'rgba(0,0,0,0.2)',
                    }}
                  >
                    <div style={{
                      position: 'absolute',
                      top: 0,
                      left: 0,
                      right: 0,
                      bottom: 0,
                      backgroundColor: groupBgImage ? 'rgba(255, 255, 255, 0.85)' : 'transparent',
                      borderRadius: '0.5rem',
                    }} />
                    <div className="flex justify-between items-start relative z-10">
                      <div className="flex-1">
                        <div className="flex items-center gap-2 mb-1">
                          {groupProfilePic && (
                            <div className="w-10 h-10 rounded-full bg-surface-card flex items-center justify-center text-xl shrink-0 overflow-hidden border-2 border-line shadow-xs">
                              {groupProfilePic.startsWith('http') || groupProfilePic.startsWith('/') ? (
                                <SafeImage
                                  src={groupProfilePic}
                                  alt={event.Group?.name}
                                  fallbackIcon="👥"
                                  className="w-full h-full object-cover"
                                />
                              ) : (
                                <span>{groupProfilePic}</span>
                              )}
                            </div>
                          )}
                          <div>
                            <h4
                              className="font-semibold [color:var(--t-color-l)] dark:[color:var(--t-color)] [text-shadow:var(--t-shadow-l)] dark:[text-shadow:var(--t-shadow)] [-webkit-text-stroke:var(--t-stroke-l)] dark:[-webkit-text-stroke:var(--t-stroke)]"
                              style={rowTitleVars}
                            >
                              {event.Game?.name || 'Game Night'}
                            </h4>
                            <p
                              className="text-sm [color:var(--t-color-l)] dark:[color:var(--t-color)] [text-shadow:var(--t-shadow-l)] dark:[text-shadow:var(--t-shadow)] [-webkit-text-stroke:var(--t-stroke-l)] dark:[-webkit-text-stroke:var(--t-stroke)]"
                              style={rowSubtitleVars}
                            >
                              {event.Group?.name || 'Unknown Group'} - {formatTime(event.start_date, timezone)}
                            </p>
                          </div>
                          {!isPastEvent && (
                            <span className="px-2 py-0.5 bg-green-100 text-green-800 text-xs rounded-sm ml-auto">
                              Upcoming
                            </span>
                          )}
                        </div>
                        <div className="flex gap-4 mt-2 text-sm text-content-muted">
                          {event.duration_minutes && (
                            <span>Duration: {event.duration_minutes} min</span>
                          )}
                        </div>
                        {/* Share Game QR button - visible for upcoming events */}
                        {!isPastEvent && (
                          <button
                            onClick={(e) => handleShowGameQR(e, event)}
                            disabled={gameQRLoading && qrEventId === event.id}
                            className="mt-2 btn btn-secondary text-xs px-3 py-1.5 inline-flex items-center gap-1.5"
                            title="Share Game QR"
                          >
                            <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2}>
                              <path strokeLinecap="round" strokeLinejoin="round" d="M3.75 4.875c0-.621.504-1.125 1.125-1.125h4.5c.621 0 1.125.504 1.125 1.125v4.5c0 .621-.504 1.125-1.125 1.125h-4.5A1.125 1.125 0 013.75 9.375v-4.5zM3.75 14.625c0-.621.504-1.125 1.125-1.125h4.5c.621 0 1.125.504 1.125 1.125v4.5c0 .621-.504 1.125-1.125 1.125h-4.5a1.125 1.125 0 01-1.125-1.125v-4.5zM13.5 4.875c0-.621.504-1.125 1.125-1.125h4.5c.621 0 1.125.504 1.125 1.125v4.5c0 .621-.504 1.125-1.125 1.125h-4.5A1.125 1.125 0 0113.5 9.375v-4.5z" />
                              <path strokeLinecap="round" strokeLinejoin="round" d="M6.75 6.75h.75v.75h-.75v-.75zM6.75 16.5h.75v.75h-.75v-.75zM16.5 6.75h.75v.75H16.5v-.75zM13.5 13.5h.75v.75h-.75v-.75zM13.5 19.5h.75v.75h-.75v-.75zM19.5 13.5h.75v.75h-.75v-.75zM19.5 19.5h.75v.75h-.75v-.75zM16.5 16.5h.75v.75H16.5v-.75z" />
                            </svg>
                            {gameQRLoading && qrEventId === event.id ? 'Loading...' : 'Share Game QR'}
                          </button>
                        )}
                      </div>
                      <SafeImage
                        src={event.Game?.image_url}
                        alt={event.Game?.name}
                        className="w-16 h-16 object-cover rounded-sm"
                      />
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </Modal.Body>
      </Modal>

      {/* Game QR Code Modal */}
      <QRCodeModal
        isOpen={showGameQR}
        onClose={() => setShowGameQR(false)}
        url={gameInviteUrl}
        title="Game Night Invite QR"
        showReset={false}
      />
    </>
  );
}
