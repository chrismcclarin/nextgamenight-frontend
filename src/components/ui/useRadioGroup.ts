'use client';

/**
 * useRadioGroup — the one radio-group keyboard and state model (Phase 88.6.1-43, D-20 / D-43).
 *
 * It implements the ARIA APG radio group pattern for buttons that act as radios:
 * - the container is a `radiogroup` with a REQUIRED name (`labelledBy` or `label`);
 * - each item is `role="radio"`, `type="button"`, with `aria-checked`;
 * - the group is ONE tab stop: a roving tabIndex of 0 on the checked item (on the first
 *   item when nothing is checked, or when `checked` is not one of the values) and -1 on
 *   every other item;
 * - ArrowRight / ArrowDown move focus to the next item AND check it, ArrowLeft / ArrowUp to
 *   the previous one, wrapping at both ends; an arrow held with Alt, Ctrl or Meta is left
 *   to the browser;
 * - Space and Enter check the focused item through native button activation (the item's
 *   `onClick`), which is also why each item is `type="button"`: inside a form it never
 *   submits.
 *
 * Consumers: the GroupSettings default-icon picker. Phase 88.9's StarRatingPicker residual 1
 * (ten individually tabbable half-star radios) is meant to adopt this hook rather than write a
 * second roving handler — radios that are not DOM siblings are supported, because each item's
 * handler knows its own index.
 *
 * Contract for consumers: spread `groupProps` on the container and `getRadioProps(index)` on
 * each item, and react to a change through `onCheck` only. Do NOT override the returned
 * `onClick` / `onKeyDown` / `ref` — compose through `onCheck`, or the item keeps the radio role
 * without its keyboard model. Selection follows focus, so `onCheck` must be cheap and safe to
 * call on every arrow press (local state, never a request).
 *
 * What it deliberately does NOT do: no markup, no styling, no Home / End (the APG lists them as
 * optional for radio groups), no 2-D grid model.
 *
 * DECISION Phase 88.6.1-43 (D-20 / D-43): ONE typed radio-group hook. Chosen: a small shared
 * hook that returns the radio role, aria-checked, the roving tabIndex, type="button", a ref and
 * the arrow handler TOGETHER, so a consumer cannot take the role without its keys. Rejected:
 * (a) an inline handler in GroupSettings.js — Phase 88.9's StarRatingPicker would copy it (the
 * milestone's duplication tenet); (b) extending useHeatmapCell — a grid model that clamps at the
 * edges instead of wrapping, is 2-D, maps Home/End/PageUp/PageDown, moves focus without
 * selecting, and by its own header decides no role; a mode flag would put two keyboard models
 * in a hook three grid files share; (c) a Radix radio group — not installed, and this phase
 * installs nothing; (d) one group-level keydown that resolves the focused radio from the event
 * target — per-radio handlers know their index by closure and keep working when radios are not
 * DOM siblings. The role travels WITH the keys on purpose: a radio role without its arrow model
 * is as dishonest as the aria-pressed D-20 replaced. Changing this is a decision, not a cleanup.
 */
import * as React from 'react';

/** The group's name — exactly one of the two is required. */
type RadioGroupName =
  | { labelledBy: string; label?: never }
  | { label: string; labelledBy?: never };

export type UseRadioGroupOptions<T> = {
  /** The options, in reading order. */
  values: readonly T[];
  /** The checked value. None is checked when null, undefined, or not one of `values` (`Object.is`). */
  checked: T | null | undefined;
  /** Called by a click, by native Space / Enter activation, and by an arrow move. */
  onCheck: (value: T) => void;
} & RadioGroupName;

export interface RadioGroupProps {
  role: 'radiogroup';
  'aria-labelledby'?: string;
  'aria-label'?: string;
}

export interface RadioItemProps {
  role: 'radio';
  type: 'button';
  'aria-checked': boolean;
  tabIndex: 0 | -1;
  ref: (node: HTMLElement | null) => void;
  onClick: () => void;
  onKeyDown: (event: React.KeyboardEvent<HTMLElement>) => void;
}

export interface UseRadioGroupResult {
  groupProps: RadioGroupProps;
  getRadioProps: (index: number) => RadioItemProps;
}

const NEXT_KEYS = new Set(['ArrowRight', 'ArrowDown']);
const PREVIOUS_KEYS = new Set(['ArrowLeft', 'ArrowUp']);

export function useRadioGroup<T>(options: UseRadioGroupOptions<T>): UseRadioGroupResult {
  const { values, checked, onCheck } = options;
  const nodesRef = React.useRef<(HTMLElement | null)[]>([]);

  const checkedIndex = values.findIndex((value) => Object.is(value, checked));
  const tabStopIndex = checkedIndex === -1 ? 0 : checkedIndex;

  const groupProps: RadioGroupProps =
    'labelledBy' in options && options.labelledBy !== undefined
      ? { role: 'radiogroup', 'aria-labelledby': options.labelledBy }
      : { role: 'radiogroup', 'aria-label': (options as { label: string }).label };

  const getRadioProps = (index: number): RadioItemProps => ({
    role: 'radio',
    type: 'button',
    'aria-checked': index === checkedIndex,
    tabIndex: index === tabStopIndex ? 0 : -1,
    ref: (node) => {
      nodesRef.current[index] = node;
    },
    onClick: () => onCheck(values[index]),
    onKeyDown: (event) => {
      if (event.altKey || event.ctrlKey || event.metaKey) return;
      const length = values.length;
      let target: number;
      if (NEXT_KEYS.has(event.key)) {
        target = (index + 1) % length;
      } else if (PREVIOUS_KEYS.has(event.key)) {
        target = (index - 1 + length) % length;
      } else {
        // Space / Enter stay native button activation; Tab leaves the group in one stop.
        return;
      }
      event.preventDefault();
      onCheck(values[target]);
      nodesRef.current[target]?.focus();
    },
  });

  return { groupProps, getRadioProps };
}
