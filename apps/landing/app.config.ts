import { defineConfig } from "@solidjs/start/config";
import { monorepoRoot } from "./loadEnv";
import mattraxUI from "@mattrax/ui/vite";

export default defineConfig({
	ssr: true,
	server: {
		prerender: {
			crawlLinks: true,
		},
	},
	vite: {
		envDir: monorepoRoot,
		plugins: [mattraxUI],
		server: {
			fs: {
				allow: ["../../node_modules"],
			},
		},
	},
});
