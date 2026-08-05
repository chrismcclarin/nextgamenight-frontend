/**
 * Route loading boundary for the magic-link RSVP flow (Req 3 / D-19, plan 88-09).
 *
 * Phone-forward surface by definition — reached from an SMS or email link.
 * Thin server component rendering the ONE shared route fallback; no skeleton
 * content (Phase 89 owns per-route skeletons, D-21).
 */
import { RouteFallback } from '@/components/ui/RouteFallback';

export default function Loading() {
  return <RouteFallback label="Loading the invite..." />;
}
