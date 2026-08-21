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
  FloatingFocusManager,
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

  /* 88-CODE-REVIEW MED#16: keyboard-opened popovers get FloatingFocusManager.
     The portal appends to document.body, so without focus management the
     popover's "Add friend" button was the LAST tab stop in the whole document —
     Enter "opened" the flow (WCAG operable, nominally) but its commit button was
     practically unreachable (WCAG 2.4.3). Hover-open keeps the no-focus-move
     behavior: yanking focus on hover is its own a11y failure. */
  const [openedByKeyboard, setOpenedByKeyboard] = useState(false);

  const { refs, floatingStyles, context } = useFloating({
    open: isOpen,
    onOpenChange: (open) => {
      setIsOpen(open);
      if (!open) setOpenedByKeyboard(false);
    },
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
    // Delta review 2026-08-06 (MED): both outcome swaps UNMOUNT the focused
    // Add-friend button — without live-region roles the outcome was silent to
    // screen readers on the keyboard path MED#16 just promoted (the mobile "+"
    // path had this treatment from D-13; the popover path did not). Insertion-
    // announced role=status/alert is the same idiom the mobile pending span
    // defends at its own marker. Focus survival is FloatingFocusManager's
    // restoreFocus (render site below).
    if (sent) {
      return (
        <div role="status" className="flex items-center gap-1.5 text-sm text-status-success font-medium">
          <span>&#10003;</span>
          <span>Request sent</span>
        </div>
      );
    }

    if (sendError) {
      return (
        <div role="alert" className="text-sm text-status-error">
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
    // AMENDED Phase 88-28 (D-37) — this marker is now the PERMANENT record,
    // and the paragraph above contains one CORRECTED claim. Both halves:
    //
    //   (i) RULING: 44x32 is ACCEPTED FOREVER. The owner was shown the
    //       trade-off — the last 12px against list density, and the fact that
    //       a mis-tap here is socially costly (it sends a stranger a friend
    //       request, not a recoverable UI action) — and chose density,
    //       informed, on 2026-08-05. This is no longer "owned by Phase 88";
    //       Phase 88 is where it was decided, and it was decided to stand.
    //       The e2e assertion in `touch-targets.spec.ts` stays at 44x32 and
    //       must NOT be "tightened" to 44x44: that would fail a shipped,
    //       recorded decision rather than catch a regression.
    //
    //  (ii) CORRECTION: "requires widening the row gap at all 9 render sites"
    //       is WRONG, and it made the fix look 9x more expensive than it is.
    //       RE-VERIFIED 2026-08-05 by reading the container above each of the
    //       nine, not by trusting the plan text. The 4px extension needs 8px
    //       of vertical room BETWEEN two adjacent instances:
    //         CONSTRAINED (1) — `RsvpSection.js:289` `space-y-1` = 4px. This
    //           is the ONLY container tighter than 8px, and it is what set the
    //           `after:-inset-y-1` ceiling: at 4px the two extensions meet
    //           exactly at the gap midpoint, which is the "terminates exactly
    //           at the gap" sentence above.
    //         EXACTLY AT THE BOUNDARY (2) — `grouplist.js:336` `flex flex-wrap
    //           gap-2` and `gameDetail/page.js:2182` `space-y-2`, both 8px.
    //           Not constrained, but they are the next things to check if the
    //           extension is ever grown.
    //         ROOMY (6) — `ManageMembers.js:440,472` (`space-y-3` + `p-4`
    //           rows) and `gameDetail/page.js:1467, 2088, 2352, 2399` (`py-2`
    //           rows). All have >=8px and would take a bigger extension today.
    //       So a future phase revisiting this has ONE lever, not nine.
    //       Line numbers are the 88-28 re-derivation: CONTEXT D-37 cites this
    //       as `RsvpSection.js:288`, which drifted by one.
    //       That lever is deliberately NOT pulled here (D-37): widening the
    //       RSVP row gap is a density change to a list the owner just chose to
    //       keep dense, and doing it as a side effect of an a11y sweep would
    //       be the silent override this project's Evidence Rule forbids.
    //       `RsvpSection.js:289`'s `space-y-1` is unchanged, on purpose.
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
        className="md:hidden ml-2.5 relative inline-flex items-center justify-center w-6 h-6 rounded-full bg-surface-card-hover text-btn-primary text-sm font-bold cursor-pointer after:absolute after:-inset-x-2.5 after:-inset-y-1 after:content-[''] active:opacity-75 focus:outline-hidden focus-visible:ring-2 focus-visible:ring-focus-ring focus-visible:ring-offset-2"
        aria-label={`Add ${username} as a friend`}
      >
        +
      </button>
    );
  };

  return (
    <>
      {/* DECISION Phase 88-28 (Req 4): the username is now keyboard-OPERABLE, not merely
          reachable. 87.8-08's census recorded it as "NO (span, no tabIndex)" — the popover
          it toggles is opened by HOVER (useHover, `mouseOnly: true`) and by tap, so before
          this a keyboard-only user had NO path to the friend-request flow at all on any
          surface where the `md:hidden` "+" is hidden. Focusable-but-inert would not have
          closed that (AR R1-M21): Enter AND Space must both activate, and both are pinned.

          Three specifics, each a choice:
          - `role="button"` + `tabIndex` chosen OVER a real `<button>`: this span is rendered
            inside a `<p>` at `ManageMembers.js:446` and inside table-ish rows elsewhere
            (9 render sites), and it must stay inline phrasing content that wraps with the
            surrounding text.
          - `stopPropagation` on the key handler is LOAD-BEARING, not defensive: at
            `grouplist.js` the name renders inside a `role="button"` group card that has its
            own Enter/Space handler. Without it, Enter on a member's name would ALSO navigate
            to the group — the keyboard twin of the tap-stealing bug 87.8 D-13 fixed for the
            adjacent "+".
          - Space is `preventDefault`ed because its default on a non-button is page scroll.

          The props go THROUGH `getReferenceProps({...})` rather than being written after a
          `{...getReferenceProps()}` spread. MEASURED — and the measurement CORRECTED a first
          draft of this comment, so both halves are recorded:
            - `getReferenceProps()` returns `['onPointerDown','onPointerEnter','onMouseMove',
              'onKeyDown']`. It HAS an `onKeyDown` of its own, so a sibling `onKeyDown={...}`
              after a spread REPLACES a library handler rather than adding to one.
            - That handler is `useDismiss`'s `closeOnEscapeKeyDown` — but Esc-to-dismiss does
              NOT visibly break when it is clobbered. Verified by planting the spread form and
              re-running the suite, which stayed green: `useDismiss` ALSO registers the same
              callback on the DOCUMENT in an effect (@floating-ui/react useDismiss, `if
              (escapeKey) doc.addEventListener('keydown', …)`). The clobber is MASKED by a
              redundancy, not harmless by design.
          The merge API is used anyway, because that redundancy is the library's private
          implementation detail rather than a contract, and because the next interaction hook
          added here would not be so lucky: `useClick`'s and `useListNavigation`'s reference
          `onKeyDown` (Enter/Space activation; arrow-key navigation) have NO document-level
          twin, and a spread would drop them silently. Going back to the spread form is a
          decision, not a cleanup — and it is pinned in `keyboardOperability.test.tsx` as a
          SOURCE property, deliberately not a behavioural one, precisely because the behaviour
          is currently masked and a behavioural pin would be vacuous.
          `aria-haspopup` is deliberately NOT set: the floating element is a plain div with no
          dialog/menu role, so any value would announce a control that is not there.

          The `'ontouchstart'` branch on onClick is preserved verbatim below — it is the
          hybrid-touch-laptop path, and keyboard activation is deliberately NOT gated on it. */}
      <span
        ref={refs.setReference}
        {...getReferenceProps({
          role: 'button',
          tabIndex: 0,
          'aria-expanded': isOpen,
          className:
            'cursor-pointer hover:underline rounded-xs focus:outline-hidden focus-visible:ring-2 focus-visible:ring-focus-ring focus-visible:ring-offset-2',
          onClick: (e) => {
            e.stopPropagation();
            // Hybrid touch laptop fallback — preserved verbatim. At ≥768px
            // viewports on touch-capable devices the mobile "+" is hidden
            // (md:hidden) and the popover-via-tap is the only path to the
            // friend-request flow.
            if ('ontouchstart' in window) {
              setOpenedByKeyboard(false);
              setIsOpen((prev) => !prev);
            }
          },
          onKeyDown: (e) => {
            if (e.key === 'Enter' || e.key === ' ') {
              e.preventDefault();
              e.stopPropagation();
              // MED#16: record the input modality BEFORE the toggle — only a
              // keyboard OPEN engages the focus manager below.
              setOpenedByKeyboard(!isOpen);
              setIsOpen((prev) => !prev);
            }
          },
          onTouchStart: (e) => {
            e.stopPropagation();
          },
        })}
      >
        {children || username}
      </span>
      {renderMobileIndicator()}
      {isOpen && (
        <FloatingPortal>
          {/* MED#16: focus manager on KEYBOARD open only — initial focus lands on
              the popover's first tabbable (the Add friend button), Esc/close
              returns it to the name span (returnFocus default). modal={false}
              keeps useDismiss's outside-press/Escape behavior intact. */}
          {openedByKeyboard ? (
            /* restoreFocus (delta review 2026-08-06): when the focused Add-friend
               button unmounts on the sent/error swap, keep focus inside the
               popover instead of dropping to <body>. */
            <FloatingFocusManager context={context} modal={false} restoreFocus>
              <div
                ref={refs.setFloating}
                style={floatingStyles}
                {...getFloatingProps()}
                className="bg-surface-card rounded-card shadow-theme-lg border border-line px-3 py-2 z-60"
              >
                {renderTooltipContent()}
              </div>
            </FloatingFocusManager>
          ) : (
            <div
              ref={refs.setFloating}
              style={floatingStyles}
              {...getFloatingProps()}
              className="bg-surface-card rounded-card shadow-theme-lg border border-line px-3 py-2 z-60"
            >
              {renderTooltipContent()}
            </div>
          )}
        </FloatingPortal>
      )}
    </>
  );
}
