'use client'
import { useState } from 'react';
import Link from 'next/link'
import { useUser } from '@auth0/nextjs-auth0/client';

function Header(){
    const { user, error, isLoading } = useUser();
    const [mobileMenuOpen, setMobileMenuOpen] = useState(false);

    if (isLoading) return <div>Loading...</div>;
    if (error) return <div>{error.message}</div>;

    if (user) {
        return (
            <div className="w-full h-20 bg-emerald-800 sticky top-0 z-50">
                <div className="w-full max-w-full px-4 h-full">
                    <div className="flex justify-between items-center h-full">
                        <h1 className='text-xl md:text-2xl'>Periodic Tabletop!</h1>
                        {/* Desktop Menu */}
                        <ul className='hidden md:flex gap-x-6 text-white'>
                            <li><a href="/api/auth/logout">Logout</a></li>
                            <li><Link href="/userProfile/">Profile</Link></li>
                            <li><Link href="/">Home</Link></li>
                        </ul>
                        {/* Mobile Menu Button */}
                        <button
                            className="md:hidden text-white p-2"
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
                    {/* Mobile Menu Dropdown */}
                    {mobileMenuOpen && (
                        <div className="md:hidden absolute top-20 left-0 right-0 bg-emerald-800 border-t border-emerald-700 shadow-lg">
                            <ul className="flex flex-col py-2">
                                <li>
                                    <Link 
                                        href="/" 
                                        className="block px-4 py-3 text-white hover:bg-emerald-700 transition-colors"
                                        onClick={() => setMobileMenuOpen(false)}
                                    >
                                        Home
                                    </Link>
                                </li>
                                <li>
                                    <Link 
                                        href="/userProfile/" 
                                        className="block px-4 py-3 text-white hover:bg-emerald-700 transition-colors"
                                        onClick={() => setMobileMenuOpen(false)}
                                    >
                                        Profile
                                    </Link>
                                </li>
                                <li>
                                    <a 
                                        href="/api/auth/logout" 
                                        className="block px-4 py-3 text-white hover:bg-emerald-700 transition-colors"
                                        onClick={() => setMobileMenuOpen(false)}
                                    >
                                        Logout
                                    </a>
                                </li>
                            </ul>
                        </div>
                    )}
                </div>
            </div>
        )
    }
    return (
        <div className="w-full h-20 bg-emerald-800 sticky top-0 z-50">
            <div className="w-full max-w-full px-4 h-full">
                <div className="flex justify-between items-center h-full">
                    <h1 className='text-xl md:text-2xl'>Periodic Tabletop!</h1>
                    {/* Desktop Menu */}
                    <ul className='hidden md:flex gap-x-6 text-white'>
                        <li><a href="/api/auth/login">Login</a></li>
                        <li><Link href="/userProfile/">Profile</Link></li>
                        <li><Link href="/">Home</Link></li>
                    </ul>
                    {/* Mobile Menu Button */}
                    <button
                        className="md:hidden text-white p-2"
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
                {/* Mobile Menu Dropdown */}
                {mobileMenuOpen && (
                    <div className="md:hidden absolute top-20 left-0 right-0 bg-emerald-800 border-t border-emerald-700 shadow-lg">
                        <ul className="flex flex-col py-2">
                            <li>
                                <Link 
                                    href="/" 
                                    className="block px-4 py-3 text-white hover:bg-emerald-700 transition-colors"
                                    onClick={() => setMobileMenuOpen(false)}
                                >
                                    Home
                                </Link>
                            </li>
                            <li>
                                <Link 
                                    href="/userProfile/" 
                                    className="block px-4 py-3 text-white hover:bg-emerald-700 transition-colors"
                                    onClick={() => setMobileMenuOpen(false)}
                                >
                                    Profile
                                </Link>
                            </li>
                            <li>
                                <a 
                                    href="/api/auth/login" 
                                    className="block px-4 py-3 text-white hover:bg-emerald-700 transition-colors"
                                    onClick={() => setMobileMenuOpen(false)}
                                >
                                    Login
                                </a>
                            </li>
                        </ul>
                    </div>
                    )}
            </div>
        </div>
    )
}

export default Header;