/** @type {import('tailwindcss').Config} */
export default {
  content: ['./src/client/**/*.{js,ts,jsx,tsx,html}'],
  theme: {
    extend: {
      fontFamily: {
        mono: ['JetBrains Mono', 'Fira Code', 'Monaco', 'Consolas', 'monospace'],
      },
    },
  },
  plugins: [],
};
