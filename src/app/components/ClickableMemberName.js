'use client';

import { useState, useEffect, useContext, useRef } from 'react';
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
 * - self     → name with desktop hover-tooltip showing blue "You" pill
 *              (no mobile inline indicator — self is informational, not actionable)
 * - unknown  → plain span (API failed; graceful degradation, no indicator)
 * - accepted → name with desktop hover-tooltip showing green "Friend" pill
 *              + mobile-only "✓ Friend" inline indicator (preserved for touch parity)
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
 * @param {Object} props
 * @param {string} props.userId - The member's nested `Users.id` UUID (Phase 87.3
 *   PR-B). This is NOT the Auth0 sub — it feeds BOTH getStatus (self/friend/pending
 *   classification) AND sendRequest → POST /friendships/request, and both the
 *   provider and the backend now key on the Users.id UUID. No sub-or-UUID
 *   tolerance branch (D-06).
 * @param {string} props.username - Display name
 * @param {React.ReactNode} [props.children] - Optional custom render (defaults to username span)
 */
export default function ClickableMemberName({ userId, username, children }) {
  const { getStatus, sendRequest } = useContext(FriendshipContext);
  const [isOpen, setIsOpen] = useState(false);
  const [sent, setSent] = useState(false);
  const [sendError, setSendError] = useState(false);
  const pendingIndicatorRef = useRef(null);

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

  // Focus management for the add-friend success swap (Phase 87.8 D-13 /
  // threat T-87.8-32): the mobile "+" button is the focused element at the
  // moment of a successful tap, and it unmounts when status flips to
  // pending_sent — the browser's default is to drop focus to <body> silently,
  // stranding screen-reader users. Move focus to the ⏳ Pending span that
  // replaces the button (see renderMobileIndicator). On desktop the span is
  // md:hidden (display: none) so focus() is a no-op there — the desktop
  // popover flow has its own "Request sent" feedback and is unchanged.
  useEffect(() => {
    if (sent && status === 'pending_sent' && pendingIndicatorRef.current) {
      pendingIndicatorRef.current.focus();
    }
  }, [sent, status]);

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

  // Graceful degrade for unknown (API failed) — no popover, no inline indicator.
  if (status === 'unknown') {
    return children || <span>{username}</span>;
  }

  // All other states render the name with a desktop hover-tooltip popover.
  // Mobile inline indicators vary per status (handled in renderMobileIndicator).

  const renderTooltipContent = () => {
    // Self → blue "You" pill. Informational only, no action.
    if (status === 'self') {
      return (
        <span className="text-[10px] uppercase tracking-wide bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-200 px-1.5 py-0.5 rounded-sm font-semibold">
          You
        </span>
      );
    }

    // Accepted → green "Friend" pill. Informational only, no action.
    if (status === 'accepted') {
      return (
        <span className="text-[10px] uppercase tracking-wide bg-emerald-100 dark:bg-emerald-900/30 text-emerald-800 dark:text-emerald-200 px-1.5 py-0.5 rounded-sm font-semibold">
          Friend
        </span>
      );
    }

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
          className="text-sm text-content-muted cursor-not-allowed px-2 py-1 rounded-sm bg-surface-elevated border border-line"
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
    // Self has no mobile inline indicator — informational only, surfaced
    // via desktop hover popover.
    if (status === 'self') return null;
    // Accepted preserves the existing md:hidden ✓ Friend mobile indicator
    // (desktop now also shows a "Friend" pill via the hover popover).
    if (status === 'accepted') {
      return <span className="md:hidden ml-1 text-xs text-status-success">✓ Friend</span>;
    }
    if (sendError) {
      return <span className="md:hidden ml-1 text-xs text-status-error">Failed</span>;
    }
    if (status === 'pending_sent' || status === 'pending_received') {
      // role="status" makes this span an implicit polite live region, so its
      // appearance is ANNOUNCED when it replaces the "+" button after a
      // successful add (the swap is otherwise silent to screen readers).
      // tabIndex={-1} makes it programmatically focusable — the focus effect
      // above moves focus here after the swap, chosen over returning focus to
      // the row or a stable ancestor because this span renders in the exact
      // position the destroyed button occupied, so focus stays where the
      // user's attention already is. Do not "fix" this back to a bare span:
      // a silent unmount drops focus to <body> (Phase 87.8 D-13 rationale).
      return (
        <span
          ref={pendingIndicatorRef}
          tabIndex={-1}
          role="status"
          className="md:hidden ml-1 text-xs text-content-muted"
        >
          ⏳ Pending
        </span>
      );
    }
    // status === 'none' — primary mobile affordance is the "+" button.
    // Tap fires the same FriendshipContext.sendRequest the desktop
    // tooltip's "Add friend" button uses; optimistic state flip in the
    // context auto-rerenders this branch as ⏳ Pending.
    //
    // DECISION Phase 87.8 R4: the invisible hit extension is asymmetric ON
    // PURPOSE — 44x32 (after:-inset-x-2.5 by after:-inset-y-1), chosen OVER a
    // symmetric 44x44 (a symmetric 10px inset on all sides). The member rows
    // these render in stack via space-y-1 — a 4px gap (RsvpSection.js:288) —
    // so a symmetric 10px vertical reach would cross 6px into the row above
    // AND the row below and steal their taps (an unintended friend request).
    // 4px is the largest vertical extension that terminates exactly at the
    // gap. 44x32 is an OWNER-ACCEPTED deviation from the 44x44 floor
    // (2026-08-02): it clears WCAG 2.2 AA (2.5.8) but misses the project
    // tenet; the full floor requires widening the row gap at all 9 render
    // sites — a density/consistency call owned by Phase 88 (recorded in
    // .planning/deferred/phase-88.md). Changing this back to a symmetric
    // inset is a decision, not a cleanup.
    //
    // DECISION Phase 87.8 (D-13): invisible pseudo-element hit extension
    // chosen OVER visible min-height growth (the per-CTA token technique at
    // the 13 shipped 44px CTA sites — wrong for an inline control inside a
    // text line, which must stay 24x24 to the eye) and OVER a padded wrapper
    // div (which
    // changes layout flow and the accessible tree; the empty after:content
    // pseudo-element changes neither). Arithmetic: 24 + 10 + 10 = 44 wide,
    // 24 + 4 + 4 = 32 tall; the inset resolves against the button's own
    // border box, so margin does not affect the math. ml-1 was widened to
    // ml-2.5 specifically so the 10px leftward extension terminates at the
    // adjacent username's edge instead of reaching 6px inside its click
    // target across the old 4px gap — a tap meant for the name must never
    // send a friend request. cursor-pointer is REQUIRED for :active to fire
    // on iOS; .btn carries it (globals.css) but this bare button does not use
    // .btn.
    //
    // DECISION Phase 88-27 (D-32/D-33): the visible TINT — Phase 88's half of
    // the M-15 split, which the line above used to say was deliberately absent
    // — is now `bg-surface-card-hover`, one of the three UI-SPEC §10.3
    // exemplars. Chosen OVER `bg-surface-accent-subtle` (an amber circle under
    // a `text-btn-primary` purple "+" — the two clash) and OVER minting a
    // `btn-primary-subtle` token, which D-33 forbids. `bg-surface-elevated` was
    // MEASURED and rejected: it is `#ffffff` in light mode, byte-identical to
    // the card this control sits on, so the circle would have been invisible on
    // exactly its own surface. The stripped `hover:`/`active:` halves are NOT
    // re-added: the button is `md:hidden`, so hover can never fire on its
    // audience, and 87.8-08's `active:opacity-75` at the end of this string is
    // already the press feedback. Removing the tint re-opens M-15.
    //
    // After a successful add, focus moves to the ⏳ Pending span that
    // replaces this button (see the focus effect near the top of the
    // component and the comment on the pending branch above).
    return (
      <button
        type="button"
        onClick={handleSendRequest}
        className="md:hidden ml-2.5 relative inline-flex items-center justify-center w-6 h-6 rounded-full bg-surface-card-hover text-btn-primary text-sm font-bold cursor-pointer after:absolute after:-inset-x-2.5 after:-inset-y-1 after:content-[''] active:opacity-75"
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
            className="bg-surface-card rounded-card shadow-theme-lg border border-line px-3 py-2 z-60"
          >
            {renderTooltipContent()}
          </div>
        </FloatingPortal>
      )}
    </>
  );
}
