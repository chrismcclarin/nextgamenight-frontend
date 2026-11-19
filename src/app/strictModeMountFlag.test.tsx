// 88.9-52 W12 / MOUNT: the standing guard for the mount-flag trap.
//
// WHAT WENT WRONG. An effect that must not act on mount skipped its first run with a ref
// (set true on the first run, return early). React StrictMode, which the Next dev server turns on,
// mounts every effect, runs a simulated cleanup and mounts it again. A ref survives that, so the
// second run was no longer the first one and the effect acted at mount: every Home group card
// focused its Members control and the browser scrolled the list to its end. Production React runs
// effects once, so the code was right there and wrong on every dev server, capture and local walk.
//
// WHY A SEPARATE FILE. The unit suite does not render under StrictMode (no wrapper in
// vitest.setup.ts, and turning it on for every suite would change the render counts many tests
// pin), so nothing could see this class. Two cheap checks stand here instead:
//   1. a SOURCE scan for the two textbook spellings of the mount flag, over every non-test file;
//   2. a RENDER sweep that mounts the focus-moving member controls under StrictMode and asserts
//      the body still holds focus.
// LIMIT, stated: the scan knows two spellings. A mount flag written another way (a counter, a
// sentinel value, a flag reset somewhere else) is caught only if its component is in the render
// table below, so a new component that moves focus from an effect belongs in that table.
// The fix the scan asks for is a previous-value ref, see
// src/app/components/MemberChipStack.tsx ("const prevExpanded = useRef(expanded);").
import fs from 'node:fs';
import path from 'node:path';

import * as React from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render } from '@testing-library/react';

import { sourceFiles, withoutComments } from '../test-utils/sourceScan';
import { MemberChipStack } from './components/MemberChipStack';
import ClickableMemberName from './components/ClickableMemberName';
import { FriendshipContext } from './components/FriendshipStatusProvider';

const SRC = path.resolve(__dirname, '..');

afterEach(cleanup);

interface MountFlagHit {
  ref: string;
  offset: number;
}

// Spelling A: a ref that starts false, set true on the first effect run, which returns early.
// Spelling B: a ref that starts true, set false on the first effect run, which returns early.
// A hit needs BOTH the early-return block and a matching declaration of that same ref, so a
// handler-armed one-shot (starts false, a handler sets it true, the effect clears it and acts)
// is not a hit: its block is the B shape over an A declaration.
function mountFlagHits(src: string): MountFlagHit[] {
  const code = withoutComments(src);
  const hits: MountFlagHit[] = [];
  const shapes: { block: RegExp; initial: string }[] = [
    { block: /if\s*\(\s*!\s*([A-Za-z_$][\w$]*)\.current\s*\)\s*\{\s*\1\.current\s*=\s*true\s*;?\s*return\s*;?\s*\}/g, initial: 'false' },
    { block: /if\s*\(\s*([A-Za-z_$][\w$]*)\.current\s*\)\s*\{\s*\1\.current\s*=\s*false\s*;?\s*return\s*;?\s*\}/g, initial: 'true' },
  ];
  for (const { block, initial } of shapes) {
    for (const match of code.matchAll(block)) {
      const ref = match[1];
      const declared = new RegExp(
        '\\b' + ref.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '\\s*=\\s*(?:React\\.)?useRef(?:<[^>]*>)?\\(\\s*' + initial + '\\s*\\)',
      );
      if (declared.test(code)) hits.push({ ref, offset: match.index ?? 0 });
    }
  }
  return hits;
}

describe('StrictMode mount-flag guard (88.9-52 W12 / MOUNT)', () => {
  it('1. ANTI-VACUITY: the scan sees both spellings, and not a handler-armed one-shot or a previous-value ref', () => {
    const spellingA = [
      'const didMount = useRef(false);',
      'useEffect(() => {',
      '  if (!didMount.current) {',
      '    didMount.current = true;',
      '    return;',
      '  }',
      '  target.current?.focus();',
      '}, [open]);',
    ].join('\n');
    const spellingB = [
      'const isFirstRender = React.useRef<boolean>(true);',
      'React.useEffect(() => {',
      '  if (isFirstRender.current) { isFirstRender.current = false; return }',
      '  announce(message);',
      '}, [message]);',
    ].join('\n');
    const handlerArmed = [
      'const isInternalChange = useRef(false);',
      'useEffect(() => {',
      '  if (isInternalChange.current) {',
      '    isInternalChange.current = false;',
      '    return;',
      '  }',
      '  setQuery(value);',
      '}, [value]);',
    ].join('\n');
    const previousValue = [
      'const prevExpanded = useRef(expanded);',
      'useEffect(() => {',
      '  if (prevExpanded.current === expanded) return;',
      '  prevExpanded.current = expanded;',
      '  target.current?.focus();',
      '}, [expanded]);',
    ].join('\n');

    expect(mountFlagHits(spellingA).map((hit) => hit.ref)).toEqual(['didMount']);
    expect(mountFlagHits(spellingB).map((hit) => hit.ref)).toEqual(['isFirstRender']);
    expect(mountFlagHits(handlerArmed)).toEqual([]);
    expect(mountFlagHits(previousValue)).toEqual([]);
  });

  it('2. SOURCE: no non-test file skips an effect\'s first run with a mount-flag ref', () => {
    const files = sourceFiles(SRC);
    expect(files.length, 'the walk found the source tree').toBeGreaterThan(150);

    const found: string[] = [];
    for (const file of files) {
      const src = fs.readFileSync(file, 'utf8');
      for (const hit of mountFlagHits(src)) {
        found.push(path.relative(SRC, file) + ' (' + hit.ref + ')');
      }
    }
    expect(
      found,
      'a mount-flag ref survives the StrictMode effect re-run, so the effect acts at mount on the dev ' +
        'server. Compare against a previous-value ref instead (MemberChipStack.tsx, prevExpanded).',
    ).toEqual([]);
  });

  it('3. RENDER: the member controls that move focus from an effect take NO focus at mount under StrictMode', () => {
    const friendship = {
      getStatus: () => 'none',
      sendRequest: vi.fn(async () => ({ ok: true })),
    };
    const members = [
      { id: 'u1', username: 'mary kay' },
      { id: 'u2', username: 'rita' },
      { id: 'u3', username: 'ada' },
    ];

    render(
      <React.StrictMode>
        <FriendshipContext.Provider value={friendship as never}>
          <MemberChipStack members={members} selfUuid="u-self" />
          <MemberChipStack members={members.slice(1)} selfUuid="u-self" />
          <ClickableMemberName userId="u1" username="mary kay" />
          <ClickableMemberName userId="u2" username="rita" />
        </FriendshipContext.Provider>
      </React.StrictMode>,
    );

    expect(
      document.activeElement,
      'two chip stacks and two member names mounted under StrictMode: focus stays on the body',
    ).toBe(document.body);
  });
});
