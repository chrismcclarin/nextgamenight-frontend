/**
 * SPEC Req 5 — the member-initials chips that replace the home group card's name-pill row.
 *
 * WHAT THIS EXISTS TO CATCH
 * -------------------------
 * The collapsed overlapping stack has NO analog anywhere in `src/` — PATTERNS CORRECTION 3
 * verified a repo-wide negative for `-ml-2`, `-space-x-*`, `ring-surface-card` and
 * `ring-2 ring-white`. Nothing else in the suite can see this geometry, so every property the
 * design contract calls load-bearing is pinned here or it is pinned nowhere.
 *
 * THE FOUR THINGS THAT WOULD SHIP GREEN WITHOUT A PIN
 * --------------------------------------------------
 * 1. THE DASH. Friend and pending chips are told apart by ring COLOUR and by SOLID-vs-DASHED.
 *    The two colours measure 1.04:1 apart in light and 1.06:1 in dark — luminance-identical,
 *    so under red-green CVD two SOLID rings are ONE ring. A test that asserts only the colour
 *    passes for both statuses and is vacuous; test 7 is the guard proving this suite can tell
 *    solid from dashed at all.
 *
 * 2. THE FILL. `UserChip`'s own chip fill is `bg-surface-elevated`, which resolves to `#ffffff`
 *    in light — byte-identical to the card it sits on. That was MEASURED and REJECTED in 88-27.
 *    Inheriting it renders an invisible chip that no render assertion notices, so the pin is a
 *    source pin.
 *
 * 3. KEYBOARD ACTIVATION. The collapsed control and `Show less` are `role="button"` SPANs, not
 *    native `<button>`s (they live inside `grouplist.js`'s own `role="button"` card, where a
 *    real button is the axe `nested-interactive` rule). A span gets NO free Enter/Space — each
 *    key is only handled if the handler says so, and a one-key implementation would pass a
 *    single-key test. Enter and Space are therefore pinned SEPARATELY for both controls, and
 *    each pin also asserts the enclosing card's handler did not fire (the tap-stealing twin).
 *
 * 4. THE ACCESSIBLE NAME (UI-SPEC A-8, WCAG 1.4.1). Owner ruling D-15 suppresses the inline
 *    `✓ Friend` / `⏳ Pending` text on chips, which leaves the ring — a COLOUR — as the only
 *    status carrier a sighted user gets, and initials carry no status at all. So each expanded
 *    chip's accessible NAME must state identity plus relationship in words. That is invisible
 *    to a visible-text assertion, so the A-8 pins query by accessible name on purpose.
 *
 * `+N` ARITHMETIC. Derived from the SELF-FILTERED array, never from `groupUsers.length - 5`.
 * The shipped arithmetic carries an unstated "the viewer is a member of this list" premise and
 * understates by one in the window where `selfUuid` has not resolved yet.
 */
import fs from 'node:fs';
import path from 'node:path';

import * as React from 'react';
import { describe, it, expect, afterEach } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';

import { MemberChip } from './MemberChipStack';

const COMPONENT_SRC = fs.readFileSync(path.join(__dirname, 'MemberChipStack.tsx'), 'utf8');

afterEach(cleanup);

describe('MemberChip — fills and ring cues (D-10, D-11, D-12, D-12b)', () => {
  it('1. renders the uppercase initials of the username', () => {
    render(<MemberChip label="ada lovelace" />);
    expect(screen.getByText('AL')).toBeInTheDocument();
  });

  it('1b. a single-token username yields TWO characters (the D-10 branch)', () => {
    render(<MemberChip label="boardgamer" />);
    expect(screen.getByText('BO')).toBeInTheDocument();
  });

  it('2. falls back to the email when there is no username, and to `?` with neither', () => {
    render(<MemberChip label="rita@example.com" />);
    expect(screen.getByText('RI')).toBeInTheDocument();
    cleanup();
    render(<MemberChip label={null} />);
    expect(screen.getByText('?')).toBeInTheDocument();
  });

  it('3. `accepted` draws a SOLID success outline — and NOT the dash', () => {
    render(<MemberChip label="ada" status="accepted" />);
    const chip = screen.getByText('AD');
    expect(chip.className).toContain('outline-status-success');
    expect(chip.className).toContain('outline-2');
    expect(chip.className).not.toContain('outline-dashed');
  });

  it('4. `pending_sent` draws a DASHED warning outline', () => {
    render(<MemberChip label="rita" status="pending_sent" />);
    const chip = screen.getByText('RI');
    expect(chip.className).toContain('outline-dashed');
    expect(chip.className).toContain('outline-status-warning');
    expect(chip.className).not.toContain('outline-status-success');
  });

  it('5. `pending_received` draws the SAME dashed warning outline as `pending_sent`', () => {
    render(<MemberChip label="rita" status="pending_received" />);
    const chip = screen.getByText('RI');
    expect(chip.className).toContain('outline-dashed');
    expect(chip.className).toContain('outline-status-warning');
  });

  it('6. `none` and `unknown` draw NO outline utility at all (absence of a claim)', () => {
    render(<MemberChip label="ada" status="none" />);
    expect(screen.getByText('AD').className).not.toContain('outline-');
    cleanup();
    render(<MemberChip label="ada" status="unknown" />);
    expect(screen.getByText('AD').className).not.toContain('outline-');
  });

  it('7. ANTI-VACUITY: the dash, not the width, is what separates friend from pending', () => {
    // Both statuses carry `outline-2`. A pin written against the WIDTH — or against
    // "has an outline" — passes for both and would let a solid amber ring ship, which is
    // exactly the version the owner rejected on the 1.04:1 luminance measurement.
    render(<MemberChip label="ada" status="accepted" />);
    render(<MemberChip label="rita" status="pending_sent" />);
    const friend = screen.getByText('AD');
    const pending = screen.getByText('RI');
    expect(friend.className).toContain('outline-2');
    expect(pending.className).toContain('outline-2');
    const dashed = [friend, pending].filter((el) => el.className.includes('outline-dashed'));
    expect(dashed).toEqual([pending]);
  });

  it('8. the NEUTRAL arm is the card-hover fill with secondary ink', () => {
    render(<MemberChip label="ada" />);
    const chip = screen.getByText('AD');
    expect(chip.className).toContain('bg-surface-card-hover');
    expect(chip.className).toContain('text-content-secondary');
    expect(chip.className).not.toContain('bg-white/85');
  });

  it('9. the TINTED arm swaps to the white wash, the neutral hairline and the card ink', () => {
    render(<MemberChip label="ada" tinted />);
    const chip = screen.getByText('AD');
    expect(chip.className).toContain('bg-white/85');
    expect(chip.className).toContain('ring-1');
    expect(chip.className).toContain('ring-black/25');
    expect(chip.className).toContain('--group-ink-l');
    expect(chip.className).toContain('--group-ink,');
    // The neutral fill measures 1.11:1 on the blue preset tint — invisible. It must be GONE,
    // not merely overridden by a later utility (source order is not a contract).
    expect(chip.className).not.toContain('bg-surface-card-hover');
    expect(chip.className).not.toContain('text-content-secondary');
  });

  it('10. the collapsed cut-out separation ring is neutral-arm ONLY', () => {
    render(<MemberChip label="ada" separated />);
    expect(screen.getByText('AD').className).toContain('ring-surface-card');
    cleanup();
    // On a tinted card the ground is NOT `surface-card`, so a cut-out ring in that token
    // would draw a stray white outline. The tinted hairline does the separating instead.
    render(<MemberChip label="ada" separated tinted />);
    expect(screen.getByText('AD').className).not.toContain('ring-surface-card');
  });

  it('11. the `+N` variant renders the literal plus-number with muted ink on the same fill', () => {
    render(<MemberChip overflow={3} />);
    const chip = screen.getByText('+3');
    expect(chip.className).toContain('text-content-muted');
    expect(chip.className).toContain('bg-surface-card-hover');
    expect(chip.className).not.toContain('outline-');
  });

  it('12. every chip is `aria-hidden` — it is a glyph, never the identity carrier', () => {
    render(<MemberChip label="ada" status="accepted" />);
    expect(screen.getByText('AD')).toHaveAttribute('aria-hidden', 'true');
  });

  it('13. SOURCE: the file never inherits `UserChip`\'s invisible-in-light chip fill (88-27)', () => {
    expect(COMPONENT_SRC).not.toContain('bg-surface-elevated');
  });

  it('14. SOURCE: no raw hex colour, and no bare border WIDTH utility', () => {
    // Both are repo-wide gates (`rawColorValues.test.ts`, `borderExplicitness.test.ts`);
    // pinning them here too makes the failure land on THIS file rather than in a sweep.
    const code = COMPONENT_SRC.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
    expect(code).not.toMatch(/#[0-9a-fA-F]{6}/);
    expect(code).not.toMatch(/\bborder-\d\b/);
  });
});
