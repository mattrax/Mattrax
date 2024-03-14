import { defineConfig } from "astro/config";
import mattraxUI from "@mattrax/ui/vite";
import tailwind from "@astrojs/tailwind";
import solidJs from "@astrojs/solid-js";

// https://astro.build/config
export default defineConfig({
	integrations: [solidJs(), tailwind()],
	vite: {
		plugins: [mattraxUI],
	},
});
