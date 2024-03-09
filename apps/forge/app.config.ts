import { defineConfig } from "@solidjs/start/config";
import tsconfigPaths from "vite-tsconfig-paths";
import Icons from "unplugin-icons/vite";
import IconsResolver from "unplugin-icons/resolver";
import AutoImport from "unplugin-auto-import/vite";
import { visualizer } from "rollup-plugin-visualizer";
import { cloudflare } from "unenv";

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
		unenv: cloudflare,
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
