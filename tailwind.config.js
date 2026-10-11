/** @type {import('tailwindcss').Config} */
export default {
  darkMode: 'class',
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        // Terminal surfaces: near-black -> charcoal.
        // Each step is a real, perceptible step. Flat panels on identical
        // values read as an unfinished mock; these are tuned so a panel, a
        // header and a hover row are visibly distinct surfaces.
        surface: {
          0: '#05070a', // app backdrop
          1: '#0a0d12', // panel body
          2: '#10141b', // panel header / inset
          3: '#171c25', // raised: inputs, hover rows
          4: '#212836', // raised further: active, selected
        },
        edge: {
          DEFAULT: '#1e242e', // hairline separators
          strong: '#2b3441', // emphasised borders
          soft: '#151a22', // near-invisible dividers
        },
        // Restrained market accents. Cyan is reserved for *interactive and
        // active* state only — never decoration — so that a cyan pixel always
        // means "you can act here" or "you are here".
        bull: '#26c281',
        bear: '#f2555a',
        amber: '#e0a33e',
        cyan: '#31c9e8',
        dim: '#6a7686',
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
        // A deliberately tight scale. Terminals live or die on density, but
        // density without a scale is just small text everywhere.
        '2xs': ['0.6875rem', { lineHeight: '1rem' }],
      },
      spacing: {
        panel: '2.25rem',
        // 4px base rhythm for the dense chrome.
        rail: '0.5rem',
      },
      letterSpacing: {
        // Panel eyebrows. Wide tracking on 10px caps is what makes a label
        // read as instrumentation rather than as a heading.
        panel: '0.16em',
        label: '0.08em',
      },
      boxShadow: {
        // One shadow, used only for genuine overlays (palette, dialogs).
        // Cards never get shadows — depth comes from surface value instead.
        overlay: '0 16px 48px -12px rgba(0,0,0,0.8)',
      },
      transitionTimingFunction: {
        // Slightly quicker than default so the UI feels like an instrument
        // responding, not a document animating.
        snap: 'cubic-bezier(0.2, 0, 0, 1)',
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