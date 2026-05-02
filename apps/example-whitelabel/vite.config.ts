import { cloudflare } from "@cloudflare/vite-plugin";
import { defineConfig } from "vite-plus";

export default defineConfig({
  plugins: [cloudflare()],
  server: {
    port: 9051,
    allowedHosts: ["dev.otbeaumont.me"]
  }
});
