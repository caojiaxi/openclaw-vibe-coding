/** @type {import('tailwindcss').Config} */
export default {
  content: ['./src/client/**/*.{html,tsx,ts}'],
  theme: {
    extend: {
      colors: {
        claw: {
          900: '#0a0e1a',
          800: '#111827',
          700: '#1e293b',
          600: '#334155',
          500: '#475569',
          accent: '#6366f1',
          'accent-light': '#818cf8',
          gold: '#f59e0b',
          'gold-light': '#fbbf24',
          red: '#ef4444',
          green: '#22c55e',
        },
      },
      fontFamily: {
        sans: ['Inter', 'system-ui', 'sans-serif'],
        mono: ['JetBrains Mono', 'monospace'],
      },
    },
  },
  plugins: [],
};
