import { defineConfig } from "@solidjs/start/config";
import tsconfigPaths from "vite-tsconfig-paths";
import mattraxUI from "@mattrax/ui/vite";

export default defineConfig({
	ssr: false,
	routeDir: "app",
	vite: {
		server: {
			strictPort: true,
			port: 1420,
			watch: {
				ignored: ["**/src-tauri/**"],
			},
			fs: {
				allow: ["../../node_modules"],
			},
		},
		plugins: [tsconfigPaths(), mattraxUI],
	},
});
