import { defineConfig } from "@solidjs/start/config";
import { searchForWorkspaceRoot } from "vite";
/* @ts-ignore */
import pkg from "@vinxi/plugin-mdx";

const { default: mdx } = pkg;
export default defineConfig({
  start: {
    server: {
      prerender: {
        // We don't do this the output is `index` not `index.html`
        routes: ["/index.html", "/company/index.html", "/404.html"],
      },
    },
    extensions: ["mdx", "md"],
  },
  plugins: [
    mdx.withImports({})({
      jsx: true,
      jsxImportSource: "solid-js",
      providerImportSource: "solid-mdx",
    }),
  ],
  server: {
    port: 3001,
    fs: {
      allow: [searchForWorkspaceRoot(process.cwd())],
    },
  },
});
