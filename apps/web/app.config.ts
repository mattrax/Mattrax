import { visualizer } from "rollup-plugin-visualizer";
import { defineConfig } from "@solidjs/start/config";
import tsconfigPaths from "vite-tsconfig-paths";
import devtools from "solid-devtools/vite";
import mattraxUI from "@mattrax/ui/vite";
import { cloudflare } from "unenv";
import path from "node:path";
import fs from "node:fs";

import { monorepoRoot } from "./loadEnv";
import "./src/env";

export default defineConfig({
	ssr: false,
	routeDir: "app",
	vite: {
		envDir: monorepoRoot,
		build: {
			// Safari mobile has problems with newer syntax
			target: "es2015",
		},
		plugins: [
			devtools(),
			tsconfigPaths({
				// If this isn't set Vinxi hangs on startup
				root: ".",
			}),
			mattraxUI,
			!(process.env.VERCEL === "1")
				? visualizer({ brotliSize: true, gzipSize: true })
				: undefined,
		],
	},
	server: {
		unenv: cloudflare,
		// TODO: We could probs PR this to the Vercel Edge preset in Nitro.
		// This is to ensure Stripe pulls in the Cloudflare Workers version not the Node version.
		// exportConditions: ["worker"],
		esbuild: {
			external: ["cloudflare:sockets"],
		},
		experimental: {
			asyncContext: true,
		},
	},
});

process.on("exit", () => {
	const workerCode = path.join("dist", "_worker.js", "chunks", "runtime.mjs");

	if (!fs.existsSync(workerCode)) {
		console.warn("Skipping Cloudflare env patching...");
		return;
	}

	// Cloudflare doesn't allow access to env outside the handler.
	// So we ship the env with the worker code.
	fs.writeFileSync(
		path.join(workerCode, "../env.mjs"),
		`const process={env:${JSON.stringify(
			process.env,
		)}};globalThis.process=process;`,
	);

	fs.writeFileSync(
		workerCode,
		`import "./env.mjs";\n${fs.readFileSync(workerCode)}`,
	);
});
