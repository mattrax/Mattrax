import fs from "node:fs";
import path from "node:path";
import contentCollections from "@content-collections/vite";
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
			routes: ["/", "/docs"],
		},
		routeRules: {
			"/**": {
				headers: {
					"X-Frame-Options": "DENY",
					"X-Content-Type-Options": "nosniff",
					"Referrer-Policy": "strict-origin-when-cross-origin",
				},
			},
			"/api/waitlist": { proxy: waitlistEndpoint },
			// TODO: Can we automatically set this for all Solid Router routes???
			"/": {
				headers: {
					// Don't cache on client but cache in Cloudflare for 1hr and keep serving if the origin is offline for another hour.
					// `no-transform` disables the Cloudflare Beacon which causes the Etag to get removed.
					"Cache-Control":
						"public, max-age=0, s-maxage=3600, stale-if-error=3600, no-transform",
				},
			},
			"/company": {
				headers: {
					"Cache-Control":
						"public, max-age=0, s-maxage=3600, stale-if-error=3600, no-transform",
				},
			},
			"/company/": {
				headers: {
					"Cache-Control":
						"public, max-age=0, s-maxage=3600, stale-if-error=3600, no-transform",
				},
			},
			"/docs/*": {
				headers: {
					"Cache-Control":
						"public, max-age=0, s-maxage=3600, stale-if-error=3600, no-transform",
				},
			},
			"/favicon.ico": {
				headers: {
					"Cache-Control":
						// Cache for 24hrs on client and Cloudflare and serve for another 24hrs if the origin is offline.
						"public, max-age=1440, s-maxage=1440, stale-if-error=1440, no-transform",
				},
			},
		},
	},
	vite: {
		envDir: monorepoRoot,
		plugins: [
			// We don't use the Solid Start adapter due to https://github.com/sdorra/content-collections/pull/269
			contentCollections({
				configPath: "src/content-collections.ts",
				isEnabled(config) {
					return config.router?.name === "ssr";
				},
			}),
			mattraxUI,
		],
		server: {
			fs: {
				allow: ["../../node_modules"],
			},
		},

		build: {
			assetsInlineLimit: 0,
		},
	},
});

process.on("exit", () => {
	const routesFile = path.join("dist", "_routes.json");

	if (fs.existsSync(routesFile)) {
		fs.writeFileSync(
			routesFile,
			JSON.stringify({
				version: 1,
				// The entire site is prerendered!
				include: ["/_fine_you_can_you_a_single_route_cloudflare"],
				exclude: ["/*"],
				// If we wanna change it use the following:
				// include: ["/*"],
				// exclude: ["/_build/*", "/assets/*", "/favicon.ico", "/ogp.png"],
			}),
		);
		console.log("Patched `_routes.json`...");
	} else {
		console.log("`_routes.json` not found. Skipping patch...");
	}
});
