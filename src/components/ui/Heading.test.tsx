// Contract pins for the <Heading> primitive (D-05 / SPEC R3 + AC-3, UI-SPEC §4.1 / §4.6).
//
// 135 raw heading tags across 43 files migrate onto this primitive in plan 36, so
// these pins are about the CONTRACT, not the styling taste:
//   1. `level` (document-outline position) and `size` (type rung) are INDEPENDENT
//      props — asking for the right outline never changes the type role. The
//      precedent is EmptyState.tsx:82-89, and ErrorFallback.tsx:78-92 ships an
//      <h1> rendered at 20px today.
//   2. the four sizes are the §4.1 rungs, and every one of them is 700
//   3. empty children render NO element at all (SPEC AC-3) — and the element that
//      vanishes takes its `id` with it, which is a live a11y hazard, pinned below
//   4. the base WRAPS and never clips — `wrap-anywhere` at every rung
//   5. the two untyped-caller hazards plan 36 makes reachable are closed: an
//      out-of-range `level`, and a forced `dangerouslySetInnerHTML` (T-88.6-05)
//
// Deliberately NOT here: a `heading-order` axe assertion. `heading-order` is a
// DOCUMENT-level rule and belongs to the composed audits in plans 45-46, not to a
// primitive suite that renders one heading in isolation.
import * as React from 'react';
import { render, cleanup } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { Heading, headingVariants } from './Heading';

afterEach(cleanup);

/**
 * The ONE untyped-caller idiom this suite uses.
 *
 * `HeadingProps` declares `level` as the literal union 1|2|3|4|5|6 and `Omit`s
 * `dangerouslySetInnerHTML` out of the extended `HTMLAttributes`. Both of those are
 * TYPE-level facts, and `npm run typecheck` is part of this plan's gate — so the
 * values they forbid cannot be written plainly in a `.tsx` suite. They are still
 * REACHABLE at runtime, because plan 36 migrates 43 untyped `.js` files onto this
 * primitive and TypeScript is not present at those call sites.
 *
 * This cast reproduces exactly that position — an untyped caller — and it is the
 * single mechanism used for every such case below (the out-of-range `level` cases
 * and the `dangerouslySetInnerHTML` case alike). Widening the declared props to
 * make those cases compile is the WRONG way out: the declared union is the
 * type-level half of the mitigation, and deleting it would leave the runtime
 * allow-list looking like the whole of it.
 */
type UntypedProps = Record<string, unknown> & { children?: React.ReactNode };
const UntypedHeading = Heading as unknown as React.ComponentType<UntypedProps>;

/** The §4.1 rung set, closed. `caption` is deliberately absent (§4.4: after this phase no heading renders at 12px). */
const RUNGS = [
  ['display', 'text-3xl', true],
  ['heading', 'text-xl', true],
  ['body', 'text-base', false],
  ['label', 'text-sm', false],
] as const;

/** UI-SPEC §4.6: default `size` derives from `level` — 1 -> display, 2/3 -> heading, 4+ -> body. */
const DERIVED_DEFAULTS = [
  [1, 'text-3xl'],
  [2, 'text-xl'],
  [3, 'text-xl'],
  [4, 'text-base'],
  [5, 'text-base'],
  [6, 'text-base'],
] as const;

const CLIP_UTILITIES = ['truncate', 'line-clamp', 'text-ellipsis', 'whitespace-nowrap'] as const;

describe('Heading — the level x size contract', () => {
  it('renders <h2> at the 20px/700 Heading rung for level={2} size="heading"', () => {
    const { container } = render(
      <Heading level={2} size="heading">
        Section
      </Heading>
    );
    const el = container.querySelector('h2');
    expect(el).not.toBeNull();
    expect(el).toHaveClass('text-xl');
    expect(el).toHaveClass('leading-tight');
    expect(el).toHaveClass('font-bold');
  });

  // The independence pin. ErrorFallback.tsx:78-92 already ships an <h1> at 20px,
  // so this is a shipped fact being formalised, not a new idea.
  it('keeps level and size independent — <Heading level={1} size="label"> is an <h1> at 14px', () => {
    const { container } = render(
      <Heading level={1} size="label">
        x
      </Heading>
    );
    const el = container.querySelector('h1');
    expect(el).not.toBeNull();
    expect(el).toHaveClass('text-sm');
    expect(el).toHaveClass('font-bold');
    // asking for the right outline did not make it louder
    expect(el).not.toHaveClass('text-3xl');
  });

  it.each(RUNGS)('maps size="%s" to %s at 700', (size, utility, tight) => {
    const { container } = render(
      <Heading level={3} size={size}>
        Rung
      </Heading>
    );
    const el = container.querySelector('h3');
    expect(el).not.toBeNull();
    expect(el).toHaveClass(utility);
    expect(el).toHaveClass('font-bold');
    if (tight) {
      expect(el).toHaveClass('leading-tight');
    } else {
      expect(el).not.toHaveClass('leading-tight');
    }
  });

  // level goes to 6 because CalendarListView.js:834-845's `DECISION Phase 88.5
  // (DR2-7b)` marker renders h5/h6 through the `headingLevel`/`rowHeadingLevel`
  // seam (:631-632, :656-657, :849-850, :889). A 1-4 primitive would bulldoze it.
  it.each([1, 2, 3, 4, 5, 6] as const)('renders level={%i} as the matching h1-h6 element', (level) => {
    const { container } = render(<Heading level={level}>Outline</Heading>);
    const el = container.querySelector(`h${level}`);
    expect(el).not.toBeNull();
    expect(el?.tagName).toBe(`H${level}`);
  });

  it.each(DERIVED_DEFAULTS)('derives the default size from level={%i} -> %s', (level, utility) => {
    const { container } = render(<Heading level={level}>Derived</Heading>);
    const el = container.querySelector(`h${level}`);
    expect(el).not.toBeNull();
    expect(el).toHaveClass(utility);
    expect(el).toHaveClass('font-bold');
  });

  it('lets a caller className win over the cva base through cn() last-wins', () => {
    const { container } = render(
      <Heading level={2} size="heading" className="text-content-accent uppercase tracking-wide">
        Eyebrow-ish
      </Heading>
    );
    const el = container.querySelector('h2');
    expect(el).not.toBeNull();
    // the three caller utilities survive...
    expect(el).toHaveClass('text-content-accent');
    expect(el).toHaveClass('uppercase');
    expect(el).toHaveClass('tracking-wide');
    // ...and so does the rung, because none of them conflicts with it
    expect(el).toHaveClass('text-xl');
    expect(el).toHaveClass('font-bold');
  });

  // forwardRef, NOT ref-as-prop: Phase 90's React 19 codemod converts every
  // primitive together, and pre-adopting here would split its blast radius.
  it('forwards a ref to the underlying heading element', () => {
    const ref = React.createRef<HTMLHeadingElement>();
    render(
      <Heading level={2} ref={ref}>
        Title
      </Heading>
    );
    expect(ref.current).not.toBeNull();
    expect(ref.current?.tagName).toBe('H2');
  });
});

describe('Heading — empty children render nothing (SPEC AC-3)', () => {
  it.each([
    ['empty string', ''],
    ['null', null],
    ['undefined', undefined],
  ])('renders NO element for %s children', (_label, children) => {
    const { container } = render(<Heading level={3}>{children}</Heading>);
    expect(container.querySelector('h3')).toBeNull();
    expect(container.firstChild).toBeNull();
  });

  // The falsy-vs-empty edge. An implementation that guards with
  // `if (!children) return null` swallows a numeric zero, which is CONTENT.
  // The guard is an explicit test against undefined / null / '' only.
  it('still renders for children={0} — a numeric zero is content, not emptiness', () => {
    const { container } = render(<Heading level={2}>{0}</Heading>);
    const el = container.querySelector('h2');
    expect(el).not.toBeNull();
    expect(el?.textContent).toBe('0');
  });

  // THE IDREF HAZARD, pinned behaviourally rather than only documented in the
  // component's docblock. An element that renders nothing takes its `id` with it,
  // so any `aria-labelledby` / `aria-describedby` pointing at a Heading can go
  // DANGLING at runtime with no error and no failing build.
  //
  // The live case: Modal.tsx:198 declares the ModalHeader title as "rendered as
  // the DialogTitle (drives `aria-labelledby`)", while Modal.tsx:159 sets
  // `aria-describedby={undefined}` — so that title is the dialog's ONLY
  // accessible name. An empty title there is a nameless dialog.
  //
  // Two softer alternatives are BLOCKED and must not be substituted for this pin:
  // weakening the AC-3 empty-children contract (the SPEC locks it), and adding a
  // dev-only `console.warn` to Heading.tsx (.eslintrc.json:6 sets
  // `no-console: error` and no override entry covers `src/components/ui` —
  // `grep -c 'src/components/ui' .eslintrc.json` -> 0, so a warn there is a lint
  // failure). The narrow behavioural pin is the answer precisely because both
  // softer options are unavailable.
  it('takes its id with it — an id-bearing Heading with empty children leaves the idref dangling', () => {
    const { container } = render(
      <Heading level={2} id="dialog-title">
        {''}
      </Heading>
    );
    expect(container.querySelector('#dialog-title')).toBeNull();
  });
});

describe('Heading — wraps, never clips', () => {
  // NOTE ON WHAT THIS SECTION CAN AND CANNOT ASSERT.
  // jsdom performs NO layout: `scrollWidth` / `offsetWidth` are 0 for every
  // element and `getComputedStyle(el).overflowWrap` reads "normal" regardless of
  // the class applied, because no Tailwind CSS is loaded here. A width comparison
  // in this file would therefore be `0 <= 0` and would assert nothing while
  // LOOKING like a geometry gate. So the wrap is pinned on the CLASS LIST here,
  // and the real 375px geometry half is owned by plan 12's planted phone arm (E5).
  // Do not add a width / scrollWidth / offsetWidth assertion to this suite.
  it.each(RUNGS)('carries the wrap utility at size="%s"', (size) => {
    const { container } = render(
      <Heading level={2} size={size}>
        Aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa
      </Heading>
    );
    const el = container.querySelector('h2');
    expect(el).not.toBeNull();
    expect(el).toHaveClass('wrap-anywhere');
  });

  it('puts the wrap utility on the BASE, not on any single size variant', () => {
    for (const [size] of RUNGS) {
      expect(headingVariants({ size })).toContain('wrap-anywhere');
      expect(headingVariants({ size })).toContain('font-bold');
    }
    // and on the bare call too, so a future size variant inherits it
    expect(headingVariants()).toContain('wrap-anywhere');
  });

  it('carries no clip or ellipsis utility at any rung', () => {
    for (const [size] of RUNGS) {
      const base = headingVariants({ size });
      for (const clip of CLIP_UTILITIES) {
        expect(base).not.toContain(clip);
      }
    }
  });
});

describe('Heading — the untyped-caller hazards plan 36 makes reachable', () => {
  // HAZARD 1: an out-of-range `level`.
  //
  // The shipped seams pass the FULL TAG STRING, not a number:
  // CalendarListView.js:631-632 and :656-657 pass `headingLevel="h5"` /
  // `rowHeadingLevel="h6"`, and EmptyState.tsx:61's public type is
  // `'h1' | 'h2' | 'h3'`. A bare `` `h${level}` `` turns "h5" into `hh5`, which
  // document.createElement accepts happily.
  //
  // WHAT THIS GUARDS, precisely: NO injection is reachable — the mandatory `h`
  // prefix plus React's createElement path bound the harm to a made-up element
  // NAME. The defect being closed is that a NON-HEADING element renders carrying
  // heading classes, with no console error and no failing test, and the document
  // outline silently loses a heading. Do not over-scope this into sanitisation.
  const VALID_TAGS = ['H1', 'H2', 'H3', 'H4', 'H5', 'H6'];

  it('resolves a tag-string level ("h5") to a real heading element, never an <hh5>', () => {
    const { container } = render(<UntypedHeading level="h5">Day</UntypedHeading>);
    expect(container.querySelector('hh5')).toBeNull();
    const el = container.firstElementChild;
    expect(el).not.toBeNull();
    expect(VALID_TAGS).toContain(el?.tagName);
    // and it preserves the level the seam asked for — that IS the outline fact
    expect(el?.tagName).toBe('H5');
  });

  it('resolves level={undefined} to a real heading element, never an <hundefined>', () => {
    const { container } = render(<UntypedHeading level={undefined}>Orphan</UntypedHeading>);
    expect(container.querySelector('hundefined')).toBeNull();
    const el = container.firstElementChild;
    expect(el).not.toBeNull();
    expect(VALID_TAGS).toContain(el?.tagName);
    // the documented safe default: h2, a generic section heading. Never h1 —
    // that would mint a second page title out of a caller's mistake.
    expect(el?.tagName).toBe('H2');
  });

  // HAZARD 2: T-88.6-05. `HeadingProps` Omits `dangerouslySetInnerHTML` out of the
  // extended HTMLAttributes, but `Omit` is erased at runtime and `{...props}`
  // would spread the sink straight onto the element. Type-level narrowing is
  // invisible to a runtime suite, so this forces the prop through from the
  // untyped-caller position and asserts the injected markup never lands.
  //
  // This is the assertion that makes the mitigation DETECTABLE. Without it the
  // threat's only evidence is the absence of the identifier in Heading.tsx — and
  // a spread makes that absence irrelevant.
  it('injects no element when dangerouslySetInnerHTML is forced through', () => {
    const { container } = render(
      <UntypedHeading
        level={2}
        dangerouslySetInnerHTML={{ __html: '<span id="injected">pwned</span>' }}
      >
        Safe title
      </UntypedHeading>
    );
    expect(container.querySelector('#injected')).toBeNull();
    expect(container.querySelector('span')).toBeNull();
    const el = container.querySelector('h2');
    expect(el).not.toBeNull();
    expect(el?.textContent).toBe('Safe title');
    expect(el?.innerHTML).not.toContain('injected');
  });
});
