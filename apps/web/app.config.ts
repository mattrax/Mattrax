import { plugin } from "@mattrax/api/plugin";
import mattraxUI from "@mattrax/ui/vite";
import { defineConfig } from "@solidjs/start/config";
import { visualizer } from "rollup-plugin-visualizer";
import devtools from "solid-devtools/vite";
import { cloudflare } from "unenv";
import tsconfigPaths from "vite-tsconfig-paths";

import { monorepoRoot } from "./loadEnv";

// Import t3 env so we get warnings about missing variables.
// import "@mattrax/api/client"; // TODO: Bring this back. It no worky rn!

const nitroPreset = process.env.NITRO_PRESET ?? "node-server";
const isCFPages = nitroPreset === "cloudflare_pages";

export default defineConfig({
	ssr: false,
	routeDir: "app",
	solid: {
		// We don't wanna apply Solid's JSX transform to the React emails.
		exclude: ["../../packages/email/**"],
	},
	vite: ({ router }) => ({
		envDir: monorepoRoot,
		css: {
			modules: {
				localsConvention: "camelCaseOnly",
			},
		},
		build: {
			// Safari mobile has problems with newer syntax
			target: "es2020",
		},
		plugins: [
			devtools(),
			tsconfigPaths(),
			mattraxUI,
			visualizer({
				brotliSize: true,
				gzipSize: true,
				filename: `stats${router === "client" ? "" : `-${router}`}.html`,
			}),
			plugin(),
		],
	}),
	server: {
		preset: nitroPreset,
		// Cloudflare will take care of this
		compressPublicAssets: false,
		experimental: {
			asyncContext: true,
		},
		esbuild: {
			options: { target: "es2020" },
		},
		analyze: {
			filename: "stats-nitro.html",
		},
		...(isCFPages && {
			// TODO: We could probs PR this to the Vercel Edge preset in Nitro.
			// This is to ensure Stripe pulls in the Cloudflare Workers version not the Node version.
			// exportConditions: ["worker"],
			unenv: cloudflare,
			rollupConfig: {
				external: ["cloudflare:sockets"],
			},
		}),
	},
});
