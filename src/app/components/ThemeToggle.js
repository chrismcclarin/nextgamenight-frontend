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
    // DECISION Phase 88.3 (§10.1): hovers to `bg-surface-header-hover`, NOT the
    // `bg-surface-hover` the other 38 swept sites took — this row sits on the dark
    // header panel under `text-white` (1.06:1 on warm-50 vs 10.48:1 on warm-700).
    // Full reasoning at NotificationBell.js's marker; pinned by name in
    // `surfaceHoverSweep.test.ts` test 4b. Converging it is a decision, not a cleanup.
    return (
      <button
        onClick={() => setTheme(isDark ? 'light' : 'dark')}
        className="w-full text-left flex items-center gap-3 px-4 py-3 text-white text-sm hover:bg-surface-header-hover active:opacity-75 transition-colors focus:outline-hidden focus-visible:ring-2 focus-visible:ring-focus-ring focus-visible:ring-inset"
        aria-label={ariaLabel}
      >
        {icon}
        {/* Phase 88.3 (Req 8 / §5.9.2): `text-content-muted` dropped — inherits the row's
            `text-white`. Full DECISION marker at `NotificationBell.js`'s row label. */}
        <span className="flex-1">{label || 'Theme'}</span>
      </button>
    )
  }

  return (
    <button
      onClick={() => setTheme(isDark ? 'light' : 'dark')}
      // Phase 88.3 (Req 7 / UI-SPEC §5.8.2): this icon variant shipped with NO focus-visible
      // ring at all — unlike the row variant above — and fell to the UA outline on the
      // warm-800 header. It now carries the same treatment as the row variant, and inherits
      // the amber-400 `--ring` override scoped to the header subtree at `Header.js`'s
      // container. See the DECISION marker at `NotificationBell.js`'s row label.
      className={`p-2 rounded-lg transition-colors hover:bg-white/10 focus:outline-hidden focus-visible:ring-2 focus-visible:ring-focus-ring focus-visible:ring-inset ${className}`}
      aria-label={ariaLabel}
      title={ariaLabel}
    >
      {icon}
    </button>
  )
}
