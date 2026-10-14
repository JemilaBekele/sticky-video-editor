/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        ink: { 950: '#07080c', 900: '#0d0f16', 850: '#12151e', 800: '#181c27', 700: '#232838', 600: '#2f3650', 500: '#4a5272', 400: '#7a829f', 300: '#aab1c9', 200: '#d6dae8' },
        accent: { 500: '#f5a524', 400: '#ffb84d', 600: '#d98c0f' },
        mint: '#3ddc97',
        coral: '#ff6b6b',
        sky: '#5aa9ff',
      },
      fontFamily: { sans: ['Inter', 'ui-sans-serif', 'system-ui', 'sans-serif'], mono: ['JetBrains Mono', 'ui-monospace', 'monospace'] },
      boxShadow: { glow: '0 0 0 1px rgba(245,165,36,0.35), 0 8px 30px rgba(245,165,36,0.15)' },
    },
  },
  plugins: [],
};
