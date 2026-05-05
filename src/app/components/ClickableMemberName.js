'use client';

import { useState, useEffect, useContext } from 'react';
import {
  useFloating,
  useHover,
  useDismiss,
  useInteractions,
  safePolygon,
  offset,
  flip,
  shift,
  autoUpdate,
  FloatingPortal,
} from '@floating-ui/react';
import { FriendshipContext } from './FriendshipStatusProvider';

/**
 * ClickableMemberName - Wraps a member name with a hover-to-open tooltip
 * for sending friend requests on desktop. Phase 68-02 MOB-06 adds an
 * always-visible inline "+ Add friend" / "⏳ Pending" / "✓ Friend"
 * indicator on mobile (<768px) so touch users have a primary affordance
 * that does not depend on hover or popover gymnastics.
 *
 * Render decisions per status:
 * - self     → plain span (no tooltip, no indicator)
 * - unknown  → plain span (API failed; graceful degradation, no indicator)
 * - accepted → name + mobile-only "✓ Friend" indicator (no popover —
 *              already-friends has no actionable affordance)
 * - none / pending_sent / pending_received → name with desktop hover-tooltip
 *              popover + existing touch-tap-toggle fallback for hybrid
 *              touch laptops at desktop widths + mobile inline indicator
 *              ("+", "⏳ Pending")
 *
 * The existing `'ontouchstart' in window` tap-toggle on the name span is
 * PRESERVED. Hybrid touch laptops (Surface, touchscreen MacBooks via
 * emulation, iPads in landscape) render at ≥768px so the new mobile "+"
 * (md:hidden) is hidden — without the tap-toggle they would have no path
 * to the friend-request flow.
 *
 * @param {string} userId - Auth0 user_id of the member
 * @param {string} username - Display name
 * @param {React.ReactNode} children - Optional custom render (defaults to username span)
 */
export default function ClickableMemberName({ userId, username, children }) {
  const { getStatus, sendRequest } = useContext(FriendshipContext);
  const [isOpen, setIsOpen] = useState(false);
  const [sent, setSent] = useState(false);
  const [sendError, setSendError] = useState(false);

  const status = getStatus(userId);

  const { refs, floatingStyles, context } = useFloating({
    open: isOpen,
    onOpenChange: setIsOpen,
    placement: 'bottom-start',
    middleware: [offset(6), flip(), shift({ padding: 8 })],
    whileElementsMounted: autoUpdate,
  });

  const hover = useHover(context, {
    delay: { open: 300 },
    handleClose: safePolygon({ blockPointerEvents: true }),
    mouseOnly: true,
  });
  const dismiss = useDismiss(context);
  const { getReferenceProps, getFloatingProps } = useInteractions([hover, dismiss]);

  // Reset sent/error state when tooltip closes so stale messages don't persist
  useEffect(() => {
    if (!isOpen) {
      const timer = setTimeout(() => {
        setSent(false);
        setSendError(false);
      }, 300);
      return () => clearTimeout(timer);
    }
  }, [isOpen]);

  const handleSendRequest = async (e) => {
    // Stop propagation so a tap on the inline "+" doesn't bubble up to the
    // wrapping name span and toggle the popover. The "+" and the popover
    // are independent affordances on devices that have both.
    if (e?.stopPropagation) e.stopPropagation();
    setSendError(false);
    try {
      await sendRequest(userId);
      setSent(true);
      // No-op on mobile (popover never opened); preserved for desktop parity.
      setTimeout(() => setIsOpen(false), 1500);
    } catch (err) {
      console.error('Failed to send friend request:', err);
      setSendError(true);
    }
  };

  // Plain-text cases — no popover, no inline affordance.
  if (status === 'self' || status === 'unknown') {
    return children || <span>{username}</span>;
  }

  // Already friends — no actionable affordance, but show "✓ Friend" inline
  // on mobile so the relationship state has touch parity with the desktop
  // hover-tooltip semantics.
  if (status === 'accepted') {
    return (
      <>
        {children || <span>{username}</span>}
        <span className="md:hidden ml-1 text-xs text-status-success">✓ Friend</span>
      </>
    );
  }

  // Pending or none — both render the desktop hover-tooltip + the existing
  // touch tap-toggle (preserved for hybrid touch laptops at ≥768px) PLUS a
  // mobile-only inline indicator (+ for none, ⏳ Pending for pending_*).

  const renderTooltipContent = () => {
    // Already sent (optimistic UI after clicking Add friend)
    if (sent) {
      return (
        <div className="flex items-center gap-1.5 text-sm text-status-success font-medium">
          <span>&#10003;</span>
          <span>Request sent</span>
        </div>
      );
    }

    if (sendError) {
      return (
        <div className="text-sm text-status-error">
          Failed to send request
        </div>
      );
    }

    // Pending states
    if (status === 'pending_sent' || status === 'pending_received') {
      return (
        <button
          disabled
          className="text-sm text-content-muted cursor-not-allowed px-2 py-1 rounded bg-surface-elevated border border-line"
        >
          Request pending
        </button>
      );
    }

    // status === 'none' — can add friend
    return (
      <button
        onClick={handleSendRequest}
        className="btn btn-primary text-sm px-3 py-1"
      >
        Add friend
      </button>
    );
  };

  // Mobile inline indicator. md:hidden so desktop visuals stay untouched.
  const renderMobileIndicator = () => {
    if (sendError) {
      return <span className="md:hidden ml-1 text-xs text-status-error">Failed</span>;
    }
    if (status === 'pending_sent' || status === 'pending_received') {
      return <span className="md:hidden ml-1 text-xs text-content-muted">⏳ Pending</span>;
    }
    // status === 'none' — primary mobile affordance is the "+" button.
    // Tap fires the same FriendshipContext.sendRequest the desktop
    // tooltip's "Add friend" button uses; optimistic state flip in the
    // context auto-rerenders this branch as ⏳ Pending.
    return (
      <button
        type="button"
        onClick={handleSendRequest}
        className="md:hidden ml-1 inline-flex items-center justify-center w-6 h-6 rounded-full bg-btn-primary/10 text-btn-primary hover:bg-btn-primary/20 active:bg-btn-primary/20 text-sm font-bold"
        aria-label={`Add ${username} as a friend`}
      >
        +
      </button>
    );
  };

  return (
    <>
      <span
        ref={refs.setReference}
        {...getReferenceProps()}
        className="cursor-pointer hover:underline"
        onClick={(e) => {
          e.stopPropagation();
          // Hybrid touch laptop fallback — preserved verbatim. At ≥768px
          // viewports on touch-capable devices the mobile "+" is hidden
          // (md:hidden) and the popover-via-tap is the only path to the
          // friend-request flow.
          if ('ontouchstart' in window) {
            setIsOpen((prev) => !prev);
          }
        }}
        onTouchStart={(e) => {
          e.stopPropagation();
        }}
      >
        {children || username}
      </span>
      {renderMobileIndicator()}
      {isOpen && (
        <FloatingPortal>
          <div
            ref={refs.setFloating}
            style={floatingStyles}
            {...getFloatingProps()}
            className="bg-surface-card rounded-card shadow-theme-lg border border-line px-3 py-2 z-[60]"
          >
            {renderTooltipContent()}
          </div>
        </FloatingPortal>
      )}
    </>
  );
}
