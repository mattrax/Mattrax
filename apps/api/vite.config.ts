import { defineConfig, loadEnv } from "vite";
import { cloudflare } from "@cloudflare/vite-plugin";

export default defineConfig(({ mode }) => ({
 	server: {
	  port: 9050,
   	allowedHosts: ["dev.otbeaumont.me"]
  },
	plugins: [
		cloudflare({
      config:
          mode === "development"
            ? { vars: { ...process.env, ...loadEnv("development", "../../", "") } as any }
            : undefined,
		})
	],
}));
