'use client'
import { useState } from 'react';
import Link from 'next/link'
import { useUser } from '@auth0/nextjs-auth0/client';
import DieLogo from './components/DieLogo';
import NotificationBell from './components/NotificationBell';
import ThemeToggle from './components/ThemeToggle';

function Header(){
    const { user, error, isLoading } = useUser();
    const [mobileMenuOpen, setMobileMenuOpen] = useState(false);

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
        <div className="w-full h-16 bg-surface-header border-b border-line-strong sticky top-0 z-50">
            <div className="w-full max-w-7xl mx-auto px-4 h-full">
                <div className="flex justify-between items-center h-full">
                    {/* Brand */}
                    <Link href="/" className="flex items-center gap-2.5 text-content-inverse hover:opacity-90 transition-opacity">
                        <DieLogo size={34} />
                        <span className="text-lg md:text-xl font-bold tracking-tight text-content-inverse">
                            Next Game Night
                        </span>
                    </Link>

                    {/* Desktop nav */}
                    <ul className="hidden md:flex gap-x-6 items-center text-content-inverse text-sm font-medium">
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
                        className="md:hidden text-content-inverse p-2 hover:text-accent transition-colors"
                        onClick={() => setMobileMenuOpen(!mobileMenuOpen)}
                        aria-label="Toggle menu"
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

                {/* Mobile dropdown */}
                {mobileMenuOpen && (
                    <div className="md:hidden absolute top-16 left-0 right-0 bg-surface-header border-t border-line-header border-b border-line-accent shadow-lg">
                        <ul className="flex flex-col py-2">
                            {navLinks.map(({ href, label, isLink }) => (
                                <li key={label}>
                                    {isLink ? (
                                        <Link
                                            href={href}
                                            className="block px-4 py-3 text-content-inverse hover:text-accent hover:bg-surface-header-hover transition-colors"
                                            onClick={() => setMobileMenuOpen(false)}
                                        >
                                            {label}
                                        </Link>
                                    ) : (
                                        <a
                                            href={href}
                                            className="block px-4 py-3 text-content-inverse hover:text-accent hover:bg-surface-header-hover transition-colors"
                                            onClick={() => setMobileMenuOpen(false)}
                                        >
                                            {label}
                                        </a>
                                    )}
                                </li>
                            ))}
                        </ul>
                        {/* Mobile notification bell */}
                        {user && (
                            <div className="px-4 py-3 border-t border-line-header">
                                <div className="flex items-center gap-3 text-content-inverse text-sm">
                                    <NotificationBell user={user} />
                                    <span className="text-content-muted">Invites</span>
                                </div>
                            </div>
                        )}
                        {/* Mobile theme toggle */}
                        <div className="px-4 py-3 border-t border-line-header">
                            <div className="flex items-center gap-3 text-content-inverse text-sm">
                                <ThemeToggle />
                                <span className="text-content-muted">Theme</span>
                            </div>
                        </div>
                    </div>
                )}
            </div>
        </div>
    );
}

export default Header;
