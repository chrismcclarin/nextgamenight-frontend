'use client';

/**
 * Heading — the one heading primitive (D-05; SPEC R3, AC-3; UI-SPEC §4.1 / §4.6).
 *
 * `level` is the document-outline position (1-6) and `size` is the visual rung by
 * ROLE (`display` 30 / `heading` 20 / `body` 16 / `label` 14, every one of them at
 * 700). They are SEPARATE, independent props — see the DECISION marker below. On
 * the repo's `cva` + `cn()` + `forwardRef` + `displayName` idiom, copied from
 * {@link Button}.
 *
 * Omitting `size` derives it from `level` (1 → display, 2/3 → heading, 4+ → body),
 * but every migrated call site passes `size` explicitly per UI-SPEC §4.4, so the
 * call site records the choice rather than inheriting one.
 *
 * What it deliberately does NOT do:
 * - **No `eyebrow` variant.** That would mint a fifth type role. Uppercase,
 *   tracking and colour ride on `className`.
 * - **No `caption` size.** After UI-SPEC §4.4 no heading renders at 12px.
 * - **No barrel export.** There is no `src/components/ui/index.ts` and this phase
 *   does not add one; import from `@/components/ui/Heading`.
 * - **No ref-as-prop.** Phase 90's React 19 codemod converts every primitive
 *   together; pre-adopting here would split that codemod's blast radius.
 * - **No ellipsis and no clipping.** The base carries `wrap-anywhere` and none of
 *   `truncate` / `line-clamp-*` / `text-ellipsis` / `whitespace-nowrap`. A caller
 *   that wants `truncate` is making a per-site decision and leaves a `DECISION`
 *   marker at that site (owners: plans 15 and 17 for `GroupGamesList.js:39` and
 *   `userProfile/page.js:1481`; `groupPlanning/page.js:268` has no owning plan
 *   today — a heading-census gap this plan does not close).
 * - **It is NOT a safe `aria-labelledby` / `aria-describedby` idref target**
 *   unless the caller guarantees non-empty content. Because empty children render
 *   NO element (AC-3), a `Heading` carrying an `id` takes that `id` with it when
 *   the content is empty, and the reference goes dangling at runtime with no
 *   error and no failing build. The concrete case is `Modal.tsx:197-198`, where
 *   the title is *"rendered as the DialogTitle (drives `aria-labelledby`)"* while
 *   `Modal.tsx:159` sets `aria-describedby={undefined}` — making that title the
 *   dialog's ONLY accessible name. Pinned behaviourally in `Heading.test.tsx`,
 *   not only stated here.
 */
import * as React from 'react';
import { cva, type VariantProps } from 'class-variance-authority';

import { cn } from '@/lib/cn';

/* DECISION Phase 88.6-03 (D-05): `level` and `size` are two independent props, chosen OVER a
   single coupled prop that derives the type role from the outline position — which is the
   obvious shape and the one a future reader is most likely to "simplify" this into. Level and
   size are different facts: the level answers "where does this sit in the document outline",
   the size answers "how loud is it". Coupling them would let a caller silently demote a page
   title's type by asking for the right outline, and would make the shipped
   `ErrorFallback.tsx:78-92` case — an `<h1>` rendered at 20px — inexpressible. The precedent is
   `EmptyState.tsx:82-89`, which already made this exact call for one surface; this primitive is
   the third writing of it and therefore the place it stops being duplicated. Splitting size back
   out of this prop, or folding it back in, is a decision, not a cleanup.

   `level` reaches 6 — not 1-4 — because `CalendarListView.js:834-845`'s
   `DECISION Phase 88.5 (DR2-7b)` marker deliberately renders h5/h6 through the
   `headingLevel` / `rowHeadingLevel` seam (`:631-632`, `:656-657`, `:849-850`, `:889`) so that
   no two structurally-nested headings share a level. A 1-4 primitive would bulldoze that. */
const headingVariants = cva('font-bold wrap-anywhere', {
  variants: {
    size: {
      display: 'text-3xl leading-tight', // 30
      heading: 'text-xl leading-tight', // 20
      body: 'text-base', // 16
      label: 'text-sm', // 14
    },
  },
  // A fallback only. The component computes a level-derived default BEFORE calling
  // headingVariants, so <Heading level={4}> resolves to `body`, not `heading`.
  defaultVariants: { size: 'heading' },
});

/* The base is `font-bold wrap-anywhere`, and the wrap utility is deliberately on the BASE rather
   than on any single size variant, so a future rung inherits it. `wrap-anywhere` is Tailwind
   4.3.3's `overflow-wrap: anywhere`, chosen OVER `break-words` (`overflow-wrap: break-word`):
   break-word does NOT count in min-content, so inside a flex parent without `min-w-0` it cannot
   stop a long unbroken token widening the column and inducing horizontal scroll at 375px.
   THIS BASE SUPERSEDES the `cva('font-bold', …)` skeleton still shown in `88.6-RESEARCH.md`
   § Code Examples and in `88.6-PATTERNS.md`; do not restore the wrap-less base on the grounds
   that a doc shows it. The class-list half is pinned in `Heading.test.tsx`; the real 375px
   geometry half is plan 12's planted phone arm (E5), because jsdom performs no layout. */

type HeadingTag = 'h1' | 'h2' | 'h3' | 'h4' | 'h5' | 'h6';

/* `Tag` resolves through this ALLOW-LIST, never by bare interpolation of `level`.
   `` `h${level}` `` turns the tag-string form into `hh5`, and `document.createElement` accepts
   that happily. The tag-string form is not hypothetical: it is the vocabulary the shipped seams
   actually pass (`headingLevel="h5"` / `rowHeadingLevel="h6"` at `CalendarListView.js:631-632`,
   `:656-657`, `:849-850`, `:889`; `EmptyState.tsx:61`'s public type is `'h1' | 'h2' | 'h3'`), and
   plan 36 migrates 43 UNTYPED `.js` files onto this primitive, where TypeScript cannot enforce
   the declared union at all. The union on `HeadingProps.level` and this allow-list are two halves
   of ONE mitigation; neither alone is the contract.

   WHAT THIS GUARDS, precisely: no injection is reachable — the mandatory `h` prefix and React's
   `createElement` path bound the harm to a made-up element NAME. The defect being closed is that
   a NON-HEADING element renders carrying heading classes, with no console error and no failing
   test, and the document outline silently loses a heading. Do not over-scope this into
   sanitisation. The guard lives entirely here and changes nothing at the call sites. */
const LEVEL_TAGS: Record<string, HeadingTag> = {
  '1': 'h1',
  '2': 'h2',
  '3': 'h3',
  '4': 'h4',
  '5': 'h5',
  '6': 'h6',
  h1: 'h1',
  h2: 'h2',
  h3: 'h3',
  h4: 'h4',
  h5: 'h5',
  h6: 'h6',
};

/** The documented safe default for an unrecognised `level`. Never `h1` — that would mint a second page title out of a caller's mistake. */
const FALLBACK_TAG: HeadingTag = 'h2';

/** UI-SPEC §4.6: the default `size` derives from the resolved level. */
const SIZE_FOR_TAG: Record<HeadingTag, 'display' | 'heading' | 'body' | 'label'> = {
  h1: 'display',
  h2: 'heading',
  h3: 'heading',
  h4: 'body',
  h5: 'body',
  h6: 'body',
};

export interface HeadingProps
  extends Omit<React.HTMLAttributes<HTMLHeadingElement>, 'dangerouslySetInnerHTML'>,
    VariantProps<typeof headingVariants> {
  /**
   * Semantic outline position. Declared as the literal union on purpose — see the
   * `LEVEL_TAGS` note above for why the runtime allow-list is the other half and
   * why widening this is not a way to satisfy anything.
   */
  level: 1 | 2 | 3 | 4 | 5 | 6;
}

const Heading = React.forwardRef<HTMLHeadingElement, HeadingProps>((allProps, ref) => {
  /* T-88.6-05, both halves. `HeadingProps` Omits `dangerouslySetInnerHTML` out of the extended
     `HTMLAttributes` (the TYPE half, copying the narrowing idiom at `EmptyState.tsx:47` and
     `RouteFallback.tsx:30`), and the destructure below drops it before `{...rest}` reaches the
     element (the RUNTIME half). The type half alone is not the mitigation: `Omit` is erased at
     runtime and the spread would carry the sink straight through from an untyped `.js` caller —
     which is exactly why "the identifier does not appear in Heading.tsx" was never evidence of
     anything. `Heading.test.tsx` forces the prop through from an untyped-caller position and
     asserts no injected element lands.
     Scoped to THIS file: the same `Omit` is deliberately NOT rippled across the other
     `HTMLAttributes`-plus-spread components in `src/components/ui` / `src/app/components` —
     that is a separate decision with no owner in this phase. */
  const {
    level,
    size,
    className,
    children,
    dangerouslySetInnerHTML: _droppedHtmlSink,
    ...rest
  } = allProps as HeadingProps & { dangerouslySetInnerHTML?: unknown };

  // AC-3. Explicitly `undefined` / `null` / `''` and nothing else — a `!children`
  // guard would swallow `children={0}`, which is CONTENT, not emptiness.
  if (children === undefined || children === null || children === '') return null;

  const Tag = LEVEL_TAGS[String(level)] ?? FALLBACK_TAG;
  const resolvedSize = size ?? SIZE_FOR_TAG[Tag];

  return (
    <Tag ref={ref} className={cn(headingVariants({ size: resolvedSize }), className)} {...rest}>
      {children}
    </Tag>
  );
});

Heading.displayName = 'Heading';

export { Heading, headingVariants };
