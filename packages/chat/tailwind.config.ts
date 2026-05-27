import type { Config } from 'tailwindcss';

const config: Config = {
  darkMode: 'class',
  content: ['./src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        border: 'hsl(var(--aj-border) / <alpha-value>)',
        input: 'hsl(var(--aj-input) / <alpha-value>)',
        ring: 'hsl(var(--aj-ring) / <alpha-value>)',
        background: 'hsl(var(--aj-background) / <alpha-value>)',
        foreground: 'hsl(var(--aj-foreground) / <alpha-value>)',
        primary: {
          DEFAULT: 'hsl(var(--aj-primary) / <alpha-value>)',
          foreground: 'hsl(var(--aj-primary-foreground) / <alpha-value>)',
        },
        secondary: {
          DEFAULT: 'hsl(var(--aj-secondary) / <alpha-value>)',
          foreground: 'hsl(var(--aj-secondary-foreground) / <alpha-value>)',
        },
        muted: {
          DEFAULT: 'hsl(var(--aj-muted) / <alpha-value>)',
          foreground: 'hsl(var(--aj-muted-foreground) / <alpha-value>)',
        },
        accent: {
          DEFAULT: 'hsl(var(--aj-accent) / <alpha-value>)',
          foreground: 'hsl(var(--aj-accent-foreground) / <alpha-value>)',
        },
        destructive: {
          DEFAULT: 'hsl(var(--aj-destructive) / <alpha-value>)',
          foreground: 'hsl(var(--aj-destructive-foreground) / <alpha-value>)',
        },
        card: {
          DEFAULT: 'hsl(var(--aj-card) / <alpha-value>)',
          foreground: 'hsl(var(--aj-card-foreground) / <alpha-value>)',
        },
        popover: {
          DEFAULT: 'hsl(var(--aj-popover) / <alpha-value>)',
          foreground: 'hsl(var(--aj-popover-foreground) / <alpha-value>)',
        },
      },
      borderRadius: {
        lg: 'var(--aj-radius)',
        md: 'calc(var(--aj-radius) - 2px)',
        sm: 'calc(var(--aj-radius) - 4px)',
      },
      fontFamily: {
        sans: 'var(--aj-font-sans, ui-sans-serif, system-ui, sans-serif)',
        mono: 'var(--aj-font-mono, ui-monospace, SFMono-Regular, monospace)',
      },
      keyframes: {
        'aj-slide-in-right': {
          from: { transform: 'translateX(100%)' },
          to: { transform: 'translateX(0)' },
        },
        'aj-slide-out-right': {
          from: { transform: 'translateX(0)' },
          to: { transform: 'translateX(100%)' },
        },
        'aj-fade-in': {
          from: { opacity: '0' },
          to: { opacity: '1' },
        },
        'aj-blink': {
          '0%, 100%': { opacity: '1' },
          '50%': { opacity: '0' },
        },
      },
      animation: {
        'aj-slide-in-right': 'aj-slide-in-right 220ms ease-out',
        'aj-slide-out-right': 'aj-slide-out-right 200ms ease-in',
        'aj-fade-in': 'aj-fade-in 200ms ease-out',
        'aj-blink': 'aj-blink 1s steps(1) infinite',
      },
    },
  },
  plugins: [],
};

export default config;
