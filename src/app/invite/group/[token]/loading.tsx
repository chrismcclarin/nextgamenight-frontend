/**
 * Route loading boundary for the group invite landing (Req 3 / D-19, plan 88-09).
 *
 * Phone-forward surface — reached from a shared link or a scanned QR code.
 * Thin server component rendering the ONE shared route fallback; no skeleton
 * content (Phase 89 owns per-route skeletons, D-21).
 */
import { RouteFallback } from '@/components/ui/RouteFallback';

export default function Loading() {
  return <RouteFallback label="Loading your group invite..." />;
}
