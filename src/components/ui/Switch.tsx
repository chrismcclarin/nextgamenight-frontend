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
      'bg-surface-muted data-[state=checked]:bg-btn-primary',
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
        // DECISION Phase 88.3 (Req 3 knock-on / UI-SPEC §8.2): the thumb keeps a visible edge with
        // a BORDER. Two 88.3 token edits land on this control at once and they pull in opposite
        // directions: D-01 re-keys the OFF track from warm-100 to warm-200, which IMPROVES
        // thumb-vs-track from 1.13:1 to 1.31:1 — but Req 3 sets light `--shadow-sm` to `none`, and
        // that shadow was the only thing actually separating a white thumb from a warm track. Net,
        // in light mode the OFF switch becomes a white lozenge on a barely-different track with
        // nothing left to read, so the border ships in the SAME wave as the shadow change rather
        // than trailing it.
        // MEASURED: `border-line-strong` (warm-500 #8c7a6a, unchanged by this phase) is 4.11:1
        // against the white thumb and 3.15:1 against the warm-200 track — both clear WCAG 1.4.11's
        // 3:1 floor for non-text contrast, from either side.
        // Dark is `border-transparent` on purpose: dark has shipped with no thumb shadow since 87.7
        // (`globals.css` `.dark --shadow-sm: none`) and white-on-purple-800 is 11.28:1, so adding
        // an edge there would be a change, not a fix.
        // The `-sm` shadow STAYS on the class below, and the reason turns on a distinction the
        // original wording collapsed — CORRECTED Phase 88.6-02 (D49-b, owner ruling 2026-09-09):
        //   * the CUSTOM PROPERTY `--shadow-sm` IS `none` — in light since 88.3 Req 3, in dark
        //     since 87.7. The class below reads THAT, because it carries the project's TIER
        //     spelling `shadow-theme-sm`, whose `@theme` key resolves through `var(--shadow-sm)`.
        //   * the UTILITY `.shadow-sm` is NOT `none`. It is Tailwind v4's built-in default, whose
        //     literal values (`0 1px 3px 0 …, 0 1px 2px -1px …`) v4 INLINES into its built-in
        //     utilities instead of reading the theme property — see `DECISION Phase 87.7 (Plan 06,
        //     RESEARCH Pitfall 2)` at `globals.css:1176-1190` (cited as `:1140-1154` before this
        //     same commit's `@theme inline` marker shifted the file by 36 lines; re-derived and
        //     re-read 2026-09-15), which records exactly that, and why those three properties
        //     deliberately stay in plain `:root`.
        // So the class below is identical in both themes because it resolves to a `none` PROPERTY,
        // not because "the `-sm` utility is `none`" — which is false. Snapping this class to the
        // alias spelling `shadow-sm` would silently reintroduce a black drop shadow in both
        // themes. Keeping the tier spelling also keeps `-md`/`-lg` composable — the same reasoning
        // `Card.tsx:22` relies on (§8.1).
        // Rejected: pointing the thumb at `shadow-theme-md`. That token is reserved for RAISED and
        // OVERLAY surfaces under archetype A, and a switch thumb is neither.
        // Removing this border once the shadow is gone is a decision, not a cleanup.
        'pointer-events-none block h-5 w-5 rounded-full bg-white shadow-theme-sm border border-line-strong dark:border-transparent',
        'translate-x-0.5 transition-transform duration-100 ease-out',
        // 44 track - 20 thumb - 2 resting inset = 22px of travel.
        'data-[state=checked]:translate-x-[22px]'
      )}
    />
  </SwitchPrimitive.Root>
));

Switch.displayName = SwitchPrimitive.Root.displayName;

export { Switch };
