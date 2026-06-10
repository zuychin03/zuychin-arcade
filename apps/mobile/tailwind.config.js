/** @type {import('tailwindcss').Config} */
module.exports = {
  content: ['./app/**/*.{js,ts,jsx,tsx}', './components/**/*.{js,ts,jsx,tsx}'],
  presets: [require('nativewind/preset')],
  theme: {
    extend: {
      colors: {
        mine: {
          bg: '#1A1208',        // deep mine dark brown-black
          surface: '#2C1F0E',   // card/panel background
          gold: '#F5C518',      // gold accent
          stone: '#6B7280',     // stone grey
          danger: '#DC2626',    // saboteur red
          tunnel: '#92400E',    // tunnel path brown
        },
      },
    },
  },
  plugins: [],
};
