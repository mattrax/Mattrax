import { bindings, defineConfig } from "cf/config";
import type { InferEnv, UnwrapConfig } from "cf/config";

export const webWorker = {
  name: "mattrax",
  compatibilityDate: "2026-10-06",
  compatibilityFlags: ["nodejs_compat"],
  entrypoint: new URL("./src/server/index.ts", import.meta.url).pathname,
  domains: ["e.mattrax.app"],
  previewUrls: false,
  observability: { enabled: true },
  env: {
    API: bindings.worker({ worker: "mattrax-api" }),
  },
};

export type WebConfig = UnwrapConfig<typeof webWorker>;
export type WebEnv = InferEnv<WebConfig>;

export default defineConfig({ worker: webWorker });
