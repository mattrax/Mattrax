import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import mattraxUI from "@mattrax/ui/vite";
import { defineConfig } from "@solidjs/start/config";
import { visualizer } from "rollup-plugin-visualizer";
import devtools from "solid-devtools/vite";
import { cloudflare } from "unenv";
import tsconfigPaths from "vite-tsconfig-paths";

import { monorepoRoot } from "./loadEnv";
import "./src/env";

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
		resolve: {
			alias: {
				// We replace the `sst` import on client so the `env.ts` file can be used
				sst:
					router === "client"
						? fileURLToPath(new URL("./src/sst-shim.js", import.meta.url))
						: fileURLToPath(
								new URL("./node_modules/sst/dist/index.js", import.meta.url),
							),
			},
		},
		plugins: [
			devtools(),
			tsconfigPaths({
				// If this isn't set Vinxi hangs on startup
				root: ".",
			}),
			mattraxUI,
			visualizer({
				brotliSize: true,
				gzipSize: true,
				filename: `stats${router === "client" ? "" : `-${router}`}.html`,
			}),
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
		// We define these rules for production in `_headers`
		routeRules: isCFPages
			? {}
			: {
					"/**": {
						// @ts-expect-error: This is in our patch
						priority: 5,
						headers: {
							"Cache-Control": "public,max-age=0,must-revalidate",
							"X-Frame-Options": "DENY",
							"X-Content-Type-Options": "nosniff",
							"Referrer-Policy": "strict-origin-when-cross-origin",
						},
					},
				},
		...(isCFPages && {
			// TODO: We could probs PR this to the Vercel Edge preset in Nitro.
			// This is to ensure Stripe pulls in the Cloudflare Workers version not the Node version.
			// exportConditions: ["worker"],
			unenv: cloudflare,
			rollupConfig: {
				external: ["cloudflare:sockets"],
			},
			cloudflare: {
				pages: {
					routes: {
						// All non-api and non-asset routes are redirected to / to be served by CDN
						exclude: ["/"],
					},
				},
			},
		}),
	},
	...(isCFPages && {
		middleware: "src/cfPagesMiddleware.ts",
	}),
});

process.on("exit", () => {
	console.log("Patching `_routes.json`...");

	fs.writeFileSync(
		path.join("dist", "_routes.json"),
		JSON.stringify({
			version: 1,
			exclude: ["/_build/*", "/assets/*", "/favicon.ico", "/tos"],
		}),
	);
});
