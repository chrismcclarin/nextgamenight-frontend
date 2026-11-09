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
  CONFIRM_LIVE_MS,
  countdownLabel,
  useConfirmCountdown,
} from '@/components/ui/confirmDelay';
import { StatusRegion } from '@/components/ui/StatusRegion';

export type ConfirmTier = 'typed' | 'dialog' | 'two-tap';

/**
 * The arm window, in ms: gated, then live, both numbers from
 * src/components/ui/confirmDelay.ts ("export const CONFIRM_DELAY_MS = 3000;"). The original
 * 3 s window was the SHIPPED kebab value of src/app/gameDetail/page.js (Phase 65-02 EVT-08),
 * absorbed rather than reinvented.
 * AMENDED Phase 88.9-23 (owner pick F9b, 88.9-PICKS-B5.json, 2026-11-07): the window is now gated
 * CONFIRM_DELAY_MS + live CONFIRM_LIVE_MS (6000 ms) from confirmDelay.ts, chosen OVER the shipped
 * 3000 ms immediately-live window.
 */
export const TWO_TAP_WINDOW_MS = CONFIRM_DELAY_MS + CONFIRM_LIVE_MS;

/** The armed visible label, matching `KebabMenu.js`'s shipped default. */
export const DEFAULT_ARMED_LABEL = 'Tap again to confirm';

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
   * `dialog`/`typed` only, optional: the confirm's text while the commit is pending
   * ("Disconnecting…"). Passed through `dialogProps`; see ConfirmDialog's `pendingLabel`.
   * Ignored by `two-tap`. (88.6.1 code review CR-5 / A-75)
   */
  pendingLabel?: string;
  /** Cancel copy. @default 'Cancel' */
  cancelLabel?: string;
  /** `typed` tier only: the phrase that must be entered EXACTLY. */
  expectedPhrase?: string;
  /** `two-tap` tier only: the armed visible label. @default 'Tap again to confirm' */
  armedLabel?: string;
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
  /** Present only when the caller supplied a resting name; swaps with the visible label. */
  'aria-label'?: string;
}

/** Everything `ConfirmDialog` needs. Spread it: `<ConfirmDialog {...dialogProps} />`. */
export interface ConfirmDialogState {
  tier: ConfirmTier;
  open: boolean;
  pending: boolean;
  title: string;
  body?: React.ReactNode;
  confirmLabel: string;
  pendingLabel?: string;
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
  /** `two-tap`: props for this target's row trigger. */
  triggerProps: (
    targetId?: string,
    targetLabel?: string,
    restingAriaLabel?: string
  ) => ConfirmTriggerProps;
  /** Spread onto `<ConfirmDialog>`. */
  dialogProps: ConfirmDialogState;
}

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
   triggerProps sites. */

export function useConfirmAction(config: UseConfirmActionConfig): ConfirmActionState {
  const {
    tier,
    title,
    body,
    confirmLabel,
    pendingLabel,
    cancelLabel = 'Cancel',
    expectedPhrase,
    armedLabel = DEFAULT_ARMED_LABEL,
    armedAnnouncement = defaultAnnouncement,
    onConfirm,
  } = config;

  const [open, setOpen] = React.useState(false);
  const [pending, setPending] = React.useState(false);
  const [armedId, setArmedId] = React.useState<string | null>(null);
  const [announcement, setAnnouncement] = React.useState('');

  // Refs mirror the state the event handlers must read SYNCHRONOUSLY. Two clicks
  // inside one tick see stale state but never a stale ref — which is what makes
  // the no-double-fire and re-arm guarantees hold under a fast double tap.
  const armedIdRef = React.useRef<string | null>(null);
  const pendingRef = React.useRef(false);
  const targetRef = React.useRef<string | undefined>(undefined);
  const armedTimerRef = React.useRef<ReturnType<typeof setTimeout> | null>(null);
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
  React.useEffect(() => {
    onConfirmRef.current = onConfirm;
    tierRef.current = tier;
    armedAnnouncementRef.current = armedAnnouncement;
    confirmLabelRef.current = confirmLabel;
  });

  const clearArmTimer = React.useCallback(() => {
    if (armedTimerRef.current) {
      clearTimeout(armedTimerRef.current);
      armedTimerRef.current = null;
    }
  }, []);

  // Unmount cleanup, absorbed verbatim in semantics from
  // src/app/components/KebabMenu.js ("Cleanup on unmount — pending timer must not fire after unmount."):
  // a pending arm timer must never fire into an unmounted tree.
  React.useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      if (armedTimerRef.current) {
        clearTimeout(armedTimerRef.current);
        armedTimerRef.current = null;
      }
    };
  }, []);

  // F9b (88.9-23): the two-tap countdown, keyed by the armed target. The dialog tier's visible
  // countdown is ConfirmDialog's own (see the AMENDED line on the R2-M16 marker above); the typed
  // tier has none. onLive writes the unchanged NC-1 arm text once pressing works.
  const announceLive = React.useCallback(() => {
    if (tierRef.current === 'two-tap' && armedIdRef.current !== null) {
      setAnnouncement(pendingAnnouncementRef.current);
    }
  }, []);
  const countdown = useConfirmCountdown(tier === 'two-tap' ? armedId : null, announceLive);
  const { isLive, secondsLeft } = countdown;
  const gated = tier === 'two-tap' && !countdown.live;
  // The armed label: counting down while gated, then the live label. A gate with a custom armed
  // label counts down on that label (userProfile's fork-7 'Remove' reads 'Remove (3)', owner
  // 2026-11-08, 88.9-RULINGS.md R-W1); the default reads 'Tap again (3)' (copy table).
  const armedText = gated
    ? countdownLabel(armedLabel === DEFAULT_ARMED_LABEL ? 'Tap again' : armedLabel, secondsLeft)
    : armedLabel;

  const disarm = React.useCallback(() => {
    clearArmTimer();
    armedIdRef.current = null;
    setArmedId(null);
    setAnnouncement('');
  }, [clearArmTimer]);

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
        clearArmTimer();
        armedIdRef.current = key;
        setArmedId(key);
        // F9b: the text is unchanged (copy NC-1); it is held until the countdown's live edge.
        pendingAnnouncementRef.current = armedAnnouncementRef.current(
          targetLabel,
          confirmLabelRef.current
        );
        setAnnouncement('');
        armedTimerRef.current = setTimeout(() => {
          armedTimerRef.current = null;
          armedIdRef.current = null;
          if (!mountedRef.current) return;
          setArmedId(null);
          setAnnouncement('');
        }, TWO_TAP_WINDOW_MS);
        return;
      }

      // Second invocation on the SAME target while the gate still runs — refused (F9b): stay
      // armed, announcement unchanged. Read from a ref, so a double tap inside one tick cannot
      // slip through.
      if (!isLive(key)) return;

      // Second invocation on the SAME target inside the live window — commit.
      clearArmTimer();
      armedIdRef.current = null;
      setArmedId(null);
      setAnnouncement('');
      void runConfirm(targetId, { from: from ?? null });
    },
    [clearArmTimer, runConfirm, isLive]
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
  }, [disarm]);

  const isArmed = React.useCallback(
    (targetId?: string) => armedId !== null && armedId === (targetId ?? SOLE_TARGET_KEY),
    [armedId]
  );

  const labelFor = React.useCallback(
    (targetId: string | undefined, restingLabel: string) =>
      isArmed(targetId) ? armedText : restingLabel,
    [isArmed, armedText]
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
      // F9b (88.9-23, MED-61): "the armed label" is the string labelFor renders, countdown
      // included — never the live label under a visible 'Tap again (3)'.
      const accessibleName = armed ? armedText : restingAriaLabel;
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
        ...(restingAriaLabel !== undefined && accessibleName !== undefined
          ? { 'aria-label': accessibleName }
          : {}),
      };
    },
    [isArmed, armedText, gated, trigger]
  );

  const statusNode = React.useMemo(
    () =>
      React.createElement(StatusRegion, {
        // Visually hidden: the visible armed label is the sighted affordance,
        // this is the same information for assistive tech.
        className: 'sr-only',
        message: announcement,
      }),
    [announcement]
  );

  const dialogProps = React.useMemo<ConfirmDialogState>(
    () => ({
      tier,
      open,
      pending,
      title,
      body,
      confirmLabel,
      pendingLabel,
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
      pendingLabel,
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
    triggerProps,
    dialogProps,
  };
}
