import { bindings, defineConfig } from "cf/config";
import type { InferEnv, UnwrapConfig } from "cf/config";

export const webWorker = {
  name: "mattrax",
  compatibilityDate: "2026-10-06",
  compatibilityFlags: ["nodejs_compat"],
  entrypoint: "@solidjs/start/server/entry",
  domains: ["e.mattrax.app"],
  previewUrls: true,
  observability: { enabled: true },
  env: {
    API: bindings.worker({ worker: "mattrax-api" }),
  },
};

export type WebConfig = UnwrapConfig<typeof webWorker>;
export type WebEnv = InferEnv<WebConfig>;

export default defineConfig({ worker: webWorker });
