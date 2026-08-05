'use client';

/**
 * Switch — the one toggle primitive (Req 5, UI-SPEC §8.3).
 *
 * A thin wrapper over `@radix-ui/react-switch`. The ENTIRE point is the ARIA:
 * Radix emits `role="switch"` and `aria-checked` (and keeps them in sync through
 * controlled *and* uncontrolled use), which is precisely what userProfile's
 * hand-rolled notification toggles do not emit today. This file therefore
 * authors **no ARIA of its own** — no `role`, no `aria-checked` prop. If you
 * find yourself adding one, the primitive is being used wrong.
 *
 * **The accessible NAME is the consumer's responsibility.** Radix supplies the
 * role and the state; it cannot invent a name. Every call site must supply one —
 * either a visible `<label htmlFor>` pointing at an `id` on this control, or an
 * `aria-label` when the toggle genuinely has no visible text. A `title` does not
 * count (§7.3).
 *
 * **No success toast on toggle (D-14).** A switch that visibly flips is its own
 * receipt; firing a "Saved" toast for a self-stating control is the noise D-14
 * bans. Toast only when the toggle FAILS and the UI must roll back.
 *
 * @example
 * <label htmlFor="email-digest">Weekly digest</label>
 * <Switch id="email-digest" checked={enabled} onCheckedChange={setEnabled} />
 */
import * as React from 'react';
import * as SwitchPrimitive from '@radix-ui/react-switch';

import { cn } from '@/lib/cn';

/* DECISION Phase 88-07 (UI-SPEC §8.3): the 44x44 touch floor is reached with an INVISIBLE
   `after:` pseudo-element (`after:-inset-y-2.5` over a 24px track: 10 + 24 + 10 = 44),
   chosen OVER the obvious alternative of growing the track to a full 44px height so the
   element itself measures 44 (that class name is deliberately not written here, so the
   phase's "no 44px-tall track" grep gate cannot match this comment). The obvious one loses
   because a 44px-tall pill with a 20px thumb reads as a
   broken control, not a switch — §8.3 names it. The mechanism is the shipped one from
   ClickableMemberName (87.8 D-13); the pseudo-element changes neither layout flow nor the
   accessible tree, which a padded wrapper div would.

   CONSEQUENCE FOR CALL SITES: the hit area reaches 10px above and below the track. Stacked
   toggles need >=20px of vertical gap between tracks or the extensions overlap and the
   upper switch steals the lower one's taps. Tightening that gap is a decision, not a
   cleanup — see the same trade-off worked through at ClickableMemberName.js.

   Thumb is literal white in BOTH themes on purpose (§8.3 `#ffffff`): it is the moving part
   whose contrast against the track carries the state, so it does not follow the theme. It
   is not a raw palette ramp value and is not the palette-in-`ui/` violation that ban
   targets. */
const Switch = React.forwardRef<
  React.ElementRef<typeof SwitchPrimitive.Root>,
  React.ComponentPropsWithoutRef<typeof SwitchPrimitive.Root>
>(({ className, ...props }, ref) => (
  <SwitchPrimitive.Root
    ref={ref}
    className={cn(
      'relative inline-flex h-6 w-11 shrink-0 cursor-pointer items-center rounded-full',
      // §7 motion table: toggles are the 100ms row. Colour only — no scale.
      'transition-colors duration-100 ease-out',
      'bg-surface-card-hover data-[state=checked]:bg-btn-primary',
      // §7.2: `focus-visible` only; `outline-hidden` keeps the transparent outline
      // forced-colors mode needs (v4's `outline-none` removes it outright).
      'focus:outline-hidden focus-visible:ring-2 focus-visible:ring-focus-ring focus-visible:ring-offset-2',
      'disabled:cursor-not-allowed disabled:opacity-50',
      // The 44x44 hit extension. See the marker above before changing these numbers.
      "after:absolute after:inset-x-0 after:-inset-y-2.5 after:content-['']",
      className
    )}
    {...props}
  >
    <SwitchPrimitive.Thumb
      className={cn(
        'pointer-events-none block h-5 w-5 rounded-full bg-white shadow-theme-sm',
        'translate-x-0.5 transition-transform duration-100 ease-out',
        // 44 track - 20 thumb - 2 resting inset = 22px of travel.
        'data-[state=checked]:translate-x-[22px]'
      )}
    />
  </SwitchPrimitive.Root>
));

Switch.displayName = SwitchPrimitive.Root.displayName;

export { Switch };
