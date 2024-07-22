import mattraxUI from "@mattrax/ui/vite";
import { defineConfig } from "vite";
import solid from "vite-plugin-solid";

export default defineConfig({
	plugins: [solid(), mattraxUI],
});
