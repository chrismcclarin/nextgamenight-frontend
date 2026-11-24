'use client';

import { useState, useEffect, useLayoutEffect, useRef, useId } from 'react';
import { createPortal } from 'react-dom';

import {
  COUNTDOWN_LABELS,
  countdownLabel,
  countdownName,
  useConfirmCountdown,
} from '@/components/ui/confirmDelay';
import { StatusRegion } from '@/components/ui/StatusRegion';
import { DelayedSpinner } from '@/components/ui/DelayedSpinner';
import { ReservedLabel } from '@/components/ui/ReservedLabel';
import { DEFAULT_ARMED_LABEL, DEFAULT_ARMED_NAME, DISARM_ANNOUNCEMENT } from '@/components/ui/useConfirmAction';
import { useDismissal } from '@/components/ui/useDismissal';
import { hostGroundHalo } from '@/components/ui/hostGround';
import { cn } from '@/lib/cn';

/**
 * KebabMenu — reusable ⋮ trigger + dropdown overlay.
 *
 * Used to collapse multiple row actions into a single touch-friendly target
 * on narrow viewports. Trigger style + dropdown chrome match the gameDetail
 * event-actions kebab (Phase 65-02) for visual consistency.
 *
 * twoTap items follow the Phase 65-02 destructive-confirm pattern:
 *   - First tap: label flips to "Tap again to confirm" (or item.confirmLabel; both superseded, see R13 below),
 *     3s revert timer arms, item highlights red.
 *   - Second tap on same item within 3s: invokes item.onClick + closes menu.
 *   - Timeout or another item tap reverts the armed state.
 *   AMENDED Phase 88.9-23 (owner pick F9b, 88.9-PICKS-B5.json, 2026-11-07): the first tap reads
 *   Tap again (3)…(1) and the second tap is refused for CONFIRM_DELAY_MS, then live for
 *   CONFIRM_LIVE_MS (6 s armed), chosen OVER the shipped immediately-live 3 s window; a keepOpen
 *   twoTap item stays open after its commit.
 *   AMENDED Phase 88.9-67 (X69, owner 2026-11-14): the gated item reads Wait (3)…(1), named
 *   <item>, wait n seconds; live words and the live-edge announcement unchanged.
 *   AMENDED Phase 88.9-52 (R13, owner 2026-11-17): the live item SHOWS Tap again and is NAMED by
 *   the full sentence (item.armedName, else the menu's armedName); see the R13 marker at the item.
 *   AMENDED Phase 89.6-07 (OW-2a): no revert timer. A live item stays armed while its menu is open,
 *   however long and while focus moves between its items, until the second tap commits, a tap on
 *   another twoTap item re-arms there, or the menu closes, which says the revert words (the OW-2a
 *   marker at the close-resets effect).
 *
 * Dismissal (outside mousedown, container Escape, the non-null relatedTarget
 * `focusout` rule, and the guarded focus restore to the trigger) is owned by the
 * shared hook `src/components/ui/useDismissal.ts` since 88.6.1-05; this component
 * consumes it and owns only its open / armed / announcement state.
 */

/* G4 (88.9-52): the clear space kept between an open menu and the edge of the box that clips it. */
const MENU_EDGE_GAP_PX = 8;

/**
 * The Items API. This enumerated list IS the contract — there is deliberately no
 * `id` field (`DECISION Phase 88.6-16` at the item map explains why), and it is
 * where explicit identity would be added if a future render site ever needs one.
 *
 * `disabled` and `ariaDisabled` are a SPLIT, not duplicates — see the
 * `DECISION Phase 88.6-16` marker at the item button.
 *
 * @typedef {Object} KebabMenuItem
 * @property {string} label - The resting visible label.
 * @property {() => void} onClick - Invoked on activation (twoTap: on the SECOND tap).
 * @property {boolean} [danger] - Destructive ink.
 * @property {boolean} [twoTap] - Phase 65-02 destructive-confirm tier.
 * @property {string} [armedName] - The SPOKEN name of this item while armed and live, a sentence
 *   that starts with the visible Tap again ('Tap again to remove'); overrides the menu default.
 *   The visible armed words are always Tap again (R13) and are not an item's to set.
 * @property {boolean} [disabled] - Native `disabled`. For a control NOBODY is standing on.
 * @property {boolean} [ariaDisabled] - `aria-disabled` + a handler refusal, never the native
 *   attribute. For the control being ACTED ON, whose label must stay readable and which must
 *   stay in the focus order.
 * @property {boolean} [busy] - In flight (rule 1, 88.9-46): the label is KEPT, the house Spinner
 *   renders beside it and `busySuffix` is appended sr-only, so the item is named label plus
 *   suffix. Never a refusal on its own — pass `ariaDisabled` beside it for the gate.
 * @property {string} [busySuffix] - The sr-only words appended to the name while `busy`
 *   (", cancelling", ", leaving", ...).
 * @property {boolean} [keepOpen] - Suppress the close after activation — on the single-tap path
 *   and on the twoTap commit.
 */

/**
 * @param {Object} props
 * @param {string} [props.ariaLabel] - Accessible label for the trigger button.
 * @param {KebabMenuItem[]} [props.items] - Action items. An EMPTY array renders no trigger.
 * @param {string} [props.armedName] - Default spoken name for armed, live twoTap items.
 *                                     Each item can override via item.armedName.
 * @param {import('@/components/ui/hostGround').HostGround} [props.hostGround='card'] - The ground the HOST paints under the trigger; selects its focus halo.
 */
export default function KebabMenu({
  ariaLabel = 'Actions',
  items = [],
  armedName = DEFAULT_ARMED_NAME,
  hostGround = 'card',
}) {
  const [open, setOpen] = useState(false);
  const [armedIndex, setArmedIndex] = useState(null);
  const [announcement, setAnnouncement] = useState('');
  const containerRef = useRef(null);
  const triggerRef = useRef(null);
  const listId = useId();

  // F9b (88.9-23): the armed item's gate. The NC-1 arm text waits in a ref and is written at
  // the live edge (see the AMENDED line on the announcement marker below); the index mirror
  // lets the live-edge callback check the item is still armed.
  const pendingAnnouncementRef = useRef('');
  const armedIndexRef = useRef(null);
  useEffect(() => {
    armedIndexRef.current = armedIndex;
  }, [armedIndex]);
  const {
    secondsLeft,
    live: armedLive,
    isLive,
  } = useConfirmCountdown(armedIndex, () => {
    if (armedIndexRef.current !== null) setAnnouncement(pendingAnnouncementRef.current);
  });

  // PROP-TIME gate, never an on-arm mount: a live region created at the moment
  // of the announcement announces nothing, which is the whole reason for the
  // StatusRegion idiom (src/components/ui/useConfirmAction.ts ("the hook RETURNS A PRE-BUILT ELEMENT"), `DECISION Phase 88-05`;
  // src/components/ui/useConfirmAction.ts ("A remounted live region announces NOTHING")).
  const canAnnounce = items.some((item) => item.twoTap);

  /* DECISION Phase 88.6-16 (D-12): the announcement region is PORTALED to
     `document.body` rather than rendered inline in the wrapper below — MEASURED,
     not preferred. `aria-hidden@1.2.6`'s `hideOthers`, which Radix's Dialog uses to
     inert the background, deliberately keeps every `[aria-live]` element AND its
     whole ancestor chain unhidden (its own source cites theKashey/aria-hidden#10).
     Two of this component's six render sites are inside the shipped `Modal`
     (both `ManageMembers.js` sites, anchor `<KebabMenu`, under the
     `Modal` at anchor `<Modal open={modal}`), so an inline live region there
     makes the ENCLOSING dialog an ancestor-of-a-kept-target: opening the nested
     invite panel over it no longer sets `aria-hidden="true"` on the members modal,
     which is the shipped BLK-88-12-01 property `ManageMembers.modals.test.tsx`
     pins. Demonstrated: inline = that suite red on "leaves the invite panel live
     and the parent modal aria-hidden"; portaled = green.
     Body level is ALSO the shape the carve-out is designed for, and the shape this
     codebase already uses by hand — `ManageMembers.js` (anchor `.statusNode}`) mounts
     its four `statusNode`s OUTSIDE its `<Modal>` (which closes at anchor `</Modal>`) for exactly this
     reason. A shared six-site component cannot ask its hosts to do that, so it does
     it itself.
     REJECTED, kept not deleted: (a) leaving it inline and relaxing the modals
     suite's `aria-hidden` expectation — that trades a shipped a11y property for a
     rendering convenience; (b) dropping the explicit `aria-live` and relying on
     `role="status"`'s implicit one to dodge the `[aria-live]` query — it would work,
     but it means editing the shared `StatusRegion` primitive for ten-plus
     consumers to defeat a library heuristic.
     The `null` first value is the SSR guard: `createPortal` needs a real
     `document`, and this is a `'use client'` component that still renders on the
     server. The region is therefore in the DOM from the first COMMITTED render
     onward — long before any arming, which needs a separate user gesture. */
  const [portalTarget, setPortalTarget] = useState(null);
  useEffect(() => {
    setPortalTarget(document.body);
  }, []);

  /* DECISION Phase 88.6.1-05 (D-18, D-04): this component CONSUMES the shared
     dismissal hook (`src/components/ui/useDismissal.ts`: the outside mousedown
     listener, the container Escape, the focusout rule and the guarded trigger
     restore) and owns only its `open` state and its kebab-specific armed /
     announcement state.
     CHOSEN over (a) keeping the four pieces inline here while a second surface
     (NotificationBell, plan 88.6.1-28) copies them — REJECTED by the duplication
     tenet (D-18: one hook, never a copy); and over (b) a caller fallback-focus
     prop — REJECTED: this component's FOCUS behaviour is unchanged (D-04, worded
     per research MC-4), and focus after a host refresh unmounts the row is the
     HOST's, through plan 88.6.1-04's focus-recovery helper.
     A dismissal changes ONLY `open`: `closeMenu` deliberately does NOT reset the
     armed index, because the close-resets effect below reads the PRE-transition
     armed index to decide whether to emit the revert copy (KM-17, KM-24).
     Re-inlining these handlers is a decision, not a cleanup. */
  const closeMenu = () => setOpen(false);
  const { containerProps, restoreFocusToTrigger } = useDismissal({
    open,
    onDismiss: closeMenu,
    containerRef,
    triggerRef,
  });

  // The Escape / focusout / outside-pointer contract and its DECISION Phase 88.6-16 markers live in src/components/ui/useDismissal.ts since 88.6.1-05.

  /* DECISION Phase 88.6-16 (D-12), the KEBAB-ONLY half of the Escape contract
     (the shared half moved to `src/components/ui/useDismissal.ts` by 88.6.1-05).
     src/app/Header.js ("if (!mobileMenuOpen) return;"), the hamburger's
     Escape, is NOT a live collision for the kebab — opening the hamburger
     mousedown-closes this menu first (the hook's outside mousedown listener) —
     noted so nobody "fixes" it.

     THE ONE COMPOSITION WHERE THIS CONTRACT DOES NOT HOLD, and the plan text for it
     was WRONG — corrected here from a live measurement (2026-09-15,
     `keyboardOperability.test.tsx` KM-7), not from the plan. At two of the six
     render sites — `ManageMembers.js`'s two `<KebabMenu` mounts (the desktop owner-only
     transfer kebab and the mobile member actions), which
     render inside the shipped `Modal` at `ManageMembers.js`
     anchor `<Modal open={modal}` — Radix's `Dialog` (src/app/components/Modal.tsx ("<Dialog open={open}"),
     `<Dialog open={open}` / `<DialogContent`) binds Escape on `document` in the
     CAPTURE phase (`@radix-ui/react-use-escape-keydown`), which runs BEFORE any
     container handler and dismisses the dialog.
     What the plan said: "this component's Escape never runs there." MEASURED: it
     DOES run. Radix `preventDefault`s but does not `stopPropagation`, so the event
     still reaches the React tree in the bubble phase and this handler claims it —
     proved by an in-dialog ancestor `onKeyDown` spy that never fires.
     What is ACTUALLY true, and is the thing to carry forward: the OUTCOME. The whole
     dialog closes and takes the menu with it, and this handler's focus restore is a
     NO-OP because the trigger unmounts with the dialog — so where focus lands is the
     dialog's own close-focus behaviour, not this component's.
     ACCEPTED, not fixed — the alternative is threading `onEscapeKeyDown` into
     `DialogContent` while a descendant kebab is open, i.e. editing a shared dialog
     primitive and its call sites, which is a bigger decision than this component.
     Do NOT restate this as "the innermost open layer claims the press": at those two
     sites the OUTER layer dismisses, whichever handler ran. */

  /* The trigger restore (the hook's `restoreFocusToTrigger`) is GUARDED on the
     trigger still being in the document, because a committing Remove can unmount
     its own row and take the trigger with it (`ManageMembers.js`, anchor
     `removeUserFromGroup` then `await fetchMembers();`).

     SAID PLAINLY: on that path this guard is exactly equivalent to NO restore —
     it prevents a crash, not a lost focus position. This component does not close
     that, and the reason is not difficulty: a caller-supplied fallback target
     would be a new prop on a six-site shared component with no consumer. The
     residual moved to Phase 88.6.1's register (planning:.planning/deferred/phase-88.6.1.md ("### R063 half (b) + R107"),
     R063b + R107) and is closed there on the HOST side by plan 88.6.1-04's
     focus-recovery helper (D-04), not by a prop here. */

  // When the menu closes, reset any armed twoTap so reopening starts fresh.
  //
  /* DECISION Phase 88.6-16 (D-12): the revert copy is emitted HERE, gated on the
     PRE-transition `armedIndex` being non-null — chosen OVER a separate
     `committedRef` commit latch consulted and cleared by this effect.
     `armedIndex -> null` has THREE producers (the 3s timeout, this effect, and a
     SUCCESSFUL commit), and announcing the revert on the third would tell a
     screen-reader user the destructive action was CANCELLED at the exact moment
     it fired.
     Why the single gate makes all three rules true at once:
       - COMMIT: `setArmedIndex(null)` and `setOpen(false)` are dispatched in the
         same React 18 automatic batch, so this effect's closure already sees
         `armedIndex === null` — no emit.
       - outside-mousedown / Escape / focusout WHILE ARMED: only `open` changes,
         so the closure still carries the armed index — emit.
       - first mount: `armedIndex` is null — no emit.
       - the 3s timeout never changes `open`, so this effect does not run on that
         path at all and the timeout keeps emitting for itself.
     The rejected latch is a second piece of mutable state on a component with six
     render sites and buys nothing the batching already gives. Re-adding it is a
     decision, not a fix for a missing piece.
     AMENDED Phase 89.6-07 (OW-2a): the 3s timeout is gone (owner OW-2a: Keep), so
     armedIndex reaches null from TWO producers now, this effect and a SUCCESSFUL
     commit; the two sentences above that name the timeout are history. The single
     gate is unchanged and still keeps the revert words off a commit, the
     CONSEQUENCE this marker exists for. */
  // DECISION Phase 89.6-07 (OW-2a, owner 2026-11-22: Keep; the card: Stays armed while the menu is
  // open; closing the menu disarms it): a twoTap item has NO revert timer. Once live it stays armed
  // while its menu is open, however long, and while focus moves between the items of the menu (the
  // dismissal hook ignores a press or a focus move that stays inside the container); the menu
  // closing by any path, a press outside it, Escape on the menu, focus leaving it or the trigger,
  // is what disarms it, through this effect, which says the revert words. A commit never says them
  // (the D-12 gate above); a tap on another twoTap item re-arms there, silently, as before. Chosen
  // OVER the page buttons' disarm set
  // (src/components/ui/useConfirmAction.ts ("DECISION Phase 89.6-04 (OW-2, owner")),
  // which would disarm the item when focus moves to the next item of the menu (the owner kept the
  // menu as the boundary); OVER a longer live window (WCAG 2.2.1 counts the expiry of a window of
  // opportunity to react as a time limit); and OVER keeping 3 seconds (register L14: on the owner's
  // iPhone VoiceOver spent the window speaking, and the item had reverted before he could swipe
  // back to it). No scroll-out or page-hidden disarm here: the owner scoped the scroll-out disarm
  // to page buttons, and the page-hidden disarm is theirs too
  // (src/components/ui/useConfirmAction.ts ("DECISION Phase 89.6-04 (scroll-out)")),
  // so a menu left open across a locked phone still shows its armed item, on its red band, when
  // the person returns. Inside a dialog, Escape closes the dialog and this menu with it
  // (this file ("THE ONE COMPOSITION WHERE THIS CONTRACT DOES NOT HOLD")),
  // which unmounts the region and says nothing; nothing is left armed. The words are
  // DISARM_ANNOUNCEMENT from
  // src/components/ui/useConfirmAction.ts ("export const DISARM_ANNOUNCEMENT"),
  // the one home the page buttons say too (owner OW-2b: Yes), chosen OVER a second copy of the
  // sentence here. Adding a revert timer back is a decision, not a cleanup.
  useEffect(() => {
    if (!open) {
      if (armedIndex !== null) {
        setAnnouncement(DISARM_ANNOUNCEMENT);
      }
      setArmedIndex(null);
    }
  }, [open, armedIndex]);

  /* DECISION Phase 88.9-52 (G4, round 4, 2026-11-18): an open menu is FITTED to the box that clips
     it, once, when it opens. The list is an absolute box hung from the right edge of its trigger,
     as wide as its longest item up to 100vw - 2rem. That cap knows the screen, not the box the
     menu sits in. Inside the Manage Members dialog (two of the six render sites) the clipping box
     is the dialog's scrolling body, which starts 12px in from the screen and whose trigger sits
     further in again from its right: at 200% the 311px menu started 24px off
     the left of the screen with only part of each word showing, and at every text size the last
     item was cut by the dialog's footer line because nothing scrolled the menu into view
     (capture r3-m). Both predate round 3 (the menu has hung this way since it first rendered in
     a dialog; X67 let it grow to the cap).
     WHAT RUNS ON OPEN: find the nearest ancestor that clips (any overflow other than visible),
     else the screen; cap the width to that box less 8px each side (kept under the class's own
     cap by min()); if the menu still starts left of the box, move it right by the difference;
     then scroll it into view by the nearest edge (the list's scroll-m-2 keeps 8px clear), which
     scrolls the dialog body, or the page for a menu opened at the foot of the screen.
     Chosen OVER portalling the menu out of the dialog (the dismissal hook and the focusout rule
     reason about containment: the same settled question the aria-controls marker below refuses
     to reopen); OVER the house floating engine (a rebuild of a six-site component, for a
     fix); OVER a narrower fixed cap (it would wrap Transfer ownership to this member at normal
     text, which X67 exists to prevent); and OVER opening upward (it trades the foot of the box
     for the head of it). A layout effect, so the first paint is already fitted.
     NOT DONE: it does not refit while open (a rotation or a text-size change with the menu open
     closes nothing and moves nothing). With no layout to measure (a box of no width: a test
     page) it touches nothing. Changing this is a decision, not a cleanup.
     AMENDED Phase 88.9-52 (R4 B3, round 4, 2026-11-18; CI run 44381640391 and the re-shoot r4-m):
     the fit above knew the clipping box's WIDTH only. At 200% text the Manage Members body is
     262px tall on a 375 phone and 173px on a 320 one, and the member menu is 314 and 354px: the
     reveal could show the top of the menu or the bottom of it, never both, and Transfer
     ownership sat under the dialog's footer line where it cannot be tapped. Now a menu TALLER
     than the room it has takes that room as its max height (the clipping box's height, or the
     screen's, less 8px above and below; never under one item) and scrolls INSIDE ITSELF; the
     reveal then puts the whole capped box in view. A menu that fits is not touched, so every
     menu at ordinary text is exactly as it was.
     CHOSEN OVER drawing the open list outside the clipping box (a portal or a fixed layer placed
     by the trigger). Swept first: three markers in this file refuse that move, each for a
     reason that still holds. (1) The dismissal hook reasons about CONTAINMENT (the outside
     mousedown and the focusout rule ask whether the target is inside this wrapper; a portalled
     list is outside it, so a tap on an item would read as a tap outside and a Tab into the list
     as focus leaving). (2) The list is the next thing in the DOM after its trigger, which is
     what gives the keyboard order trigger, item, item with no focus management of our own; a
     portalled list sits at the end of the body and needs a focus trap or a roving order built
     for it, on six sites. (3) Two of the six sites are inside the Radix dialog, which makes
     everything outside its content inert and aria-hidden: a list portalled to the body there
     cannot be focused or read at all, and one portalled into the dialog shell is still clipped
     by the shell's own overflow-hidden. A list that scrolls inside itself changes none of
     that: same element, same place, same order, so Escape, the focus return to the trigger, the
     armed and busy states and keepOpen are untouched on all six sites, and a Tab to an item
     below the fold scrolls it into view natively. Its cost is said plainly: at 320 with 200%
     text the menu shows less than two of its three items at once and the rest is a scroll
     away; the cut item at the fold is the cue.
     The inline overflow replaces a one-item menu's own clip (overflow-hidden) only while
     capped, and sideways it stays hidden, so the rounded corners still clip the band. */
  const listRef = useRef(null);
  useLayoutEffect(() => {
    if (!open) return;
    const list = listRef.current;
    if (!list) return;
    let left = 0;
    let right = document.documentElement.clientWidth;
    // Up and down: the screen, narrowed to the clipping box when that box clips up and down.
    const screenHeight = document.documentElement.clientHeight;
    let top = 0;
    let bottom = screenHeight;
    for (let el = list.parentElement; el && el !== document.body; el = el.parentElement) {
      const style = window.getComputedStyle(el);
      const clipsY = (style.overflowY || 'visible') !== 'visible';
      if ((style.overflowX || 'visible') !== 'visible' || clipsY) {
        const box = el.getBoundingClientRect();
        left = box.left;
        right = box.right;
        if (clipsY) {
          top = screenHeight > 0 ? Math.max(box.top, 0) : box.top;
          bottom = screenHeight > 0 ? Math.min(box.bottom, screenHeight) : box.bottom;
        }
        break;
      }
    }
    if (right - left <= 0) return;
    const room = right - left - 2 * MENU_EDGE_GAP_PX;
    if (room > 0) list.style.maxWidth = `min(calc(100vw - 2rem), ${Math.floor(room)}px)`;
    // R4 B3: measured after the width cap (a narrower menu wraps its labels and grows taller) and
    // with any earlier cap cleared, so this reads the menu's own height.
    list.style.maxHeight = '';
    list.style.overflowY = '';
    list.style.overflowX = '';
    const own = list.getBoundingClientRect();
    const shift = left + MENU_EDGE_GAP_PX - own.left;
    list.style.translate = shift > 0.5 ? `${Math.ceil(shift)}px 0` : '';
    const roomY = bottom - top - 2 * MENU_EDGE_GAP_PX;
    if (roomY > 0 && own.height > roomY + 0.5) {
      const firstItem = list.querySelector('button');
      const oneItem = firstItem ? Math.ceil(firstItem.getBoundingClientRect().height) : 0;
      list.style.maxHeight = `${Math.max(Math.floor(roomY), oneItem)}px`;
      list.style.overflowY = 'auto';
      list.style.overflowX = 'hidden';
    }
    if (typeof list.scrollIntoView === 'function') list.scrollIntoView({ block: 'nearest', inline: 'nearest' });
  }, [open]);

  // X13-7 (88.9-67): the keepOpen exits put focus on the item that was activated. A no-op when
  // the press already focused it (a keyboard press, a Chromium click).
  const focusActivatedItem = (target) => {
    if (target && target.isConnected && document.activeElement !== target) target.focus();
  };

  const handleItemClick = (item, index, target) => {
    if (item.disabled) return;
    /* The `ariaDisabled` press is refused in the HANDLER, never by the platform —
       see the flag's DECISION marker at the item button below. */
    if (item.ariaDisabled) return;

    if (item.twoTap) {
      // First tap on this item: arm it (the F9b gate runs; no revert timer since 89.6-07, OW-2a).
      if (armedIndex !== index) {
        setArmedIndex(index);
        /* DECISION Phase 88.6-16 (D-12): the armed announcement names THE ITEM,
           a deliberate DIVERGENCE from src/components/ui/useConfirmAction.ts ("It MUST name the target")
           and from its `defaultAnnouncement` at src/components/ui/useConfirmAction.ts ("function defaultAnnouncement("),
           which builds a TWO-part string
           (`Press again to confirm: ${confirmLabel} ${targetLabel}`). The item
           label is not the target.
           WHY IT IS STILL RIGHT HERE, and it turns entirely on the region being
           per INSTANCE (see the region's own note above): the only shipped
           destructive item's label is the row-invariant 'Remove'
           (`ManageMembers.js`, anchor `label: 'Remove'`), but arming row 3 after row 1 writes into a
           DIFFERENT component instance's own region, which goes from empty to
           armed text — a change, so it announces. Measured 2026-09-14: every
           shipped menu carries AT MOST ONE twoTap item, so there is no in-instance
           target switch for a name to disambiguate; naming the item still earns
           its place because a menu with TWO twoTap items re-announces on a switch,
           which a bare confirm label would not.
           THE TWO DECISIONS MOVE TOGETHER: a one-region-per-surface design would
           make the row-invariant label unusable here.
           REJECTED, kept not deleted: a new per-item or per-menu field carrying
           the row's subject so the message could match the hook's two-part shape —
           another field on a six-site shared component's items API, which every
           shipped call site would have to author correctly, for a re-announcement
           the per-instance region already guarantees.
           AMENDED Phase 88.9-23 (F9b): written at the live edge, not at arm — content rule
           above unchanged. */
        pendingAnnouncementRef.current = `Press again to confirm: ${item.label}`;
        setAnnouncement('');
        return;
      }
      // Second tap while the gate still runs — refused (F9b): stay armed, announcement
      // unchanged. Read from the countdown's ref, keyed by this item's index.
      if (!isLive(index)) return;
      // Second tap once live: commit.
      setArmedIndex(null);
      // NOT the revert copy: a commit is not a cancellation.
      setAnnouncement('');
      item.onClick();
      // F9b: a keepOpen twoTap item stays open, mounted and focused after its commit — the
      // same promise the single-tap keep-open path makes (see that marker below).
      // AMENDED Phase 88.9-67 (X13-7): a keepOpen exit focuses the activated item, so focus stays
      // on it where a tap does not focus (WebKit) and a host's focus recovery can watch it, chosen
      // OVER threading the element into item.onClick (an items-API change on six sites).
      if (item.keepOpen) {
        focusActivatedItem(target);
        return;
      }
      setOpen(false);
      restoreFocusToTrigger();
      return;
    }

    // Single-tap path.
    item.onClick();

    /* DECISION Phase 88.6-16 (D-12/D24): an opt-in per-ITEM keep-open flag on the
       SINGLE-TAP path — over converging gameDetail's kebab onto duplicate markup
       (rejected by the duplication tenet) and over a plain swap that loses the
       in-flight 'Cancelling…' feedback on two destructive actions. Owner ruling
       2026-09-09 (D24 c).

       It is INERT by default: measured, none of the 6 shipped render sites passes
       it. Plan 88.6-18 is its first consumer.

       Delete must NOT become 'twoTap + keepOpen' on the strength of this flag —
       the two-tap tiers in src/app/gameDetail/page.js ("D-40 + D-07: explicitly NOT the two-tap tier.")
       and `ManageMembers.js` (anchor `DECISION Phase 88 AR-DEC-3`) reason
       from the CURRENT auto-close and
       are unchanged by a per-item opt-out.
       AMENDED Phase 88.9-67 (X13-7): ManageMembers' phone Remove is now twoTap + keepOpen;
       AR-DEC-3's arming-tap reason is unchanged; the session Delete stays on the dialog tier.

       The flag opts an item out of one close TRIGGER, never out of dismissal:
       outside-mousedown, Escape and the focusout rule all behave exactly as they do
       without it. A keep-open activation closes nothing and unmounts nothing, so
       there is no focus to restore and none is stolen — focus stays on the item.
       That is true ONLY because an activated item's busy gate is `ariaDisabled` and
       never the native disabled attribute (see the item button below).
       AMENDED Phase 88.9-23 (owner pick F9b, 88.9-PICKS-B5.json, 2026-11-07): keepOpen is now
       also honoured on the twoTap commit, for gameDetail's Cancel event / Leave event, chosen
       OVER the single-tap-only flag (which would have closed the menu and hidden Cancelling…,
       D24 c). The Delete sentence above still stands: the session Delete stays on the dialog
       tier.
       AMENDED Phase 88.9-67 (X13-7): a keepOpen exit focuses the activated item, so focus stays
       on it where a tap does not focus (WebKit) and a host's focus recovery can watch it, chosen
       OVER threading the element into item.onClick (an items-API change on six sites). The
       sentence above, that focus stays on the item, was untrue on WebKit until this. */
    if (item.keepOpen) {
      focusActivatedItem(target);
      return;
    }

    setOpen(false);
    restoreFocusToTrigger();
  };

  /* DECISION Phase 88.6-16 (D-12): with NO items the component renders no trigger
     at all — chosen OVER today's unconditional trigger against a default
     `items = []`, which ships a 44x44 control that opens nothing. A deliberate
     behaviour change on a component with 6 render sites. Every hook above runs
     first, so this early return never changes hook order. */
  if (items.length === 0) return null;

  // 88.9-52 (R20): the band's shape follows the item COUNT (the marker is on the list below).
  const soloItem = items.length === 1;

  return (
    <div
      className="relative shrink-0"
      ref={containerRef}
      {...containerProps}
    >
      {/* DECISION Phase 88.6-16 (D-12): an sr-only StatusRegion, mounted at PROP
          time on `items.some(i => i.twoTap)` — mounted for the whole life of every
          instance that can ever announce, absent from instances that cannot. A
          label swap on a focused element does not announce (the 88.6 UI-SPEC §7.3 rule,
          restated at src/app/components/FriendInvitePanel.js ("that swap, and a label change on the element the user is"), "a label change on the element the
          user is focused on does not announce"), which is why the region exists at all.

          THE GATE'S YIELD, MEASURED 2026-09-14 and written here because a wrong
          rationale at a site is inherited as fact: it does NOT thin the per-row
          count on either surface that can announce. `ManageMembers.js` (anchor `role !== 'pending').map`)
          maps the members and the mobile kebab (its second `<KebabMenu`) ALWAYS carries the
          `twoTap: true` Remove; `OpenPollsList.js`'s `prompts.map` rows, each with a
          `<KebabMenu` gated on `prompt.can_close === true` whose one item is `twoTap: true`, are the
          same shape. So the predicate is TRUE for every row and the region IS per row on
          both surfaces — that is the accepted design, and it is precisely what makes
          the item-label announcement sound. What the gate buys is exactly one thing:
          an instance that can NEVER announce carries no region — the shipped example
          is the desktop owner-only transfer kebab in `ManageMembers.js` (its first `<KebabMenu`),
          whose single item has no twoTap (anchor `label: 'Transfer ownership to this member'`).

          The "one region per SURFACE" reading is WRONG and is not restated here:
          src/components/ui/useConfirmAction.ts ("Render it ONCE, unconditionally,") says "Render it ONCE, unconditionally,
          anywhere inside the surface" — one region per GATE, always mounted — and
          `ManageMembers.js` mounts FOUR of them on ONE surface (src/app/components/ManageMembers.js ("{removeMemberGate.statusNode}"), src/app/components/ManageMembers.js ("{rejectMemberGate.statusNode}"),
          src/app/components/ManageMembers.js ("{resetInviteGate.statusNode}"), src/app/components/ManageMembers.js ("{promoteAdminGate.statusNode}"), each `.statusNode}`).

          RECORDED REJECTED ALTERNATIVE, kept not deleted: hoisting the announcement
          out through a `statusNode` / `onAnnounce` prop the host supplies — an API
          addition to a six-site shared component for no user-visible gain,
          justified only by the per-surface rule that is not the shipped reality.

          It is PORTALED to `document.body` — see the portal DECISION marker above
          for the measured reason and the two rejected arms. Its placement here in
          the JSX is where it belongs conceptually; `createPortal` decides where it
          lands in the DOM. */}
      {canAnnounce && portalTarget
        ? createPortal(<StatusRegion className="sr-only" message={announcement} />, portalTarget)
        : null}

      {/* DECISION Phase 88-28 (Req 4, AR R2-M22): the trigger carries an explicit
          `min-h-11 min-w-11` + centring box, chosen OVER leaving it at `px-2 py-1` and OVER
          the invisible `after:` hit extension.

          MEASURED, because the must-have's own figure was wrong: this control is NOT the
          "~40x40 via p-2 + w-6 svg" the plan text describes (that is the Header hamburger).
          It is `text-2xl` + `leading-none` + `py-1` = 4 + 24 + 4 = 32px tall, and `px-2`
          around a `⋮` glyph ~= 24px wide. So it was ~24x32, the worst of the two, not the
          better one — 87.8-08's census logged it as "~38px FAIL" which was also generous.

          It gets the visible box rather than a pseudo-element because D-40 made this the SOLE
          phone entry point for row actions on gameDetail and ManageMembers: at `md:hidden`
          the inline Edit/Delete are gone and this is the only way to reach them. A control
          that is the only path to a destructive action should not be the one whose real
          target is smaller than it looks. The +20px of width lands in a `shrink-0` cell at
          the end of a row, so content reflows rather than clipping.

          `.btn`'s phone floor (D-36, globals.css) does not reach this control — it is not a
          `.btn` — which is exactly why it needed its own. Removing the floor is a decision.

          DECISION Phase 88.6-16 (D-12), appended 2026-09-15: this component no longer claims
          the ARIA menu pattern. The popup-role attribute on this trigger and the two dropdown
          role attributes are REMOVED, because the component implemented none of that
          contract — no arrow navigation, no Home/End, no type-ahead, and (until this change)
          no keyboard close path at all. Claiming it was worse than claiming nothing.
          REJECTED: implementing the full WAI-ARIA menu contract. It would require re-tiering
          the two destructive items to `ConfirmDialog`, reopening AR-DEC-3
          (`ManageMembers.js`, anchor `DECISION Phase 88 AR-DEC-3`), for ~90-120 lines. If it is
          ever chosen, the engine is `@floating-ui/react` — the house engine (src/components/ui/Combobox.tsx ("DECISION Phase 88-08 (OI-6): this primitive is built on"),
          `DECISION Phase 88-08 (OI-6)`) — and NEVER Radix
          DropdownMenu, which is not a dependency and portals by default.
          Re-adding the popup-role attribute in ANY form, including the `="true"` value, is
          FORBIDDEN: ARIA maps that value to the menu role, so it re-asserts the exact claim
          this removal makes. */}
      <button
        type="button"
        ref={triggerRef}
        onClick={() => setOpen((prev) => !prev)}
        /* DECISION Phase 88.9-35 R033 (owner pick B2a, 88.9-PICKS-B1.json, 2026-11-04): the trigger's
           halo is the HOST's ground passed as a typed hostGround key
           (src/components/ui/hostGround.ts ("export const HOST_GROUND_HALO")), default card — every
           live phone host is a card — merged
           after the shipped literal with cn so the literal keeps its card key, chosen OVER round 1's
           fixed card halo on every host. The tinted group-page host left with F5b; the groupPlanning
           desktop arm (card on a phone, page from md) cannot be named by one key and is plan
           88.9-50's. Changing this is a decision, not a cleanup.
           AMENDED Phase 88.9-50 (plan review 2026-11-08): the groupPlanning desktop arm named above was a census false positive — OpenPollCard's li paints bg-surface-card at every width (src/app/components/OpenPollsList.js ("const CARD_ROW_CLASS = 'bg-surface-card border border-line rounded-card flex flex-wrap items-start';")), so every live host is a card and the default key is right; no md companion on this trigger, chosen OVER one (it would paint a page-coloured gap on a card row from 768px, band 1.31 / 1.22). */
        className={cn(
          'inline-flex min-h-11 min-w-11 items-center justify-center text-2xl text-content-muted hover:text-content-primary leading-none rounded-sm hover:bg-surface-hover active:opacity-75 transition-colors focus:outline-hidden focus-visible:ring-2 focus-visible:ring-focus-ring focus-visible:ring-offset-2 focus-visible:ring-offset-surface-card',
          hostGroundHalo(hostGround)
        )}
        aria-expanded={open}
        /* DECISION Phase 88.6-16 (D-12): `aria-controls` is the HONEST replacement
           for the removed popup relationship — it says only what is true (this
           trigger controls that list) — and it is rendered ONLY while the menu is
           open, using the conditional-spread form the house idiom uses at
           src/components/ui/useConfirmAction.ts ("'aria-pressed': true as const") (`...(armed ? { 'aria-pressed': true as const } : {})`). The
           dropdown is conditionally rendered, so a
           permanently-present attribute would name an element that is NOT in the
           document for most of the component's life: a dangling reference, not a
           relationship.
           RECORDED REJECTED ALTERNATIVE, kept not deleted: render the list
           unconditionally and toggle the HTML `hidden` attribute instead of
           unmounting it. That also removes the dangle, and it is rejected because it
           changes what the container CONTAINS while closed — both the mousedown
           outside-close and the focusout rule reason about containment, so it moves
           a settled question to fix an attribute lifetime. */
        {...(open ? { 'aria-controls': listId } : {})}
        aria-label={ariaLabel}
        title={ariaLabel}
      >
        {/* Unicode vertical-ellipsis — matches gameDetail event-actions kebab. */}
        ⋮
      </button>

      {open && (
        /* DECISION Phase 88.6-16 (D-12): the explicit `role="list"` is LOAD-BEARING,
           not redundant ARIA awaiting a cleanup. Tailwind v4's own preflight sets
           `list-style: none` on every `ul` in this app
           (`node_modules/tailwindcss/preflight.css`, the `ol, ul, menu` block, active
           via `@import 'tailwindcss' source(none);` at src/app/globals.css ("@import 'tailwindcss' source(none);")), and
           `list-style: none` strips the IMPLICIT list role in Safari/VoiceOver — the
           surface this project declares primary. Plain buttons announced as a set
           with a count is the WHOLE compensation for dropping the menu pattern, so
           without this attribute the trade is void. No `list-none` utility is added
           here and none is needed: the preflight already did it, and this attribute
           compensates for the PREFLIGHT, not for a utility a reader could simply
           drop. The axe audit cannot see this (it does not model the Safari quirk) —
           `keyboardOperability.test.tsx` is the only gate on it. */
        /* DECISION Phase 88.9-67 (X67): the menu sizes to its longest item (w-max) with the 160px
           floor and a viewport cap, chosen OVER raising the floor (252px to unwrap Transfer
           ownership to this member, widening every short menu) and OVER shortening labels (no
           owner word). An absolute right-0 box in the 44px trigger wrapper shrank to 44px, so the
           floor fixed every menu at 160px and the armed lines wrapped. Long labels still wrap at
           the cap (E6). */
        /* DECISION Phase 88.9-52 (R20, owner 2026-11-17, pick Rule; his words: "When it's by
           itself, it should fill the box."): the band an item paints (the armed red, and the hover
           fill) has ONE rule by item count. A menu with ONE item: the list drops its vertical
           padding and clips to its own rounded corners, so the band fills the whole menu, 1px
           inside the border. A menu with SEVERAL items: each row is inset 4px at the sides and
           the item is rounded, which with the list's 4px vertical padding and 1px border is an
           even 5px on every side of the band, the same on a first, middle or last item. The text
           starts where it did (4px row + 8px item is the 12px the item carried alone), so no menu
           changes width, and the shape is set by the COUNT, never by the armed state, so no menu
           changes size when an item arms. A one-item menu is 8px shorter than it was (46px with
           the 44px item), at rest and armed alike.
           Chosen OVER the square band between two 5px strips of card that every menu had (W32,
           the look half: in the one-item Event actions menu it read as a stripe in a box); OVER
           filling to the corners in every menu (in the three-item member menu the owner preferred
           the inset band); and OVER switching shape on arming (the menu would jump). Written as
           whole class names on the count, not a parent-state selector: the count is known here.
           The replica in e2e/touch-targets.spec.ts ("UI-SPEC §9.3 E6: the kebab popover stays inside 375px") follows these strings in lockstep.
           Changing either shape is a decision, not a cleanup.
           AMENDED Phase 88.9-52 (G3, round 4, 2026-11-18; the after-build capture r3-l rendered
           the several-item menu):
           - NEIGHBOURING BANDS ARE 2px APART (space-y-0.5 on the list; the gap is between ROWS,
             so every item keeps its own 44px floor). As built two neighbours touched: an armed
             band and a hovered band met with 0px between them, which is not an inset band on
             that side. Chosen OVER 4px (nearer the 5px edges, but it moves further from the
             picture the owner picked, where rows sat edge to edge) and OVER shrinking the item
             inside its row (the tap height would drop under 44px). A several-item menu is 2px
             taller per row after the first; the size still follows the COUNT, never the armed
             state. A one-item menu takes none of it.
           - AN ITEM HOVERS ON THE GHOST WASH (enabled-hover:bg-surface-ghost-hover, the owner's
             R8c ruling: a visible hover fill), chosen OVER the shared hover wash it wore
             (hover:bg-surface-hover: #faf8f5 on the white menu, 1.06, near invisible in both
             shapes). Light #e3dad1: 1.38 off the menu, primary ink 13.02 and danger ink 6.02 on
             it. Dark is the same colour as before (the token names the shared wash there): 1.23
             off the menu, inks 10.64 and 5.94. The enabled-hover form also means a gated or
             busy (aria-disabled) item no longer lights under the pointer, the house rule
             (src/components/ui/Button.tsx ("/* DECISION Phase 88.6-06 (D10): the hover elevation above, and the ghost")). The trigger keeps its own wash. */
        <ul
          id={listId}
          ref={listRef}
          role="list"
          className={`absolute right-0 top-full mt-1 z-20 scroll-m-2 w-max min-w-[160px] max-w-[calc(100vw-2rem)] bg-surface-card border border-line rounded-md shadow-theme-lg ${
            soloItem ? 'py-0 overflow-hidden' : 'py-1 space-y-0.5'
          }`}
        >
          {items.map((item, index) => {
            const isArmed = item.twoTap && armedIndex === index;
            // F9b: an armed item counts down while gated, then reads its armed label.
            const isGated = isArmed && !armedLive;
            /* DECISION Phase 88.9-52 (R13): the live armed item SHOWS the house words Tap again
               (src/components/ui/useConfirmAction.ts ("export const DEFAULT_ARMED_LABEL"), where the
               ruling and its reasons are written) and is NAMED by the full sentence, the item's
               armedName or the menu's; chosen OVER the sentence as the visible label (what shipped)
               and OVER dropping the sentence from the name. The item field and the menu prop were
               called confirmLabel while they WERE the visible label; they are armedName now, so the
               name of the field says which string it holds. R20's band rule, W31 and W32 are
               untouched: the shape still follows the item count and the reserve is still measured
               at the armed weight. Showing the sentence again is a decision, not a cleanup. */
            const isLiveArmed = isArmed && !isGated;
            const label = isArmed
              ? isGated
                ? countdownLabel(secondsLeft)
                : DEFAULT_ARMED_LABEL
              : item.label;
            const danger = item.danger || isArmed;
            // 88.9-52 (W31): which of the two spinner mounts below this item uses. A property of the
            // item, never its busy flag, so neither mount unmounts when busy drops (the R-C3b hold).
            const reservesLabel = Boolean(item.twoTap);
            return (
              /* DECISION Phase 88.6-16 (D-12/D24): the mapped root is keyed on
                 POSITION, over the label-derived key this map used to carry. NOT
                 cosmetic. `keepOpen` exists precisely so the PARENT can flip an
                 item's label under a FOCUSED item (plan 18 flips both destructive
                 items to their in-flight strings and relies on them staying mounted
                 and focused for the whole request). A key derived from the label
                 hands React a NEW key at the same position, so the button unmounts
                 and remounts and focus lands on `<body>` — where the container-bound
                 Escape handler above is not on the propagation path. That is the same
                 end state the `ariaDisabled` rule below refuses the native disabled
                 attribute for, reached by a second route; both rules must hold or the
                 keep-open focus promise is false.
                 The index is ALREADY this component's identity basis for arming
                 (`armedIndex`), so a positional key makes the DOM key and the state
                 key agree, and the one conditionally-spread item
                 (`ManageMembers.js`, anchor `...(userRole === 'owner' ? [{`) is spread LAST, so indices never shift
                 and a positional key cannot mis-pair a node with a different action.
                 Re-deriving the key from the label later is a REGRESSION, not a
                 cleanup. No `id` field is introduced: measured, zero of the 6 shipped
                 render sites passes one, so an `id ?? index` form is dead in every
                 branch. The documented Items API above is where explicit identity
                 would be added if a future render site ever needs it. */
              <li key={index} className={soloItem ? undefined : 'px-1'}>
                <button
                  type="button"
                  onClick={(event) => handleItemClick(item, index, event.currentTarget)}
                  disabled={item.disabled}
                  /* DECISION Phase 88.6-16 (D-12): `aria-pressed` is present ONLY
                     while armed and ABSENT (never "false") at rest — the
                     conditional-spread form of src/components/ui/useConfirmAction.ts ("'aria-pressed': true as const") (`'aria-pressed': true`), never an
                     `aria-pressed={isArmed}` binding. React stringifies booleans on
                     `aria-*`, so the binding form would stamp `aria-pressed="false"`
                     on every resting item and on non-toggle `twoTap: false` items
                     (src/app/gameDetail/page.js ("D-40 + D-07: explicitly NOT the two-tap tier."), `twoTap: false`), announcing plain actions as unpressed
                     toggles — the inverse of the house idiom.
                     This attribute is LEGAL here only because the item role is gone:
                     axe-core 4.12.1's `menuitem.allowedAttrs` permits only posinset,
                     setsize and expanded. The role removal and this attribute are ONE
                     change, not two. */
                  {...(isArmed ? { 'aria-pressed': true } : {})}
                  /* DECISION Phase 88.6-16 (D-12): the opt-in per-item `ariaDisabled`
                     flag renders `aria-disabled="true"` (absent at rest) and NEVER the
                     native disabled attribute, with the press refused by the early
                     return at the top of `handleItemClick`.
                     WHY: a natively-disabled focused element blurs to `<body>` in a
                     real browser, and the container-bound Escape handler is not on the
                     propagation path of a `<body>` keydown — so the keyboard dismissal
                     path would degrade to tabbing the whole document for the duration
                     of a request, with the item the user was standing on gone from the
                     focus order and no announcement.
                     THE HOUSE RULE IS HONOURED, NOT INVENTED. It is a SPLIT, stated
                     at src/app/components/NextGameNightCard.tsx ("DECISION Phase 88.5 (SPEC Req 4 / UI-SPEC A-5, narrowed)")
                     and src/app/components/EmailAddressSection.tsx ("DECISION Phase 88.8 DR-C (re-scoped 2026-09-04, plan review round 4)") (the
                     split restated at src/app/components/EmailAddressSection.tsx ("a control nobody is standing on may be natively disabled"), "a control nobody
                     is standing on"): the control being ACTED ON gets `aria-disabled`; a control
                     nobody is standing on may stay natively disabled. `item.disabled`
                     therefore STAYS in the API for that second kind.
                     INERT by default: measured, zero of the 6 shipped render sites
                     passes `disabled:` or `ariaDisabled:`. Plan 18 is the first
                     consumer of both this and `keepOpen`.
                     REJECTED, kept not deleted: dropping the busy gate entirely and
                     letting the caller's ref latch be the whole guard — zero change
                     here, but it deletes the busy affordance that ships today and
                     leaves no programmatic busy state for assistive tech, making a
                     destructive item look fully live while a request is in flight. */
                  /* F9b (88.9-23): an armed item inside its gate renders aria-disabled the same
                     way; the refusal is the isLive check in handleItemClick. */
                  {...(item.ariaDisabled || isGated ? { 'aria-disabled': true } : {})}
                  /* X69 (88.9-67): only while gated the item carries a name of its own — its resting
                     label, then the wait — because Wait (n) alone would not say what it does. */
                  {...(isGated ? { 'aria-label': countdownName(item.label, secondsLeft) } : {})}
                  /* R13 (88.9-52): live, the name is the full sentence; it starts with the visible
                     Tap again (Label in Name). At rest the item is named by its own text. */
                  {...(isLiveArmed ? { 'aria-label': item.armedName || armedName } : {})}
                  /* 88-CODE-REVIEW MED#13: min-h-11 — the 87.8-08 census FAIL row (~36px)
                     these items still carried after D-40 made this menu the SOLE phone
                     path to destructive row actions. The trigger was floored by 88-28;
                     the items behind it were not. The dropdown is an absolute overlay,
                     so taller rows reflow nothing outside it. */
                  /* DECISION Phase 88.9-23 O-17: the gated (aria-disabled) item changes INK
                     (text-content-muted) over an opacity wash — src/app/tokenContrast.test.ts ("no aria-disabled rule uses opacity")
                     forbids the dim, and the wash this item carried was that test's blind spot (a
                     variant-prefixed utility). It also restyles the in-flight Cancelling… / Leaving…
                     items. Owner confirm from one picture (88.9-23 task 3). */
                  className={`w-full min-h-11 text-left ${soloItem ? 'px-3' : 'px-2 rounded-sm'} py-2 text-sm active:opacity-75 transition-colors disabled:opacity-50 disabled:cursor-not-allowed aria-disabled:text-content-muted aria-disabled:cursor-not-allowed focus:outline-hidden focus-visible:ring-2 focus-visible:ring-focus-ring focus-visible:ring-inset ${
                    danger
                      ? `text-content-status-error ${isArmed ? 'bg-status-error-subtle font-semibold' : 'enabled-hover:bg-surface-ghost-hover'}`
                      : 'text-content-primary enabled-hover:bg-surface-ghost-hover'
                  }`}
                >
                  {/* X69 width (88.9-67): a twoTap item holds the widest of Wait (3), (2), (1) and its
                       armed words from the moment the menu opens, so the item and the menu keep their
                       size when it arms and when it goes live; a plain item renders its bare label. */}
                  {/* AMENDED Phase 88.9-52 (W32, width half): the reserve is measured at the armed weight
                       (font-semibold, the weight the gated and armed labels paint at, on the armed
                       branch of this item's className), chosen OVER the resting weight it inherited: the
                       Cancel event menu grew 1.4px (160 to 161.4, measured at 375) on the first tap. */}
                  {/* DECISION Phase 88.9-52 (W31): a busy twoTap item's spinner is rendered INSIDE the
                       label's cell, straight after the word, chosen OVER after the reserved cell, where
                       it sat about 90px right of a short word (measured: the member menu's Remove,
                       whose cell holds Tap again to remove). The cell is as wide as its widest
                       occupant, so the word plus the spinner still fits the reserved width for every
                       shipped label. A plain item has no reserved cell and keeps the spinner after its
                       label. Moving it back out is a decision, not a cleanup.
                       AMENDED Phase 88.9-52 (R13): the cell now holds the short Tap again, which no
                       longer covers the resting word plus the spinner by itself, so that width is
                       reserved by name: the item's own label with the spinner's room after it (pr-6 is
                       the spinner's ml-2 plus its w-4), at the resting weight a busy item paints at.
                       Chosen OVER leaving it to the short words, where a one-item menu at enlarged
                       text would widen by the spinner when the request starts.
                       AMENDED Phase 88.9-52 (G2, round 4, 2026-11-18): that resting weight is now NAMED
                       on the reserve (font-normal), chosen OVER inheriting it. An armed item paints
                       font-semibold on this button, the reserve inherited it, and the cell grew to
                       the bold form of the item's own word: the one-item End check-in menu measured
                       273.23px at rest and 277.34px at Wait (3) and Tap again at 200% text (capture
                       r3-m). At normal text the 160px floor hid it; a menu whose longest item is a
                       plain one (the member menu) never showed it. Every occupant of the cell now
                       has one weight in every state, so the cell cannot change with arming. */}
                  {reservesLabel ? (
                    <ReservedLabel
                      reserve={[...COUNTDOWN_LABELS, DEFAULT_ARMED_LABEL]}
                      reserveClassName="font-semibold"
                      reserveTrailing={{ text: item.label, className: 'pr-6 font-normal' }}
                    >
                      {label}
                      <DelayedSpinner busy={Boolean(item.busy)} className="ml-2 align-middle" />
                    </ReservedLabel>
                  ) : (
                    label
                  )}
                  {/* DECISION Phase 88.9-46 (rule 1 kebab busy): a busy item keeps its label and
                       shows the house spinner plus a heard suffix (the same sr-only span Button
                       renders), chosen OVER the caller swapping the label string (the shipped
                       gameDetail pattern — the in-flight word replaced the whole name) and OVER a
                       native disabled item (the 88.6-18 D3 marker: a focused natively-disabled item
                       blurs to body). The item is a block w-full button, not flex, so the spinner
                       carries its own ml-2 (the raw-button composition of 88.9-45). busy is not a
                       refusal: `item.ariaDisabled` stays the gate.
                       AMENDED Phase 88.9-56 (R-C3b reach): the spinner is the delayed, held element, mounted
                       beside the label outside the busy ternary (an element, not a hook, so it works inside
                       items.map); the ternary keeps only the heard suffix. An item that navigates on success
                       keeps busy until the page unmounts.
                       AMENDED Phase 88.9-52 (W31): a twoTap item mounts that same element inside its
                       label cell above; only a plain item mounts it here. */}
                  {reservesLabel ? null : <DelayedSpinner busy={Boolean(item.busy)} className="ml-2 align-middle" />}
                  {item.busy ? <span className="sr-only">{item.busySuffix}</span> : null}
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
