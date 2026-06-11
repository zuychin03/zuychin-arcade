/** @type {import('tailwindcss').Config} */
module.exports = {
  content: ['./app/**/*.{js,ts,jsx,tsx}', './components/**/*.{js,ts,jsx,tsx}'],
  presets: [require('nativewind/preset')],
  // App is always dark; 'class' lets the scheme be set manually instead of
  // following the OS media query (NativeWind throws otherwise).
  darkMode: 'class',
  theme: {
    extend: {
      colors: {
        // Neon arcade chrome — red/purple/blue like neon lights
        arcade: {
          bg: '#0B0716',        // near-black violet
          surface: '#161028',   // panel background
          surfaceTranslucent: 'rgba(22, 16, 40, 0.7)', // glassmorphism surface
          panel: '#1F1838',     // raised panel
          panelTranslucent: 'rgba(31, 24, 56, 0.7)', // glassmorphism panel
          border: '#2E2452',    // subtle borders
          pink: '#FF2E88',      // neon pink/red
          red: '#FF3355',       // neon red
          purple: '#A855F7',    // neon purple
          violet: '#7C3AED',    // deep violet
          blue: '#4F8EF7',      // neon blue
          cyan: '#2EE6FF',      // neon cyan
          muted: '#8E86B3',     // muted lavender text
          text: '#EDEAFB',      // near-white text
        },
        // In-game Saboteur board palette (it's still a mine down there)
        mine: {
          bg: '#130E1F',        // mine depths, tinted to match arcade bg
          surface: '#241B36',   // card/panel background
          gold: '#F5C518',      // gold accent
          stone: '#6B7280',     // stone grey
          danger: '#FF3355',    // saboteur neon red
          tunnel: '#92400E',    // tunnel path brown
        },
      },
    },
  },
  plugins: [],
};
