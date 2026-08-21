'use client';

/**
 * Combobox — the typeahead picker primitive (Req 5/8, UI-SPEC §8.5).
 *
 * Backs `GameComboInput`. The text field is the {@link Input} primitive, so the 16px
 * iOS-zoom floor (Req 1) lives in exactly one place and this file never restates it.
 * Everything else here is the ARIA + keyboard contract §8.5 locks:
 *
 * - `role="combobox"` / `aria-expanded` / `aria-controls` / `aria-activedescendant` on the
 *   INPUT, `role="listbox"` + `role="option"` on the popup (AR R1-M19).
 * - ArrowUp/ArrowDown traverse, Enter selects, Escape closes and returns focus to the input.
 * - Options clear the 44px touch floor (`min-h-11`); the listbox sits on
 *   `--color-bg-elevated` with `shadow-theme-lg` and `--radius-card`.
 *
 * The accessible NAME of the field is the consumer's (`aria-label`, or a visible
 * `<label htmlFor>` pointing at `id`) — same contract as {@link Switch}. This primitive
 * cannot invent one.
 *
 * Open state and the item list are CONTROLLED. Consumers own debouncing, fetching and
 * "when is this allowed to open", because the shipped picker's open rule is not
 * "has items" (it opens on a pending search too, to show the loading row).
 */

import * as React from 'react';
import {
  autoUpdate,
  flip,
  offset,
  shift,
  useDismiss,
  useFloating,
  useInteractions,
  useListNavigation,
  useRole,
} from '@floating-ui/react';

import { cn } from '@/lib/cn';

import { Input } from './Input';

/* DECISION Phase 88-08 (OI-6): this primitive is built on `@floating-ui/react`, which is
   ALREADY a direct dependency (`ClickableMemberName`, `HeatmapTooltip`). It was chosen OVER
   the obvious alternative — pulling the shadcn `command` block through the CLI and pairing it
   with the Radix popover package, i.e. the route the ecosystem docs describe as "the" way to
   build a combobox.

   That route is rejected for a MECHANICAL reason, not taste: the `command` registry entry
   declares a registry dependency on `dialog`, so installing it OVERWRITES this repo's shipped
   `src/components/ui/dialog.tsx` — 125 hand-tuned lines already consumed by `Modal`,
   `ConfirmDialog` and `DangerZoneDeleteAccount`, carrying its own Phase 88-05 decision record.
   The CLI gives no per-file opt-out. So the "upgrade" silently reverts four shipped surfaces.

   (The two package names that route would add are deliberately NOT written anywhere in this
   file, so the phase's dependency grep gate cannot match this comment. See 88-08-PLAN.md
   and UI-SPEC §12 OI-6 for the names.)

   Re-routing this to the CLI is a decision that clobbers `dialog.tsx`, not a cleanup. */

/* DECISION Phase 88-08 (UI-SPEC §8.5): the listbox renders INLINE inside the wrapper —
   absolutely positioned by floating-ui — rather than through `FloatingPortal`, which is the
   idiom both existing floating-ui consumers here use and the one a future reader is most
   likely to "correct" this to.

   Inline loses portal's escape from ancestor `overflow`, and wins on the thing that matters:
   every shipped call site (`createEvent`, `ScheduleForm`, `BallotOptionsEditor`) renders this
   INSIDE a Radix dialog. A portalled listbox lands outside the dialog's DOM subtree, so its
   pointer events read as "outside press" to the dialog's dismiss layer. Focus stays on the
   input the whole time (virtual focus), so portal buys no focus-trap benefit to offset that.
   The shipped picker was inline-absolute too, so this is also behaviour-preserving.

   Moving this to a portal is a decision that must re-verify dialog dismissal, not a cleanup. */

export interface ComboboxItem {
  /** Stable React key. */
  key: string;
  /** Rendered option content. */
  label: React.ReactNode;
  /**
   * Optional section heading. Consecutive items sharing a `group` render under one
   * `role="group"`; arrow keys still traverse the whole list, across sections.
   */
  group?: string;
  disabled?: boolean;
  onSelect: () => void;
}

export interface ComboboxProps
  extends Omit<
    React.InputHTMLAttributes<HTMLInputElement>,
    'value' | 'onChange' | 'onSelect'
  > {
  items: ComboboxItem[];
  /** Text field value (controlled). */
  value: string;
  onValueChange: (value: string) => void;
  /** Popup open state (controlled — see the file header). */
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Renders the loading row instead of the empty row. */
  loading?: boolean;
  loadingLabel?: string;
  emptyLabel?: string;
  /**
   * When no option is highlighted, does Enter commit the FIRST enabled item?
   * Defaults true — the 88-08 GameComboInput parity (relevant-search-hit lists).
   * Pass false for pickers that open on FOCUS over a full unfiltered list
   * (88-CODE-REVIEW MED#2: the timezone picker committed "Africa/Abidjan" on a
   * bare Enter from a keyboard user tabbing through the page).
   */
  selectFirstOnEnter?: boolean;
  /** Accessible name for the listbox itself. */
  listLabel?: string;
  /**
   * Slot inside the field wrapper, for a clear/affordance button. Positioned by the
   * caller; the field reserves right padding whenever it is present.
   */
  trailing?: React.ReactNode;
  /** Class on the outer wrapper. */
  className?: string;
  /** Class on the text field. */
  inputClassName?: string;
  /** Class on the popup surface. */
  listClassName?: string;
}

interface RenderGroup {
  name?: string;
  entries: Array<{ item: ComboboxItem; index: number }>;
}

const Combobox = React.forwardRef<HTMLInputElement, ComboboxProps>(
  (
    {
      items,
      value,
      onValueChange,
      open,
      onOpenChange,
      loading = false,
      loadingLabel = 'Searching…',
      emptyLabel = 'No results found',
      selectFirstOnEnter = true,
      listLabel = 'Suggestions',
      trailing,
      className,
      inputClassName,
      listClassName,
      ...inputProps
    },
    forwardedRef
  ) => {
    const [activeIndex, setActiveIndex] = React.useState<number | null>(null);
    const listRef = React.useRef<Array<HTMLElement | null>>([]);
    const inputRef = React.useRef<HTMLInputElement | null>(null);
    const headingId = React.useId();

    // Keep the navigation list exactly as long as `items`, so a shrunk result set cannot
    // leave stale nodes behind for arrow-key navigation to land on.
    if (listRef.current.length !== items.length) {
      listRef.current.length = items.length;
    }

    const { refs, floatingStyles, context } = useFloating({
      open,
      onOpenChange,
      whileElementsMounted: autoUpdate,
      middleware: [offset(4), flip({ padding: 8 }), shift({ padding: 8 })],
    });

    // `role: 'combobox'` is what supplies the whole R1-M19 attribute set — `role="combobox"`,
    // `aria-expanded`, `aria-controls` and `aria-autocomplete` on the INPUT, plus
    // `role="listbox"` on the popup and `role="option"` + `aria-selected` on each row. Do not
    // hand-author those alongside it; two sources for one attribute is how they drift.
    const role = useRole(context, { role: 'combobox' });
    const dismiss = useDismiss(context);
    const disabledIndices = React.useMemo(
      () =>
        items.reduce<number[]>((acc, item, index) => {
          if (item.disabled) acc.push(index);
          return acc;
        }, []),
      [items]
    );
    const listNavigation = useListNavigation(context, {
      listRef,
      activeIndex,
      onNavigate: setActiveIndex,
      disabledIndices,
      // Virtual focus: the DOM focus never leaves the text field, so typing keeps working
      // while arrow keys move `aria-activedescendant`. This is also why Escape has nothing
      // to "restore" in practice — the explicit refocus below is belt-and-braces for the
      // pointer-driven path.
      virtual: true,
      loop: true,
      focusItemOnOpen: false,
    });

    const { getReferenceProps, getFloatingProps, getItemProps } = useInteractions([
      role,
      dismiss,
      listNavigation,
    ]);

    const setInputRef = React.useCallback(
      (node: HTMLInputElement | null) => {
        inputRef.current = node;
        refs.setReference(node);
        if (typeof forwardedRef === 'function') forwardedRef(node);
        else if (forwardedRef) forwardedRef.current = node;
      },
      [refs, forwardedRef]
    );

    const selectAt = React.useCallback(
      (index: number) => {
        const item = items[index];
        if (!item || item.disabled) return false;
        item.onSelect();
        setActiveIndex(null);
        return true;
      },
      [items]
    );

    /* DECISION Phase 88-08: with no active option, Enter selects the FIRST enabled item
       rather than doing nothing (the strict ARIA-pattern reading). This PRESERVES the
       shipped `GameComboInput` behaviour — `handleKeyDown` there selects `localResults[0]`
       or `bggResults[0]` on Enter — and 88-08 is an adoption, not a behaviour change.
       Making Enter inert without an active option is a decision, not a cleanup.
       AMENDED by 88-CODE-REVIEW MED#2 (2026-08-06): parity stays the DEFAULT, but it was
       written for lists that only open after typed input (every first item is a relevant
       hit). A consumer that opens on FOCUS over a full unfiltered list opts out via
       `selectFirstOnEnter={false}` — there, Enter with nothing highlighted takes the
       strict ARIA reading (inert) instead of committing an arbitrary first entry.
       AMENDED by 88-CODE-REVIEW MED#3 (2026-08-06): Enter-while-open ALWAYS
       preventDefaults, selectable item or not. The deleted GameComboInput handler
       absorbed Enter unconditionally while open; dropping that let Enter during the
       debounce/no-results window fall through and SUBMIT the host form (createEvent,
       ScheduleForm, BallotOptionsEditor all wrap this in <form onSubmit>). */
    const handleKeyDown = (event: React.KeyboardEvent<HTMLInputElement>) => {
      if (event.key === 'Enter' && open) {
        event.preventDefault();
        const index =
          activeIndex ?? (selectFirstOnEnter ? items.findIndex((item) => !item.disabled) : -1);
        if (index >= 0) {
          selectAt(index);
        }
        return;
      }
      if (event.key === 'Escape') {
        setActiveIndex(null);
        if (open) {
          onOpenChange(false);
          inputRef.current?.focus();
        }
      }
    };

    const groups = React.useMemo<RenderGroup[]>(() => {
      const acc: RenderGroup[] = [];
      items.forEach((item, index) => {
        const last = acc[acc.length - 1];
        if (last && last.name === item.group) last.entries.push({ item, index });
        else acc.push({ name: item.group, entries: [{ item, index }] });
      });
      return acc;
    }, [items]);

    const renderOption = ({ item, index }: { item: ComboboxItem; index: number }) => (
      <div
        key={item.key}
        ref={(node) => {
          listRef.current[index] = node;
        }}
        className={cn(
          // §8.5: options clear the 44px touch floor at every width — this is the row a
          // thumb aims at on a phone, so the floor is unconditional, not `max-md:`.
          'flex min-h-11 w-full cursor-pointer items-center px-3 py-2',
          'text-base text-content-primary',
          activeIndex === index && 'bg-surface-card-hover',
          item.disabled && 'cursor-not-allowed opacity-50'
        )}
        {...getItemProps({
          active: activeIndex === index,
          selected: activeIndex === index,
          onClick() {
            selectAt(index);
          },
        })}
      >
        {item.label}
      </div>
    );

    const status = loading ? loadingLabel : items.length === 0 ? emptyLabel : null;

    return (
      <div className={cn('relative', className)}>
        <div className="relative flex items-center">
          <Input
            ref={setInputRef}
            value={value}
            onChange={(event) => onValueChange(event.target.value)}
            className={cn(trailing && 'pr-11', inputClassName)}
            {...getReferenceProps({
              ...inputProps,
              onKeyDown: handleKeyDown,
            })}
          />
          {trailing}
        </div>

        {open && (
          <div
            ref={refs.setFloating}
            style={floatingStyles}
            className={cn(
              'z-50 w-full overflow-y-auto',
              'max-h-60 rounded-card border border-line bg-surface-elevated shadow-theme-lg',
              listClassName
            )}
          >
            {/* The listbox is a separate node from the positioned surface so the status row
                below can live OUTSIDE it: a `listbox` may own only `option`/`group`, and a
                loose "Searching…" div inside one is an aria-required-children violation. */}
            <div aria-label={listLabel} className="py-1" {...getFloatingProps()}>
              {groups.map((group, groupIndex) =>
                group.name ? (
                  <div
                    key={`${group.name}-${groupIndex}`}
                    role="group"
                    aria-labelledby={`${headingId}-${groupIndex}`}
                  >
                    <div
                      id={`${headingId}-${groupIndex}`}
                      className="border-b border-line bg-surface-page px-3 py-1 text-sm text-content-muted"
                    >
                      {group.name}
                    </div>
                    {group.entries.map(renderOption)}
                  </div>
                ) : (
                  group.entries.map(renderOption)
                )
              )}
            </div>
            {status && (
              <div role="status" className="px-3 py-2 text-base text-content-muted">
                {status}
              </div>
            )}
          </div>
        )}
      </div>
    );
  }
);

Combobox.displayName = 'Combobox';

export { Combobox };
