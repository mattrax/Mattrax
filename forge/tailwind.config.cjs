/** @type {import('tailwindcss').Config} */
export default {
  darkMode: ["class"],
  content: ["./src/**/*.{html,js,jsx,ts,tsx}"],
  theme: {
    extend: {
      colors: {
        pagebg: {
          light: "#f6f6f6",
          dark: "#1e1e1e",
        },
        header: {
          light: "white",
          dark: "#262626",
        },
        brand: {
          DEFAULT: "#0284C8",
          secondary: "#036AA2",
          tertiary: "#025f91",
        },
        brandDark: {
          DEFAULT: "#262626",
          secondary: "#171717",
        },
      },
    },
  },
  plugins: [require("@tailwindcss/forms"), require("@kobalte/tailwindcss")],
  presets: [require("./ui.preset.js")],
};
