import { defineConfig } from "@solidjs/start/config";
import mattraxUI from "@mattrax/ui/vite";

export default defineConfig({
	ssr: true,
	server: {
		prerender: {
			crawlLinks: true,
		},
	},
	vite: {
		plugins: [mattraxUI],
		server: {
			fs: {
				allow: ["../../node_modules/.pnpm/@fontsource-variable+inter@5.0.17"],
			},
		},
	},
});
