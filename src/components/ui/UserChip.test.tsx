// Pins for initialsOf (Phase 88.5, RESEARCH B-3 / D-10).
//
// WHAT THESE EXIST TO CATCH: the member chip stack (plan 88.5-06) and UserChip's own
// avatar fallback derive their initials from this ONE function. Before Phase 88.5 it was
// module-private, so the chips would have had to fork it — a second definition that can
// drift. Two behaviours are new here and are pinned so they are not "tidied" away:
//
//   1. a SINGLE-token label yields TWO characters ('boardgamer' -> 'BO'), because most
//      usernames in this app are one token and a lone 'B' reads as noise in a chip;
//   2. a null/undefined label returns '?' instead of throwing — the crash path a caller
//      hits for a member with neither a username nor an email to pass in.

//
// ADDED Phase 88.6-37 task 1 (D-22 / T-88.6-102 / T-88.6-105): the avatar branch's two
// controls. Neither is observable in the app today — `FriendInvitePanel.js:681-684` is
// UserChip's only importer and passes `{ name: ... }` with no avatar, which
// `identity.contract.test.ts` explains (friend search's payload stayed NARROW: no
// `picture_url`). These assertions are what make the controls real BEFORE a caller
// supplies an avatar, and what a v2.1 avatar rollout relies on.

import { describe, it, expect, afterEach } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';
import { initialsOf, UserChip } from './UserChip';

afterEach(cleanup);

describe('initialsOf — multi-token labels (unchanged behaviour)', () => {
  it('returns the first letter of each of the first two tokens', () => {
    expect(initialsOf('Mary Kay')).toBe('MK');
  });

  it('still uses only the first two tokens of a longer name', () => {
    expect(initialsOf('Mary Kay Jones')).toBe('MK');
  });

  it('uppercases lowercase input', () => {
    expect(initialsOf('mary kay')).toBe('MK');
  });

  it('collapses runs of whitespace rather than counting them as tokens', () => {
    expect(initialsOf('  Mary   Kay  ')).toBe('MK');
  });
});

describe('initialsOf — single-token labels (D-10, NEW in Phase 88.5)', () => {
  it("returns the first TWO characters of a single token ('boardgamer' -> 'BO')", () => {
    // Before Phase 88.5 this returned 'B'. The change is deliberate: single-token
    // usernames are the common case here and one letter reads as noise in a chip.
    expect(initialsOf('boardgamer')).toBe('BO');
  });

  it('uppercases both characters', () => {
    expect(initialsOf('ab')).toBe('AB');
  });

  it("yields ONE character for a one-character token ('b' -> 'B', not 'B?' or padding)", () => {
    expect(initialsOf('b')).toBe('B');
  });
});

describe('initialsOf — missing and empty labels never throw', () => {
  it('returns ? for an empty string', () => {
    expect(initialsOf('')).toBe('?');
  });

  it('returns ? for a whitespace-only string', () => {
    expect(initialsOf('   ')).toBe('?');
  });

  it('returns ? for null without throwing', () => {
    expect(() => initialsOf(null)).not.toThrow();
    expect(initialsOf(null)).toBe('?');
  });

  it('returns ? for undefined without throwing', () => {
    expect(() => initialsOf(undefined)).not.toThrow();
    expect(initialsOf(undefined)).toBe('?');
  });
});

describe('UserChip avatar — referrerPolicy (D-22 / T-88.6-102)', () => {
  it('renders the avatar <img> with referrerPolicy="no-referrer"', () => {
    const { container } = render(
      <UserChip user={{ name: 'Mary Kay', avatarUrl: 'https://cdn.example.com/a.png' }} />
    );
    const img = container.querySelector('img');
    expect(img).not.toBeNull();
    // `referrerPolicy` is reflected as the `referrerpolicy` attribute; assert the
    // ATTRIBUTE rather than the property so a React-version change in how the prop is
    // applied cannot pass this vacuously.
    expect(img).toHaveAttribute('referrerpolicy', 'no-referrer');
  });
});

describe('UserChip avatar — the house allow-list gate (T-88.6-105)', () => {
  // One case PER POLARITY. The rejected arm is the load-bearing one: without the gate the
  // <img> renders with a `javascript:` src, which is what `safeBgImageStyle.ts:3-7`'s
  // one-list invariant says cannot happen at any image sink in this family.
  it('ALLOWED absolute https URL renders the <img>', () => {
    const { container } = render(
      <UserChip user={{ name: 'Mary Kay', avatarUrl: 'https://cdn.example.com/a.png' }} />
    );
    expect(container.querySelector('img')).toHaveAttribute(
      'src',
      'https://cdn.example.com/a.png'
    );
    expect(screen.queryByText('MK')).toBeNull();
  });

  it('ALLOWED root-relative URL renders the <img> (allowRelative: true, SafeImage parity)', () => {
    const { container } = render(
      <UserChip user={{ name: 'Mary Kay', avatarUrl: '/uploads/pic.png' }} />
    );
    // Handed to the DOM in its ORIGINAL relative form — the validation base is never emitted
    // (`safeBgImageStyle.ts:14-21`).
    expect(container.querySelector('img')).toHaveAttribute('src', '/uploads/pic.png');
  });

  it('REJECTED javascript: URL renders the EXISTING initials fallback, not a dead <img>', () => {
    const { container } = render(
      // eslint-disable-next-line no-script-url
      <UserChip user={{ name: 'Mary Kay', avatarUrl: 'javascript:alert(1)' }} />
    );
    expect(container.querySelector('img')).toBeNull();
    expect(screen.getByText('MK')).toBeInTheDocument();
  });

  it('REJECTED data: URL renders the initials fallback', () => {
    const { container } = render(
      <UserChip user={{ name: 'Mary Kay', avatarUrl: 'data:image/png;base64,AAAA' }} />
    );
    expect(container.querySelector('img')).toBeNull();
    expect(screen.getByText('MK')).toBeInTheDocument();
  });
});

describe('UserChip — §4.5 pill-ink weight (W36 twin)', () => {
  // The sweep half, not a fix: 600 -> 700 on the initials fill, matching
  // `MemberChipStack.tsx:85`'s shipped treatment. The 12px/14px rungs do NOT move — the
  // chip's `h-6 w-6` / `h-8 w-8` boxes are the fixed geometry D-01 names.
  it('the initials fill carries font-bold (700), never 600 or 500', () => {
    render(<UserChip user={{ name: 'Mary Kay' }} size="sm" />);
    const initials = screen.getByText('MK');
    expect(initials).toHaveClass('font-bold');
    expect(initials.className).not.toMatch(/font-(semibold|medium)/);
  });

  it('keeps the 12px rung on the sm chip and 14px on the md chip (fixed geometry, D-01)', () => {
    const { rerender } = render(<UserChip user={{ name: 'Mary Kay' }} size="sm" />);
    expect(screen.getByText('MK')).toHaveClass('h-6', 'w-6', 'text-xs');
    rerender(<UserChip user={{ name: 'Mary Kay' }} size="md" />);
    expect(screen.getByText('MK')).toHaveClass('h-8', 'w-8', 'text-sm');
  });
});
