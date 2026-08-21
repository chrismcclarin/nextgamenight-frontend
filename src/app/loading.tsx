/**
 * Root route loading boundary (Req 3 / D-19, plan 88-09).
 *
 * Thin server component. The ONE route-level loading look lives in
 * `RouteFallback` — every boundary in this phase renders it rather than
 * hand-rolling its own spinner. No skeleton content here: `loading.tsx`
 * unmounts as soon as the server segment resolves, which is before client
 * data lands, so Phase 89 owns skeletons (D-21).
 */
import { RouteFallback } from '@/components/ui/RouteFallback';

export default function Loading() {
  return <RouteFallback label="Getting your groups..." />;
}
