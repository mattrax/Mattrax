import mattraxUI from "@mattrax/ui/vite";
import { defineConfig } from "@solidjs/start/config";
import { monorepoRoot } from "./loadEnv";

if (typeof process.env.VITE_MATTRAX_CLOUD_ORIGIN !== "string")
	throw new Error("Missing 'VITE_MATTRAX_CLOUD_ORIGIN' env variable!");
const waitlistEndpoint = new URL(
	"/api/waitlist",
	process.env.VITE_MATTRAX_CLOUD_ORIGIN,
).toString();

export default defineConfig({
	ssr: true,
	server: {
		prerender: {
			crawlLinks: true,
		},
		routeRules: {
			"/api/waitlist": { proxy: waitlistEndpoint },
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
