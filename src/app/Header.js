'use client'
import { useState, useEffect, useRef } from 'react';
import Link from 'next/link'
import { useUser } from '@auth0/nextjs-auth0/client';
import DieLogo from './components/DieLogo';
import NotificationBell from './components/NotificationBell';
import ThemeToggle from './components/ThemeToggle';

function Header(){
    const { user, error, isLoading } = useUser();
    const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
    const triggerRef = useRef(null);
    const wasOpenRef = useRef(false);

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
            { href: '/', label: 'Home', isLink: true },
            { href: '/api/auth/login', label: 'Login', isLink: false },
          ];

    return (
        <>
            {/* Dim backdrop — sibling of the header so it sits above the page
                but below the menu in z-order. Rendered unconditionally with
                class-toggle so the fade animation plays on both directions.
                pointer-events-none on closed state ensures it never eats clicks. */}
            <div
                className={`md:hidden fixed inset-0 bg-black/60 backdrop-blur-sm z-40 transition-opacity duration-200 ease-out ${
                    mobileMenuOpen
                        ? 'opacity-100'
                        : 'opacity-0 pointer-events-none'
                }`}
                onClick={() => setMobileMenuOpen(false)}
                aria-hidden="true"
            />

            <div className="w-full h-16 bg-surface-header border-b border-line-strong sticky top-0 z-50">
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

                        {/* Mobile menu button */}
                        <button
                            ref={triggerRef}
                            className="md:hidden text-white p-2 hover:text-accent transition-colors"
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
                        </button>
                    </div>

                    {/* Mobile dropdown — rendered unconditionally with class-toggle so
                        BOTH open and close animations play (mount/unmount strips the
                        element before CSS transition can run, killing the exit animation).
                        pointer-events-none on closed state prevents the off-screen menu
                        from eating clicks on the page below. */}
                    <div
                        className={`md:hidden absolute top-16 left-0 right-0 bg-surface-header border-t border-line-header border-b border-line-accent shadow-lg transition-all duration-200 ease-out ${
                            mobileMenuOpen
                                ? 'translate-y-0 opacity-100'
                                : '-translate-y-full opacity-0 pointer-events-none'
                        }`}
                    >
                        <ul className="flex flex-col py-2">
                            {navLinks.map(({ href, label, isLink }) => (
                                <li key={label}>
                                    {isLink ? (
                                        <Link
                                            href={href}
                                            className="block px-4 py-3 text-white hover:text-accent hover:bg-surface-header-hover transition-colors"
                                            onClick={() => setMobileMenuOpen(false)}
                                        >
                                            {label}
                                        </Link>
                                    ) : (
                                        <a
                                            href={href}
                                            className="block px-4 py-3 text-white hover:text-accent hover:bg-surface-header-hover transition-colors"
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
                            press-state via bg-surface-card-hover. Outer div is just a
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
                    </div>
                </div>
            </div>
        </>
    );
}

export default Header;
