import { createPreset } from "fumadocs-ui/tailwind-plugin";
import { fontFamily } from "tailwindcss/defaultTheme";

/** @type {import('tailwindcss').Config} */
export default {
	content: [
		"./index.html",
		"./src/**/*.{js,ts,jsx,tsx}",
		"./docs/**/*.{md,mdx}",
		"../../packages/ui/src/**/*.{js,ts,jsx,tsx}",
	],
	darkMode: "selector",
	theme: {
		extend: {
			fontFamily: {
				sans: ["var(--font-sans)", ...fontFamily.sans],
			},
		},
	},
	plugins: [require("@tailwindcss/typography")],
	presets: [require("@mattrax/ui/tailwind"), createPreset()],
};
