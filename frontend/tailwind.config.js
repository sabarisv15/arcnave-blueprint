import tailwindcssAnimate from 'tailwindcss-animate';

/** @type {import('tailwindcss').Config} */
export default {
  darkMode: ['class'],
  content: ['./index.html', './src/**/*.{js,jsx}'],
  theme: {
    container: {
      center: true,
      padding: '2rem',
      screens: { '2xl': '1400px' },
    },
    extend: {
      colors: {
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
        accent: {
          DEFAULT: 'var(--accent)',
          foreground: 'var(--accent-foreground)',
        },
        popover: {
          DEFAULT: 'var(--popover)',
          foreground: 'var(--popover-foreground)',
        },
        card: {
          DEFAULT: 'var(--card)',
          foreground: 'var(--card-foreground)',
        },
        success: {
          DEFAULT: 'var(--success)',
          foreground: 'var(--success-foreground)',
        },
        warning: {
          DEFAULT: 'var(--warning)',
          foreground: 'var(--warning-foreground)',
        },
        info: {
          DEFAULT: 'var(--info)',
          foreground: 'var(--info-foreground)',
        },
        spotlight: {
          DEFAULT: 'var(--spotlight)',
          foreground: 'var(--spotlight-foreground)',
        },
        dark: {
          DEFAULT: 'var(--dark)',
          foreground: 'var(--dark-foreground)',
        },
        gold: {
          DEFAULT: 'var(--gold)',
          foreground: 'var(--gold-foreground)',
          deep: 'var(--gold-deep)',
          'deep-foreground': 'var(--gold-deep-foreground)',
        },
      },
      borderRadius: {
        '2xl': 'calc(var(--radius) + 8px)',
        xl: 'calc(var(--radius) + 2px)',
        lg: 'var(--radius)',
        md: 'calc(var(--radius) - 4px)',
        sm: 'calc(var(--radius) - 6px)',
      },
      boxShadow: {
        sm: 'var(--shadow-sm)',
        card: 'var(--shadow-card)',
        elevated: 'var(--shadow-elevated)',
        popover: 'var(--shadow-popover)',
      },
      fontFamily: {
        sans: ['Inter', 'system-ui', 'sans-serif'],
      },
      fontSize: {
        xs: ['0.75rem', { lineHeight: '1rem', letterSpacing: '-0.005em' }],
        sm: ['0.8125rem', { lineHeight: '1.25rem', letterSpacing: '-0.005em' }],
        base: ['0.875rem', { lineHeight: '1.375rem', letterSpacing: '-0.006em' }],
        lg: ['1rem', { lineHeight: '1.5rem', letterSpacing: '-0.008em' }],
        xl: ['1.125rem', { lineHeight: '1.625rem', letterSpacing: '-0.012em', fontWeight: '600' }],
        '2xl': ['1.5rem', { lineHeight: '1.875rem', letterSpacing: '-0.02em', fontWeight: '700' }],
        '3xl': ['1.875rem', { lineHeight: '2.25rem', letterSpacing: '-0.025em', fontWeight: '700' }],
        '4xl': ['2.5rem', { lineHeight: '2.75rem', letterSpacing: '-0.03em', fontWeight: '700' }],
      },
      spacing: {
        page: 'var(--page-gap)',
        4.5: '1.125rem',
        18: '4.5rem',
      },
    },
  },
  plugins: [tailwindcssAnimate],
};
