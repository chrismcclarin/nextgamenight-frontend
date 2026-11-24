'use client';

/**
 * useConfirmAction — the one destructive-confirmation state machine
 * (Req 11 / D-03..D-11, UI-SPEC §8.7).
 *
 * Every destructive gate in the app routes through this hook, and the ONLY thing
 * that differs between gates is `tier` (D-07). The config object is a SUPERSET
 * across tiers — `body` is accepted and ignored by `two-tap`, `expectedPhrase` is
 * accepted and ignored by `dialog` — so retiering a gate later is a one-word edit
 * at the call site and never a markup rewrite.
 *
 * Blocking semantics are non-negotiable in every tier (D-08): the gate is
 * explicit, cancel aborts, and `onConfirm` is never reached by any path that
 * merely informs the person after the fact. There is deliberately no
 * "just show a message and proceed" branch anywhere in this file.
 *
 * What it deliberately does NOT do (the composition contract —
 * `useFetchErrorState.ts` is the model for this section):
 * - **No fetching, and no pre-flight of its own.** D-06's blocker panel is
 *   content the CALLER supplies to `ConfirmDialog`. `GroupSettings.js` already
 *   ships its own pre-flight (`groupsAPI.getDeletionImpact`); a second one here
 *   would double the request on the most destructive screen in the app.
 * - **No markup.** The one exception is `statusNode` (see below), which exists
 *   because a consumer obligation to hand-render a live region would defeat the
 *   one-word-tier-switch guarantee. Everything visible is `ConfirmDialog`'s.
 *   `reserveFor` (88.9-67) hands back STRINGS for the caller's own label wrapper; it is not markup.
 * - **No typed-tier input state.** The type-to-confirm value lives in
 *   `ConfirmDialog` and is passed IN to `confirmDisabled`/`confirm`. If it lived
 *   here, every keystroke would re-render the host page (the adopter surfaces
 *   include ~2000-line pages), not just the dialog.
 * - **No error copy.** If `onConfirm` rejects, the gate stays open and `pending`
 *   clears; surfacing why is the caller's job, exactly as
 *   `DangerZoneDeleteAccount.tsx` does with its own failure message.
 *
 * **Known limit (D-07), and it is a real one:** the `two-tap` tier needs a
 * trigger that SURVIVES the first click with a changed label. It therefore
 * cannot be used on an auto-closing menu item — the menu unmounts the armed
 * trigger before the second tap can reach it. This is exactly why D-40 forbids
 * two-tap on the gameDetail kebab's Delete item, which routes to `dialog`
 * instead. Persistent inline row buttons (`friends/page.js`, `ManageMembers.js`
 * rows) are fine.
 */
import * as React from 'react';

import {
  CONFIRM_DELAY_MS,
  COUNTDOWN_LABELS,
  countdownLabel,
  countdownName,
  useConfirmCountdown,
} from '@/components/ui/confirmDelay';
import { StatusRegion } from '@/components/ui/StatusRegion';
import { useDismissal, type DismissalContainerProps } from '@/components/ui/useDismissal';
import { useInlineReceipt } from '@/components/ui/useInlineReceipt';

export type ConfirmTier = 'typed' | 'dialog' | 'two-tap';

/**
 * The arm window, in ms: gated, then live, both numbers from
 * src/components/ui/confirmDelay.ts ("export const CONFIRM_DELAY_MS = 3000;"). The original
 * 3 s window was the SHIPPED kebab value of src/app/gameDetail/page.js (Phase 65-02 EVT-08),
 * absorbed rather than reinvented.
 * AMENDED Phase 88.9-23 (owner pick F9b, 88.9-PICKS-B5.json, 2026-11-07): the window is now gated
 * CONFIRM_DELAY_MS + live CONFIRM_LIVE_MS (6000 ms) from confirmDelay.ts, chosen OVER the shipped
 * 3000 ms immediately-live window.
 * AMENDED Phase 89.6-04 (OW-2): the window and its export are gone; the wait before a control goes
 * live is unchanged. See the OW-2 marker below.
 */
// DECISION Phase 89.6-04 (OW-2, owner 2026-11-22 3:49 PM Pacific: OW2) A): the two-tap tier has NO
// live window. After the wait, the armed control stays live until the second press commits or until
// it disarms: a press anywhere outside the control itself, focus moving to another control, or
// Escape, all three through the one dismissal hook, with the armed control as both container and
// trigger:
// src/components/ui/useDismissal.ts ("DECISION Phase 88.6.1-05 (D-18): ONE hook")
// It also disarms when the control scrolls out of view or the page is hidden (the scroll-out marker
// below). A press on another row of the gate is a press outside the armed one: that row disarms and
// the pressed row arms. Every disarm says DISARM_ANNOUNCEMENT, the kebab's revert words (owner
// OW-2b: Yes); a commit and this hook's own re-arm never do. No forgiveness margin: the container is
// the control, so a press just outside its 44px box disarms (owner: If 44px is the size of
// accessibility standard for unsteady hands, then we should follow it.). Chosen OVER a 20 second
// live window (still a time limit under WCAG 2.2.1, which names the expiry of a window of
// opportunity to react) and OVER keeping 3 seconds (on the owner's iPhone VoiceOver spent the window
// speaking, register L14). Adding a revert timer back is a decision, not a cleanup.
/** The words a disarmed two-tap control says (OW-2b): the kebab's revert copy, one home for both tiers. */
export const DISARM_ANNOUNCEMENT = 'Confirmation cancelled.';

/* DECISION Phase 88.9-52 (R13, owner 2026-11-17, pick Everywhere; his words: What if we just made
   it "tap again"? would that work?): the live armed label a person SEES is Tap again on every
   two-tap control, and the name a screen reader HEARS stays the full sentence the control spoke
   before (Tap again to confirm, or the caller's own, such as Tap again to remove). Chosen OVER the
   full sentence as the visible label (what shipped: at 375 it pushed the see-all Remove onto a
   second line and the row jumped from 62px to 98px on the first tap) and OVER shortening the name
   too (a name of Tap again alone would not say what the second tap does). The name STARTS with the
   visible words, so Label in Name (WCAG 2.5.3) holds. The width reserve follows the visible label
   (reserveFor below), which is the point of the ruling. The kebab's items follow the same two
   constants (src/app/components/KebabMenu.js ("DECISION Phase 88.9-52 (R13)")). Supersedes the
   one-string armed label of Phase 88-05 and the Profile phone Remove's visible sentence (X36b).
   NOT covered: a control whose live label is its own verb (the Profile collection x arms to
   Remove by an earlier owner ruling, fork 7); it passes armedLabel and is unchanged.
   AMENDED Phase 88.9-52 (R4 D4, owner 2026-11-18): that exception is gone. The collection
   control is a worded Remove button now and arms to Tap again like the rest, so no shipped
   control passes armedLabel any more; the option stays for a control whose live label must be
   its own verb. The ruling is at src/app/userProfile/page.js ("AMENDED Phase 88.9-52 (R4 D4, owner 2026-11-18): REPLACED.").
   Lengthening the visible label again is a decision, not a cleanup. */
/** The armed VISIBLE label of every two-tap control. */
export const DEFAULT_ARMED_LABEL = 'Tap again';
/** The armed SPOKEN name where the caller gives none. It starts with the visible label. */
export const DEFAULT_ARMED_NAME = 'Tap again to confirm';

/** Key used when a two-tap gate has exactly one target and passes no id. */
const SOLE_TARGET_KEY = '__sole__';

export interface UseConfirmActionConfig {
  /** The friction tier. THE one call-site knob (D-07). */
  tier: ConfirmTier;
  /** `{Verb} {specific object}?` — the dialog title. Ignored by `two-tap`. */
  title: string;
  /** Concrete consequences, in counts. Ignored by `two-tap` (superset config). */
  body?: React.ReactNode;
  /** The verb alone: "Remove", "Delete", "Disconnect". Never "OK"/"Yes". */
  confirmLabel: string;
  /**
   * `dialog`/`typed` only, optional: the sr-only words appended to the confirm's name while the
   * commit is pending (", disconnecting") — rule 1 (88.9-45); the visible text keeps `confirmLabel`
   * and the house spinner joins it. Passed through `dialogProps`; see ConfirmDialog's `busySuffix`.
   * Ignored by `two-tap`. (88.6.1 code review CR-5 / A-75, re-shaped; default-off)
   */
  busySuffix?: string;
  /** Cancel copy. @default 'Cancel' */
  cancelLabel?: string;
  /** `typed` tier only: the phrase that must be entered EXACTLY. */
  expectedPhrase?: string;
  /**
   * `two-tap` tier only: the armed VISIBLE label. @default 'Tap again'. Passed only by a control
   * whose live label is its own verb (the Profile collection x, fork 7); every other control
   * shows the default (R13).
   */
  armedLabel?: string;
  /**
   * `two-tap` tier only: the armed SPOKEN name, a sentence that STARTS with the visible label
   * ('Tap again to remove'). @default 'Tap again to confirm' with the default visible label, and
   * the visible label itself when the caller passes its own `armedLabel`.
   */
  armedName?: string;
  /**
   * `two-tap` tier only: builds the live-region text. It MUST name the target —
   * a target switch is then a guaranteed text change and therefore a guaranteed
   * re-announcement.
   */
  armedAnnouncement?: (targetLabel: string | undefined, confirmLabel: string) => string;
  /**
   * Runs ONLY after an explicit confirmation. Receives the committed target id
   * (the armed id for `two-tap`; the trigger's id, unchanged, for the others).
   * May return a promise — the gate stays `pending` until it settles.
   *
   * `two-tap` only: a second argument, `{ from }`, carries the control the person activated for
   * the committing tap (`event.currentTarget` of the row trigger), so a consumer can arm
   * `useFocusRecovery` with `from` (its consumer contract item 1: Safari does not focus a clicked
   * button). Additive; a consumer that reads one argument is unaffected. The `dialog`/`typed`
   * tiers call `onConfirm(targetId)` exactly as before (their activator is the dialog's own
   * confirm control, which the dialog's restore owns).
   */
  onConfirm: (targetId?: string, context?: ConfirmContext) => void | Promise<void>;
}

/** The second argument a `two-tap` commit hands `onConfirm` (88.6.1 code review A-74). */
export interface ConfirmContext {
  /** The trigger the person pressed for the committing tap, or null when it was not a click. */
  from: Element | null;
}

/** Props for a `two-tap` row trigger. Spread onto the row's own `<button>`. */
export interface ConfirmTriggerProps {
  type: 'button';
  onClick: (event?: React.MouseEvent<Element>) => void;
  /** Present ONLY while armed (a resting destructive button is not a toggle). */
  'aria-pressed'?: true;
  /**
   * Present ONLY while armed AND gated (F9b, 88.9-23): the second press is refused for
   * CONFIRM_DELAY_MS. Never native `disabled` — the armed control keeps focus.
   */
  'aria-disabled'?: true;
  /**
   * Present when the caller supplied a resting name (it swaps with the visible label), and for
   * every caller while armed AND gated: the resting name, then the wait (X69, 88.9-67).
   */
  'aria-label'?: string;
  /** Present ONLY while armed: the dismissal hook's Escape half (OW-2, 89.6-04). */
  onKeyDown?: DismissalContainerProps['onKeyDown'];
  /** Present ONLY while armed: the dismissal hook's focus-leaving half (OW-2, 89.6-04). */
  onBlur?: DismissalContainerProps['onBlur'];
}

/** Everything `ConfirmDialog` needs. Spread it: `<ConfirmDialog {...dialogProps} />`. */
export interface ConfirmDialogState {
  tier: ConfirmTier;
  open: boolean;
  pending: boolean;
  title: string;
  body?: React.ReactNode;
  confirmLabel: string;
  busySuffix?: string;
  cancelLabel: string;
  expectedPhrase?: string;
  /**
   * F9b (88.9-23): true for the `dialog` tier only — ConfirmDialog gates its confirm for
   * CONFIRM_DELAY_MS from open. Static per gate; the per-second countdown lives in the dialog.
   */
  confirmDelay: boolean;
  onCancel: () => void;
  onConfirm: (typedValue?: string) => void;
  confirmDisabled: (typedValue?: string) => boolean;
}

export interface ConfirmActionState {
  tier: ConfirmTier;
  /** `dialog`/`typed`: is the gate open. Always false for `two-tap`. */
  open: boolean;
  /** True while `onConfirm` is in flight. Blocks every re-entry path. */
  pending: boolean;
  /** `two-tap`: the armed target key, or null. NOT a boolean — see AR DEC-2. */
  armedId: string | null;
  /**
   * The always-mounted `role="status"` region. Render it ONCE, unconditionally,
   * anywhere inside the surface. See the DECISION marker below for why the hook
   * ships an element rather than asking the caller to render one.
   * AMENDED Phase 88.9-23 (F9b): the two-tap arm text is written at the LIVE edge, not at arm,
   * chosen OVER announcing at arm (a false instruction for CONFIRM_DELAY_MS) and OVER new live
   * copy (research A12, no copy row).
   * AMENDED Phase 89.6-04 (OW-2b): a disarm writes DISARM_ANNOUNCEMENT here through
   * useInlineReceipt, which clears it after INLINE_RECEIPT_MS so the hidden node is not left holding
   * it as a phantom swipe stop; a commit or a re-arm writes nothing, and the live edge replaces it.
   * The house rule for a hidden region that keeps its words is stated at
   * src/components/ui/announcer.ts ("cleared again")
   */
  statusNode: React.ReactElement;
  /**
   * Start the gate for a target. `two-tap` arms; the others open the dialog. `from` (two-tap) is
   * the activating control, handed to `onConfirm` on the committing tap.
   */
  trigger: (targetId?: string, targetLabel?: string, from?: Element | null) => void;
  /** Commit (`dialog`/`typed`). `ConfirmDialog` supplies the typed value. */
  confirm: (typedValue?: string) => void;
  /** Abort. `onConfirm` is never called; any armed target is disarmed. */
  cancel: () => void;
  /** True while the confirm control must stay disabled. */
  confirmDisabled: (typedValue?: string) => boolean;
  /** Exact-equality phrase check for the `typed` tier. */
  matchesPhrase: (value: string) => boolean;
  /** `two-tap`: is this target the armed one. */
  isArmed: (targetId?: string) => boolean;
  /** `two-tap`: the label to RENDER for this target. */
  labelFor: (targetId: string | undefined, restingLabel: string) => string;
  /**
   * `two-tap` (X69 width, 88.9-67): the strings whose width this target's label must hold, the
   * three countdown labels and the armed VISIBLE label (R13: the short one, never the spoken name), while the target is armed; with `atRest` also at
   * rest (a control whose arming must not reflow its neighbour). An empty list otherwise and in
   * the other tiers. Strings, not markup: the caller hands them to `ReservedLabel`.
   */
  reserveFor: (targetId?: string, options?: { atRest?: boolean }) => readonly string[];
  /** `two-tap`: props for this target's row trigger. */
  triggerProps: (
    targetId?: string,
    targetLabel?: string,
    restingAriaLabel?: string
  ) => ConfirmTriggerProps;
  /** Spread onto `<ConfirmDialog>`. */
  dialogProps: ConfirmDialogState;
}

/** The empty reserve, one identity for every call that reserves nothing. */
const NO_RESERVE: readonly string[] = Object.freeze([]);

function defaultAnnouncement(
  targetLabel: string | undefined,
  confirmLabel: string
): string {
  return targetLabel
    ? `Press again to confirm: ${confirmLabel} ${targetLabel}`
    : `Press again to confirm: ${confirmLabel}`;
}

/* DECISION Phase 88-05 (D-05/D-07, AR R2): the hook RETURNS A PRE-BUILT ELEMENT
   (`statusNode`) composed over the shipped `StatusRegion` primitive, instead of the two
   alternatives a future reader is most likely to "clean this up" into.

   REJECTED ALTERNATIVE 1 — defining a small `<Announcer />` component INSIDE the hook body
   and returning it. That reads tidier and every text-content assertion still passes green,
   but the component's function identity is new on every host render, so React unmounts and
   remounts the live region each time. A remounted live region announces NOTHING in
   NVDA/VoiceOver — it is the exact conditional-mount defect this gate exists to avoid, and
   it is invisible to any test that only reads text. `ConfirmDialog.test.tsx` pins DOM
   identity (`expect(getByRole('status')).toBe(node)`) precisely to catch a re-introduction.

   REJECTED ALTERNATIVE 2 — documenting "render your own live region" as a consumer
   obligation. Eleven adopter surfaces would each have to get it right, and a gate that
   forgot would look and test fine. That also breaks the one-word-tier-switch must-have:
   switching a gate to `two-tap` would additionally require hand-adding markup.

   Removing `statusNode` from the return, or building it from a locally-defined component,
   is a DECISION, not a cleanup. */

/* DECISION Phase 88-05 (AR R2-M16): `confirmDisabled` is a FUNCTION taking the typed value,
   chosen OVER the obvious shape — a plain boolean derived from typed-value state held here
   in the hook. The boolean version requires the hook to own the type-to-confirm input state,
   which puts a `setState` on every keystroke in the HOST component. The adopter surfaces are
   pages of ~2000 lines (`userProfile`, `gameDetail`); a keystroke must re-render the dialog
   only. The value therefore lives in `ConfirmDialog` and is passed in here.

   Collapsing this back to a boolean is a decision about where re-render cost lands, not a
   simplification.
   AMENDED Phase 88.9-23 (F9b): the dialog-tier countdown lives in ConfirmDialog for the same
   reason; the two-tap countdown lives here because the host renders the label — 3 extra host
   renders per arm, accepted, chosen OVER a label leaf component that would change all 5
   triggerProps sites.
   AMENDED Phase 88.9-52 (A-56): the measured count is 4 extra host renders per arm (two ticks, the
   live edge, the countdown's reset to idle when the row disarms), not 3. It was 5 until the
   countdown's arm-time state write was removed (src/components/ui/confirmDelay.ts ("AMENDED Phase 88.9-52 (A-56)")).
   Pinned by src/components/ui/useConfirmAction.test.ts ("A-56 (88.9-52): one arm left alone costs the host 4 extra renders").
   AMENDED Phase 89.6-04 (OW-2): the fourth render is the reset when the row disarms, by any path; an
   arm left alone costs nothing once live. Measured after the change: still 4 extra, 6 with the arm
   and the disarm themselves. */

/** The countdown's key for one arm: the target plus that arm's sequence number (A-55 marker below). */
function countdownKey(armedId: string, armSeq: number): string {
  return armedId + '#' + armSeq;
}

export function useConfirmAction(config: UseConfirmActionConfig): ConfirmActionState {
  const {
    tier,
    title,
    body,
    confirmLabel,
    busySuffix,
    cancelLabel = 'Cancel',
    expectedPhrase,
    armedLabel = DEFAULT_ARMED_LABEL,
    armedName: armedNameConfig,
    armedAnnouncement = defaultAnnouncement,
    onConfirm,
  } = config;
  // R13: the spoken name of the live armed control. A caller with its own visible label and no
  // name of its own is named by that label, as before.
  const armedName =
    armedNameConfig ?? (armedLabel === DEFAULT_ARMED_LABEL ? DEFAULT_ARMED_NAME : armedLabel);

  const [open, setOpen] = React.useState(false);
  const [pending, setPending] = React.useState(false);
  const [armedId, setArmedId] = React.useState<string | null>(null);
  // DECISION Phase 88.9-52 (A-55): every arm gets its own sequence number, and the countdown is
  // keyed on the target AND that number, chosen OVER keying on the target alone. When a row's
  // window ends and the same row is pressed again before React has rendered the disarm, the two
  // updates commit together, the target key never changes, and a countdown keyed on the target
  // would keep the ended window's live state: the label would read live at once and the next press
  // would delete with no wait. The number makes each arm a new key. Removing it is a decision, not
  // a cleanup.
  // AMENDED Phase 89.6-04 (OW-2): there is no window end now; the same race comes from any disarm
  // followed by a press on the same row in one turn, so the sequence number stays.
  const [armSeq, setArmSeq] = React.useState(0);
  const [announcement, setAnnouncement] = React.useState('');

  // Refs mirror the state the event handlers must read SYNCHRONOUSLY. Two clicks
  // inside one tick see stale state but never a stale ref — which is what makes
  // the no-double-fire and re-arm guarantees hold under a fast double tap.
  const armedIdRef = React.useRef<string | null>(null);
  const armSeqRef = React.useRef(0);
  const pendingRef = React.useRef(false);
  const targetRef = React.useRef<string | undefined>(undefined);
  // OW-2 (89.6-04): the armed control itself, the dismissal hook's container AND trigger. Set on the
  // arm from the pressed control, cleared on the commit; a disarm leaves it so Escape's restore can
  // refocus the same control.
  const armedElRef = React.useRef<HTMLElement | null>(null);
  const mountedRef = React.useRef(true);
  // F9b (88.9-23): the arm text waits here until the gate runs out (written at the live edge),
  // and the dialog tier's open time backs the wall-clock refusal in confirm().
  const pendingAnnouncementRef = React.useRef('');
  const openRef = React.useRef(false);
  const openedAtRef = React.useRef(0);

  // Latest-callback refs: `onConfirm` receives the committed target from the
  // ARMED state, and calls the newest handler — never a closure captured when
  // the row was first rendered.
  const onConfirmRef = React.useRef(onConfirm);
  const tierRef = React.useRef(tier);
  const armedAnnouncementRef = React.useRef(armedAnnouncement);
  const confirmLabelRef = React.useRef(confirmLabel);
  const dismissalPropsRef = React.useRef<DismissalContainerProps | null>(null);
  React.useEffect(() => {
    onConfirmRef.current = onConfirm;
    tierRef.current = tier;
    armedAnnouncementRef.current = armedAnnouncement;
    confirmLabelRef.current = confirmLabel;
    // OW-2 (89.6-04): the newest dismissal handlers, read by the two stable wrappers below.
    dismissalPropsRef.current = dismissal.containerProps;
  });

  // mountedRef stops a settling commit from writing state into an unmounted tree.
  React.useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  // OW-2b (89.6-04): the disarm words and when they clear. The timer is the receipt hook's, so this
  // file schedules nothing of its own.
  const disarmReceipt = useInlineReceipt();
  const { showReceipt: showDisarmReceipt, clearReceipt: clearDisarmReceipt } = disarmReceipt;

  // F9b (88.9-23): the two-tap countdown, keyed by the armed target. The dialog tier's visible
  // countdown is ConfirmDialog's own (see the AMENDED line on the R2-M16 marker above); the typed
  // tier has none. onLive writes the unchanged NC-1 arm text once pressing works.
  const announceLive = React.useCallback(() => {
    if (tierRef.current === 'two-tap' && armedIdRef.current !== null) {
      // The live-edge words replace any cancel words still showing, and end their timer.
      clearDisarmReceipt();
      setAnnouncement(pendingAnnouncementRef.current);
    }
  }, [clearDisarmReceipt]);
  const countdown = useConfirmCountdown(
    tier === 'two-tap' && armedId !== null ? countdownKey(armedId, armSeq) : null,
    announceLive
  );
  const { isLive, secondsLeft } = countdown;
  const gated = tier === 'two-tap' && !countdown.live;
  // The armed label: counting down while gated, then the live label.
  // AMENDED Phase 88.9-67 (X69): every caller counts Wait (n), a custom armed label included —
  // supersedes R-W1 (2026-11-08) for the gated half by the owner's widened 2026-11-14 ruling; the
  // live label stays the caller's (fork 7).
  const armedText = gated ? countdownLabel(secondsLeft) : armedLabel;

  // The SILENT disarm: cancel() only. It says nothing (see cancel below).
  const disarm = React.useCallback(() => {
    armedIdRef.current = null;
    armedElRef.current = null;
    setArmedId(null);
    setAnnouncement('');
  }, []);

  // The disarm that SPEAKS: every path a person takes away from an armed control (the OW-2 marker
  // at the top of this file). When nothing is armed it returns: a commit or an earlier disarm got
  // there first, and this guard is what keeps the cancel words off a commit.
  const disarmWithNotice = React.useCallback(() => {
    if (armedIdRef.current === null) return;
    armedIdRef.current = null;
    if (!mountedRef.current) return;
    setArmedId(null);
    setAnnouncement('');
    showDisarmReceipt(DISARM_ANNOUNCEMENT);
  }, [showDisarmReceipt]);

  // The one dismissal hook, consumed, never copied: the outside press, Escape and focus leaving.
  // It reads the container at event time, so this one call follows the armed control row to row.
  const dismissal = useDismissal({
    open: tier === 'two-tap' && armedId !== null,
    onDismiss: disarmWithNotice,
    containerRef: armedElRef,
    triggerRef: armedElRef,
  });
  // Two stable wrappers, so an armed target's props keep one identity across countdown ticks (the
  // memoised collection card depends on it).
  const armedOnKeyDown = React.useCallback<DismissalContainerProps['onKeyDown']>(
    (event) => dismissalPropsRef.current?.onKeyDown(event),
    []
  );
  const armedOnBlur = React.useCallback<DismissalContainerProps['onBlur']>(
    (event) => dismissalPropsRef.current?.onBlur(event),
    []
  );

  // DECISION Phase 89.6-04 (scroll-out): an armed two-tap control also disarms, and says the cancel
  // words, when it scrolls fully out of view after it was seen in view (an observer on the armed
  // control, threshold 0) and when the page is hidden (a page-visibility listener: an armed control
  // must not sit live across a locked phone, research S F-OW2 item 6). Both live here and run only
  // while armed. Chosen OVER adding either to the one dismissal hook, which would change the kebab,
  // whose item stays armed while its menu is open (owner OW-2a: Keep), and the bell:
  // src/components/ui/useDismissal.ts ("DECISION Phase 88.6.1-05 (D-18): ONE hook")
  // and OVER a shared in-view hook (no second consumer). Not a second dismissal engine: the outside
  // press, Escape and focus leaving stay that hook's; the page-hidden event exists only on the
  // document and is none of its four pieces. A control hidden only under the sticky header still
  // counts as in view. Owner, 2026-11-22: Sorry, I forgot, lets do teh scroll out of view disarm.
  // Changing this is a decision, not a cleanup.
  React.useEffect(() => {
    if (tier !== 'two-tap' || armedId === null) return;
    const onVisibilityChange = () => {
      if (document.visibilityState === 'hidden') disarmWithNotice();
    };
    document.addEventListener('visibilitychange', onVisibilityChange);
    return () => document.removeEventListener('visibilitychange', onVisibilityChange);
  }, [tier, armedId, armSeq, disarmWithNotice]);

  React.useEffect(() => {
    if (tier !== 'two-tap' || armedId === null) return;
    const element = armedElRef.current;
    // No armed element (a programmatic arm), or no observer in this browser: nothing to watch, and
    // every other disarm still works.
    if (element === null || typeof IntersectionObserver === 'undefined') return;
    const armedKey = armedId;
    // Out of view counts only AFTER the control was seen in view: a first report out of view (armed
    // from the keyboard under the fold, or before layout) disarms nothing.
    let seenInView = false;
    const observer = new IntersectionObserver(
      (entries) => {
        // Entries arrive oldest first, so one batch holding in view then out of view still disarms.
        for (const entry of entries) {
          if (entry.isIntersecting) {
            seenInView = true;
          } else if (seenInView && armedIdRef.current === armedKey) {
            disarmWithNotice();
          }
        }
      },
      // The viewport is the root, so a scroll box (the Participants dialog body) clips it too.
      { root: null, threshold: 0 }
    );
    observer.observe(element);
    return () => observer.disconnect();
  }, [tier, armedId, armSeq, disarmWithNotice]);

  const matchesPhrase = React.useCallback(
    (value: string) =>
      // Exact equality on the RAW string (ASVS V5). Never a pattern compiled
      // from the expected phrase or from what the person typed — a group name
      // is user-supplied and would otherwise be interpreted, not compared.
      typeof expectedPhrase === 'string' &&
      expectedPhrase.length > 0 &&
      value === expectedPhrase,
    [expectedPhrase]
  );

  const confirmDisabled = React.useCallback(
    (typedValue?: string) => {
      if (pending) return true;
      if (tier === 'typed') return !matchesPhrase(typedValue ?? '');
      return false;
    },
    [pending, tier, matchesPhrase]
  );

  const runConfirm = React.useCallback(async (targetId?: string, context?: ConfirmContext) => {
    if (pendingRef.current) return;
    pendingRef.current = true;
    setPending(true);
    try {
      // Only the two-tap commit passes a context; the dialog tiers keep their one-argument call.
      await (context === undefined ? onConfirmRef.current(targetId) : onConfirmRef.current(targetId, context));
      if (!mountedRef.current) return;
      openRef.current = false;
      setOpen(false);
      targetRef.current = undefined;
    } catch {
      // The gate stays OPEN on failure so the person can retry or cancel. The
      // caller owns the failure copy (see the doc-comment) — swallowing it here
      // and closing anyway would claim a destructive action succeeded when it
      // did not.
    } finally {
      pendingRef.current = false;
      if (mountedRef.current) setPending(false);
    }
  }, []);

  const trigger = React.useCallback(
    (targetId?: string, targetLabel?: string, from?: Element | null) => {
      // Re-entry while a commit is in flight is inert in EVERY tier.
      if (pendingRef.current) return;

      if (tierRef.current !== 'two-tap') {
        targetRef.current = targetId;
        // F9b: the gate runs from OPEN; a trigger on an already-open dialog does not restart it.
        if (!openRef.current) openedAtRef.current = Date.now();
        openRef.current = true;
        setOpen(true);
        return;
      }

      const key = targetId ?? SOLE_TARGET_KEY;

      // First invocation on this target — or an invocation on a DIFFERENT
      // target, which re-arms there and never commits. Without this key, arming
      // row A and single-tapping row B destroys row B (AR DEC-2).
      if (armedIdRef.current !== key) {
        armedIdRef.current = key;
        armedElRef.current = from instanceof HTMLElement ? from : null;
        setArmedId(key);
        armSeqRef.current += 1;
        setArmSeq(armSeqRef.current);
        // F9b: the text is unchanged (copy NC-1); it is held until the countdown's live edge.
        pendingAnnouncementRef.current = armedAnnouncementRef.current(
          targetLabel,
          confirmLabelRef.current
        );
        // Any cancel words from a disarm just before this arm stay on the page (a press on another
        // row): the live edge replaces them, or the receipt clears them.
        setAnnouncement('');
        return;
      }

      // Second invocation on the SAME target while the gate still runs — refused (F9b): stay
      // armed, announcement unchanged. Read from a ref, so a double tap inside one tick cannot
      // slip through.
      if (!isLive(countdownKey(key, armSeqRef.current))) return;

      // Second invocation on the SAME target once it is live — commit. The armed refs are cleared
      // BEFORE the commit runs, so no disarm path can speak over it.
      armedIdRef.current = null;
      armedElRef.current = null;
      setArmedId(null);
      setAnnouncement('');
      clearDisarmReceipt();
      void runConfirm(targetId, { from: from ?? null });
    },
    [runConfirm, isLive, clearDisarmReceipt]
  );

  const confirm = React.useCallback(
    (typedValue?: string) => {
      // Defence in depth behind the disabled confirm button: a `typed` gate
      // never commits unless the value it was handed matches exactly.
      const value = typeof typedValue === 'string' ? typedValue : undefined;
      if (tierRef.current === 'typed' && !matchesPhrase(value ?? '')) return;
      // F9b, defence in depth behind ConfirmDialog's aria-disabled confirm (the Enter path): the
      // dialog tier refuses for CONFIRM_DELAY_MS from open, by wall clock, so the host keeps no
      // per-second state for it.
      if (
        tierRef.current === 'dialog' &&
        Date.now() - openedAtRef.current < CONFIRM_DELAY_MS
      ) {
        return;
      }
      void runConfirm(targetRef.current);
    },
    [matchesPhrase, runConfirm]
  );

  const cancel = React.useCallback(() => {
    openRef.current = false;
    setOpen(false);
    targetRef.current = undefined;
    disarm();
    // It removes words and writes none: a close that cancels never leaves the cancel words waiting
    // for a reopened region (the Participants dialog, src/app/gameDetail/page.js).
    clearDisarmReceipt();
  }, [disarm, clearDisarmReceipt]);

  const isArmed = React.useCallback(
    (targetId?: string) => armedId !== null && armedId === (targetId ?? SOLE_TARGET_KEY),
    [armedId]
  );

  const labelFor = React.useCallback(
    (targetId: string | undefined, restingLabel: string) =>
      isArmed(targetId) ? armedText : restingLabel,
    [isArmed, armedText]
  );

  // X69 width (88.9-67): every label an armed control can paint. The countdown labels differ in
  // width (proportional digits), so all three are held, with the label that follows them.
  const reserveLabels = React.useMemo<readonly string[]>(
    () => [...COUNTDOWN_LABELS, armedLabel],
    [armedLabel]
  );
  const reserveFor = React.useCallback(
    (targetId?: string, options?: { atRest?: boolean }): readonly string[] =>
      tier === 'two-tap' && (options?.atRest === true || isArmed(targetId))
        ? reserveLabels
        : NO_RESERVE,
    [tier, isArmed, reserveLabels]
  );

  const triggerProps = React.useCallback(
    (
      targetId?: string,
      targetLabel?: string,
      restingAriaLabel?: string
    ): ConfirmTriggerProps => {
      const armed = isArmed(targetId);
      // Label-in-Name (WCAG 2.5.3): the accessible name follows the VISIBLE
      // label. A static aria-label sitting over a swapped visible label is the
      // failure this exists to prevent — so when armed, the name is the armed
      // label; when the caller supplies no name at all, none is invented.
      // F9b (88.9-23, MED-61): once live, "the armed label" is the string labelFor renders.
      // AMENDED Phase 88.9-52 (R13): once live the name is armedName, the full sentence, which
      // starts with the visible Tap again; and the hook now names the live control for EVERY
      // caller whose name differs from its visible label, a caller with no resting name included
      // (the Profile phone Remove), because the visible words alone no longer say what happens.
      // AMENDED Phase 88.9-67 (X69): while gated the name is <resting name>, wait n seconds — it
      // contains the visible word (W3C Understanding 2.5.3) and tracks every step; the only window
      // in which the hook names a control itself, chosen OVER a name equal to Wait (n), which
      // would not say what the button does.
      const waiting = armed && gated;
      const live = armed && !gated;
      const liveNeedsName = restingAriaLabel !== undefined || armedName !== armedLabel;
      return {
        type: 'button',
        // DECISION 88.6.1 code review A-74: the click's `currentTarget` is threaded to `onConfirm`
        // over the old event-less `() => trigger(...)`. Without it a two-tap consumer cannot meet
        // useFocusRecovery's `from` contract, and on WebKit (which does not focus a clicked
        // button) focus fell to <body> when the removed row left. Dropping the event is a
        // decision, not a cleanup.
        onClick: (event) => trigger(targetId, targetLabel, event?.currentTarget ?? null),
        ...(armed ? { 'aria-pressed': true as const } : {}),
        ...(armed && gated ? { 'aria-disabled': true as const } : {}),
        // OW-2 (89.6-04): Escape and focus leaving, while armed only; a resting target gets nothing.
        ...(armed ? { onKeyDown: armedOnKeyDown, onBlur: armedOnBlur } : {}),
        ...(waiting
          ? { 'aria-label': countdownName(restingAriaLabel ?? confirmLabel, secondsLeft) }
          : live
            ? liveNeedsName
              ? { 'aria-label': armedName }
              : {}
            : restingAriaLabel !== undefined
              ? { 'aria-label': restingAriaLabel }
              : {}),
      };
    },
    [isArmed, armedLabel, armedName, gated, trigger, confirmLabel, secondsLeft, armedOnKeyDown, armedOnBlur]
  );

  const statusNode = React.useMemo(
    () =>
      React.createElement(StatusRegion, {
        // Visually hidden: the visible armed label is the sighted affordance,
        // this is the same information for assistive tech.
        className: 'sr-only',
        // The arm words when there are any, else the disarm receipt: one node, one region.
        message: announcement !== '' ? announcement : disarmReceipt.receipt,
      }),
    [announcement, disarmReceipt.receipt]
  );

  const dialogProps = React.useMemo<ConfirmDialogState>(
    () => ({
      tier,
      open,
      pending,
      title,
      body,
      confirmLabel,
      busySuffix,
      cancelLabel,
      expectedPhrase,
      confirmDelay: tier === 'dialog',
      onCancel: cancel,
      onConfirm: confirm,
      confirmDisabled,
    }),
    [
      tier,
      open,
      pending,
      title,
      body,
      confirmLabel,
      busySuffix,
      cancelLabel,
      expectedPhrase,
      cancel,
      confirm,
      confirmDisabled,
    ]
  );

  return {
    tier,
    open,
    pending,
    armedId,
    statusNode,
    trigger,
    confirm,
    cancel,
    confirmDisabled,
    matchesPhrase,
    isArmed,
    labelFor,
    reserveFor,
    triggerProps,
    dialogProps,
  };
}
