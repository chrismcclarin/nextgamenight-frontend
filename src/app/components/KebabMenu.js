'use client';

import { useState, useEffect, useRef, useId } from 'react';
import { createPortal } from 'react-dom';

import { StatusRegion } from '@/components/ui/StatusRegion';

/**
 * KebabMenu — reusable ⋮ trigger + dropdown overlay.
 *
 * Used to collapse multiple row actions into a single touch-friendly target
 * on narrow viewports. Trigger style + dropdown chrome match the gameDetail
 * event-actions kebab (Phase 65-02) for visual consistency.
 *
 * twoTap items follow the Phase 65-02 destructive-confirm pattern:
 *   - First tap: label flips to "Tap again to confirm" (or item.confirmLabel),
 *     3s revert timer arms, item highlights red.
 *   - Second tap on same item within 3s: invokes item.onClick + closes menu.
 *   - Timeout or another item tap reverts the armed state.
 *
 * Outside-click closes the menu (mousedown listener on a container ref,
 * mirroring NotificationBell.js). A `focusout` whose relatedTarget is non-null
 * and outside the container is the KEYBOARD half beside it.
 */

/* The sr-only copy emitted when an armed twoTap item reverts. It is NOT emitted
   on a successful commit — see the close-resets effect below. */
const REVERT_ANNOUNCEMENT = 'Confirmation cancelled.';

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
 * @property {string} [confirmLabel] - Armed label for this item, overriding the menu default.
 * @property {boolean} [disabled] - Native `disabled`. For a control NOBODY is standing on.
 * @property {boolean} [ariaDisabled] - `aria-disabled` + a handler refusal, never the native
 *   attribute. For the control being ACTED ON, whose label must stay readable and which must
 *   stay in the focus order.
 * @property {boolean} [keepOpen] - Suppress the close on the SINGLE-TAP path only. Inert on a
 *   twoTap item.
 */

/**
 * @param {Object} props
 * @param {string} [props.ariaLabel] - Accessible label for the trigger button.
 * @param {KebabMenuItem[]} [props.items] - Action items. An EMPTY array renders no trigger.
 * @param {string} [props.confirmLabel] - Default label for armed twoTap items.
 *                                        Each item can override via item.confirmLabel.
 */
export default function KebabMenu({
  ariaLabel = 'Actions',
  items = [],
  confirmLabel = 'Tap again to confirm',
}) {
  const [open, setOpen] = useState(false);
  const [armedIndex, setArmedIndex] = useState(null);
  const [announcement, setAnnouncement] = useState('');
  const containerRef = useRef(null);
  const triggerRef = useRef(null);
  const armedTimerRef = useRef(null);
  const listId = useId();

  // PROP-TIME gate, never an on-arm mount: a live region created at the moment
  // of the announcement announces nothing, which is the whole reason for the
  // StatusRegion idiom (useConfirmAction.ts:162-180).
  const canAnnounce = items.some((item) => item.twoTap);

  /* DECISION Phase 88.6-16 (D-12): the announcement region is PORTALED to
     `document.body` rather than rendered inline in the wrapper below — MEASURED,
     not preferred. `aria-hidden@1.2.6`'s `hideOthers`, which Radix's Dialog uses to
     inert the background, deliberately keeps every `[aria-live]` element AND its
     whole ancestor chain unhidden (its own source cites theKashey/aria-hidden#10).
     Two of this component's six render sites are inside the shipped `Modal`
     (`ManageMembers.js:571`, `:595` under `:378`), so an inline live region there
     makes the ENCLOSING dialog an ancestor-of-a-kept-target: opening the nested
     invite panel over it no longer sets `aria-hidden="true"` on the members modal,
     which is the shipped BLK-88-12-01 property `ManageMembers.modals.test.tsx`
     pins. Demonstrated: inline = that suite red on "leaves the invite panel live
     and the parent modal aria-hidden"; portaled = green.
     Body level is ALSO the shape the carve-out is designed for, and the shape this
     codebase already uses by hand — `ManageMembers.js:819-827` mounts its four
     `statusNode`s OUTSIDE its `<Modal>` (which closes at `:712`) for exactly this
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

  // Outside-click closes the dropdown (mousedown so it fires before click
  // bubbles, same idiom as NotificationBell).
  //
  // KEEP BOTH CLOSE PATHS. This mousedown handler is not wrong, it is
  // INCOMPLETE: it owns POINTER dismissal only. The `focusout` handler on the
  // container below is the KEYBOARD half beside it, and it deliberately does
  // not guess about pointers. Deleting either one leaves a dismissal hole —
  // that is a decision, not a cleanup.
  useEffect(() => {
    if (!open) return;
    function handleClickOutside(e) {
      if (containerRef.current && !containerRef.current.contains(e.target)) {
        setOpen(false);
      }
    }
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [open]);

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
     decision, not a fix for a missing piece. */
  useEffect(() => {
    if (!open) {
      if (armedTimerRef.current) {
        clearTimeout(armedTimerRef.current);
        armedTimerRef.current = null;
      }
      if (armedIndex !== null) {
        setAnnouncement(REVERT_ANNOUNCEMENT);
      }
      setArmedIndex(null);
    }
  }, [open, armedIndex]);

  // Cleanup on unmount — pending timer must not fire after unmount.
  useEffect(() => {
    return () => {
      if (armedTimerRef.current) {
        clearTimeout(armedTimerRef.current);
        armedTimerRef.current = null;
      }
    };
  }, []);

  /* Focus returns to the trigger after a close that unmounted the focused item.
     GUARDED on the trigger still being in the document, because a committing
     Remove can unmount its own row and take the trigger with it
     (`ManageMembers.js:193-211`: `removeUserFromGroup` at `:196` then
     `await fetchMembers()` at `:197`).

     SAID PLAINLY: on that path this guard is exactly equivalent to NO restore —
     it prevents a crash, not a lost focus position. This component does not close
     that, and the reason is not difficulty: a caller-supplied fallback target
     would be a new prop on a six-site shared component with no consumer. The
     residual is registered in `.planning/deferred/phase-88.6.md`, paired with the
     sibling host-target residual plan 28 registers for `MemberChipStack`. */
  const restoreFocusToTrigger = () => {
    const trigger = triggerRef.current;
    if (trigger && trigger.isConnected) trigger.focus();
  };

  const handleItemClick = (item, index) => {
    if (item.disabled) return;
    /* The `ariaDisabled` press is refused in the HANDLER, never by the platform —
       see the flag's DECISION marker at the item button below. */
    if (item.ariaDisabled) return;

    if (item.twoTap) {
      // First tap on this item: arm the 3s revert timer.
      if (armedIndex !== index) {
        if (armedTimerRef.current) clearTimeout(armedTimerRef.current);
        setArmedIndex(index);
        /* DECISION Phase 88.6-16 (D-12): the armed announcement names THE ITEM,
           a deliberate DIVERGENCE from `useConfirmAction.ts:76-80` (the contract
           sentence says the text must name the TARGET) and from its
           `defaultAnnouncement` at `:153-160`, which builds a TWO-part string
           (`Press again to confirm: ${confirmLabel} ${targetLabel}`). The item
           label is not the target.
           WHY IT IS STILL RIGHT HERE, and it turns entirely on the region being
           per INSTANCE (see the region's own note above): the only shipped
           destructive item's label is the row-invariant 'Remove'
           (`ManageMembers.js:618`), but arming row 3 after row 1 writes into a
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
           the per-instance region already guarantees. */
        setAnnouncement(`Press again to confirm: ${item.label}`);
        armedTimerRef.current = setTimeout(() => {
          setArmedIndex(null);
          armedTimerRef.current = null;
          setAnnouncement(REVERT_ANNOUNCEMENT);
        }, 3000);
        return;
      }
      // Second tap within 3s — clear timer + commit.
      clearTimeout(armedTimerRef.current);
      armedTimerRef.current = null;
      setArmedIndex(null);
      // NOT the revert copy: a commit is not a cancellation.
      setAnnouncement('');
      item.onClick();
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
       the two-tap tiers in `gameDetail/page.js:1270-1274` (D-40/D-07) and
       `ManageMembers.js:608-618` (AR-DEC-3) reason from the CURRENT auto-close and
       are unchanged by a per-item opt-out.

       The flag opts an item out of one close TRIGGER, never out of dismissal:
       outside-mousedown, Escape and the focusout rule all behave exactly as they do
       without it. A keep-open activation closes nothing and unmounts nothing, so
       there is no focus to restore and none is stolen — focus stays on the item.
       That is true ONLY because an activated item's busy gate is `ariaDisabled` and
       never the native disabled attribute (see the item button below). */
    if (item.keepOpen) return;

    setOpen(false);
    restoreFocusToTrigger();
  };

  /* DECISION Phase 88.6-16 (D-12): Escape is bound on the CONTAINER and claims the
     key with preventDefault() + stopPropagation() when it ACTS — chosen OVER a
     `document` listener.
     WHY: a document listener cannot scope Escape to the innermost open layer. Two
     document bubble listeners fire in registration order and `preventDefault`
     cannot un-run the one that already ran. The live ancestor this claim protects
     is `gameDetail/page.js:384-402`, the `descExpanded` collapse, which bails only
     on `event.defaultPrevented` at `:387`. Both states can be live at once (expand
     the description, then open the kebab), so without the claim one Escape would
     close the menu AND collapse the description.
     `Header.js:31-42`'s `mobileMenuOpen` Escape is NOT a live collision — opening
     the hamburger mousedown-closes this menu first (the effect above) — noted so
     nobody "fixes" it. `FeedbackButton.js:39-43` records the house preference for
     not stacking document-level Escape listeners.

     THE ONE COMPOSITION WHERE THIS CONTRACT DOES NOT HOLD, and the plan text for it
     was WRONG — corrected here from a live measurement (2026-09-15,
     `keyboardOperability.test.tsx` KM-7), not from the plan. At two of the six
     render sites — `ManageMembers.js:571` and `:595`, which render inside the
     shipped `Modal` at `ManageMembers.js:378` — Radix's `Dialog`
     (`Modal.tsx:149-150`) binds Escape on `document` in the CAPTURE phase
     (`@radix-ui/react-use-escape-keydown`), which runs BEFORE any container handler
     and dismisses the dialog.
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
  const handleKeyDown = (event) => {
    if (event.key !== 'Escape' || !open) return;
    event.preventDefault();
    event.stopPropagation();
    setOpen(false);
    restoreFocusToTrigger();
  };

  /* DECISION Phase 88.6-16 (D-12): a focusout closes the menu ONLY when
     `relatedTarget` is non-null AND outside the container. A NULL relatedTarget
     NEVER closes.
     WHY: null is ambiguous, not "left the document". It is also what a pointer
     press over non-focusable inside chrome (the `py-1` band on the list) or over a
     disabled item produces — so closing on null dismisses the menu on an INSIDE
     tap and silently disarms a live two-tap gate (`ManageMembers.js:620`,
     `OpenPollsList.js:282`). Pointer dismissal is already owned by the mousedown
     handler above; this half exists for the keyboard and does not need to guess
     about pointers.
     REJECTED, kept not deleted: (a) a deferred `document.activeElement` /
     `document.hasFocus()` check — it fails the same inside-tap case and is
     untestable in jsdom (measured: no focusout fires on a disabled item);
     (b) treating a null relatedTarget as "left the document".
     Bound through React's onBlur, which is implemented on `focusout` and bubbles
     (React has no `onFocusOut` prop) — so there is no listener to remove and no
     per-row leak. */
  const handleFocusOut = (event) => {
    if (!open) return;
    const next = event.relatedTarget;
    if (!next) return;
    if (containerRef.current && containerRef.current.contains(next)) return;
    setOpen(false);
  };

  /* DECISION Phase 88.6-16 (D-12): with NO items the component renders no trigger
     at all — chosen OVER today's unconditional trigger against a default
     `items = []`, which ships a 44x44 control that opens nothing. A deliberate
     behaviour change on a component with 6 render sites. Every hook above runs
     first, so this early return never changes hook order. */
  if (items.length === 0) return null;

  return (
    <div
      className="relative shrink-0"
      ref={containerRef}
      onKeyDown={handleKeyDown}
      onBlur={handleFocusOut}
    >
      {/* DECISION Phase 88.6-16 (D-12): an sr-only StatusRegion, mounted at PROP
          time on `items.some(i => i.twoTap)` — mounted for the whole life of every
          instance that can ever announce, absent from instances that cannot. A
          label swap on a focused element does not announce
          (`useConfirmAction.ts:162-180`), which is why the region exists at all.

          THE GATE'S YIELD, MEASURED 2026-09-14 and written here because a wrong
          rationale at a site is inherited as fact: it does NOT thin the per-row
          count on either surface that can announce. `ManageMembers.js:473` maps the
          members and the mobile kebab at `:595` ALWAYS carries the `twoTap: true`
          Remove (`:617-623`); `OpenPollsList.js:176`/`:276`/`:282` is the same
          shape. So the predicate is TRUE for every row and the region IS per row on
          both surfaces — that is the accepted design, and it is precisely what makes
          the item-label announcement sound. What the gate buys is exactly one thing:
          an instance that can NEVER announce carries no region — the shipped example
          is the desktop owner-only transfer kebab at `ManageMembers.js:571`, whose
          single item has no twoTap (`:573-583`).

          The "one region per SURFACE" reading is WRONG and is not restated here:
          `useConfirmAction.ts:124-128` says "Render it ONCE, unconditionally,
          anywhere inside the surface" — one region per GATE, always mounted — and
          `ManageMembers.js` mounts FOUR of them on ONE surface (`:819`, `:821`,
          `:823`, `:827`).

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
          (`ManageMembers.js:608-618`), for ~90-120 lines. If it is ever chosen, the engine is
          `@floating-ui/react` — the house engine (`Combobox.tsx:39-58`) — and NEVER Radix
          DropdownMenu, which is not a dependency and portals by default.
          Re-adding the popup-role attribute in ANY form, including the `="true"` value, is
          FORBIDDEN: ARIA maps that value to the menu role, so it re-asserts the exact claim
          this removal makes. */}
      <button
        type="button"
        ref={triggerRef}
        onClick={() => setOpen((prev) => !prev)}
        className="inline-flex min-h-11 min-w-11 items-center justify-center text-2xl text-content-muted hover:text-content-primary leading-none rounded-sm hover:bg-surface-hover active:opacity-75 transition-colors focus:outline-hidden focus-visible:ring-2 focus-visible:ring-focus-ring focus-visible:ring-offset-2"
        aria-expanded={open}
        /* DECISION Phase 88.6-16 (D-12): `aria-controls` is the HONEST replacement
           for the removed popup relationship — it says only what is true (this
           trigger controls that list) — and it is rendered ONLY while the menu is
           open, using the conditional-spread form the house idiom uses at
           `useConfirmAction.ts:386`. The dropdown is conditionally rendered, so a
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
           via `@import 'tailwindcss' source(none);` at `globals.css:10`), and
           `list-style: none` strips the IMPLICIT list role in Safari/VoiceOver — the
           surface this project declares primary. Plain buttons announced as a set
           with a count is the WHOLE compensation for dropping the menu pattern, so
           without this attribute the trade is void. No `list-none` utility is added
           here and none is needed: the preflight already did it, and this attribute
           compensates for the PREFLIGHT, not for a utility a reader could simply
           drop. The axe audit cannot see this (it does not model the Safari quirk) —
           `keyboardOperability.test.tsx` is the only gate on it. */
        <ul
          id={listId}
          role="list"
          className="absolute right-0 top-full mt-1 z-20 min-w-[160px] bg-surface-card border border-line rounded-md shadow-theme-lg py-1"
        >
          {items.map((item, index) => {
            const isArmed = item.twoTap && armedIndex === index;
            const label = isArmed ? (item.confirmLabel || confirmLabel) : item.label;
            const danger = item.danger || isArmed;
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
                 (`ManageMembers.js:625-632`) is spread LAST, so indices never shift
                 and a positional key cannot mis-pair a node with a different action.
                 Re-deriving the key from the label later is a REGRESSION, not a
                 cleanup. No `id` field is introduced: measured, zero of the 6 shipped
                 render sites passes one, so an `id ?? index` form is dead in every
                 branch. The documented Items API above is where explicit identity
                 would be added if a future render site ever needs it. */
              <li key={index}>
                <button
                  type="button"
                  onClick={() => handleItemClick(item, index)}
                  disabled={item.disabled}
                  /* DECISION Phase 88.6-16 (D-12): `aria-pressed` is present ONLY
                     while armed and ABSENT (never "false") at rest — the
                     conditional-spread form of `useConfirmAction.ts:386`, never an
                     `aria-pressed={isArmed}` binding. React stringifies booleans on
                     `aria-*`, so the binding form would stamp `aria-pressed="false"`
                     on every resting item and on non-toggle `twoTap: false` items
                     (`gameDetail/page.js:1274`), announcing plain actions as unpressed
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
                     verbatim at `NextGameNightCard.tsx:379-390` (`DECISION Phase 88.5`)
                     and `EmailAddressSection.tsx:1572-1598` (`DECISION Phase 88.8
                     DR-C`): the control being ACTED ON gets `aria-disabled`; a control
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
                  {...(item.ariaDisabled ? { 'aria-disabled': true } : {})}
                  /* 88-CODE-REVIEW MED#13: min-h-11 — the 87.8-08 census FAIL row (~36px)
                     these items still carried after D-40 made this menu the SOLE phone
                     path to destructive row actions. The trigger was floored by 88-28;
                     the items behind it were not. The dropdown is an absolute overlay,
                     so taller rows reflow nothing outside it. */
                  className={`w-full min-h-11 text-left px-3 py-2 text-sm active:opacity-75 transition-colors disabled:opacity-50 disabled:cursor-not-allowed aria-disabled:opacity-50 aria-disabled:cursor-not-allowed focus:outline-hidden focus-visible:ring-2 focus-visible:ring-focus-ring focus-visible:ring-inset ${
                    danger
                      ? `text-content-status-error ${isArmed ? 'bg-status-error-subtle font-semibold' : 'hover:bg-surface-hover'}`
                      : 'text-content-primary hover:bg-surface-hover'
                  }`}
                >
                  {label}
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
