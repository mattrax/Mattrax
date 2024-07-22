// @ts-expect-error // TODO: I got no idea why TS is yapping
import mattraxUI from "@mattrax/ui/vite";
import { defineConfig } from "vite";
import { createHtmlPlugin } from "vite-plugin-html";
import solid from "vite-plugin-solid";
import tsconfigPaths from "vite-tsconfig-paths";

export default defineConfig({
	plugins: [
		solid(),
		tsconfigPaths(),
		mattraxUI,
		createHtmlPlugin({
			minify: true,
		}),
	],
});
