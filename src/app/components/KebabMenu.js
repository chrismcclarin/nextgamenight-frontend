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
    <div className="relative flex-shrink-0" ref={containerRef}>
      <button
        type="button"
        onClick={() => setOpen((prev) => !prev)}
        className="text-2xl text-content-muted hover:text-content-primary px-2 py-1 leading-none rounded hover:bg-surface-card-hover transition-colors"
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
                className={`w-full text-left px-3 py-2 text-sm transition-colors disabled:opacity-50 disabled:cursor-not-allowed ${
                  danger
                    ? `text-status-error ${isArmed ? 'bg-status-error/10 font-semibold' : 'hover:bg-surface-card-hover'}`
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
