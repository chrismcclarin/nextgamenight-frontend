// Phase 89.6-44 (owner ruling TC-A, 2026-11-27): every tag is centred on its line. A flex row centres
// its tags already; a tag that sits in a line of text is drawn inside a line-tall box (PILL_LINE) when
// its mount passes inText. This suite pins the block's half: the box is one span around the tag, it
// carries PILL_LINE and whatever belongs to the box (lineClassName: display classes, margins), and
// the tag keeps its own ref, attributes and classes, so every locator and focus path still lands on
// the tag. Without inText nothing is wrapped and the tag is what it has always been.
// The marker is at src/components/ui/Pill.tsx ("DECISION Phase 89.6-44 (TC-A, tag centring)").
// Which mounts pass inText is pinned per file by
// src/app/pillFamily.test.ts ("TC-A (89.6-44): every tag in a line of text is drawn in the line-tall box").
import * as React from 'react';

import { cleanup, render } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';

import Pill, { PILL_BOX, PILL_LINE } from './Pill';

const tokens = (el: Element): string[] => (el.getAttribute('class') ?? '').split(/\s+/).filter((t) => t.length > 0);
const sorted = (list: string[]): string[] => [...list].sort();

afterEach(cleanup);

describe('TC-A (89.6-44): a tag in a line of text is drawn in a line-tall box', () => {
  it('TC-A: with inText one box wraps the tag, the box carries PILL_LINE and lineClassName, and the ref and attributes land on the tag', () => {
    const ref = React.createRef<HTMLSpanElement>();
    const { container } = render(
      <p>
        <Pill tone="emerald" inText lineClassName="md:hidden ml-1" ref={ref} data-friend-indicator="" role="status" tabIndex={-1} title="a title" className="shrink-0">
          Friend
        </Pill>
      </p>,
    );
    const holder = container.firstElementChild as HTMLElement;
    expect(holder.children, 'the holder has one child: the box').toHaveLength(1);
    const box = holder.firstElementChild as HTMLElement;
    expect(box.tagName).toBe('SPAN');
    expect(box.children, 'the box holds one element: the tag').toHaveLength(1);
    const tag = box.firstElementChild as HTMLElement;
    expect(tag.tagName).toBe('SPAN');
    expect(tag.children, 'the tag is a leaf').toHaveLength(0);
    expect(tag.textContent).toBe('Friend');
    expect(box.textContent, 'the box adds no text of its own').toBe('Friend');

    // The box: PILL_LINE plus what the mount says belongs to the box, and nothing but a class.
    expect(sorted(tokens(box))).toEqual(sorted([...PILL_LINE.split(' '), 'md:hidden', 'ml-1']));
    expect(box.getAttributeNames(), 'the box carries no role, no tab stop, no data attribute and no title').toEqual(['class']);

    // The tag: the ref, every passed attribute, its own class, and none of the box classes.
    expect(ref.current, 'the ref lands on the tag').toBe(tag);
    expect(tag).toHaveAttribute('data-friend-indicator', '');
    expect(tag).toHaveAttribute('role', 'status');
    expect(tag).toHaveAttribute('tabindex', '-1');
    expect(tag).toHaveAttribute('title', 'a title');
    expect(sorted(tokens(tag))).toEqual(sorted([...PILL_BOX.split(' '), 'font-normal', 'whitespace-nowrap', 'bg-surface-pill-emerald', 'text-content-pill-emerald', 'shrink-0']));
    expect(tag.getAttributeNames().filter((name) => /intext|lineclassname/i.test(name)), 'neither prop leaks into the markup').toEqual([]);
  });

  it('TC-A: PILL_LINE is the line-tall box, with the placement of before kept where the lh unit is not supported', () => {
    // Base: an inline-flex box aligned on the middle with no height of its own, which is exactly where
    // the tag sat before the ruling. Where the browser knows the lh unit the box is one line tall and
    // sits on the top of its line, so the tag is centred on the line.
    expect(PILL_LINE).toBe('inline-flex items-center align-middle supports-[height:1lh]:h-[1lh] supports-[height:1lh]:align-top');
  });

  it('TC-A: a display passed in lineClassName replaces the display of the box, and the tag keeps its own', () => {
    const { container } = render(
      <p>
        <Pill tone="emerald" inText lineClassName="hidden md:inline-flex">
          Friend
        </Pill>
      </p>,
    );
    const box = (container.firstElementChild as HTMLElement).firstElementChild as HTMLElement;
    expect(tokens(box)).toEqual(expect.arrayContaining(['hidden', 'md:inline-flex', 'items-center', 'supports-[height:1lh]:h-[1lh]', 'supports-[height:1lh]:align-top']));
    expect(tokens(box), 'the box has no bare inline-flex beside hidden').not.toContain('inline-flex');
    const tag = box.firstElementChild as HTMLElement;
    expect(tokens(tag)).toContain('inline-flex');
    expect(tokens(tag)).not.toContain('hidden');
  });

  it('TC-A: without inText there is no box: the tag is the holder child, with the classes it has always had', () => {
    const ref = React.createRef<HTMLSpanElement>();
    const { container } = render(
      <p>
        <Pill tone="amber" ref={ref} className="ml-1.5" lineClassName="md:hidden">
          Guest
        </Pill>
      </p>,
    );
    const holder = container.firstElementChild as HTMLElement;
    expect(holder.children).toHaveLength(1);
    const tag = holder.firstElementChild as HTMLElement;
    expect(ref.current).toBe(tag);
    expect(tag.children, 'no box and no inner node').toHaveLength(0);
    expect(tag.textContent).toBe('Guest');
    expect(tag.getAttributeNames(), 'lineClassName is the box: with no box it goes nowhere').toEqual(['class']);
    expect(tag.getAttribute('class')).toBe('inline-flex items-center align-middle px-1.5 py-0.5 rounded-sm text-xs leading-4 font-normal whitespace-nowrap bg-surface-pill-amber text-content-pill-amber ml-1.5');
  });
});
