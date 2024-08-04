/** @type {import('tailwindcss').Config} */
export default {
	content: [
		"./index.html",
		"./src/**/*.{html,js,jsx,ts,tsx}",
		"../../packages/*/src/**/*.{js,jsx,md,mdx,ts,tsx}",
	],
	theme: {
		extend: {},
	},
	plugins: [],
	presets: [require("@mattrax/ui/tailwind")],
};
