import fs from "node:fs";
import path from "node:path";
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
		experimental: {
			asyncContext: true,
		},
		esbuild: {
			options: { target: "es2020" },
		},
		analyze: {
			filename: "stats-nitro.html",
		},
		routeRules: {
			"/**": {
				// @ts-expect-error: This is in our patch
				priority: 5,
				headers: {
					"Cache-Control": "public,max-age=0,must-revalidate",
					"X-Frame-Options": "DENY",
					"X-Content-Type-Options": "nosniff",
					"Referrer-Policy": "strict-origin-when-cross-origin",
					// TODO: Setup a proper content security policy
					// "Content-Security-Policy": "script-src 'self';",
					...(isCFPages && {
						"Cloudflare-CDN-Cache-Control": "public,max-age=31536000,immutable",
						"Strict-Transport-Security":
							"max-age=31536000; includeSubDomains; preload",
					}),
				},
			},
			"/favicon.ico": {
				headers: {
					"Cache-Control": "public,immutable,max-age=31536000",
				},
			},
			"/assets/**": {
				headers: {
					"Cache-Control": "public,immutable,max-age=31536000",
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
