import { cloudflare } from "@cloudflare/vite-plugin";
import { defineConfig } from "vite-plus";

export default defineConfig({
	plugins: [cloudflare()],
	server: {
	  port: 9050,
  	allowedHosts: ["dev.otbeaumont.me"]
	}
});
