import { defineConfig } from "@solidjs/start/config";
import tsconfigPaths from "vite-tsconfig-paths";

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
		},
		plugins: [tsconfigPaths()],
	},
});
