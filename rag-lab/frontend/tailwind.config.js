import { createRequire } from 'node:module'
const require = createRequire(import.meta.url)
/** @type {import('tailwindcss').Config} */
export default {
  darkMode: 'class',
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      fontFamily: {
        sans: ['"Inter Variable"', 'Inter', 'ui-sans-serif', 'system-ui', 'sans-serif'],
        mono: ['"JetBrains Mono"', 'ui-monospace', 'SFMono-Regular', 'Menlo', 'monospace'],
      },
      colors: {
        bg: 'rgb(var(--bg) / <alpha-value>)',
        surface: 'rgb(var(--surface) / <alpha-value>)',
        elevated: 'rgb(var(--elevated) / <alpha-value>)',
        line: 'rgb(var(--line) / <alpha-value>)',
        fg: 'rgb(var(--fg) / <alpha-value>)',
        muted: 'rgb(var(--muted) / <alpha-value>)',
        subtle: 'rgb(var(--subtle) / <alpha-value>)',
        accent: 'rgb(var(--accent) / <alpha-value>)',
        brand: 'rgb(var(--brand) / <alpha-value>)',
        onbrand: 'rgb(var(--on-brand) / <alpha-value>)',
        navy: 'rgb(var(--navy) / <alpha-value>)',
        paneA: 'rgb(var(--pane-a) / <alpha-value>)',
        paneB: 'rgb(var(--pane-b) / <alpha-value>)',
        paneC: 'rgb(var(--pane-c) / <alpha-value>)',
        good: 'rgb(var(--good) / <alpha-value>)',
        bad: 'rgb(var(--bad) / <alpha-value>)',
        warn: 'rgb(var(--warn) / <alpha-value>)',
      },
      boxShadow: {
        // popovers/menus: a hairline plus a short, tight drop
        glow: '0 0 0 1px rgb(var(--line)), 0 4px 12px -2px rgb(0 0 0 / 0.10)',
        card: '0 1px 2px 0 rgb(0 0 0 / 0.05)',
      },
      borderRadius: {
        md: '3px',
        lg: '5px',
        xl: '6px',
        '2xl': '8px',
      },
      keyframes: {
        pulsering: { '0%,100%': { boxShadow: '0 0 0 0 rgb(var(--ring) / 0.55)' }, '50%': { boxShadow: '0 0 0 5px rgb(var(--ring) / 0)' } },
        shimmer: { '100%': { transform: 'translateX(100%)' } },
        flash: { '0%': { backgroundColor: 'rgb(var(--accent) / 0.28)' }, '100%': { backgroundColor: 'transparent' } },
      },
      animation: {
        pulsering: 'pulsering 1.2s ease-in-out infinite',
        shimmer: 'shimmer 1.6s infinite',
        flash: 'flash 1.6s ease-out',
      },
    },
  },
  plugins: [require('@tailwindcss/container-queries')],
}
