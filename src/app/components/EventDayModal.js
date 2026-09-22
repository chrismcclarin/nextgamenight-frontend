'use client';
import { useEffect, useRef, useState } from 'react';
import { toast } from 'sonner';
import {
  getSubtitleStyle,
  getTextStyle,
  groupInkVars,
  isDarkBackground,
  resolveGroupGround,
  storedGroupColour,
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
import { Button } from '../../components/ui/Button';
import { Heading } from '../../components/ui/Heading';
import { getFetchErrorMessage } from '../../components/ui/useFetchErrorState';
import { logger, errCtx } from '../../lib/logger';
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

  /* DECISION Phase 88.6-27 (W16 / D-31, UI-SPEC §12 A-4): the cancelled-generation guard for
     the toast below, and the mechanism here is NOT the one it looks like it should be.

     THIS COMPONENT IS UNMOUNTED BY ITS HOST. `EventCalendar.js:242` is `{selectedDay && (`
     around `<EventDayModal` at `:243`, and `EventCalendar.js` is this component's ONLY
     production caller. The toast still lands after the modal is gone, because `toast.error` is
     a MODULE-LEVEL IMPERATIVE call reached from the SURVIVING promise continuation — React
     unmounting a component cancels neither the in-flight `eventsAPI.getEventInviteToken` nor
     its `catch`. So a future reader must not re-file this as "the component must be staying
     mounted": it is not, and that is precisely why a state comparison cannot help.

     REJECTED: comparing against `selectedDay`, or against any component state. Post-unmount
     that closure is unreachable as a signal — the handler holds the render's values and
     nothing re-runs to update them, so the guard would be a guard in name only.
     REJECTED: `AbortController`, which `88.6-29-PLAN.md:29` rejects for this class by name.

     CHOSEN: a ref invalidated in an unmount cleanup, checked before the toast fires — the same
     cancelled-generation shape the phase defines once (shipped source:
     `NextGameNightCard.tsx:197/204-205/209-211`). WHY THIS IS NOT BOOKKEEPING: W16's whole
     ruled purpose is that "the user's context must not move", and a toast landing on the
     calendar the user navigated back to, about a modal they already closed, moves context in
     exactly the way the ruling forbids. */
  const mountedRef = useRef(true);
  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

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
      /* W16 (D-31, UI-SPEC §12 A-4): the TOAST arm, not a banner. This is an action failure
         inside an OPEN modal, so the user's context must not move, and a `FetchErrorBanner`
         would reflow the day list under their thumb. NO fallback is passed, deliberately:
         `getFetchErrorMessage` already yields the ratified `unknown` string, so no new copy is
         authored here. Before this, the user tapped "Share Game QR", nothing happened, and
         nothing told them why. */
      if (mountedRef.current) toast.error(getFetchErrorMessage(err));
      /* AC-2, at the level the owner amended it to on 2026-09-13: `logger.info`, REPLACING the
         raw `console.error` rather than sitting beside it — the module's contract is that call
         sites use `logger.*` instead of raw `console.*`. STATE THE COST HONESTLY: `logger.info`
         is `Sentry.addBreadcrumb` (`logger.ts:34-36`), so this failure reaches Sentry only
         ATTACHED TO a later event in the same session; it does not become independently visible
         to an operator. Whether these paths deserve a Sentry EVENT is routed to the owner, not
         decided here. `errCtx(err)` and never the raw `Error`: `logger.info(msg, ctx)`'s second
         parameter is a plain object, and `checkJs: false` hides that mistake in a `.js` file.
         The message is the literal; the ctx carries the error's name and message and nothing
         else (T-84-01). Fires regardless of mount state — a developer log is not context. */
      logger.info('Failed to get game invite token', errCtx(err));
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
              <Button
                variant="primary"
                onClick={() => onCreateEventOnDay(selectedDay.date)}
                className="w-full sm:w-auto"
              >
                + New event on this day
              </Button>
            </div>
          )}
          {selectedDay.events.length === 0 ? (
            <p className="text-content-secondary text-center py-8">No events on this day.</p>
          ) : (
            <div className="space-y-3">
              {selectedDay.events.map(event => {
                const eventDate = new Date(event.start_date);
                const isPastEvent = eventDate < new Date();
                const groupProfilePic = event.Group?.profile_picture_url;
                const groupBgImage = event.Group?.background_image_url;
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
                /*
                 * AMENDED Phase 88.3.1 (plan 08, AMENDMENT J) — the D-09 marker
                 * above is KEPT VERBATIM and its Tailwind source-order reasoning
                 * is untouched. Two mechanical facts under it changed:
                 * `groupBgColor` is gone (its "ALSO REJECTED: gating on
                 * `groupBgColor` alone" now reads against `rowGroundPair`,
                 * unchanged in substance), and the hand-written
                 * `tinted ? … : null` gate is gone because T-88.3-43 became a
                 * property of the resolver's RETURN TYPE — `{dark, light, …}` or
                 * `null`, never half a pair — instead of a gate six callers each
                 * rewrite.
                 *
                 * The ACCESSOR is `storedGroupColour(event.Group)`, never
                 * `background_color`: plan 88.3.1-05 migrates coloured groups to
                 * `color_preset='<id>', background_color=NULL`, so reading the
                 * legacy column alone renders every migrated group uncoloured
                 * with a fully green suite. REJECTED: a per-site `?? background_color`
                 * ternary — six copies of one rule. A decision, not a cleanup.
                 */
                const rowGroundPair = resolveGroupGround(storedGroupColour(event.Group));
                const ground = rowGroundPair?.dark ?? null;
                const tinted = rowGroundPair?.light ?? null;
                /*
                 * DECISION Phase 88.6-41 (W49 / FSEC-03): ONE image flag, derived
                 * from the VALIDATED `safeBgImageStyle` output. This replaces the
                 * 88.3.1 plan-08 two-flag marker, whose REJECTED arm ("converging
                 * `hasBgImage` onto the validated style here … converge all four
                 * in one pass, with a rendered check") this plan discharged.
                 * History, because it records why the divergence shipped:
                 * `safeBgImageStyle` drops relative/invalid URLs, so a
                 * truthy-but-rejected URL paints NO image — that row is a plain
                 * coloured card and must get its ink. 88.3.1 fixed the INK half
                 * with a second flag and left the TEXT half raw, because
                 * converging it changes what those rows paint.
                 *
                 * The surviving flag keeps the RAW NAME because that is the name
                 * every treatment below already reads; the RHS moved onto the
                 * validated side. `grouplist.js` is the reference shape.
                 *
                 * Its PAIRED raw-URL consumers converged in the SAME commit —
                 * `isThemedRow` below and the 0.85 white wash further down. A
                 * flag converged without its wash leaves TEXT_ON_DARK under a
                 * still-raw white wash on an invalid-URL row over a dark preset:
                 * white on near-white. A decision, not a cleanup.
                 */
                const bgImageStyle = safeBgImageStyle(groupBgImage);
                const hasBgImage = !!bgImageStyle;
                // No image and no group colour: the row is on the themed
                // surface, so the shared fallback resolution owns its text.
                // Keyed on `ground` (not the stored hex) and therefore declared
                // AFTER it — see the CR-02 marker below.
                // AMENDED Phase 88.6-41 (W49): gated on the validated flag, not
                // the raw URL. `CalendarListView.js`'s twin already read the flag,
                // so the two files were ASYMMETRIC; they are one shape now. The
                // VISIBLE delta is real and intended: an invalid-URL, no-colour
                // row leaves the TEXT_ON_LIGHT + white-shadow branch and takes
                // the plain-ground pole, which is what it always should have had.
                const isThemedRow = !hasBgImage && !ground;
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
                /*
                 * DECISION Phase 88.3-cr (CR-02, code-adversarial-review
                 * 2026-08-27): the DARK arm is computed on `ground`, not on the
                 * stored hex, and the LIGHT arm on `tinted`, not on
                 * `tinted || <stored hex>` — mirroring the shipped shape at
                 * `groupHomePage/page.js`, which gates BOTH the ground and the
                 * text style on the tint succeeding. Gating only the ground was
                 * the exact asymmetry the T-88.3-43 marker above warns about:
                 * a stored value that `resolveGroupBackgroundColor` passes
                 * through but `lightTintGroupBackgroundColor` rejects (anything
                 * not a 6-digit hex) would drop the card back to the themed
                 * surface while the text treatment was still computed against
                 * the malformed string — `getBrightness` returns 255 for it, so
                 * the dark arm painted the light-ground pole on a DARK themed
                 * card. Unreachable for new writes (the backend validator is
                 * `^#[0-9A-Fa-f]{6}$`), which is why this is a consistency fix
                 * rather than a bug fix — but "withhold both grounds together"
                 * has to mean the text too, or the marker is only half true.
                 * REJECTED: leaving the stored hex in and widening the tint
                 * validator instead. A decision, not a cleanup.
                 *
                 * AMENDED Phase 88.3.1 (plan 08), everything above KEPT AS
                 * HISTORY: the two function names this marker cites —
                 * `resolveGroupBackgroundColor` and the tint — are no longer
                 * CALLED in this file; both moved inside the resolver. The
                 * control is unchanged and is now structural, because `ground`
                 * and `tinted` are destructured from one object and cannot drift
                 * apart. `rowSubtitleVars` below is NOT dead code superseded by
                 * the card ink: it is the LEGACY and BACKGROUND-IMAGE fallback
                 * the "Duration:" line's `--group-ink-muted*` chain resolves to,
                 * which is why that line now carries it too.
                 */
                const rowTitleVars = themedTextStyleVars(
                  rowTitleTreatment(ground),
                  rowTitleTreatment(tinted),
                );
                const rowSubtitleVars = themedTextStyleVars(
                  rowSubtitleTreatment(ground),
                  rowSubtitleTreatment(tinted),
                );
                return (
                  /* DECISION Phase 88.3 (R3-C, owner ruling 2026-08-25): this
                     row is keyboard-operable, matching the shipped shape at
                     CalendarListView.js's EventRow rather than inventing a new
                     one. REJECTED: leaving it mouse-only — the identical
                     interaction one file over has been keyboard-reachable all
                     along. A decision, not a cleanup.

                     AMENDED Phase 88.3 code-adversarial-review run 3 (H1, owner
                     ruling (a) 2026-08-28): the KEYBOARD target is the TITLE
                     BLOCK below, not this card. The card keeps a pointer-only
                     `onClick`; `role="button"` / `tabIndex` / `onKeyDown` live on
                     the title `<div>` (NO aria-label — see the note there). Why: the card
                     CONTAINS a native "Share Game QR" `<button>` (upcoming
                     events). With the handler on the card, Enter on that button
                     bubbled up, was `preventDefault()`ed and navigated to the
                     event instead of showing the QR — a keyboard path that
                     worked before 2c37a4e — and `role="button"` is
                     children-presentational, so AT never exposed the nested
                     button at all (WCAG 4.1.2). EventRow was safe to copy only
                     because it has no interactive descendants. REJECTED:
                     (1) a `target !== currentTarget` guard alone — fixes the
                     hijack, leaves the nested button hidden from AT;
                     (2) moving the Share button out of the card — an unasked
                     layout change to a control the owner ruled on the same
                     day. Pinned by EventDayModal.test.tsx. */
                  <div
                    key={event.id}
                    onClick={() => onEventClick(event)}
                    /* DECISION Phase 88.6-27 (W30 + D49-b) — TWO findings on one className,
                       decided independently and recorded together because they are one string.

                       (a) D49-b (owner ruling 2026-09-09, option i): `hover:shadow-md` ->
                       `hover:shadow-theme-md`. The alias spelling resolved to Tailwind v4's
                       INLINED BLACK default instead of this app's warm theme tier
                       (`DECISION Phase 87.7`, `globals.css:1141-1155`), so the hover HUE
                       changes visibly and on purpose. PLAIN `hover:`, NOT `enabled-hover:` —
                       this is a card `div`, not a `.btn`, and there is no gated control here
                       to withhold the lift from.

                       (b) W30, the BORDER, and BOTH ARMS move. The inline
                       `borderColor: isPastEvent ? 'rgba(0,0,0,0.1)' : 'rgba(0,0,0,0.2)'` is
                       GONE — not half-tokenised — and the distinction it carried now rides
                       this className, where a `dark:` fork can reach it. An inline declaration
                       beats any class, which is why the key is deleted rather than overridden.
                       CHOSEN by closest shipped VALUE (UI-SPEC §1.2): over the white card,
                       `rgba(0,0,0,0.1)` composites to ~#e6e6e6 and `border-line-control`
                       (warm-300 `#d6cbc0`) is the nearest shipped step; `rgba(0,0,0,0.2)`
                       composites to ~#cccccc and `border-line` (warm-400 `#b8a898`) is the
                       nearest — and `border-line` is also what this element's own `border`
                       utility already declared, so the non-past arm simply stops being
                       overridden. REJECTED: `border-line-strong` for the darker arm.
                       `globals.css:1138-1155` retires the hairline-to-`border-strong`
                       migration outright and reserves 3:1 for CONTROL boundaries; a resting
                       card row is not one. NAMED TRADE-OFF, not an oversight:
                       `border-line-control`'s NAME is about an input edge
                       (`globals.css:467-473`) and it is used here for its VALUE as the one
                       shipped step lighter than `border-line`. DISCLOSED CONSEQUENCE: in DARK
                       mode `--color-border-control` is `transparent` (`globals.css:1851`), so
                       a past row's edge disappears — it was already effectively invisible
                       there (10% black over a dark card), while the NON-past row GAINS the
                       theme border the hardcoded black had been suppressing. Re-introducing an
                       inline colour here is a decision, not a cleanup.
                       THE `border` WIDTH IS REPEATED INSIDE BOTH TERNARY ARMS ON PURPOSE, not
                       hoisted out beside `p-4`: `borderExplicitness.test.ts` (D-35, Req 16)
                       forbids a bare `border` that leaves its colour to the base-layer shim, and
                       it reads STATIC string chunks — a hoisted `border` with the colour in a
                       template expression reads to it as exactly that offence, and it reds.
                       Each arm therefore carries width AND colour together. Hoisting the width
                       out is a decision, not a cleanup. */
                    className={`p-4 ${isPastEvent ? 'border border-line-control' : 'border border-line'} rounded-lg transition-all hover:shadow-theme-md cursor-pointer ${tinted ? 'bg-[var(--group-ground-light)] dark:bg-[var(--group-ground)]' : 'bg-surface-card'}`}
                    style={{
                      ...(tinted && {
                        '--group-ground': ground,
                        '--group-ground-light': tinted,
                      }),
                      /*
                       * DECISION Phase 88.3.1 (SPEC Req 4 / UI-SPEC 3.3): the
                       * CARD ink pair rides in the SAME style object as the two
                       * grounds, chosen OVER emitting it on the "Duration:" line
                       * that consumes it — ink and ground must turn on and off
                       * together, and `groupColourRendering.test.ts` test 9 can
                       * only assert that when both live in one expression.
                       * `hasBackgroundImage` is passed EXPLICITLY: this is a
                       * `.js` file, so a forgotten option degrades silently to
                       * `false`, the UNSAFE direction (a preset's tinted ink
                       * painted over a user's photograph).
                       * AMENDED Phase 88.6-41 (W49): the "REJECTED: the raw
                       * `hasBgImage`" note that sat here is retired with its
                       * parent two-flag marker. There is no raw flag left to
                       * reject — `hasBgImage` IS `!!bgImageStyle` now; see the
                       * marker at its declaration, and tests 29/31.
                       */
                      ...groupInkVars(rowGroundPair, {
                        surface: 'card',
                        hasBackgroundImage: hasBgImage,
                      }),
                      ...bgImageStyle,
                      backgroundSize: 'cover',
                      backgroundPosition: 'center',
                      position: 'relative',
                      zIndex: 1,
                      /* W30: the `borderColor` key that used to sit here is GONE — both of its
                         arms were raw inline colour values. See the marker on the className
                         above for the tokens it became and why. */
                    }}
                  >
                    {/* AMENDED Phase 88.6-41 (W49): the contrast wash is gated on
                        the VALIDATED flag, in the SAME commit as the treatments
                        above — byte-identical change to `CalendarListView.js`'s
                        twin wash, because it is the same designed pair. */}
                    <div style={{
                      position: 'absolute',
                      top: 0,
                      left: 0,
                      right: 0,
                      bottom: 0,
                      backgroundColor: hasBgImage ? 'rgba(255, 255, 255, 0.85)' : 'transparent',
                      borderRadius: '0.5rem',
                    }} />
                    <div className="flex justify-between items-start relative z-10">
                      <div className="flex-1">
                        <div className="flex items-center gap-2 mb-1">
                          {/* DECISION Phase 88.6-27 (D-14b, RESEARCH §C.2 Open Question 6):
                                `shadow-xs` -> `shadow-theme-sm`. THIS ELEMENT HAD NO MARKER AT
                                ALL, which is why D-14b never named it.

                                THE EVIDENCE THAT DECIDED IT: this 40px group-avatar disc is a
                                byte-identical TWIN of `CalendarListView.js`'s `EventRow` avatar
                                — same `w-10 h-10 rounded-full bg-surface-card ... border-2
                                border-line` — and that one already carries `shadow-theme-sm`.
                                The two differed in exactly one class. One control, one
                                treatment.

                                `--shadow-xs` is UNDECLARED in `globals.css`, so the old class
                                fell through to Tailwind's default black hairline — off-tier by
                                the D-14b rule. `--shadow-sm` is `0 0 #0000` in BOTH themes
                                (`globals.css:1361`, `:1765`), so this snap REMOVES that black
                                hairline rather than recolouring it: a disclosed visible delta,
                                and the disc keeps its `border-2 border-line` edge, which is
                                what actually separates it from the card.

                                REJECTED: deleting the shadow class outright. It reads the same
                                today, but it would leave the twins textually divergent again
                                and give a future sweep nothing to converge on. REJECTED:
                                declaring a `--shadow-xs` token — that mints a fourth tier the
                                D-14b rule exists to prevent. */}
                          {groupProfilePic && (
                            <div className="w-10 h-10 rounded-full bg-surface-card flex items-center justify-center text-xl shrink-0 overflow-hidden border-2 border-line shadow-theme-sm">
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
                          <div
                            role="button"
                            tabIndex={0}
                            /* NO aria-label, deliberately (88.3 code-adversarial-review run 4,
                               2026-08-28): on a role="button" an explicit label REPLACES the
                               name computed from the subtree, and the <p> below is the only
                               place the START TIME is rendered — the one field that tells two
                               events on the same day apart. The name is therefore computed
                               from the <h4> + <p> content ("Catan Tuesday Crew - 7:00 PM"),
                               exactly as CalendarListView's EventRow does. Pinned by
                               EventDayModal.test.tsx (name must contain a clock time). */
                            onKeyDown={(e) => {
                              if (e.key === 'Enter' || e.key === ' ') {
                                e.preventDefault();
                                e.stopPropagation();
                                onEventClick(event);
                              }
                            }}
                            className="rounded-sm focus:outline-hidden focus-visible:ring-2 focus-visible:ring-focus-ring focus-visible:ring-offset-2"
                          >
                            {/* D-04: this `<h4>` carries NO SIZE class, so it renders at body
                                size — `<Heading level={4} size="body">` (16) states that rather
                                than inheriting it, and the LEVEL is preserved. It is NOT
                                class-less: the six arbitrary-value themed-ink classes below (a
                                AMENDED Phase 88.6-44 (R7, UI-SPEC §7.5 — the ONE sanctioned
                                heading-level change class): LEVEL 4 -> 3. The composed
                                heading-order audit (`EventDayModal.test.tsx`, axe `heading-order`)
                                found the outline jumping from the dialog's `<h2>` title
                                (`<Modal.Header>` renders a Radix DialogTitle) straight to this
                                `<h4>` — "Heading levels should only increase by one". The skip is
                                PRE-EXISTING (the `<h4>` predates plan 88.6-27's sweep, which
                                preserved it under P4; the `<h2>` arrived with the 88-17 Modal
                                migration), not introduced by the sweep. `size="body"` and every
                                class below are byte-unchanged — only the semantic level moves, and
                                `typeScaleTouchedSurfaces.test.ts` EXPECTED_LEVELS moves with it in
                                the same commit. Going back to 4 re-opens the finding.
                                light/dark pair each for colour, text-shadow and
                                -webkit-text-stroke, all reading `--t-*`) are what keep the event
                                title readable over a group background PHOTO, and every one of
                                them passes through byte-identical, as does `style={rowTitleVars}`.
                                Dropping them because "it had no classes worth keeping" would
                                make titles unreadable on photo-backed rows in one theme or both.
                                `font-semibold` is the only class that GOES, and it goes because
                                the primitive's `font-bold` base supersedes it (§4.5: headings
                                are 700). */}
                            <Heading
                              level={3}
                              size="body"
                              className="[color:var(--t-color-l)] dark:[color:var(--t-color)] [text-shadow:var(--t-shadow-l)] dark:[text-shadow:var(--t-shadow)] [-webkit-text-stroke:var(--t-stroke-l)] dark:[-webkit-text-stroke:var(--t-stroke)]"
                              style={rowTitleVars}
                            >
                              {event.Game?.name || 'Game Night'}
                            </Heading>
                            <p
                              className="text-sm [color:var(--t-color-l)] dark:[color:var(--t-color)] [text-shadow:var(--t-shadow-l)] dark:[text-shadow:var(--t-shadow)] [-webkit-text-stroke:var(--t-stroke-l)] dark:[-webkit-text-stroke:var(--t-stroke)]"
                              style={rowSubtitleVars}
                            >
                              {event.Group?.name || 'Unknown Group'} - {formatTime(event.start_date, timezone)}
                            </p>
                          </div>
                          {/* DECISION Phase 88.6-27 (W31, SPEC Req 6): the last status chip in
                               the app still on the RAW Tailwind palette, and the only one with
                               no dark fork at all — `bg-green-100 text-green-800` painted a pale
                               mint chip with dark-green ink on a DARK card. It takes the shipped
                               Req 6 pair `bg-status-success-subtle text-content-status-success`,
                               which is the same pair `PromptScheduleSection.js:192` already
                               wears, and the dark arm arrives with the tokens rather than being
                               authored here.
                               MEASURED with `src/lib/wcag.ts`, both themes, so the move is not
                               taken on faith: outgoing 6.4924 (one value, since it had no dark
                               fork); incoming 6.0253 light (`#166534` on `#dcf1e4`) and 4.6561
                               dark (`#22c55e` on `#234443`). Light loses 0.47 and both arms
                               clear the 4.5 AA floor — a small, stated reduction bought in
                               exchange for a chip that is actually legible in dark mode.
                               `text-xs` STAYS: a chip label is Caption 12 by §4.2's closed role
                               list. */}
                          {!isPastEvent && (
                            <span className="px-2 py-0.5 bg-status-success-subtle text-content-status-success text-xs rounded-sm ml-auto">
                              Upcoming
                            </span>
                          )}
                        </div>
                        {/* DECISION Phase 88.3.1 (SPEC Req 8, site 2 of 3 — UI-SPEC 3.5).

                            THE HISTORY THIS REPLACES, CARRIED NOT DELETED. The comment here was
                            "88.3 UI-REVIEW (2026-08-28) fix 1": `text-content-muted` (warm-600)
                            reads **3.4**-3.6:1 on the eight light tints — an AA miss — so the line
                            was forked to `text-content-primary` on the tinted arm (9.3-9.9:1),
                            matching grouplist.js's "Last Game" row, and pinned by
                            `groupColourRendering.test.ts` test 24. **That fix is NOT being undone.**
                            It is superseded by an ink that is solved per preset per theme, so the
                            3.4-3.6 miss it repaired cannot recur on any of the sixteen surfaces.
                            The 88.6 register entry "[tint/dark-mode LIMIT] EventDayModal Duration
                            line" is closed by this marker.

                            CHOSEN: the line reads the 85% muted rung of the CARD ink out of the
                            cascade — `--group-ink-muted` / `--group-ink-muted-l` — selected by the
                            SAME `dark:` fork that selects the ground, so the pole is a function of
                            the RENDERED ground by construction. Req 8's failure mode (a pole chosen
                            by "does this group have a colour") cannot occur here.

                            REJECTED: keeping the `tinted ? 'text-content-primary' :
                            'text-content-muted'` theme-token fork. It was correct only while every
                            shipped preset was dark; on a legacy LIGHT stored hex in dark mode it
                            paints near-white on near-white, about 1.1:1.

                            THE NUMBER, STATED HONESTLY: this is a contrast REDUCTION on the tinted
                            arm, not an improvement. Measured 2026-08-29 with `src/lib/wcag.ts`
                            against the sixteen SHIPPED bands (not the superseded t = 0.70 tints):
                            the outgoing `text-content-primary` reads **13.27-13.39:1** light
                            (warm-900) and **10.65-14.53:1** dark (warm-50); the incoming muted rung
                            reads **5.52-6.28:1** (min 5.5239 on violet light, max 6.2835 on
                            amber/green dark). Traded deliberately for the tinted ink the owner
                            asked for, and comfortably over the 4.5:1 AA floor. There is no "we
                            improved it from 1.6:1" here — no such baseline exists, and a fabricated
                            one survives into three downstream documents.

                            THE `var(…, …)` FALLBACK IS LOAD-BEARING. `groupInkVars` returns `{}`
                            for the LEGACY / custom-hex arm and for the background-image arm, so on
                            those rows `--group-ink-muted*` is undefined; without a fallback the
                            declaration is invalid at computed-value time and `color` INHERITS the
                            page's ground-blind theme colour — the exact defect this marker closes,
                            on the arm that is LIVE for the whole window before BE PR-2's remap. The
                            `style={rowSubtitleVars}` below puts this row's own ground-derived
                            subtitle treatment on THIS element (the same object the `<p>` above
                            carries), so `var(--t-color-l)` / `var(--t-color)` is the fallback and it
                            is computed against the rendered ground. Verified 2026-08-29 that
                            tailwindcss@4.3.3 in this tree compiles the nested-fallback arbitrary
                            value and its `dark:` variant. Test 24 moves with this line. */}
                        <div
                          className={`flex gap-4 mt-2 text-sm ${tinted ? '[color:var(--group-ink-muted-l,var(--t-color-l))] dark:[color:var(--group-ink-muted,var(--t-color))]' : 'text-content-muted'}`}
                          style={rowSubtitleVars}
                        >
                          {event.duration_minutes && (
                            <span>Duration: {event.duration_minutes} min</span>
                          )}
                        </div>
                        {/* Share Game QR button - visible for upcoming events */}
                        {!isPastEvent && (
                          <Button
                            variant="accent"
                            onClick={(e) => handleShowGameQR(e, event)}
                            disabled={gameQRLoading && qrEventId === event.id}
                            /* DECISION Phase 88.3-18 (owner ruling on Req 12 UAT test 4 / 11c(c),
                               2026-08-28): `btn-secondary` -> `btn-accent`. Owner: "The Share game
                               qr button still looks odd. Lets make it amber, like the create event
                               button." The amber lives ONCE, in the `.btn-accent` rule over
                               `--color-btn-accent-*` — REJECTED: a second inline
                               `var(--amber-700)` literal here. White on amber-700 = 5.0216 (AA);
                               hover white on amber-800 = 7.0900. `font-semibold` and the house
                               focus-ring string match the Create-Event button this copies
                               (`groupHomePage/page.js:794,798-804`); the ring is applied PER-SITE
                               rather than as `.btn:focus-visible`, which would be a 119-call-site
                               change belonging to 88.6. A byte-identical TWIN of this button lives
                               at `gameDetail/page.js:1601` and moved in the same commit — one
                               control, one treatment. Full marker at the `.btn-accent` rule. */
                            /* Phase 88.6-27: the legacy accent class pair is retired onto the
                               primitive's accent variant above (the class string is NOT quoted
                               here — test 47 counts BOTH spellings file-wide, comments included,
                               and expects exactly one accent-treated control per file). SEVEN classes were DEAD
                               under unlayered `.btn` (`globals.css:2195-2205` declares
                               `display: inline-flex`, `align-items: center`, `gap`,
                               `font-weight: 600`, `font-size` and `padding`) and are deleted, not
                               moved: the 600 weight, `text-xs`, `px-3`, `py-1.5`, `inline-flex`,
                               `items-center` and `gap-1.5`. `mt-2` SURVIVES — `.btn` declares no
                               margin, so it was never dead. The per-site focus-ring string goes in
                               THIS SAME EDIT rather than as a later tidy: on the primitive
                               spelling the ring comes from the primitive's own cva base
                               (`Button.tsx:113`), and `tokenContrast.test.ts` test 47 reds a
                               migrated site that keeps a per-site copy of it.
                               NOTE FOR A FUTURE EDITOR OF THIS COMMENT: test 47 locates this
                               control by walking BACK from the tooltip attribute below to the
                               nearest preceding button open tag, and it counts that attribute to
                               detect a ballooned slice. So neither that tag's literal text nor
                               that attribute's literal spelling may appear in this marker — both
                               are described rather than quoted, deliberately.
                               The control KEEPS its native `disabled`. */
                            className="mt-2"
                            title="Share Game QR"
                          >
                            {/* Decorative: the visible "Share Game QR" / "Loading..." label already
                                gives this button its accessible name, so the icon is hidden from AT
                                rather than announced as a stray image before the label. House
                                convention — the sibling at `invite/game/[token]/page.js:210` carries
                                the same pair. */}
                            <svg className="w-3.5 h-3.5" aria-hidden="true" focusable="false" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2}>
                              <path strokeLinecap="round" strokeLinejoin="round" d="M3.75 4.875c0-.621.504-1.125 1.125-1.125h4.5c.621 0 1.125.504 1.125 1.125v4.5c0 .621-.504 1.125-1.125 1.125h-4.5A1.125 1.125 0 013.75 9.375v-4.5zM3.75 14.625c0-.621.504-1.125 1.125-1.125h4.5c.621 0 1.125.504 1.125 1.125v4.5c0 .621-.504 1.125-1.125 1.125h-4.5a1.125 1.125 0 01-1.125-1.125v-4.5zM13.5 4.875c0-.621.504-1.125 1.125-1.125h4.5c.621 0 1.125.504 1.125 1.125v4.5c0 .621-.504 1.125-1.125 1.125h-4.5A1.125 1.125 0 0113.5 9.375v-4.5z" />
                              <path strokeLinecap="round" strokeLinejoin="round" d="M6.75 6.75h.75v.75h-.75v-.75zM6.75 16.5h.75v.75h-.75v-.75zM16.5 6.75h.75v.75H16.5v-.75zM13.5 13.5h.75v.75h-.75v-.75zM13.5 19.5h.75v.75h-.75v-.75zM19.5 13.5h.75v.75h-.75v-.75zM19.5 19.5h.75v.75h-.75v-.75zM16.5 16.5h.75v.75H16.5v-.75z" />
                            </svg>
                            {gameQRLoading && qrEventId === event.id ? 'Loading...' : 'Share Game QR'}
                          </Button>
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
