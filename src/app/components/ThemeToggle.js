'use client'
import { useTheme } from 'next-themes'
import { useState, useEffect } from 'react'

export default function ThemeToggle({ className = '', variant = 'icon', label }) {
  const { setTheme, resolvedTheme } = useTheme()
  const [mounted, setMounted] = useState(false)

  useEffect(() => setMounted(true), [])

  if (!mounted) return <div className="w-8 h-8" />

  const isDark = resolvedTheme === 'dark'
  const ariaLabel = `Switch to ${isDark ? 'light' : 'dark'} mode`

  const icon = isDark ? (
    <svg className="w-5 h-5 text-amber-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2} aria-hidden="true">
      <path strokeLinecap="round" strokeLinejoin="round" d="M12 3v1m0 16v1m9-9h-1M4 12H3m15.364 6.364l-.707-.707M6.343 6.343l-.707-.707m12.728 0l-.707.707M6.343 17.657l-.707.707M16 12a4 4 0 11-8 0 4 4 0 018 0z" />
    </svg>
  ) : (
    <svg className="w-5 h-5 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2} aria-hidden="true">
      <path strokeLinecap="round" strokeLinejoin="round" d="M20.354 15.354A9 9 0 018.646 3.646 9.003 9.003 0 0012 21a9.003 9.003 0 008.354-5.646z" />
    </svg>
  )

  if (variant === 'row') {
    // Full-width row hit area — entire surface toggles theme.
    // Mirrors NotificationBell row variant for parity in mobile hamburger.
    return (
      <button
        onClick={() => setTheme(isDark ? 'light' : 'dark')}
        className="w-full text-left flex items-center gap-3 px-4 py-3 text-white text-sm hover:bg-surface-card-hover active:bg-surface-card-hover transition-colors"
        aria-label={ariaLabel}
      >
        {icon}
        <span className="text-content-muted flex-1">{label || 'Theme'}</span>
      </button>
    )
  }

  return (
    <button
      onClick={() => setTheme(isDark ? 'light' : 'dark')}
      className={`p-2 rounded-lg transition-colors hover:bg-white/10 ${className}`}
      aria-label={ariaLabel}
      title={ariaLabel}
    >
      {icon}
    </button>
  )
}
