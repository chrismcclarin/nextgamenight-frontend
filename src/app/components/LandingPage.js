'use client';

import { Button } from '../../components/ui/Button';
import { Heading } from '../../components/ui/Heading';

import DieLogo from './DieLogo';

export default function LandingPage() {
  return (
    <div className="min-h-screen flex flex-col">

      {/* Hero */}
      <div className="bg-surface-nav py-24 px-4">
        <div className="max-w-4xl mx-auto text-center">
          <div className="flex justify-center mb-8">
            <DieLogo size={80} />
          </div>
          {/* DECISION Phase 88.6-35 (D-04 / UI-SPEC §4.4 row 4): this h1 stays a RAW
              `text-5xl md:text-6xl`, chosen OVER migrating it to `<Heading level={1}
              size="display">` with the rest of this file's headings — which is the obvious
              move and the one a future sweep will reach for.

              WHY. Its size is EXEMPT by owner ruling (2026-09-08): Phase 88.9 W55 owns the
              landing hero block's sizes. Migrating it would need a size OVERRIDE on the
              primitive to hold 48/60, which re-introduces both an off-scale value AND a
              breakpoint-grown one INSIDE the primitive's output — strictly worse than leaving
              it raw and rostered where the gate can see it. The exemption is carried by
              `typeScaleTouchedSurfaces.test.ts`'s RUNG_ROSTER and BREAKPOINT_ROSTER entries
              for this file, both under that owner provenance.

              Applying the general rule here is a decision, not a cleanup — it takes a look
              call away from the phase that owns it. */}
          <h1 className="text-5xl md:text-6xl font-bold mb-6 leading-tight text-white">
            Your next game night<br className="hidden sm:block" /> starts here.
          </h1>
          {/* DECISION Phase 88.6-35 (UI-SPEC §4.3 row 1): this hero lede stays at `text-xl`
              (20), chosen OVER folding it to Body 16 the way §4.3 folds every other running-
              prose `<p>` in the tree.

              WHY. 20 IS one of §4.1's five rungs, so no gate reds either way and nothing
              mechanical decides it — it is a ROLE question, not a rung violation. And the
              answer is a LOOK call inside the one block a recorded owner ruling reserves:
              W55 owns the hero, and a −4px lede under a 48/60px h1 changes the hero's
              proportions. The same shape as `ParticipantRow`'s six form labels (plan 29):
              legal rung, debatable role, inside recorded owner tuning → routed, not decided.
              Routed to Phase 88.9 W55 and recorded in `.planning/deferred/phase-88.6.md`.

              Growing or shrinking this is a decision, not a cleanup. */}
          <p className="text-xl text-white/70 mb-10 max-w-2xl mx-auto">
            Find the night your whole group is free. In one glance.
          </p>

          <div className="flex flex-col sm:flex-row gap-4 justify-center items-center">
            {/* DECISION Phase 88.6-35 (UI-SPEC §3.2 asChild row / §3.4 rules 1-3, D-14b):
                this is the file's ONE `.btn` element — MEASURED, `grep -n '\bbtn\b'` returns
                this className and no other. It becomes `<Button asChild variant="primary">`
                wrapping the EXISTING `<a>`, chosen OVER rewriting the child to `<Link>`: this
                href is an Auth0 handoff route, and a client-router navigation to it is a
                behaviour change, not a cleanup.

                The surviving utilities ride on `<Button className>`, NEVER on the slotted
                child — Radix `Slot` concatenates the child's className onto the slot's WITHOUT
                tailwind-merge, so a utility left on the child cannot win a conflict and can
                silently double up (shipped precedent `GroupLibrary.js:184`).

                `hover:shadow-xl` is GONE for two independent reasons with one fix. It is
                OFF-TIER: `--shadow-xl` is declared ZERO times in `globals.css` (re-measured at
                this commit — `grep -c -- '--shadow-xl' src/app/globals.css` → 0), so it fell
                through to Tailwind's inlined black default instead of the re-tinted project
                ladder (D-14b). And it is a BARE `hover:` pin, which re-lifts a gated control
                and does not de-dupe against the primitive's `enabled-hover:` base token, so
                both would have survived the merge. The replacement `enabled-hover:shadow-theme-lg`
                is ALSO what §3.4 rule 2 requires of any site declaring its own
                `shadow-theme-lg`: without it, `Button`'s base `enabled-hover:shadow-theme-md`
                would SHRINK this control's resting `lg` on hover — an inverted elevation.

                DELETED as dead under unlayered `.btn` (globals.css:2194-2205): `px-8 py-4`
                (padding `:2202`), `text-lg` (font-size `:2201`), `font-bold` (weight `:2200`),
                `text-center` (the block is `inline-flex` + `justify-content: center`), and
                `transition-all` — `.btn` declares `transition: var(--theme-transition)`
                (`:2203`), whose value already includes `box-shadow 0.25s ease` (`:1684`), so
                the utility was both dead and redundant. KEPT as alive: `shadow-theme-lg` and
                `w-full sm:w-auto`. */}
            <Button
              asChild
              variant="primary"
              className="shadow-theme-lg enabled-hover:shadow-theme-lg w-full sm:w-auto"
            >
              <a href="/api/auth/login">
                Get Started
              </a>
            </Button>
            {/* DECISION Phase 88.6-35 (D-02 CORRECTED / UI-SPEC §4.3, §13): the Google CTA
                below is NOT swept — not migrated to `<Button>`, not resized, not re-weighted —
                chosen OVER treating it as this file's second `.btn` element, which is what
                `88.6-CONTEXT.md` D-02 and `88.6-UI-SPEC.md` §4.3 `:328` used to say.

                THE RECORD WAS WRONG AND THE FILE IS THE EVIDENCE: its className below carries
                `rounded-btn` and never `btn`, so it is not a `.btn` element at all. Plan 10's
                scanner and RESEARCH §B.1 agree (`LandingPage.js` = 1 `.btn` site, the CTA
                above). §4.3 was amended on 2026-09-09 to match. Its `text-lg px-8 py-4` are
                therefore ALIVE, not dead — deleting them as "dead `.btn` classes" would have
                silently stripped live sizing and geometry off this control.

                ITS SIZE AND ITS LOOK ARE BOTH PHASE 88.9 W55's, under the same owner ruling
                (2026-09-08) that exempts the hero h1 and the h2 below: this is the THIRD W55
                site in this file. Its live 600 weight is rostered under that provenance in
                `typeScaleTouchedSurfaces.test.ts`'s WEIGHT_ROSTER entry for this file — which
                previously read "dead on a .btn (delete)" and is corrected in the same commit
                as this comment.

                AND MIGRATING IT WOULD BREAK THE OI-7 RING DIRECTLY BELOW. `Button`'s cva base
                carries `focus-visible:ring-offset-2`; this element carries `ring-inset`.
                twMerge keeps BOTH (different properties), painting a 2px white band inside the
                amber ring — a focus-indicator degradation `e2e/contrast.spec.ts`'s OI-7 measure
                cannot see, because it measures the ring's contrast, not an offset band. It
                would also impose `.btn` geometry, elevation and variant fill over two explicit
                "this is a decision, not a cleanup" markers.

                Sweeping this element is a decision, not a cleanup. */}
            {/* DECISION Phase 88.3 (Req 7 / UI-SPEC §11 OI-7): this ONE element re-points
                `--ring` to amber-400 for itself, chosen OVER letting Req 7's global light
                ring (`purple-700`) apply here.

                WHY, measured rather than argued. This button's ground is a COMPOSITE, and
                it is the one Req 7 ground that no token holds: `bg-white/20` over the
                hero's `bg-surface-nav` (purple-900) composites to a mid slate. The light
                ring reads **1.07:1** against that — a focus indicator nobody can see, on
                the sign-in control of a logged-out page. amber-400 reads **4.36:1** on the
                same composite. Gate C measures this at 375x667 rather than trusting either
                number (`e2e/contrast.spec.ts`, the OI-7 describe).

                REJECTED, and it is the mistake this comment exists to stop being repeated:
                `[--color-focus-ring:var(--amber-400)]`. It COMPILES and does NOTHING —
                `--color-focus-ring` is declared in `@theme inline`, so Tailwind substitutes
                its VALUE (`var(--ring)`) into the emitted utility, and `--ring` resolves on
                `:root`. Plan 07 already proved this on the header (`globals.css:1070-1075`);
                overriding `--ring` is the only form that works.

                ALSO REJECTED: moving the override up to the hero container, the way
                `Header.js:116` scopes the whole header subtree. The hero's other CTA is
                `btn btn-primary`, whose ring sits on its own offset — it does not need the
                amber and would inherit it silently. This element is the one with the
                composited ground, so this element is where the override belongs.

                Widening or removing this is a decision, not a cleanup. */}
            <a
              href="/api/auth/login?connection=google-oauth2"
              className="bg-white/20 hover:bg-white/30 active:opacity-75 border border-white/30 text-white px-8 py-4 rounded-btn text-lg font-semibold transition-all w-full sm:w-auto text-center flex items-center justify-center gap-3 focus:outline-hidden focus-visible:ring-2 focus-visible:ring-focus-ring focus-visible:ring-inset [--ring:var(--amber-400)]"
            >
              {/* DECISION Phase 88-22 (Req 2): the four fills below stay RAW,
                  chosen OVER converting them to semantic tokens with the rest of
                  this file. They are Google's LOGO ART — the brand blue, green,
                  yellow and red that Google's sign-in branding guidelines
                  require be reproduced exactly, in every theme. This is the same
                  exemption class as DieLogo.js, which the SPEC already names.
                  Tokenizing them would recolour a third party's trademark on a
                  surface tied to our OAuth verification. Not a cleanup. */}
              <svg className="w-5 h-5 shrink-0" viewBox="0 0 24 24">
                <path d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z" fill="#4285F4"/>
                <path d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" fill="#34A853"/>
                <path d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z" fill="#FBBC05"/>
                <path d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" fill="#EA4335"/>
              </svg>
              Sign in with Google
            </a>
          </div>
        </div>
      </div>

      {/* Feature cards */}
      <div className="bg-surface-page flex-1 py-20 px-4">
        <div className="max-w-4xl mx-auto">
          {/* DECISION Phase 88.6-35 (RESEARCH §C.4, Open Question 3): this h2 stays a RAW
              `text-3xl` (30), chosen OVER migrating it to `<Heading level={2} size="heading">`
              (20) with the three card titles below.

              WHY. D-04's heading table has NO row for "h2 @ 30" — §C.4 found that gap, and it
              is a real gap, not an omission this plan may close by preference. Both readings
              are defensible: stay at Display 30, which is an off-ROLE Display on an h2; or
              move to Heading 20, which is a visible −10px on the landing page's one section
              title. That makes it a LOOK call, and look calls on this page belong to Phase
              88.9 W55 by the same owner ruling (2026-09-08) that exempts the hero h1 and the
              Google CTA above.

              IT IS NOT A RUNG VIOLATION, so no roster entry holds it — 30 is §4.1's Display
              rung and the rung scanner checks MEMBERSHIP, not role fit (measured by plan 11,
              which seeded this file's RUNG_ROSTER entry at 1 site for the h1 alone rather than
              the 2 its plan text asserted). This comment is therefore the ONLY thing standing
              between it and the next sweep.

              Resizing this is a decision, not a cleanup. */}
          <h2 className="text-3xl font-bold text-center text-content-primary mb-12">
            Everything your group needs
          </h2>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-8">
            {/* DECISION Phase 88.6-35 (UI-SPEC §4.3 row 4): the `text-4xl` on each of the
                three emoji tiles below is ICON SIZING, not type — §4.3 rules glyph-only spans
                (`×`, `⋮`, `+`, emoji) OUT of the type scale explicitly, so they are left
                alone by this sweep on purpose rather than by omission. Folding them to a type
                rung is a decision, not a cleanup. */}
            <div className="card p-3 md:p-6 hover:shadow-theme-md transition-all border border-line hover:border-line-accent">
              <div className="text-4xl mb-4">🎲</div>
              <Heading level={3} size="heading" className="mb-2 text-content-primary">Track Sessions</Heading>
              <p className="text-content-secondary">
                Record every game night. See when you played, who showed up, and what everyone thought.
              </p>
            </div>

            <div className="card p-3 md:p-6 hover:shadow-theme-md transition-all border border-line hover:border-line-accent">
              <div className="text-4xl mb-4">👥</div>
              <Heading level={3} size="heading" className="mb-2 text-content-primary">Gather Your Crew</Heading>
              <p className="text-content-secondary">
                Coordinate without the group-chat back-and-forth. Availability fills itself in.
              </p>
            </div>

            <div className="card p-3 md:p-6 hover:shadow-theme-md transition-all border border-line hover:border-line-accent">
              <div className="text-4xl mb-4">⭐</div>
              <Heading level={3} size="heading" className="mb-2 text-content-primary">Rate &amp; Remember</Heading>
              <p className="text-content-secondary">
                Review games after you play them. Build your group&apos;s collection of favorites over time.
              </p>
            </div>
          </div>
        </div>
      </div>

    </div>
  );
}
