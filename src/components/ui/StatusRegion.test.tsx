// D-05 aria-live contract for the shared StatusRegion (PRIM-04).
//
// The live container must mount EMPTY-FIRST and inject text on change, and expose
// polite (role=status) and assertive (role=alert) variants. Corrected Phase 88.6.1
// (D-42): screen readers ignore the conditional mount of a polite / status region,
// but an inserted role="alert" that arrives with its text IS announced (ARIA 1.2
// alert; TetraLogical 2024 matrix incl. VoiceOver iOS). The assertive variant
// still mounts empty-first: node identity is assertable, and a clear-then-set
// makes an identical repeat re-announce.
import * as React from 'react';
import { describe, it, expect, afterEach, beforeAll, afterAll, vi } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';
import { StatusRegion } from './StatusRegion';

afterEach(cleanup);

describe('StatusRegion aria-live contract', () => {
  it('mounts empty-first: the polite live region is present but has no text', () => {
    render(<StatusRegion />);
    const region = screen.getByRole('status');
    expect(region).toHaveAttribute('aria-live', 'polite');
    expect(region).toHaveTextContent('');
  });

  it('injects text on change without remounting the region (same node)', () => {
    const { rerender } = render(<StatusRegion />);
    const before = screen.getByRole('status');
    expect(before).toHaveTextContent('');

    rerender(<StatusRegion message="Saved" />);
    const after = screen.getByRole('status');
    expect(after).toBe(before); // same live node — text injected, not remounted
    expect(after).toHaveTextContent('Saved');
  });

  it('polite variant (default) → role="status" + aria-live="polite"', () => {
    render(<StatusRegion message="Loading" />);
    const region = screen.getByRole('status');
    expect(region).toHaveAttribute('aria-live', 'polite');
    expect(region).toHaveTextContent('Loading');
  });

  it('assertive variant → role="alert" + aria-live="assertive"', () => {
    render(<StatusRegion politeness="assertive" message="Request failed" />);
    const region = screen.getByRole('alert');
    expect(region).toHaveAttribute('aria-live', 'assertive');
    expect(region).toHaveTextContent('Request failed');
  });
});

// D-22 (Phase 88.6.1-06): the opt-in srOnlyWhenEmpty prop. While the rendered
// content (message ?? children) is null, undefined, a boolean or '', the region is
// visually hidden with sr-only; it is the SAME node in both states and its role,
// aria-live and aria-atomic never change. Emptiness is decided from the VALUE:
// an element, an array, a number or a whitespace string is always content
// (fail-visible), so the prop can never hide a message that is on screen.
describe('srOnlyWhenEmpty (D-22): sr-only only while the region has nothing to say', () => {
  // React warns about an unknown DOM prop only ONCE per process, so the spy must
  // exist before the first render in this describe; a spy installed inside a later
  // it() would miss the warning and pass vacuously.
  let errorSpy: ReturnType<typeof vi.spyOn>;
  beforeAll(() => {
    errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
  });
  afterAll(() => {
    errorSpy.mockRestore();
  });

  function liveAttrs(el: HTMLElement) {
    return {
      role: el.getAttribute('role'),
      live: el.getAttribute('aria-live'),
      atomic: el.getAttribute('aria-atomic'),
    };
  }

  it('the prop never reaches the DOM and React never warns about it', () => {
    render(<StatusRegion srOnlyWhenEmpty />);
    const region = screen.getByRole('status');
    const attrNames = Array.from(region.attributes).map((a) => a.name.toLowerCase());
    expect(attrNames).not.toContain('sronlywhenempty');
    // The attribute check alone is vacuous (React drops a boolean true on an
    // unknown attribute even without the fix); the warning is the real signal.
    const mentions = errorSpy.mock.calls.filter((args: unknown[]) =>
      args.map(String).join(' ').includes('srOnlyWhenEmpty')
    );
    expect(mentions).toEqual([]);
  });

  it('empty polite region: sr-only plus text-sm, no text, role=status', () => {
    render(<StatusRegion srOnlyWhenEmpty />);
    const region = screen.getByRole('status');
    expect(region).toHaveClass('sr-only');
    expect(region).toHaveClass('text-sm');
    expect(region).toHaveTextContent('');
    expect(region).toHaveAttribute('aria-live', 'polite');
  });

  it('empty assertive region: sr-only, role=alert, aria-live=assertive', () => {
    render(<StatusRegion srOnlyWhenEmpty politeness="assertive" />);
    const region = screen.getByRole('alert');
    expect(region).toHaveClass('sr-only');
    expect(region).toHaveAttribute('aria-live', 'assertive');
    expect(region).toHaveTextContent('');
  });

  it('a region holding text is never sr-only; the consumer classes and text-sm stay', () => {
    render(<StatusRegion srOnlyWhenEmpty className="mt-2 text-content-secondary" message="Saved" />);
    const region = screen.getByRole('status');
    expect(region).not.toHaveClass('sr-only');
    expect(region).toHaveClass('mt-2', 'text-content-secondary', 'text-sm');
    expect(region).toHaveTextContent('Saved');
  });

  it('empty, then Saved, then empty: the same node, live attributes constant, sr-only toggles', () => {
    const { rerender } = render(<StatusRegion srOnlyWhenEmpty className="mt-2" message="" />);
    const node = screen.getByRole('status');
    const attrs = liveAttrs(node);
    expect(node).toHaveClass('sr-only');

    rerender(<StatusRegion srOnlyWhenEmpty className="mt-2" message="Saved" />);
    expect(screen.getByRole('status')).toBe(node);
    expect(liveAttrs(node)).toEqual(attrs);
    expect(node).not.toHaveClass('sr-only');
    expect(node).toHaveTextContent('Saved');

    rerender(<StatusRegion srOnlyWhenEmpty className="mt-2" message="" />);
    expect(screen.getByRole('status')).toBe(node);
    expect(liveAttrs(node)).toEqual(attrs);
    expect(node).toHaveClass('sr-only');
    expect(node).toHaveTextContent('');
  });

  it('emptiness table: null, undefined, false, true and the empty string are empty', () => {
    const empties: Array<[string, React.ReactNode]> = [
      ['null', null],
      ['undefined', undefined],
      ['false', false],
      ['true', true],
      ['empty string', ''],
    ];
    for (const [label, value] of empties) {
      const viaMessage = render(<StatusRegion srOnlyWhenEmpty message={value} />);
      expect(viaMessage.container.firstElementChild, `message=${label}`).toHaveClass('sr-only');
      cleanup();
      const viaChildren = render(<StatusRegion srOnlyWhenEmpty>{value}</StatusRegion>);
      expect(viaChildren.container.firstElementChild, `children=${label}`).toHaveClass('sr-only');
      cleanup();
    }
  });

  it('fail-visible: a string, whitespace, 0, an element child and an array always count as content', () => {
    const contents: Array<[string, React.ReactNode]> = [
      ['a non-empty string', 'Saved'],
      ['a whitespace-only string', ' '],
      ['the number 0', 0],
      ['an empty keyed span (truthy element)', <span key="seq-1" />],
      ['an array', ['a', 'b']],
    ];
    for (const [label, value] of contents) {
      const { container } = render(<StatusRegion srOnlyWhenEmpty>{value}</StatusRegion>);
      expect(container.firstElementChild, label).not.toHaveClass('sr-only');
      cleanup();
    }
  });

  it('default OFF: prop absent and srOnlyWhenEmpty={false} render the exact markup captured from the pre-D-22 primitive', () => {
    // Expected strings were captured by RUNNING the unchanged primitive (FE
    // ecd9943), never typed by hand. A diff here is a finding, not a string to update.
    const cases: Array<[string, (off?: boolean) => React.ReactElement, string]> = [
      [
        '(a) no props',
        (off) => <StatusRegion srOnlyWhenEmpty={off} />,
        '<div role="status" aria-live="polite" aria-atomic="true" class="text-sm"></div>',
      ],
      [
        '(b) always-sr-only consumer with a message',
        (off) => <StatusRegion srOnlyWhenEmpty={off} className="sr-only" message="Saved" />,
        '<div role="status" aria-live="polite" aria-atomic="true" class="text-sm sr-only">Saved</div>',
      ],
      [
        '(c) assertive, empty message',
        (off) => (
          <StatusRegion
            srOnlyWhenEmpty={off}
            politeness="assertive"
            className="text-content-status-error"
            message=""
          />
        ),
        '<div role="alert" aria-live="assertive" aria-atomic="true" class="text-sm text-content-status-error"></div>',
      ],
      [
        '(d) id + margin, empty children',
        (off) => (
          <StatusRegion srOnlyWhenEmpty={off} id="hint" className="mt-1 text-xs">
            {''}
          </StatusRegion>
        ),
        '<div role="status" aria-live="polite" aria-atomic="true" class="mt-1 text-xs" id="hint"></div>',
      ],
    ];
    for (const [label, make, expected] of cases) {
      const absent = render(make(undefined));
      expect((absent.container.firstElementChild as HTMLElement).outerHTML, `${label}, prop absent`).toBe(expected);
      cleanup();
      const off = render(make(false));
      expect((off.container.firstElementChild as HTMLElement).outerHTML, `${label}, prop false`).toBe(expected);
      cleanup();
    }
  });

  // R8 idempotency backstop (held-out): the same outcome twice must be announced
  // twice. A consumer clears first ('Saved' then '' then 'Saved'), and that second
  // set must still be a real text mutation on the same node with the prop on;
  // re-rendering 'Saved' over 'Saved' is a bail-out with zero text mutations.
  for (const politeness of ['polite', 'assertive'] as const) {
    it(`R8 backstop (${politeness}): a clear-then-set is a text mutation on the same node; a same-text rerender is none`, () => {
      const role = politeness === 'assertive' ? 'alert' : 'status';
      const { rerender } = render(
        <StatusRegion srOnlyWhenEmpty politeness={politeness} message="Saved" />
      );
      const node = screen.getByRole(role);
      const observer = new MutationObserver(() => {});
      observer.observe(node, { childList: true, characterData: true, subtree: true });
      const textMutations = () =>
        observer.takeRecords().filter((r) => r.type === 'childList' || r.type === 'characterData');

      rerender(<StatusRegion srOnlyWhenEmpty politeness={politeness} message="" />);
      expect(textMutations().length).toBeGreaterThan(0);
      expect(node).toHaveClass('sr-only');

      rerender(<StatusRegion srOnlyWhenEmpty politeness={politeness} message="Saved" />);
      expect(screen.getByRole(role)).toBe(node);
      expect(textMutations().length).toBeGreaterThan(0);
      expect(node).not.toHaveClass('sr-only');

      rerender(<StatusRegion srOnlyWhenEmpty politeness={politeness} message="Saved" />);
      expect(screen.getByRole(role)).toBe(node);
      expect(textMutations()).toEqual([]);
      observer.disconnect();
    });
  }
});
