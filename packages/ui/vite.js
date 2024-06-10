import { fileURLToPath } from "node:url";
import AutoImport from "unplugin-auto-import/vite";
import IconsResolver from "unplugin-icons/resolver";
import Icons from "unplugin-icons/vite";
// import { PluginOption } from "vite";

export default [
	AutoImport({
		resolvers: [IconsResolver({ prefix: "Icon", extension: "jsx" })],
		dts: fileURLToPath(new URL("./src/auto-imports.d.ts", import.meta.url)),
	}),
	Icons({ compiler: "solid" }),
]; // satisfies PluginOption;
