import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';

/**
 * Merge conditional class names (clsx) and de-dupe conflicting Tailwind
 * utilities (tailwind-merge v3). This is the shadcn `cn` util, hand-authored
 * on the manual-install path (Pitfall 3 fallback).
 *
 * The project runs `tailwindcss` v4 (4.3.3) in its CSS-first form — the theme
 * is declared by `@theme` (`globals.css:147`) and `@theme inline`
 * (`globals.css:320`), and there is NO `tailwind.config.*` anywhere under
 * `periodictabletop/`. `tailwind-merge` v3 is therefore the matching major:
 * v2's class map is Tailwind v3's.
 *
 * DECISION Phase 88.6-01 (W33): bumped to `tailwind-merge` 3.6.0 (EXACT pin,
 * no caret — the Package Legitimacy Audit and breaking-change triage are
 * version-scoped to 3.6.0, and `dist-tags.latest` has since moved to 3.7.0).
 * REJECTED: staying pinned at v2. Its recorded reason — "the project is on
 * Tailwind v3" — has been FALSE since the v4 migration, so re-pinning to v2 on
 * that reasoning is exactly what this marker exists to stop. Re-pinning is a
 * decision, not a cleanup, and it needs a reason that is true.
 *
 * Evidence the bump changed no shipped merge: `src/lib/cn.twMergeV3.test.ts` —
 * 14 expectations captured by RUNNING them against 2.6.1, then re-run green
 * against 3.6.0 (5 primitive merges across Button/Modal/BottomSheet/Combobox/
 * Input, 7 pairwise token families, 2 bracketed-variant forms). A diff there is
 * a finding, not a test to fix.
 *
 * `cn()`'s body is deliberately config-less — bare `twMerge(clsx(inputs))` —
 * which is why v3 breaking changes 3-8 (custom `isLength`, prefixes, custom
 * separators, `createTailwindMerge`, `DefaultThemeGroupIds`) do not apply.
 */
export function cn(...inputs: ClassValue[]): string {
  return twMerge(clsx(inputs));
}
