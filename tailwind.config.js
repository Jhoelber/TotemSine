/** @type {import('tailwindcss').Config} */
export default {
  content: [
    "./index.html",
    "./src/**/*.{js,ts,jsx,tsx}",
  ],
  theme: {
    extend: {
      keyframes: {
        'bounce': {
          '0%, 100%': { transform: 'translateY(-1)' }, // Posição inicial e final
          '30%': { transform: 'translateY(2px)' },   // Pico da animação
          '50%': { transform: 'translateY(4px)' },   // Meio da animação, deslocamento maior
          '70%': { transform: 'translateY(2px)' },   // Retrocesso do pico
          '100%': { transform: 'translateY(0)' },
        },
        'bounce2': {
          '0%, 100%': { transform: 'translateY(0)' }, // Posição inicial e final
          '30%': { transform: 'translateY(2px)' },   // Pico da animação
          '50%': { transform: 'translateY(4px)' },   // Meio da animação, deslocamento maior
          '70%': { transform: 'translateY(2px)' },   // Retrocesso do pico
          '100%': { transform: 'translateY(0)' },
        }

      },
      animation: {
        'bounce': 'bounce 2s ease-in-out infinite',
        'bounce2': 'bounce2 3s ease-in-out infinite'
      }


    },
  },
  plugins: [],
}
