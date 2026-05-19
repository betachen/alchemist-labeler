/** @type {import('tailwindcss').Config} */
export default {
  darkMode: 'class',
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        buy: '#1D9E75',
        sell: '#D85A30',
      },
    },
  },
  plugins: [],
}
