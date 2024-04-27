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
			},
			// START: input-otp
			keyframes: {
				"caret-blink": {
					"0%,70%,100%": { opacity: "1" },
					"20%,50%": { opacity: "0" },
				},
			},
			animation: {
				"caret-blink": "caret-blink 1.2s ease-out infinite",
			},
			// END: input-otp
		},
	},
	plugins: [require("@kobalte/tailwindcss")],
	presets: [require("./ui.preset.js")],
};
