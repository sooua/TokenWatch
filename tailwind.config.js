/** @type {import('tailwindcss').Config} */
export default {
  content: ['./src/**/*.{js,jsx,ts,tsx}', './src/index.html'],
  theme: {
    extend: {
      zIndex: {
        '1': '1',
        '10': '10',
        '20': '20',
        '30': '30',
        '40': '40',
        '50': '50',
        '60': '60',
        '70': '70',
        '80': '80',
        '90': '90',
        '100': '100',
        '999': '999',
        '9999': '9999',
        dropdown: '999',
        tooltip: '9999',
        modal: '1000',
        overlay: '998',
      },
      colors: {
        // Claude / Anthropic warm design system
        parchment: '#f5f4ed',
        ivory: '#faf9f5',
        sand: '#e8e6dc',
        cream: '#f0eee6',
        terracotta: {
          DEFAULT: '#c96442',
          light: '#d97757',
          dark: '#b0533a',
        },
        claude: {
          black: '#141413',
          dark: '#30302e',
          charcoal: '#3d3d3a',
          warm: '#4d4c48',
          olive: '#5e5d59',
          stone: '#87867f',
          silver: '#b0aea5',
        },
        ring: {
          warm: '#d1cfc5',
          deep: '#c2c0b6',
        },
        // Warm neutrals for per-shade usage
        'neutral-warm': {
          50: '#f5f4ed',
          100: '#f0eee6',
          200: '#e8e6dc',
          300: '#d1cfc5',
          400: '#b0aea5',
          500: '#87867f',
          600: '#5e5d59',
          700: '#4d4c48',
          800: '#30302e',
          900: '#141413',
        },
      },
      fontFamily: {
        // Anthropic Serif → Georgia fallback (custom face not loaded in this build)
        serif: [
          'Anthropic Serif',
          'Tiempos',
          'Georgia',
          'Cambria',
          'Times New Roman',
          'serif',
        ],
        // Anthropic Sans → system sans fallback
        sans: [
          'Anthropic Sans',
          'Inter',
          'system-ui',
          '-apple-system',
          'Segoe UI',
          'Helvetica Neue',
          'Arial',
          'sans-serif',
        ],
        // Anthropic Mono → monospace fallback
        mono: [
          'Anthropic Mono',
          'JetBrains Mono',
          'Fira Code',
          'SFMono-Regular',
          'Consolas',
          'monospace',
        ],
        // Default "primary" keeps compatibility with existing components that
        // reference `font-primary`. We make it sans — serif is only applied
        // explicitly on headline elements.
        primary: [
          'Anthropic Sans',
          'Inter',
          'system-ui',
          '-apple-system',
          'Segoe UI',
          'Helvetica Neue',
          'Arial',
          'sans-serif',
        ],
      },
      fontSize: {
        // Scales from Claude design system (tightened)
        xs: ['0.75rem', { lineHeight: '1.5' }],
        sm: ['0.875rem', { lineHeight: '1.5' }],
        base: ['1rem', { lineHeight: '1.6' }],
        lg: ['1.125rem', { lineHeight: '1.6' }],
        xl: ['1.25rem', { lineHeight: '1.4' }],
        '2xl': ['1.5rem', { lineHeight: '1.3' }],
        '3xl': ['2rem', { lineHeight: '1.2' }],
        '4xl': ['2.5rem', { lineHeight: '1.15' }],
        '5xl': ['3.25rem', { lineHeight: '1.1' }],
      },
      letterSpacing: {
        tightest: '-0.02em',
        tighter: '-0.01em',
        tight: '-0.005em',
        normal: '0',
        wide: '0.01em',
        wider: '0.02em',
        widest: '0.12em',
      },
      boxShadow: {
        // Ring-based elevation ("shadow as border")
        'ring-warm': '0 0 0 1px #d1cfc5',
        'ring-deep': '0 0 0 1px #c2c0b6',
        'ring-cream': '0 0 0 1px #f0eee6',
        'ring-sand': '0 0 0 1px #e8e6dc',
        'ring-dark': '0 0 0 1px #30302e',
        // Whisper shadow for elevated surfaces
        whisper: '0 4px 24px rgba(0, 0, 0, 0.05)',
        'whisper-md': '0 8px 32px rgba(0, 0, 0, 0.06)',
      },
      spacing: {
        'fluid-xs': 'clamp(0.25rem, 0.2rem + 0.25vw, 0.5rem)',
        'fluid-sm': 'clamp(0.5rem, 0.4rem + 0.5vw, 1rem)',
        'fluid-md': 'clamp(1rem, 0.8rem + 1vw, 2rem)',
        'fluid-lg': 'clamp(1.5rem, 1.2rem + 1.5vw, 3rem)',
        'fluid-xl': 'clamp(2rem, 1.6rem + 2vw, 4rem)',
      },
      animation: {
        'fade-in': 'fadeIn 0.4s ease-out forwards',
        'slide-up': 'slideUp 0.4s ease-out forwards',
        'scale-in': 'scaleIn 0.25s cubic-bezier(0.4, 0, 0.2, 1)',
      },
      keyframes: {
        fadeIn: {
          '0%': { opacity: '0' },
          '100%': { opacity: '1' },
        },
        slideUp: {
          '0%': { opacity: '0', transform: 'translateY(8px)' },
          '100%': { opacity: '1', transform: 'translateY(0)' },
        },
        scaleIn: {
          '0%': { opacity: '0', transform: 'scale(0.98)' },
          '100%': { opacity: '1', transform: 'scale(1)' },
        },
      },
    },
  },
  plugins: [],
};
