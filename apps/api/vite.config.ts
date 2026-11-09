import { defineConfig } from "vite";
import { cloudflare } from "@cloudflare/vite-plugin";

export default defineConfig({
  server: {
    port: 9050,
    allowedHosts: ["dev.otbeaumont.me"],
  },
  plugins: [cloudflare()],
});
