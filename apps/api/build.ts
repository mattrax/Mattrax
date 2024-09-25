import { execSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { build } from "esbuild";
import { solidPlugin } from "esbuild-plugin-solid";
import { apiRoutes, headers } from "./config.js";

const __dirname = path.dirname(new URL(import.meta.url).pathname);

const dist = path.join(__dirname, "dist");

// Get git SHA
const gitSha = execSync("git rev-parse HEAD").toString().trim();

// Cleanup previous builds
if (fs.existsSync(dist)) fs.rmSync(dist, { recursive: true });
fs.mkdirSync(dist);

const webDist = path.join(__dirname, "..", "web", "dist");
if (fs.existsSync(webDist)) fs.rmSync(webDist, { recursive: true });

// Build UI
execSync("pnpm web build", {
	stdio: "inherit",
	cwd: path.join(__dirname, "..", ".."),
	env: {
		NITRO_PRESET: "cloudflare_pages",
		GIT_SHA: gitSha,
		...process.env,
	},
});

// Copy frontend build
fs.cpSync(path.join(__dirname, "..", "web", "dist"), dist, { recursive: true });

// Cleanup Vinxi/Nitro output
fs.rmSync(path.join(dist, "_worker.js"), { recursive: true, force: true });
fs.rmSync(path.join(dist, "nitro.json"));
fs.rmSync(path.join(dist, "_build", ".vite", "manifest.json"));
fs.rmSync(path.join(dist, "_build", "server-functions-manifest.json"));
fs.rmSync(path.join(dist, "_redirects"));
fs.rmSync(path.join(dist, "_headers"));
fs.rmSync(path.join(dist, "_routes.json"));

// Build worker
const result = await build({
	bundle: true,
	format: "esm",
	charset: "utf8",
	sourcemap: false,
	outdir: path.join(dist, "_worker.js"),
	entryPoints: ["./src/index.ts"],
	logLevel: "info",
	resolveExtensions: [".tsx", ".ts", ".jsx", ".mjs", ".js", ".json"],
	mainFields: ["solid", "worker", "browser", "module", "jsnext", "main"],
	conditions: ["solid", "worker", "browser", "import", "production"],
	platform: "node",
	splitting: true,
	plugins: [solidPlugin({ solid: { generate: "ssr" } })],
	define: {
		"import.meta.env": JSON.stringify({
			DEV: false,
			NODE_ENV: JSON.stringify("production"),
			GIT_SHA: gitSha,
		}),
	},
	metafile: true,
});

if (result.errors.length > 0) process.exit(1);

// TODO: Disable in prod
fs.writeFileSync(
	path.join(dist, "_worker.js", "meta.json"),
	JSON.stringify(result.metafile),
);

// Cloudflare configuration
fs.writeFileSync(
	path.join(dist, "_routes.json"),
	JSON.stringify({
		version: 1,
		include: apiRoutes,
		exclude: [],
	}),
);

fs.writeFileSync(
	path.join(dist, "_headers"),
	Object.entries(headers)
		.map(
			([route, headers]) =>
				`${route}\n${Object.entries(headers)
					.map(([key, value]) => `\t${key}: ${value}`)
					.join("\n")}`,
		)
		.join("\n"),
);

console.log("Build complete!");
