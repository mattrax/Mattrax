import { bindings, defineConfig } from "cf/config";
import type { InferEnv, UnwrapConfig } from "cf/config";

const worker = {
  name: "mattrax-example-whitelabel",
  compatibilityDate: "2026-10-06",
  compatibilityFlags: ["nodejs_compat"],
  entrypoint: "./src/index.ts",
  assets: {
    notFoundHandling: "single-page-application" as const,
    runWorkerFirst: true,
  },
  observability: { enabled: true },
  env: {
    ORIGIN: bindings.text("http://localhost:9051"),
    AUTH_SECRET: bindings.secret(),
    /** Optional white-label identity used in generated enrollment profiles. */
    BRAND_NAME: bindings.text("Mattrax"),
    BRAND_LOGO_URL: bindings.text(""),
    SUPPORT_EMAIL: bindings.text("hello@mattrax.app"),
    BRAND_COLOR: bindings.text("#1c1917"),
    /** Required: webhook authentication fails closed when this is unset. */
    WEBHOOK_SECRET: bindings.secret(),
    APNS_CERT: bindings.secret(),
    APNS_KEY: bindings.secret(),
    DB: bindings.d1({ name: "mattrax-whitelabel" }),
    APPS: bindings.r2({ name: "mattrax-whitelabel" }),
    ASSETS: bindings.assets(),
  },
};

export type ExampleWhitelabelConfig = UnwrapConfig<typeof worker>;
export type ExampleWhitelabelEnv = InferEnv<ExampleWhitelabelConfig>;

export default defineConfig({ worker });
