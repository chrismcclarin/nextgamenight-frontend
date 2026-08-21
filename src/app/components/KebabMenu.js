'use client';

import { useState, useEffect, useRef } from 'react';

/**
 * KebabMenu — reusable ⋮ trigger + dropdown overlay.
 *
 * Used to collapse multiple row actions into a single touch-friendly target
 * on narrow viewports. Trigger style + dropdown chrome match the gameDetail
 * event-actions kebab (Phase 65-02) for visual consistency.
 *
 * Items API:
 *   { label: string, onClick: () => void, danger?: bool, twoTap?: bool, disabled?: bool }
 *
 * twoTap items follow the Phase 65-02 destructive-confirm pattern:
 *   - First tap: label flips to "Tap again to confirm" (or item.confirmLabel),
 *     3s revert timer arms, item highlights red.
 *   - Second tap on same item within 3s: invokes item.onClick + closes menu.
 *   - Timeout or another item tap reverts the armed state.
 *
 * Outside-click closes the menu (mousedown listener on a container ref,
 * mirroring NotificationBell.js).
 *
 * @param {string} ariaLabel - Accessible label for the trigger button.
 * @param {Array<Object>} items - Action items (see shape above).
 * @param {string} [confirmLabel] - Default label for armed twoTap items.
 *                                  Each item can override via item.confirmLabel.
 */
export default function KebabMenu({
  ariaLabel = 'Actions',
  items = [],
  confirmLabel = 'Tap again to confirm',
}) {
  const [open, setOpen] = useState(false);
  const [armedIndex, setArmedIndex] = useState(null);
  const containerRef = useRef(null);
  const armedTimerRef = useRef(null);

  // Outside-click closes the dropdown (mousedown so it fires before click
  // bubbles, same idiom as NotificationBell).
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
  useEffect(() => {
    if (!open) {
      if (armedTimerRef.current) {
        clearTimeout(armedTimerRef.current);
        armedTimerRef.current = null;
      }
      setArmedIndex(null);
    }
  }, [open]);

  // Cleanup on unmount — pending timer must not fire after unmount.
  useEffect(() => {
    return () => {
      if (armedTimerRef.current) {
        clearTimeout(armedTimerRef.current);
        armedTimerRef.current = null;
      }
    };
  }, []);

  const handleItemClick = (item, index) => {
    if (item.disabled) return;

    if (item.twoTap) {
      // First tap on this item: arm the 3s revert timer.
      if (armedIndex !== index) {
        if (armedTimerRef.current) clearTimeout(armedTimerRef.current);
        setArmedIndex(index);
        armedTimerRef.current = setTimeout(() => {
          setArmedIndex(null);
          armedTimerRef.current = null;
        }, 3000);
        return;
      }
      // Second tap within 3s — clear timer + commit.
      clearTimeout(armedTimerRef.current);
      armedTimerRef.current = null;
      setArmedIndex(null);
      item.onClick();
      setOpen(false);
      return;
    }

    // Single-tap path.
    item.onClick();
    setOpen(false);
  };

  return (
    <div className="relative shrink-0" ref={containerRef}>
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
          `.btn` — which is exactly why it needed its own. Removing the floor is a decision. */}
      <button
        type="button"
        onClick={() => setOpen((prev) => !prev)}
        className="inline-flex min-h-11 min-w-11 items-center justify-center text-2xl text-content-muted hover:text-content-primary leading-none rounded-sm hover:bg-surface-card-hover active:opacity-75 transition-colors focus:outline-hidden focus-visible:ring-2 focus-visible:ring-focus-ring focus-visible:ring-offset-2"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label={ariaLabel}
        title={ariaLabel}
      >
        {/* Unicode vertical-ellipsis — matches gameDetail event-actions kebab. */}
        ⋮
      </button>

      {open && (
        <div
          role="menu"
          className="absolute right-0 top-full mt-1 z-20 min-w-[160px] bg-surface-card border border-line rounded-md shadow-lg py-1"
        >
          {items.map((item, index) => {
            const isArmed = item.twoTap && armedIndex === index;
            const label = isArmed ? (item.confirmLabel || confirmLabel) : item.label;
            const danger = item.danger || isArmed;
            return (
              <button
                key={`${item.label}-${index}`}
                type="button"
                role="menuitem"
                onClick={() => handleItemClick(item, index)}
                disabled={item.disabled}
                /* 88-CODE-REVIEW MED#13: min-h-11 — the 87.8-08 census FAIL row (~36px)
                   these items still carried after D-40 made this menu the SOLE phone
                   path to destructive row actions. The trigger was floored by 88-28;
                   the items behind it were not. The dropdown is an absolute overlay,
                   so taller rows reflow nothing outside it. */
                className={`w-full min-h-11 text-left px-3 py-2 text-sm active:opacity-75 transition-colors disabled:opacity-50 disabled:cursor-not-allowed focus:outline-hidden focus-visible:ring-2 focus-visible:ring-focus-ring focus-visible:ring-inset ${
                  danger
                    ? `text-status-error ${isArmed ? 'bg-status-error-subtle font-semibold' : 'hover:bg-surface-card-hover'}`
                    : 'text-content-primary hover:bg-surface-card-hover'
                }`}
              >
                {label}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
