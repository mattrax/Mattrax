import { execSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { apiRoutes, frontendRoutes, headers } from "./config.js";

const __dirname = path.dirname(new URL(import.meta.url).pathname);

const dist = path.join(__dirname, "dist");

execSync("pnpm web build", {
	stdio: "inherit",
	cwd: path.join(__dirname, "..", ".."),
	env: {
		NITRO_PRESET: "cloudflare_pages",
		...process.env,
	},
});

if (fs.existsSync(dist)) fs.rmSync(dist, { recursive: true });
fs.mkdirSync(dist);

// Copy frontend build
fs.cpSync(path.join(__dirname, "..", "web", "dist"), dist, { recursive: true });

// Cleanup Vinxi output
fs.rmSync(path.join(dist, "_worker.js"), { recursive: true, force: true });
fs.rmSync(path.join(dist, "nitro.json"));
fs.rmSync(path.join(dist, "_build", ".vite", "manifest.json"));
fs.rmSync(path.join(dist, "_build", "server-functions-manifest.json"));

// Cloudflare configuration
fs.copyFileSync(path.join(dist, "index.html"), path.join(dist, "404.html"));

fs.writeFileSync(
	path.join(dist, "_routes.json"),
	JSON.stringify({
		version: 1,
		include: apiRoutes,
	}),
);

fs.writeFileSync(
	path.join(dist, "_redirects"),
	frontendRoutes.map((route) => `${route} /index.html 200`).join("\n"),
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
