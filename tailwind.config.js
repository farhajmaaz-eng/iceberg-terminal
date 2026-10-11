/** @type {import('tailwindcss').Config} */
export default {
  darkMode: 'class',
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        // Terminal surfaces: near-black -> charcoal
        surface: {
          0: '#050607',
          1: '#0a0c0f',
          2: '#101317',
          3: '#161a20',
          4: '#1e242c',
        },
        edge: {
          DEFAULT: '#232a33',
          strong: '#2f3945',
          soft: '#1a1f26',
        },
        // Restrained market accents
        bull: '#22c55e',
        bear: '#ef4444',
        amber: '#f59e0b',
        cyan: '#22d3ee',
        dim: '#6b7684',
      },
      fontFamily: {
        sans: [
          'Inter',
          'ui-sans-serif',
          'system-ui',
          '-apple-system',
          'Segoe UI',
          'Roboto',
          'Helvetica Neue',
          'Arial',
          'sans-serif',
        ],
        mono: [
          'JetBrains Mono',
          'ui-monospace',
          'SFMono-Regular',
          'Menlo',
          'Consolas',
          'Liberation Mono',
          'monospace',
        ],
      },
      fontSize: {
        '2xs': ['0.6875rem', { lineHeight: '1rem' }],
      },
      spacing: {
        panel: '2.25rem',
      },
      keyframes: {
        'flash-up': {
          '0%': { backgroundColor: 'rgba(34,197,94,0.22)' },
          '100%': { backgroundColor: 'transparent' },
        },
        'flash-down': {
          '0%': { backgroundColor: 'rgba(239,68,68,0.22)' },
          '100%': { backgroundColor: 'transparent' },
        },
        'marquee-up': {
          '0%': { transform: 'translateY(0)' },
          '100%': { transform: 'translateY(-50%)' },
        },
        'pulse-dim': {
          '0%, 100%': { opacity: '1' },
          '50%': { opacity: '0.45' },
        },
      },
      animation: {
        'flash-up': 'flash-up 700ms ease-out',
        'flash-down': 'flash-down 700ms ease-out',
        'pulse-dim': 'pulse-dim 1.6s ease-in-out infinite',
      },
    },
  },
  plugins: [],
};