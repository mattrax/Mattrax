import { defineConfig } from "@solidjs/start/config";
import path from "node:path";
import fs from "node:fs";
import tsconfigPaths from "vite-tsconfig-paths";
import Icons from "unplugin-icons/vite";
import IconsResolver from "unplugin-icons/resolver";
import AutoImport from "unplugin-auto-import/vite";
import { visualizer } from "rollup-plugin-visualizer";

import { monorepoRoot } from "./loadEnv";
import "./src/env";

export default defineConfig({
	ssr: false,
	routeDir: "./app",
	vite: {
		envDir: monorepoRoot,
		build: {
			// Safari mobile has problems with newer syntax
			target: "es2015",
		},
		plugins: [
			tsconfigPaths({
				// If this isn't set Vinxi hangs on startup
				root: ".",
			}),
			AutoImport({
				resolvers: [IconsResolver({ prefix: "Icon", extension: "jsx" })],
				dts: "./src/auto-imports.d.ts",
			}),
			Icons({ compiler: "solid" }),
			!(process.env.VERCEL === "1")
				? visualizer({ brotliSize: true, gzipSize: true })
				: undefined,
		],
	},
	server: {
		// vercel: {
		//   regions: ["iad1"],
		// },
		// This is to ensure Stripe pulls in the Cloudflare Workers version not the Node version.
		// TODO: We could probs PR this to the Vercel Edge preset in Nitro.
		exportConditions: ["worker"],
		esbuild: {
			options: {
				/// Required for `@paralleldrive/cuid2` to work.
				/// https://github.com/paralleldrive/cuid2/issues/62
				target: "es2020",
			},
		},
		experimental: {
			asyncContext: true,
		},
	},
});

// TODO: Remove this hackery
const workerCode = path.join("dist", "_worker.js", "index.js");
const routesJson = path.join("dist", "_routes.json");
process.on("exit", () => {
	if (!fs.existsSync(workerCode)) {
		console.warn("Skipping Cloudflare env patching...");
		return;
	}

	// Cloudflare doesn't allow access to env outside the handler.
	// So we ship the env with the worker code.
	fs.writeFileSync(
		path.join(workerCode, "../env.js"),
		`
		const process={env:${JSON.stringify(process.env)}};
		globalThis.process=process.env;`,
	);

	fs.writeFileSync(
		workerCode,
		`
		import "./env";
		${fs.readFileSync(workerCode)}`
	);

	// Replace Nitro's config so Cloudflare will serve the HTML from the CDN instead of the worker (they can do "304 Not Modified" & ETag caching).
	fs.writeFileSync(
		routesJson,
		JSON.stringify({
			version: 1,
			include: ["/api/*"],
			exclude: ["/_headers"],
		}),
	);
});
