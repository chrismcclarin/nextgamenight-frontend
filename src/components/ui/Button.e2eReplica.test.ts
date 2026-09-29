// LOCKSTEP PIN for the UI-SPEC §9.3 E10 planted replica in `e2e/touch-targets.spec.ts`.
//
// Added by plan 88.6-58 task 3 (2026-09-28, /code-adversarial-review 88.6 H1, owner ruling
// `H1-RULING: rebuild-replica-plus-lockstep-pin`). The E10 test plants a copy of the gameDetail
// row-action pair (GuestInviteButton + the two-tap Remove) at 375px and measures it for
// overflow. Plan 88.6-18 migrated both shipped controls onto `<Button size="sm" variant="ghost">`
// but the replica kept the PRE-migration `text-xs` classes and a label ('Remove Bartholomew')
// no shipped state renders — so the only automated gate for a SPEC-named backstop was green
// regardless of the shipped controls. It stayed stale because e2e cannot import `src/` (it
// imports only `./support/*`), so nothing tied the literal to the primitive.
//
// This suite is that tie. It reads the two replica literals OUT OF THE SPEC FILE and asserts
// each against the SHIPPED class string, computed through the same `cn(buttonVariants(...))`
// path `<Button>` renders (Button.tsx `cn(buttonVariants({ variant, size }), className)`) —
// never a hand-composed string, because `cn` is `twMerge` and may reorder/dedupe. The call-site
// classes are READ from `gameDetail/page.js` too, so a class change on EITHER side reds here in
// `npm test` instead of leaving the replica stale again. Edit the replica and the control
// together. RED on FE d03f728 (the stale replica); GREEN after the rebuild.
import fs from 'node:fs';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

import { cn } from '@/lib/cn';
import { buttonVariants } from './Button';

const ROOT = path.resolve(__dirname, '../../..');
const read = (rel: string): string => fs.readFileSync(path.join(ROOT, rel), 'utf8');

const SPEC = read('e2e/touch-targets.spec.ts');
const PAGE = read('src/app/gameDetail/page.js');
const CONFIRM = read('src/components/ui/useConfirmAction.ts');

/** The E10 test body, from its title to the start of its shipped-row half. */
function e10Block(): string {
  const lines = SPEC.split('\n');
  const start = lines.findIndex((l) =>
    l.includes('UI-SPEC §9.3 E10: a two-control row-action pair'),
  );
  const end = lines.findIndex((l, i) => i > start && l.includes('half 2: the shipped row'));
  expect(start, 'E10 test title not found in e2e/touch-targets.spec.ts').toBeGreaterThan(-1);
  expect(end, 'E10 "half 2: the shipped row" marker not found after the title').toBeGreaterThan(
    start,
  );
  return lines.slice(start, end).join('\n');
}

interface Planted {
  tag: string;
  className: string;
  label: string;
}

/** `const <name> = make('<tag>', '<className>', '<label>')` — the replica's planted controls. */
function planted(block: string): Record<string, Planted> {
  const out: Record<string, Planted> = {};
  const re = /const (invite|remove) = make\(\s*'(\w+)',\s*'([^']*)',\s*'([^']*)',?\s*\)/g;
  for (const m of block.matchAll(re)) {
    out[m[1]] = { tag: m[2], className: m[3], label: m[4] };
  }
  return out;
}

describe('E10 planted replica is byte-derived from the SHIPPED gameDetail row controls (lockstep)', () => {
  const block = e10Block();
  const controls = planted(block);

  it('plants exactly the two controls, in the make(tag, className, label) shape this pin reads', () => {
    expect(Object.keys(controls).sort()).toEqual(['invite', 'remove']);
  });

  it('REMOVE = cn(buttonVariants({ ghost, sm }), the ARMED call-site classes read from gameDetail/page.js', () => {
    // Anchor 1: the armed branch literal, read from the shipped call site.
    const armed = PAGE.match(/className=\{`border shrink-0 \$\{\s*isConfirming\s*\?\s*'([^']+)'/);
    expect(armed, 'two-tap Remove armed className not found in gameDetail/page.js').not.toBeNull();
    // Anchor 2: the literal this pin was written against — a change on the page reds here AND
    // makes the reader re-derive the replica deliberately.
    expect(armed![1]).toBe(
      'bg-status-error-subtle border-status-error text-content-status-error font-semibold',
    );
    const expected = cn(
      buttonVariants({ variant: 'ghost', size: 'sm' }),
      `border shrink-0 ${armed![1]}`,
    );
    expect(controls.remove?.tag).toBe('button');
    expect(controls.remove?.className).toBe(expected);
  });

  it("INVITE = the settled <span>'s static classes + the `member` branch ink (its widest settled label)", () => {
    const prefix = PAGE.match(
      /<span\s+className=\{`(inline-flex min-h-11[^`$]*?)\$\{branchInk\}`\}/,
    );
    expect(prefix, 'GuestInviteButton settled <span> className not found').not.toBeNull();
    const ink = PAGE.match(
      /status === 'pending' \|\| status === 'member' \|\| status === 'already'\s*\?\s*'([^']+)'/,
    );
    expect(ink, "branchInk's settled (member) arm not found").not.toBeNull();
    expect(PAGE).toContain("{status === 'member' && 'Already a member'}");
    // Template interpolation, not `cn` — the span renders the string byte-for-byte.
    const expected = `${prefix![1]}${ink![1]}`;
    expect(controls.invite?.tag).toBe('span');
    expect(controls.invite?.className).toBe(expected);
  });

  it("labels are the widest REAL states: 'Already a member' and the default armed label", () => {
    const armedDefault = CONFIRM.match(/DEFAULT_ARMED_LABEL = '([^']+)'/);
    expect(armedDefault).not.toBeNull();
    // gameDetail passes NO armedLabel to its two-tap gate, so the armed text is the default.
    const gate = PAGE.slice(PAGE.indexOf('const removeParticipantGate = useConfirmAction({'));
    expect(gate.slice(0, gate.indexOf('});'))).not.toContain('armedLabel');
    expect(controls.invite?.label).toBe('Already a member');
    expect(controls.remove?.label).toBe(armedDefault![1]);
    expect(controls.remove?.label).toBe('Tap again to confirm');
  });

  it('carries no pre-migration residue: no `Remove Bartholomew`, no `text-xs`', () => {
    expect(block).not.toContain('Remove Bartholomew');
    expect(block).not.toContain('text-xs');
  });
});
