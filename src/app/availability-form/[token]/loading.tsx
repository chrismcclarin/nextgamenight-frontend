/**
 * Route loading boundary for the magic-link availability form (Req 3 / D-19,
 * plan 88-09).
 *
 * Phone-forward surface by definition — this route is reached from an SMS or
 * email link, so a blank frame here is a blank frame on someone's phone.
 * Thin server component rendering the ONE shared route fallback; no skeleton
 * content (Phase 89 owns per-route skeletons, D-21).
 */
import { RouteFallback } from '@/components/ui/RouteFallback';

export default function Loading() {
  return <RouteFallback label="Opening your availability form..." />;
}
