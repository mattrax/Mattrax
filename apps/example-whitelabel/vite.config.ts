import { cloudflare } from "@cloudflare/vite-plugin";
import solid from "vite-plugin-solid";
import { defineConfig } from "vite-plus";

export default defineConfig({
  plugins: [solid(), cloudflare()],
  server: {
    port: 9051,
    allowedHosts: ["dev.otbeaumont.me"],
  },
});
