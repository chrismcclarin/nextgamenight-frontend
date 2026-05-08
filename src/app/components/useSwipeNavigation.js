'use client';

import { useRef, useState, useCallback } from 'react';

/**
 * useSwipeNavigation — touch-only swipe gesture hook for week navigation.
 *
 * Phase 72 HUX-04: visible chevrons remain the primary control on every
 * surface; swipe is a power-user shortcut on top, gated to (hover: none)
 * devices by the caller (this hook does NOT detect the media query itself
 * so callers can decide their own enable rule).
 *
 * Public API:
 *   const { onTouchStart, onTouchMove, onTouchEnd, onTouchCancel, isSwiping } =
 *     useSwipeNavigation({
 *       onSwipeLeft,            // fired when user drags content LEFT (next week)
 *       onSwipeRight,           // fired when user drags content RIGHT (prev week)
 *       threshold = 50,         // min absolute px delta to count as a swipe
 *       velocityThreshold = 0.3,// min |dx|/dt in px/ms
 *       enabled = true,         // when false all handlers no-op
 *     });
 *
 * Direction convention (matches natural device behavior — sliding the heatmap
 * LEFT means "view what's to the RIGHT", which is the NEXT week):
 *   - dx < 0 (right-to-left finger swipe; content drags LEFT)  → onSwipeLeft  → next week
 *   - dx > 0 (left-to-right finger swipe; content drags RIGHT) → onSwipeRight → prev week
 *
 * preventDefault: this hook does NOT call preventDefault() in any handler.
 * The caller decides whether vertical scroll should remain — some surfaces
 * (e.g. createEvent's manual-entry pane inside a modal) want vertical scroll
 * to keep working. If a caller needs to block scroll during a swipe, they
 * can read `isSwiping` and apply CSS `touch-action: pan-y` (or similar) on
 * the wrapper.
 *
 * Animation: hard-cut. The next render shows the new week with no slide
 * animation (CONTEXT D — Plan 72-03 decision documented).
 */
export default function useSwipeNavigation({
  onSwipeLeft,
  onSwipeRight,
  threshold = 50,
  velocityThreshold = 0.3,
  enabled = true,
} = {}) {
  // startRef holds { x, y, time } captured at touchstart; null between gestures
  // and when a multi-touch (pinch) is detected (we abort then).
  const startRef = useRef(null);
  const [isSwiping, setIsSwiping] = useState(false);

  const onTouchStart = useCallback(
    (event) => {
      if (!enabled) return;
      // Multi-touch (pinch zoom etc.) — abort any swipe tracking.
      if (event.touches.length > 1) {
        startRef.current = null;
        setIsSwiping(false);
        return;
      }
      const touch = event.touches[0];
      startRef.current = { x: touch.clientX, y: touch.clientY, time: Date.now() };
      setIsSwiping(false);
    },
    [enabled]
  );

  const onTouchMove = useCallback(
    (event) => {
      if (!enabled) return;
      if (!startRef.current) return;
      // If a second finger lands mid-gesture, abort.
      if (event.touches.length > 1) {
        startRef.current = null;
        setIsSwiping(false);
        return;
      }
      const touch = event.touches[0];
      const dx = touch.clientX - startRef.current.x;
      const dy = touch.clientY - startRef.current.y;
      // Treat as a horizontal swipe-in-progress only if the gesture is clearly
      // horizontal — keeps vertical scroll smooth and prevents the heatmap
      // from registering scroll attempts as week swipes.
      if (Math.abs(dx) > 10 && Math.abs(dx) > Math.abs(dy) * 1.5) {
        setIsSwiping(true);
      }
    },
    [enabled]
  );

  const onTouchEnd = useCallback(
    (event) => {
      if (!enabled) return;
      if (!startRef.current) return;
      // changedTouches holds the lifted finger; touches[] is empty at touchend.
      const touch = event.changedTouches[0];
      const dx = touch.clientX - startRef.current.x;
      const dy = touch.clientY - startRef.current.y;
      const dt = Math.max(1, Date.now() - startRef.current.time); // avoid div-by-zero
      const horizontalEnough = Math.abs(dx) > Math.abs(dy) * 1.5;
      const passesDistance = Math.abs(dx) >= threshold;
      const passesVelocity = Math.abs(dx) / dt >= velocityThreshold;

      if (horizontalEnough && passesDistance && passesVelocity) {
        if (dx < 0) {
          onSwipeLeft?.();
        } else {
          onSwipeRight?.();
        }
      }
      startRef.current = null;
      setIsSwiping(false);
    },
    [enabled, threshold, velocityThreshold, onSwipeLeft, onSwipeRight]
  );

  const onTouchCancel = useCallback(() => {
    if (!enabled) return;
    startRef.current = null;
    setIsSwiping(false);
  }, [enabled]);

  return { onTouchStart, onTouchMove, onTouchEnd, onTouchCancel, isSwiping };
}
