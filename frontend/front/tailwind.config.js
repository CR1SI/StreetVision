/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './*/index.html', './src/**/*.{js,jsx}'],
  theme: {
    extend: {
      colors: {
        // StreetVision palette v2: near-black base, one accent, no decorative pastels.
        ink: { DEFAULT: '#0B0D10', 900: '#0B0D10', 800: '#111318', 700: '#15181D', 600: '#1B1F26', 500: '#2A2E35' },
        map: '#141414',
        fg: { DEFAULT: '#F2F3F5', dim: '#9198A3', faint: '#6B7280' },
        brand: {
          // One accent color, used sparingly for primary actions / links / focus.
          accent: '#3B82F6', 'accent-dim': '#152238',
          // Semantic-only colors kept for things that must stay visually distinct
          // (proximity tiers, confidence, error states) — muted, not candy-bright.
          danger: '#DC5B5B', 'danger-dim': '#2A1616',
          warn: '#C9963E', 'warn-dim': '#2A2013',
          ok: '#3FA679', 'ok-dim': '#122520',
        },
      },
      borderRadius: {
        DEFAULT: '0px',
        none: '0px',
        sm: '0px',
        md: '0px',
        lg: '0px',
        xl: '0px',
        '2xl': '0px',
        '3xl': '0px',
        full: '2px', // "pill" shapes become a minimal 2px radius, not a stadium
      },
      fontFamily: {
        display: ['"IBM Plex Sans"', 'ui-sans-serif', 'system-ui', 'sans-serif'],
        sans: ['"IBM Plex Sans"', 'ui-sans-serif', 'system-ui', 'sans-serif'],
        mono: ['"IBM Plex Mono"', 'ui-monospace', 'SFMono-Regular', 'monospace'],
      },
    },
  },
  plugins: [],
}