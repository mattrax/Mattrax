/**@type {import("tailwindcss").Config} */

module.exports = {
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
				corvu: {
					bg: "#f3f1fe",
					100: "#e6e2fd",
					200: "#d4cbfb",
					300: "#bcacf6",
					400: "#a888f1",
					text: "#180f24",
				},
			},
			animation: {
				"caret-blink": "caret-blink 1.25s ease-out infinite",
				"height-in": "height-in 250ms ease-in-out",
				"height-out": "height-out 150ms ease-in-out",
			},
			keyframes: {
				"caret-blink": {
					"0%,70%,100%": { opacity: "1" },
					"20%,50%": { opacity: "0" },
				},
				"height-in": {
					"0%": { height: "0px", opacity: "0" },
					"40%": { opacity: "100%" },
					"100%": { height: "100%" },
				},
				"height-out": {
					"0%": { opacity: "100%" },
					"50%": { height: "100%", opacity: "75%" },
					"100%": { opacity: "0" },
				},
			},
			transitionProperty: {
				height: "height",
			},
		},
	},
	plugins: [require("@kobalte/tailwindcss"), require("@corvu/tailwind")],
	presets: [require("./ui.preset.js")],
};
