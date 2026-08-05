/**
 * Route loading boundary for `/groupHomePage` (Req 3 / D-19, plan 88-09).
 *
 * Thin server component rendering the ONE shared route fallback. No skeleton
 * content — Phase 89 owns per-route skeletons (D-21).
 */
import { RouteFallback } from '@/components/ui/RouteFallback';

export default function Loading() {
  return <RouteFallback label="Getting your group..." />;
}
