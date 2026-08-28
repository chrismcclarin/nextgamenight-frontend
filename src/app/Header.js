'use client'
import { useState, useEffect, useRef } from 'react';
import Link from 'next/link'
import { useUser } from '@auth0/nextjs-auth0/client';
import DieLogo from './components/DieLogo';
import NotificationBell from './components/NotificationBell';
import ThemeToggle from './components/ThemeToggle';
import { useUnreadNotificationCount } from './components/UnreadNotificationProvider';
import FeedbackButton from './components/FeedbackButton';

function Header(){
    const { user, error, isLoading } = useUser();
    const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
    const triggerRef = useRef(null);
    const wasOpenRef = useRef(false);

    // MOB-08 (Plan 77-01): mobile hamburger unread-indicator dot.
    // Same totalCount source as the in-menu bell badge — the
    // UnreadNotificationProvider (mounted in app/layout.js) owns the
    // single pending-invites fetch + the friend-request count. Hook is
    // safe to call here even when logged out (provider returns
    // totalCount = 0 in that case); gating the render below on
    // `user && totalCount > 0` handles the logged-out case explicitly.
    const { totalCount } = useUnreadNotificationCount();

    // Escape closes the mobile hamburger menu while it's open.
    // Reuses the FeedbackButton.js:41-50 idiom (document keydown listener,
    // attached only while open, cleaned up on close/unmount).
    // Scope-limited per CONTEXT D-01: closes hamburger only — no app-wide
    // escape-sweep event (no current consumers; YAGNI).
    useEffect(() => {
        if (!mobileMenuOpen) return;

        function handleKeyDown(e) {
            if (e.key === 'Escape') {
                setMobileMenuOpen(false);
            }
        }

        document.addEventListener('keydown', handleKeyDown);
        return () => document.removeEventListener('keydown', handleKeyDown);
    }, [mobileMenuOpen]);

    // Focus restore: when the menu transitions from open → closed,
    // return keyboard focus to the hamburger trigger button.
    // Guard with wasOpenRef so the focus call doesn't fire on initial mount.
    useEffect(() => {
        if (wasOpenRef.current && !mobileMenuOpen) {
            triggerRef.current?.focus();
        }
        wasOpenRef.current = mobileMenuOpen;
    }, [mobileMenuOpen]);

    if (isLoading) return <div className="w-full h-16 bg-surface-header" />;
    if (error) return <div>{error.message}</div>;

    const navLinks = user
        ? [
            { href: '/', label: 'Home', isLink: true },
            { href: '/friends', label: 'Friends', isLink: true },
            { href: '/userProfile/', label: 'Profile', isLink: true },
            { href: '/api/auth/logout', label: 'Logout', isLink: false },
          ]
        : [
            { href: '/api/auth/login', label: 'Login', isLink: false },
          ];

    return (
        <>
            {/* Dim backdrop — sibling of the header so it sits above the page
                but below the menu in z-order. Rendered unconditionally with
                class-toggle so the fade animation plays on both directions.
                pointer-events-none on closed state ensures it never eats clicks. */}
            <div
                className={`md:hidden fixed inset-0 bg-black/60 backdrop-blur-xs z-40 transition-opacity duration-200 ease-out ${
                    mobileMenuOpen
                        ? 'opacity-100'
                        : 'opacity-0 pointer-events-none'
                }`}
                onClick={() => setMobileMenuOpen(false)}
                aria-hidden="true"
            />

            {/* DECISION Phase 88.3 (Req 7 / UI-SPEC §5.8.2): the focus ring is scoped to
                amber-400 for this whole header subtree — chosen OVER letting Req 7's global
                light-mode ring (purple-700) apply here.

                MEASURED BASIS: the header/nav chrome is DARK IN BOTH THEMES — a deliberate,
                shipped choice (`globals.css` `--color-bg-header`: warm-800 light / warm-900
                dark; `--color-bg-nav`: purple-900; recorded as "intentional, keep" in
                `.planning/research/DESIGN-SYSTEM-REFERENCE-2026.md:59-60`). Against that dark
                ground Req 7's purple-700 ring reads 1.93:1 on warm-800, 1.78:1 on purple-900
                and 1.38:1 on warm-700 (header-hover) — all below WCAG 2.4.11's 3:1 floor. The
                value dark mode already uses, amber-400, reads 9.00 / 8.30 / 6.27 on those same
                three grounds. Everything inside this container inherits it, including the two
                desktop icon-only triggers (NotificationBell / ThemeToggle) that gained their
                first focus-visible ring in this same plan.

                Rejected — overriding `--color-focus-ring` here instead of `--ring`. That shape
                looks like the shipped `EventScheduler.tsx:228-236` precedent but is INERT on
                this chain. That precedent overrides a ONE-hop alias; this ring chain is TWO
                hops (`--color-focus-ring` -> `--ring` -> the emitted `--tw-ring-color`), and
                `--ring: var(--color-focus-ring)` is declared on `:root`, so its `var()` is
                substituted at computed-value time THERE and descendants inherit an
                already-resolved hex. Compiled against this project's own tailwindcss@4.3.3, the
                consumer utility emits `.focus-visible\:ring-focus-ring:focus-visible {
                --tw-ring-color: var(--ring); }` — it reads `--ring`, never
                `--color-focus-ring`. A descendant override of the latter compiles cleanly, goes
                green in every gate that only checks the class string, and changes nothing on
                screen. `darkChromeLegibility.test.ts` test 2 asserts that shape is absent.

                Rejected — a `dark:` variant fix. Useless here: the ground is dark in BOTH
                themes, so there is no light/dark fork to hang the fix on.

                Changing either of these is a decision, not a cleanup. */}
            <div className="w-full h-16 bg-surface-header border-b border-line-strong sticky top-0 z-50 [--ring:var(--amber-400)]">
                <div className="w-full max-w-7xl mx-auto px-4 h-full">
                    <div className="flex justify-between items-center h-full">
                        {/* Brand */}
                        <Link href="/" className="flex items-center gap-2.5 text-white hover:opacity-90 transition-opacity">
                            <DieLogo size={34} />
                            <span className="text-lg md:text-xl font-bold tracking-tight text-white">
                                Next Game Night
                            </span>
                        </Link>

                        {/* Desktop nav */}
                        <ul className="hidden md:flex gap-x-6 items-center text-white text-sm font-medium">
                            {navLinks.map(({ href, label, isLink }, index) => (
                                <li key={label} className="flex items-center gap-x-6">
                                    {isLink ? (
                                        <Link
                                            href={href}
                                            className="hover:text-accent transition-colors"
                                        >
                                            {label}
                                        </Link>
                                    ) : (
                                        <a
                                            href={href}
                                            className="hover:text-accent transition-colors"
                                        >
                                            {label}
                                        </a>
                                    )}
                                    {/* Insert NotificationBell after Profile (second item for logged-in users) */}
                                    {user && label === 'Profile' && (
                                        <NotificationBell user={user} />
                                    )}
                                </li>
                            ))}
                            <li><ThemeToggle /></li>
                        </ul>

                        {/* Mobile menu button — `relative` parent lets the
                            MOB-08 unread-indicator dot absolutely position
                            over the hamburger icon's top-right corner.

                            DECISION Phase 88-28 (Req 4): `p-2.5` chosen OVER `p-2` (10 + 24 + 10
                            = 44x44, up from 8 + 24 + 8 = 40x40) and OVER the invisible
                            `after:-inset-0.5` hit extension used at `ClickableMemberName` and
                            `GameComboInput`. The pseudo-element technique exists for controls
                            that must stay small TO THE EYE inside a text line; nothing here
                            constrains this button's visible size — it has no background, so
                            growing its padding is invisible — and the extension would leave the
                            button's own box at 40x40, which a `boundingBox()` assertion (plan
                            88-30) would read as still failing. Layout cost is 4px in a
                            `justify-between` row inside an `h-16` header: the icon shifts 2px
                            left of the container's `px-4` edge and nothing reflows.
                            87.8-08 logged this as a "40x40 FAIL" by arithmetic and RESEARCH
                            flagged it as assumption A7 (never measured in a browser); 88-30's
                            e2e is what settles it. Going back to `p-2` is a decision. */}
                        <button
                            ref={triggerRef}
                            className="relative md:hidden text-white p-2.5 hover:text-accent active:opacity-75 transition-colors focus:outline-hidden focus-visible:ring-2 focus-visible:ring-focus-ring focus-visible:ring-inset"
                            onClick={() => setMobileMenuOpen(!mobileMenuOpen)}
                            aria-label="Toggle menu"
                            aria-expanded={mobileMenuOpen}
                        >
                            <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                {mobileMenuOpen ? (
                                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                                ) : (
                                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6h16M4 12h16M4 18h16" />
                                )}
                            </svg>

                            {/* MOB-08: unread-notification dot.
                                - bg-red-500 matches NotificationBell badge token verbatim.
                                - rounded-full matches the bell badge shape language.
                                - h-2.5 w-2.5 (~10px) reads as a dot, not a numeric badge.
                                - absolute top-1.5 right-1.5 positions inside the button's p-2.5
                                  padding so the dot sits at the hamburger icon's top-right
                                  corner without overflowing the tap surface. Phase 88-28 moved
                                  BOTH together (p-2 -> p-2.5, top-1/right-1 -> top-1.5/right-1.5):
                                  the dot's offset is measured from the button's border box, so
                                  raising the padding without raising the inset would push the
                                  dot 2px further from the icon corner it is meant to sit on.
                                - ring-2 ring-surface-header gives the dot a header-bg halo
                                  so it visually separates from the white hamburger lines
                                  (Slack/Discord/Linear pattern).
                                - aria-hidden because it's decorative; the menu contents
                                  announce the unread state to screen readers, and the
                                  button's aria-label "Toggle menu" stays unchanged.
                                - Inherits md:hidden from the parent button — desktop
                                  renders zero hamburger UI and therefore zero dot.
                                - No animation per CONTEXT D (badge appears/disappears
                                  instantly when count crosses 0). */}
                            {user && totalCount > 0 && (
                                <span
                                    className="absolute top-1.5 right-1.5 h-2.5 w-2.5 rounded-full bg-red-500 ring-2 ring-surface-header"
                                    aria-hidden="true"
                                />
                            )}
                        </button>
                    </div>

                    {/* Mobile dropdown — rendered unconditionally with class-toggle so
                        BOTH open and close animations play (mount/unmount strips the
                        element before CSS transition can run, killing the exit animation).
                        pointer-events-none on closed state prevents the off-screen menu
                        from eating clicks on the page below. */}
                    {/* DECISION Phase 88.3 (Req 7 / UI-SPEC §5.8.2): the same amber-400 ring
                        override as the header container above. This panel is a separate
                        subtree root — it is `absolute`-positioned but still a DOM descendant
                        of the header container, so strictly it would inherit; the override is
                        repeated here so the panel keeps a legible ring if it is ever hoisted
                        or portalled out. Same measured basis (purple-700 = 1.93:1 on warm-800,
                        amber-400 = 9.00:1), same two Rejected alternatives: NOT `--color-focus-ring`
                        (inert — `--ring` resolves on `:root`; see the container's marker), and
                        NOT a `dark:` variant (the ground is dark in both themes). That is a
                        decision, not a cleanup.

                        DECISION Phase 88.3 (owner ruling R3-D, 2026-08-25): `inert` while the
                        menu is CLOSED — chosen OVER a conditional mount (Rejected). The comment directly
                        above establishes why this panel renders unconditionally: mount/unmount
                        strips the element before the CSS transition can run, killing the exit
                        animation. But "hidden" here is only `-translate-y-full opacity-0
                        pointer-events-none`, none of which removes anything from the Tab
                        order — so all three rows inside (each carrying `focus:outline-hidden`)
                        stayed keyboard-reachable while invisible, and a keyboard user tabbing
                        past the closed hamburger landed on rows they could not see. `inert`
                        removes the subtree from the a11y tree and the Tab order without
                        touching the mount the exit animation needs; a conditional mount would
                        fix the Tab order by re-breaking the animation. React 18.2.0 here, so
                        the empty-string attribute form is required (React 19 would accept a
                        boolean `inert` prop). That is a decision, not a cleanup. */}
                    <div
                        className={`md:hidden absolute top-16 left-0 right-0 bg-surface-header border-t border-line-header border-b border-line-accent shadow-lg transition-all duration-200 ease-out [--ring:var(--amber-400)] ${
                            mobileMenuOpen
                                ? 'translate-y-0 opacity-100'
                                : '-translate-y-full opacity-0 pointer-events-none'
                        }`}
                        inert={mobileMenuOpen ? undefined : ''}
                    >
                        <ul className="flex flex-col py-2">
                            {navLinks.map(({ href, label, isLink }) => (
                                <li key={label}>
                                    {isLink ? (
                                        <Link
                                            href={href}
                                            className="block px-4 py-3 text-white hover:text-accent hover:bg-surface-header-hover active:opacity-75 transition-colors focus:outline-hidden focus-visible:ring-2 focus-visible:ring-focus-ring focus-visible:ring-inset"
                                            onClick={() => setMobileMenuOpen(false)}
                                        >
                                            {label}
                                        </Link>
                                    ) : (
                                        <a
                                            href={href}
                                            className="block px-4 py-3 text-white hover:text-accent hover:bg-surface-header-hover active:opacity-75 transition-colors focus:outline-hidden focus-visible:ring-2 focus-visible:ring-focus-ring focus-visible:ring-inset"
                                            onClick={() => setMobileMenuOpen(false)}
                                        >
                                            {label}
                                        </a>
                                    )}
                                </li>
                            ))}
                        </ul>
                        {/* Mobile notification bell — full-row tap surface (MOB-02 + MOB-03).
                            variant="row" makes the entire button the hit target with
                            press-state via an instant opacity dim (Phase 87.8 D-12
                            converged idiom). Outer div is just a
                            non-interactive border container; the inner <button> is the
                            actual tap surface. */}
                        {user && (
                            <div className="border-t border-line-header">
                                <NotificationBell user={user} variant="row" label="Invites" />
                            </div>
                        )}
                        {/* Mobile theme toggle — full-row tap target for parity with Invites row */}
                        <div className="border-t border-line-header">
                            <ThemeToggle variant="row" label="Theme" />
                        </div>
                        {/* Mobile feedback entry point (Phase 87.8 D-09) — full-row
                            tap surface for parity with Invites/Theme. Only the
                            TRIGGER lives here: the modal deliberately does NOT
                            render in this dropdown (its computed `translate` would
                            capture a fixed-position overlay as its containing
                            block) — the row drives the modal instance mounted at
                            the layout root via FeedbackModalProvider. onOpen closes
                            this menu in the SAME transition that opens the modal,
                            the close-on-tap idiom the nav links above use. Gated on
                            user like the Invites row — feedback is auth-only. */}
                        {user && (
                            <div className="border-t border-line-header">
                                {/* invokerRef (Phase 88.3-17, owner ruling 6 /
                                    DEF-88.3-12-01): the modal restores focus to
                                    the hamburger toggle, NOT to this row — this
                                    row sits inside the panel R3-D disables in
                                    the same transition `onOpen` fires, and a
                                    control inside a disabled subtree cannot take
                                    focus. R3-D itself is untouched; the full
                                    DECISION marker with both rejected
                                    alternatives is at the row variant's onClick
                                    in FeedbackButton.js. */}
                                <FeedbackButton
                                    variant="row"
                                    label="Send feedback"
                                    onOpen={() => setMobileMenuOpen(false)}
                                    invokerRef={triggerRef}
                                />
                            </div>
                        )}
                    </div>
                </div>
            </div>
        </>
    );
}

export default Header;
