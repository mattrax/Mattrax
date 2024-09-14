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

// TODO: Maybe generate from Solid Router
// These skip the Worker so they can be served by CF's edge.
// (our Worker has smart placement for the API so it's not edge)
const staticRoutes = [
	"/",
	"/tos",
	"/account",
	"/invite",
	"/login",
	"/enroll",
	"/o/*",
];

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
		server: {
			// TODO: Remove this
			proxy: {
				"/api2": {
					target: "http://localhost:9000",
					changeOrigin: true,
					rewrite: (path) => path.replace(/^\/api2/, ""),
				},
			},
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
		routeRules: {
			"/**": {
				headers: {
					"X-Frame-Options": "DENY",
					"X-Content-Type-Options": "nosniff",
					"Referrer-Policy": "strict-origin-when-cross-origin",
					"Strict-Transport-Security":
						"max-age=31536000; includeSubDomains; preload",
				},
			},
			"/favicon.ico": {
				headers: {
					"Cache-Control":
						"public, max-age=1440, s-maxage=1440, stale-if-error=1440, no-transform",
				},
			},
			...Object.fromEntries(
				staticRoutes.map((route) => [
					route,
					{
						headers: {
							"Cache-Control":
								"public, max-age=0, s-maxage=3600, stale-if-error=3600, no-transform",
						},
					},
				]),
			),
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
	const routesFile = path.join("dist", "_routes.json");

	if (fs.existsSync(routesFile)) {
		fs.writeFileSync(
			routesFile,
			JSON.stringify({
				version: 1,
				include: ["/*"],
				exclude: [
					// HTML/favicon.ico routes
					...staticRoutes,
					// Handled by `_redirects`
					"/EnrollmentServer/*",
					// Static files
					"/_build/*",
					"/assets/*",
				],
			}),
		);

		console.log("Patched `_routes.json`...");
	} else {
		console.log("`_routes.json` not found. Skipping patch...");
	}
});
