import { fileURLToPath } from "node:url";
import AutoImport from "unplugin-auto-import/vite";
import IconsResolver from "unplugin-icons/resolver";
import Icons from "unplugin-icons/vite";
// import { PluginOption } from "vite";

// Workaround for https://github.com/solidjs/solid-start/issues/1374
const VinxiAutoImport = (options) => {
	const autoimport = AutoImport(options);

	return {
		...autoimport,
		transform(src, id) {
			let pathname = id;

			if (id.startsWith("/")) {
				pathname = new URL(`file://${id}`).pathname;
			}

			return autoimport.transform(src, pathname);
		},
	};
};

export default [
	VinxiAutoImport({
		resolvers: [IconsResolver({ prefix: "Icon", extension: "jsx" })],
		dts: fileURLToPath(new URL("./src/auto-imports.d.ts", import.meta.url)),
	}),
	Icons({ compiler: "solid" }),
]; // satisfies PluginOption;
