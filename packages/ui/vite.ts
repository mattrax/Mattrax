import IconsResolver from "unplugin-icons/resolver";
import AutoImport from "unplugin-auto-import/vite";
import Icons from "unplugin-icons/vite";
import type { PluginOption } from "vite";

export default [
	AutoImport({
		resolvers: [IconsResolver({ prefix: "Icon", extension: "jsx" })],
		dts: new URL("./src/auto-imports.d.ts", import.meta.url).pathname,
	}),
	Icons({ compiler: "solid" }),
] satisfies PluginOption;
