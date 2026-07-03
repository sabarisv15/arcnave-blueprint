/** @type {import('tailwindcss').Config} */
module.exports = {
  content: [
    "./index.html",
    "./src/**/*.{js,ts,jsx,tsx}",
  ],
  theme: {
    extend: {
      colors: {
        /* iOS 26 System Colors */
        ios: {
          blue:   '#007AFF',
          indigo: '#5856D6',
          purple: '#AF52DE',
          pink:   '#FF2D55',
          red:    '#FF3B30',
          orange: '#FF9500',
          yellow: '#FFCC00',
          green:  '#34C759',
          teal:   '#5AC8FA',
          cyan:   '#32ADE6',
          mint:   '#00C7BE',
        },
        /* Legacy compat — Indigo extended */
        indigo: {
          50:  '#EEF2FF', 100: '#E0E7FF', 200: '#C7D2FE',
          300: '#A5B4FC', 400: '#818CF8', 500: '#6366F1',
          600: '#4F46E5', 650: '#4338CA', 700: '#4338CA',
          800: '#3730A3', 900: '#312E81',
        },
        /* Slate extended */
        slate: {
          50:  '#F8FAFC', 100: '#F1F5F9', 105: 'rgba(241,245,249,0.9)',
          200: '#E2E8F0', 300: '#CBD5E1', 400: '#94A3B8',
          500: '#64748B', 600: '#475569', 700: '#334155',
          800: '#1E293B', 805: '#172033', 900: '#0F172A',
        },
        rose:    { 50:'#FFF1F2', 100:'#FFE4E6', 200:'#FECDD3', 300:'#FDA4AF', 400:'#FB7185', 500:'#F43F5E', DEFAULT:'#FF3B30', 600:'#E11D48' },
        emerald: { 50:'#ECFDF5', 100:'#D1FAE5', 400:'#34D399', 500:'#10B981', DEFAULT:'#34C759', 600:'#059669' },
        cyan:    { DEFAULT:'#32ADE6', 300:'#67E8F9', 400:'#22D3EE', 500:'#06B6D4', 600:'#0891B2' },
        amber:   { DEFAULT:'#FF9500', 100:'#FEF3C7', 400:'#FBBF24', 500:'#F59E0B', 600:'#D97706' },
        green:   { 400:'#4ADE80', 500:'#22C55E', DEFAULT:'#34C759', 600:'#16A34A' },
        violet:  { DEFAULT:'#5856D6', 500:'#8B5CF6', 600:'#7C3AED' },
      },
      fontFamily: {
        sans: ['-apple-system','SF Pro Display','Inter','BlinkMacSystemFont','"Segoe UI"','sans-serif'],
        mono: ['"JetBrains Mono"','"SF Mono"','monospace'],
      },
      borderRadius: {
        'ios':    '12px',
        'ios-lg': '18px',
        'ios-xl': '22px',
        'ios-2xl':'28px',
        'ios-3xl':'36px',
      },
      backdropBlur: {
        xs: '4px',  sm: '10px', md: '18px',
        lg: '28px', xl: '38px', '2xl': '50px',
      },
      animation: {
        'float':         'floatAnim 7s ease-in-out infinite',
        'float-delayed': 'floatAnim 7s ease-in-out 2.5s infinite',
        'slide-up':      'slideUp 0.45s cubic-bezier(0.16,1,0.3,1) forwards',
        'slide-right':   'slideRight 0.40s cubic-bezier(0.16,1,0.3,1) forwards',
        'fade-in':       'fadeIn 0.35s ease-out forwards',
        'pop':           'springPop 0.42s cubic-bezier(0.34,1.56,0.64,1) forwards',
        'pulse-glow':    'pulseGlow 3s ease-in-out infinite',
        'pulse-blue':    'pulseBlue 2.5s ease-in-out infinite',
        'shimmer':       'shimmer 1.8s ease-in-out infinite',
        'ios-appear':    'iosAppear 0.55s cubic-bezier(0.34,1.56,0.64,1) both',
        'orb-float':     'orbFloat 22s ease-in-out infinite alternate',
        'spin-slow':     'spin 8s linear infinite',
        'pulse-ring':    'pulseRing 2s ease-out infinite',
      },
      keyframes: {
        floatAnim: {
          '0%,100%': { transform: 'translateY(0px) rotate(0deg)' },
          '50%':     { transform: 'translateY(-12px) rotate(0.5deg)' },
        },
        slideUp: {
          '0%':   { transform: 'translateY(28px)', opacity: '0' },
          '100%': { transform: 'translateY(0)',    opacity: '1' },
        },
        slideRight: {
          '0%':   { transform: 'translateX(-28px)', opacity: '0' },
          '100%': { transform: 'translateX(0)',      opacity: '1' },
        },
        fadeIn: {
          '0%': { opacity: '0' }, '100%': { opacity: '1' },
        },
        springPop: {
          '0%':   { transform: 'scale(0.88) translateY(18px)', opacity: '0' },
          '60%':  { transform: 'scale(1.03) translateY(-3px)', opacity: '1' },
          '100%': { transform: 'scale(1) translateY(0)',        opacity: '1' },
        },
        pulseGlow: {
          '0%,100%': { boxShadow: '0 0 0 0 rgba(0,122,255,0.22)' },
          '50%':     { boxShadow: '0 0 28px 6px rgba(0,122,255,0.40)' },
        },
        pulseBlue: {
          '0%,100%': { opacity: '0.70', transform: 'scale(1.00)' },
          '50%':     { opacity: '1.00', transform: 'scale(1.06)' },
        },
        shimmer: {
          '0%':   { backgroundPosition: '-400% 0' },
          '100%': { backgroundPosition:  '400% 0' },
        },
        iosAppear: {
          'from': { transform: 'scale(0.82) rotate(-4deg)', opacity: '0' },
          'to':   { transform: 'scale(1) rotate(0deg)',     opacity: '1' },
        },
        orbFloat: {
          '0%':   { transform: 'translate(0%,0%) scale(1)' },
          '33%':  { transform: 'translate(4%,-4%) scale(1.06)' },
          '66%':  { transform: 'translate(-3%,3%) scale(0.96)' },
          '100%': { transform: 'translate(2%,-2%) scale(1.03)' },
        },
        pulseRing: {
          '0%':   { opacity: '0.55', transform: 'scale(0.95)' },
          '80%':  { opacity: '0',    transform: 'scale(1.35)' },
          '100%': { opacity: '0',    transform: 'scale(1.35)' },
        },
      },
      boxShadow: {
        'glass':    '0 8px 32px rgba(0,0,0,0.06), 0 2px 8px rgba(0,0,0,0.04)',
        'glass-lg': '0 20px 60px rgba(0,0,0,0.09), 0 8px 24px rgba(0,0,0,0.05)',
        'glass-xl': '0 32px 80px rgba(0,0,0,0.12), 0 12px 32px rgba(0,0,0,0.07)',
        'ios-blue': '0 4px 18px rgba(0,122,255,0.38)',
        'ios-red':  '0 4px 18px rgba(255,59,48,0.32)',
        'ios-green':'0 4px 18px rgba(52,199,89,0.30)',
      },
    },
  },
  plugins: [],
}
