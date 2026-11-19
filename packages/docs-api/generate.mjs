import { mkdir, rm } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { Application } from "typedoc";
import { load } from "typedoc-plugin-markdown";

/**
 * Generate the TypeScript reference for the management backend SDK.
 *
 * Rspress recommends its TypeDoc plugin for API pages, and this produces the
 * same `typedoc-plugin-markdown` output that plugin would. It runs TypeDoc
 * directly because the plugin cannot pass `tsconfig` through: TypeDoc reads
 * `tsconfig.json` from the working directory during bootstrap, and the repo
 * root is a solution-style config whose project references make TypeDoc
 * convert the whole workspace (and exceed the Node heap).
 *
 * The docs' own tsconfig, below, points at `sdk.ts` and nothing else. The
 * depth cap keeps Effect's generic types from being expanded into an
 * unreadable page.
 */
const here = path.dirname(fileURLToPath(import.meta.url));

const repoRoot = path.resolve(here, "..", "..");

const outDir = path.join(repoRoot, "docs", "api", "sdk");

const app = await Application.bootstrapWithPlugins({
  name: "SDK reference",
  entryPoints: [path.join(here, "sdk.ts")],
  tsconfig: path.join(repoRoot, "docs", ".config", "tsconfig.typedoc.json"),
  disableSources: true,
  router: "kind",
  readme: "none",
  githubPages: false,
  requiredToBeDocumented: ["Class", "Function", "Interface"],
  plugin: [load],
  entryFileName: "index",
  hidePageHeader: true,
  hideBreadcrumbs: true,
  pageTitleTemplates: { module: "{kind}: {name}" },
  cleanOutputDir: false,
  excludeExternals: true,
  skipErrorChecking: true,
  maxTypeConversionDepth: 2,
});

const project = await app.convert();

if (!project) throw new Error("TypeDoc could not convert packages/docs-api/sdk.ts");

await rm(outDir, { recursive: true, force: true });

await mkdir(outDir, { recursive: true });

await app.outputs.writeOutput({ name: "markdown", path: outDir }, project);

console.log(`Generated SDK reference in ${path.relative(repoRoot, outDir)}`);
