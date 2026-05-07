'use client';

// New wrapper API (Phase 72 Plan 01). Consumers migrated in Phase 72 Plan 02.
//
// HeatmapTooltip is a self-contained, prop-driven tooltip primitive used by all
// three heatmap surfaces (EventHeatmapBackground, HeatmapCell, MergedHeatmapCell).
// It owns trigger/dismiss/positioning/animation behavior; the consumer passes the
// trigger element as `children` and the tooltip body as `content`.
//
// Behavior contract (from Phase 72 CONTEXT D):
//   - Desktop hover: 250ms open delay, instant dismiss on mouse leave.
//   - Mobile/touch: tap trigger toggles; tap outside or tap same trigger dismisses.
//   - Keyboard: Tab focuses trigger, focus reveals tooltip, Esc dismisses.
//   - Concurrency: only one tooltip open at a time across the entire app.
//   - Renders into a FloatingPortal so positioning is not constrained by
//     overflow/transform ancestors.
//   - `tone='mobile'` opt-in styling variant (larger type, more padding,
//     stronger contrast); default styling stays compact for desktop.
//
// Public API:
//   <HeatmapTooltip
//     content={<JSX />}              // tooltip body
//     tone="default" | "mobile"      // styling variant
//     disabled={false}               // skip wrapping (children pass-through)
//     placement="top"                // floating-ui placement
//     ariaLabel="Cell details"       // optional aria-label on the trigger
//     triggerRef={refOrCallback}     // exposes the cloned trigger DOM element
//   >
//     <CellElement />                // single trigger child
//   </HeatmapTooltip>
//
// triggerRef escape hatch: parent grids in Plan 02 (HeatmapGrid +
// MergedHeatmapGrid) implement roving-tabindex arrow-key navigation and need to
// call `cellRefs.current[idx].focus()` without fighting floating-ui's internal
// `refs.setReference` ref. The primitive merges floating-ui's ref with the
// caller's `triggerRef` so both stay in sync. Honored on the disabled
// pass-through path too — grid keyboard nav must work over empty cells as well.
//
// Smoke-test for triggerRef wiring (__test__ — no test runner in this app yet):
//   const ref = React.createRef();
//   render(<HeatmapTooltip content={<div/>} triggerRef={ref}><span/></HeatmapTooltip>);
//   // expect: triggerRef.current.tagName === 'SPAN'  (cloned span receives merged ref)

import {
  useFloating,
  useHover,
  useClick,
  useFocus,
  useDismiss,
  useInteractions,
  useRole,
  useTransitionStyles,
  safePolygon,
  offset,
  flip,
  shift,
  arrow,
  autoUpdate,
  FloatingPortal,
} from '@floating-ui/react';
import {
  useState,
  useEffect,
  useRef,
  useId,
  Children,
  cloneElement,
} from 'react';

// ---------------------------------------------------------------------------
// Module-level singleton manager
// ---------------------------------------------------------------------------
// Guarantees only one tooltip is open across all heatmap surfaces app-wide.
// Each instance registers its setIsOpen on mount and unregisters on unmount.
// When an instance opens, it asks the manager to close any other instance
// holding the open slot. Lives at module scope so every <HeatmapTooltip />
// shares the same registry without prop-drilling or context.
let currentOpenId = null;
const subscribers = new Map(); // id -> setIsOpen

function registerTooltip(id, setIsOpen) {
  subscribers.set(id, setIsOpen);
}

function unregisterTooltip(id) {
  subscribers.delete(id);
  if (currentOpenId === id) currentOpenId = null;
}

function requestOpen(id) {
  if (currentOpenId && currentOpenId !== id) {
    const prev = subscribers.get(currentOpenId);
    if (prev) prev(false);
  }
  currentOpenId = id;
}

function requestClose(id) {
  if (currentOpenId === id) currentOpenId = null;
}

// ---------------------------------------------------------------------------
// Ref-merging helper
// ---------------------------------------------------------------------------
/**
 * Merge multiple refs (callback or ref-object) into a single callback ref.
 * Used to merge floating-ui's setReference with the caller's optional
 * triggerRef AND any ref already present on the cloned child element.
 * Exported so consumers/tests can use it directly if they need to compose
 * additional refs (e.g. Plan 02 grids that also want a per-cell measurement
 * ref alongside the focus ref).
 */
export function mergeRefs(...refs) {
  return (node) => {
    refs.forEach((ref) => {
      if (!ref) return;
      if (typeof ref === 'function') {
        ref(node);
      } else {
        // React ref-object — direct assignment is the documented contract.
        ref.current = node;
      }
    });
  };
}

// ---------------------------------------------------------------------------
// Props-merging helper
// ---------------------------------------------------------------------------
// Chains overlapping handlers from the original child with floating-ui's
// interaction props so existing onClick / onKeyDown / etc. on the child
// (e.g. slot-select on MergedHeatmapCell) keep firing alongside the new
// hover/tap/focus behavior. Child handler runs first; if it calls
// `event.preventDefault()` we still let floating-ui's handler run unless
// `event.defaultPrevented` is set explicitly via `event.preventDefault()` AND
// the consumer wants to suppress (pattern matches @floating-ui/react docs).
function mergeProps(childProps, floatingProps) {
  const merged = { ...childProps, ...floatingProps };
  // Find every event-handler key (`on*`) present in BOTH.
  Object.keys(childProps).forEach((key) => {
    if (
      key.startsWith('on') &&
      typeof childProps[key] === 'function' &&
      typeof floatingProps[key] === 'function'
    ) {
      const childHandler = childProps[key];
      const floatingHandler = floatingProps[key];
      merged[key] = (event, ...rest) => {
        childHandler(event, ...rest);
        if (!event?.defaultPrevented) {
          floatingHandler(event, ...rest);
        }
      };
    }
  });
  // className / style merging stays as floatingProps wins for tooltip wiring;
  // the floating-ui interactions don't set className/style on the reference.
  return merged;
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------
function HeatmapTooltip({
  children,
  content,
  tone = 'default',
  disabled = false,
  placement = 'top',
  ariaLabel,
  triggerRef,
}) {
  const id = useId();
  const tooltipDomId = `htm-tt-${id.replace(/[^a-zA-Z0-9_-]/g, '')}`;
  const [isOpen, setIsOpen] = useState(false);
  const arrowRef = useRef(null);

  // Register/unregister with the singleton manager. Lives at the top of the
  // component (before any early returns) so disabled-path instances also
  // participate in cleanup if the disabled flag flips at runtime.
  useEffect(() => {
    registerTooltip(id, setIsOpen);
    return () => unregisterTooltip(id);
  }, [id]);

  // Whenever this instance opens, claim the singleton slot (closes any other
  // open tooltip). Whenever it closes, release the slot.
  useEffect(() => {
    if (isOpen) {
      requestOpen(id);
    } else {
      requestClose(id);
    }
  }, [id, isOpen]);

  const { refs, floatingStyles, context, middlewareData } = useFloating({
    open: isOpen,
    onOpenChange: setIsOpen,
    placement,
    whileElementsMounted: autoUpdate,
    middleware: [
      offset(8),
      flip(),
      shift({ padding: 8 }),
      arrow({ element: arrowRef }),
    ],
  });

  // Triggers — each gated to its modality.
  // - useHover: desktop only (mouseOnly), 250ms open / 0ms close per CONTEXT D.
  // - useClick: handles tap-to-open + tap-same-trigger-to-close on touch
  //   devices and acts as fallback on hybrid laptops.
  // - useFocus: keyboard Tab focus reveals the tooltip (a11y).
  // - useDismiss: Esc + outside-press dismiss.
  // - useRole: assigns role='tooltip' and aria-describedby plumbing.
  const hover = useHover(context, {
    delay: { open: 250, close: 0 },
    handleClose: safePolygon({ blockPointerEvents: false }),
    mouseOnly: true,
  });
  const click = useClick(context, {
    event: 'click',
    toggle: true,
  });
  const focus = useFocus(context);
  const dismiss = useDismiss(context, {
    escapeKey: true,
    outsidePress: true,
    // useClick already toggles on reference press; turning this off here
    // prevents a double-fire that would re-open the tooltip immediately.
    referencePress: false,
  });
  const role = useRole(context, { role: 'tooltip' });

  const { getReferenceProps, getFloatingProps } = useInteractions([
    hover,
    click,
    focus,
    dismiss,
    role,
  ]);

  // Animation — fade + tiny slide. Conservative defaults under CONTEXT
  // "Claude's discretion on animation curve and duration".
  const { isMounted, styles: transitionStyles } = useTransitionStyles(context, {
    duration: { open: 120, close: 80 },
    initial: { opacity: 0, transform: 'translateY(2px)' },
  });

  // ---- Disabled / no-content pass-through ----------------------------------
  // Even on the pass-through path we honor `triggerRef` so grid keyboard nav
  // works over empty cells too. We clone the child once with a single
  // ref-merging callback (parent triggerRef + child's existing ref) and
  // attach no listeners.
  if (disabled || !content) {
    if (!triggerRef) {
      return <>{children}</>;
    }
    const child = Children.only(children);
    return cloneElement(child, {
      ref: mergeRefs(triggerRef, child.ref),
    });
  }

  // ---- Active wrapper path -------------------------------------------------
  const child = Children.only(children);
  const mergedRef = mergeRefs(refs.setReference, triggerRef, child.ref);
  const referenceProps = getReferenceProps({
    ref: mergedRef,
    // Make non-button triggers focusable (Tab path) without overriding any
    // explicit tabIndex the consumer set on the child.
    tabIndex: child.props.tabIndex ?? 0,
    'aria-describedby': isOpen ? tooltipDomId : undefined,
    'aria-label': ariaLabel ?? child.props['aria-label'],
  });

  // Tone-specific styling. Default = desktop tooltip; mobile = larger type,
  // more padding, stronger contrast (ring), wider max-width for the mobile
  // expand surface in Plan 02 (MergedHeatmapCell).
  // Plan 72-02 UAT hotfix: bumped default tone padding/type from
  // `px-3 py-2 text-sm` to `px-4 py-2.5 text-base` for desktop readability —
  // the prior default felt cramped next to the (intentionally large) mobile
  // tone. Mobile tone unchanged.
  const toneClassName =
    tone === 'mobile'
      ? 'bg-surface-elevated text-content-primary rounded-card px-4 py-3 text-base font-medium shadow-theme-lg max-w-[calc(100vw-2rem)] z-50 ring-1 ring-line'
      : 'bg-surface-elevated text-content-primary rounded-card px-4 py-2.5 text-base shadow-theme-lg max-w-xs z-50';

  // Arrow positioning per floating-ui's arrow-middleware contract.
  // The arrow div is absolutely positioned by middlewareData.arrow.x/y on the
  // axis perpendicular to the placement, and pinned to -4px on the static
  // side (the side opposite to where the popover sits relative to the
  // reference). Border on all sides so the half facing the popover is
  // tucked behind it; the visible half displays the matching ring-line edge
  // for a clean seam against the tone='mobile' ring.
  // Arrow border matches tone='mobile' ring-line so the seam reads cleanly.
  // Plan 02 Task 4 UAT step 11 confirms this visually.
  const staticSide = {
    top: 'bottom',
    right: 'left',
    bottom: 'top',
    left: 'right',
  }[placement.split('-')[0]];

  return (
    <>
      {cloneElement(child, mergeProps(child.props, referenceProps))}
      {isMounted && (
        <FloatingPortal>
          <div
            {...getFloatingProps({
              ref: refs.setFloating,
              id: tooltipDomId,
            })}
            style={{ ...floatingStyles, ...transitionStyles }}
            className={toneClassName}
          >
            {content}
            <div
              ref={arrowRef}
              className="absolute w-2 h-2 bg-surface-elevated border border-line rotate-45"
              style={{
                left: middlewareData.arrow?.x != null ? `${middlewareData.arrow.x}px` : '',
                top: middlewareData.arrow?.y != null ? `${middlewareData.arrow.y}px` : '',
                [staticSide]: '-4px',
              }}
            />
          </div>
        </FloatingPortal>
      )}
    </>
  );
}

export default HeatmapTooltip;
export { HeatmapTooltip };
