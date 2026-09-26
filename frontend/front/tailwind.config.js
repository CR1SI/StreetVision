/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './*/index.html', './src/**/*.{js,jsx}'],
  theme: {
    extend: {
      colors: {
        // StreetVision palette (from the Sperry Tech brand colors): navy base, purple/teal, pink accent
        ink: { DEFAULT: '#0A0F1C', 900: '#0A0F1C', 800: '#111A2C', 700: '#17223A', 600: '#1E2A46', 500: '#26314C' },
        map: '#171717',
        fg: { DEFAULT: '#F3F5FA', dim: '#8C96AD', faint: '#5C6784' },
        brand: {
          purple: '#7C6FEF', 'purple-dim': '#2A2560',
          teal: '#2FD1C0', 'teal-dim': '#123B37',
          pink: '#F0397E', 'pink-dim': '#3E1330',
          amber: '#FBBF63', 'amber-dim': '#3F2E12',
          orange: '#FB8B3D', sky: '#5AC8FA',
        },
      },
      fontFamily: {
        display: ['"Space Grotesk"', 'ui-sans-serif', 'system-ui', 'sans-serif'],
        sans: ['Manrope', 'ui-sans-serif', 'system-ui', 'sans-serif'],
      },
    },
  },
  plugins: [],
}
