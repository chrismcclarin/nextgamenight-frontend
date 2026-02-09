/** @type {import('tailwindcss').Config} */
module.exports = {
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
    },
  },
  plugins: [],
}
