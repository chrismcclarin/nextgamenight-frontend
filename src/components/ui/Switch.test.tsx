// Contract pins for the <Switch> primitive (Req 5, UI-SPEC §8.3).
//
// The point of this primitive is ARIA the app currently does not emit anywhere:
// userProfile's notification toggles are styled <button>s with no `role="switch"`
// and no `aria-checked` (F-353/357/362). So these pins assert ROLES AND STATE, not
// classes, wherever possible — a regression to a hand-rolled styled <button> must
// fail here even if it looks identical.
//
//   1. `role="switch"` + `aria-checked` come from Radix; the app authors no ARIA.
//   2. Keyboard activation toggles and fires `onCheckedChange`.
//   3. The visible track stays 44x24 (`w-11 h-6`) and the 44x44 floor is reached by an
//      invisible `after:` pseudo-element — NOT by growing the track to `h-11`, which
//      looks broken. jsdom has no layout, so the pin is on the mechanism.
//   4. `focus-visible` ring only (§7.2).
//   5. axe-clean when the consumer supplies the accessible name.
import * as React from 'react';
import { render, screen, cleanup } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { axe } from 'vitest-axe';
import { Switch } from './Switch';

afterEach(cleanup);

describe('Switch', () => {
  it('exposes role="switch" with aria-checked reflecting state', () => {
    render(<Switch aria-label="Email notifications" />);
    const control = screen.getByRole('switch', { name: 'Email notifications' });
    expect(control).toHaveAttribute('aria-checked', 'false');

    cleanup();
    render(<Switch aria-label="Email notifications" defaultChecked />);
    expect(screen.getByRole('switch')).toHaveAttribute('aria-checked', 'true');
  });

  it('toggles aria-checked and fires onCheckedChange on Space', async () => {
    const user = userEvent.setup();
    const onCheckedChange = vi.fn();
    render(
      <Switch aria-label="Email notifications" onCheckedChange={onCheckedChange} />
    );
    const control = screen.getByRole('switch');

    await user.tab();
    expect(control).toHaveFocus();
    await user.keyboard(' ');

    expect(control).toHaveAttribute('aria-checked', 'true');
    expect(onCheckedChange).toHaveBeenCalledWith(true);
  });

  it('toggles on Enter as well as Space', async () => {
    const user = userEvent.setup();
    render(<Switch aria-label="Email notifications" />);
    const control = screen.getByRole('switch');

    await user.tab();
    await user.keyboard('{Enter}');

    expect(control).toHaveAttribute('aria-checked', 'true');
  });

  it('reaches 44x44 with an invisible hit extension, keeping the track 44x24', () => {
    render(<Switch aria-label="Email notifications" />);
    const control = screen.getByRole('switch');

    // Visible track: 44 wide x 24 tall.
    expect(control).toHaveClass('w-11');
    expect(control).toHaveClass('h-6');
    // 24 + 10 + 10 = 44: the reach is on the pseudo-element, not the track.
    expect(control.className).toMatch(/after:-inset-y-2\.5/);
    expect(control.className).toMatch(/after:content-\[/);
    // A 44px-TALL track is the failure mode this primitive exists to avoid.
    expect(control.className).not.toMatch(/(^|[\s:])h-11\b/);
  });

  it('uses a focus-visible ring and no bare focus: ring utility', () => {
    render(<Switch aria-label="Email notifications" />);
    const control = screen.getByRole('switch');
    expect(control.className).toContain('focus-visible:ring-2');
    expect(control.className).toContain('focus-visible:ring-focus-ring');
    expect(control.className).not.toMatch(/(^|\s)focus:(ring|border|bg)/);
  });

  it('carries no raw palette classes (semantic tokens only in ui/)', () => {
    render(<Switch aria-label="Email notifications" />);
    expect(screen.getByRole('switch').className).not.toMatch(
      /(red|green|amber|purple|warm|gray|slate)-[0-9]/
    );
  });

  it('forwards a ref and spreads unknown props onto the control', () => {
    const ref = React.createRef<HTMLButtonElement>();
    render(
      <Switch
        ref={ref}
        aria-label="Email notifications"
        id="email-notifications"
        aria-describedby="email-notifications-hint"
      />
    );
    const control = screen.getByRole('switch');
    expect(ref.current).toBe(control);
    expect(control).toHaveAttribute('id', 'email-notifications');
    expect(control).toHaveAttribute(
      'aria-describedby',
      'email-notifications-hint'
    );
  });

  it('merges consumer classes without dropping its own', () => {
    render(<Switch aria-label="Email notifications" className="ml-2" />);
    const control = screen.getByRole('switch');
    expect(control).toHaveClass('ml-2');
    expect(control).toHaveClass('w-11');
  });

  it('passes an axe audit with an associated visible label', async () => {
    const { container } = render(
      <div>
        <label htmlFor="digest">Weekly digest</label>
        <Switch id="digest" />
      </div>
    );
    expect(await axe(container)).toHaveNoViolations();
  });
});
