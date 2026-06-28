/** @type {import('tailwindcss').Config} */
module.exports = {
  darkMode: 'class',
  content: [
    './src/pages/**/*.{js,ts,jsx,tsx,mdx}',
    './src/components/**/*.{js,ts,jsx,tsx,mdx}',
    './src/app/**/*.{js,ts,jsx,tsx,mdx}',
  ],
  safelist: [
    // Heatmap intensity colors (prevent purging)
    'bg-gray-100',
    'bg-yellow-200',
    'bg-yellow-400',
    'bg-orange-400',
    'bg-red-500',
    'border-gray-300',
    'border-yellow-400',
    'border-yellow-500',
    'border-orange-500',
    'border-red-600',
  ],
  theme: {
    extend: {
      backgroundImage: {
        'gradient-radial': 'radial-gradient(var(--tw-gradient-stops))',
        'gradient-conic':
          'conic-gradient(from 180deg at 50% 50%, var(--tw-gradient-stops))',
      },
      colors: {
        surface: {
          page: 'var(--color-bg-page)',
          card: 'var(--color-bg-card)',
          'card-hover': 'var(--color-bg-card-hover)',
          elevated: 'var(--color-bg-elevated)',
          input: 'var(--color-bg-input)',
          nav: 'var(--color-bg-nav)',
          'nav-hover': 'var(--color-bg-nav-hover)',
          header: 'var(--color-bg-header)',
          'header-hover': 'var(--color-bg-header-hover)',
        },
        content: {
          primary: 'var(--color-text-primary)',
          secondary: 'var(--color-text-secondary)',
          muted: 'var(--color-text-muted)',
          inverse: 'var(--color-text-inverse)',
          link: 'var(--color-text-link)',
          'link-hover': 'var(--color-text-link-hover)',
        },
        accent: {
          DEFAULT: 'var(--color-accent)',
          hover: 'var(--color-accent-hover)',
          text: 'var(--color-accent-text)',
          foreground: 'var(--accent-foreground)',
        },
        // shadcn/ui color bridge — direct var() (the bridge vars hold full color
        // VALUES, not hsl() channels), aliased onto the existing palette in globals.css.
        border: 'var(--border)',
        input: 'var(--input)',
        ring: 'var(--ring)',
        background: 'var(--background)',
        foreground: 'var(--foreground)',
        primary: {
          DEFAULT: 'var(--primary)',
          foreground: 'var(--primary-foreground)',
        },
        secondary: {
          DEFAULT: 'var(--secondary)',
          foreground: 'var(--secondary-foreground)',
        },
        destructive: {
          DEFAULT: 'var(--destructive)',
          foreground: 'var(--destructive-foreground)',
        },
        muted: {
          DEFAULT: 'var(--muted)',
          foreground: 'var(--muted-foreground)',
        },
        popover: {
          DEFAULT: 'var(--popover)',
          foreground: 'var(--popover-foreground)',
        },
        card: {
          DEFAULT: 'var(--card)',
          foreground: 'var(--card-foreground)',
        },
        line: {
          DEFAULT: 'var(--color-border)',
          strong: 'var(--color-border-strong)',
          accent: 'var(--color-border-accent)',
          header: 'var(--color-border-header)',
        },
        btn: {
          'primary': 'var(--color-btn-primary-bg)',
          'primary-hover': 'var(--color-btn-primary-hover)',
          'primary-text': 'var(--color-btn-primary-text)',
          'secondary': 'var(--color-btn-secondary-bg)',
          'secondary-hover': 'var(--color-btn-secondary-hover)',
          'secondary-text': 'var(--color-btn-secondary-text)',
        },
        status: {
          success: 'var(--color-success)',
          error: 'var(--color-error)',
          warning: 'var(--color-warning)',
        },
        focus: {
          ring: 'var(--color-focus-ring)',
        },
        cream: '#fef9ef',
      },
      borderRadius: {
        'card': '12px',
        'btn': '8px',
      },
      boxShadow: {
        'theme-sm': 'var(--shadow-sm)',
        'theme-md': 'var(--shadow-md)',
        'theme-lg': 'var(--shadow-lg)',
      },
    },
  },
  plugins: [require('tailwindcss-animate')],
}
