'use client';

/**
 * DelayedSpinner — the delayed, held house Spinner every busy host renders (plan 88.9-54,
 * owner ruling R-C3b).
 *
 * Mount it unconditionally beside the label with the host's own busy flag:
 * `<DelayedSpinner busy={saving} className="ml-2" />`. It renders null until the busy has
 * lasted SPINNER_DELAY_MS, then the house {@link Spinner}, and keeps it SPINNER_MIN_MS from
 * its appearance even after busy drops. The host keeps its own sr-only suffix on its busy
 * flag (the heard name is immediate) and never wraps this element in a busy guard — a guard
 * would unmount it on success and lose the hold.
 */
import * as React from 'react';

import { Spinner } from './Spinner';
import { useDelayedSpinner } from './useDelayedSpinner';

export interface DelayedSpinnerProps {
  /** The host's in-flight flag. */
  busy: boolean;
  /** Extra classes for the Spinner once shown (the raw-host idiom passes "ml-2 align-middle"). */
  className?: string;
}

/* DECISION Phase 88.9-54 (R-C3b, reach): the delayed, held Spinner is an always-mounted ELEMENT rather than a hook each host calls, chosen OVER a hook-only API — two shipped hosts render their spinner inside a .map (KebabMenu items, the RSVP trio), where a hook cannot be called, and a host that unmounts the spinner when busy drops would lose the hold; a host mounts this element unconditionally beside its label (it renders null until shown), keeps its own sr-only suffix on its busy flag, and never wraps it in a busy guard. The hold ends with the host: a host whose spinner leaves the tree on success (a confirm dialog that closes, a modal whose action calls onClose, a banner that unmounts on a successful retry) ends the hold with it — the close IS the completion feedback — chosen OVER delaying the close until the hold is spent, which would add up to 500 ms of lag to every destructive confirm (orchestrator merits ruling 2026-11-10, reported to the owner; 88.9-51 R12 can overrule it). Button is the first consumer; plan 88.9-56 Task 3 mounts it at every raw host. */
export function DelayedSpinner({ busy, className }: DelayedSpinnerProps) {
  const shown = useDelayedSpinner(busy);
  return shown ? <Spinner className={className} /> : null;
}

DelayedSpinner.displayName = 'DelayedSpinner';
