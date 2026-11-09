import { bindings, defineConfig } from "cf/config";
import type { InferEnv, UnwrapConfig } from "cf/config";

/**
 * Shared with the web Worker's Vite config so that both Workers are built
 * together and can talk to each other over the service binding during dev.
 */
export const apiWorker = {
  name: "mattrax-api",
  compatibilityDate: "2026-10-06",
  compatibilityFlags: ["nodejs_compat"],
  entrypoint: new URL("./src/index.ts", import.meta.url).pathname,
  workersDev: false,
  previewUrls: false,
  observability: { enabled: true },
  placement: { mode: "smart" as const },
  env: {
    ORIGIN: bindings.text("https://e.mattrax.app"),
    AUTH_SECRET: bindings.secret(),
    STRIPE_SECRET_KEY: bindings.secret(),
    STRIPE_WEBHOOK_SECRET: bindings.secret(),
    STRIPE_DEVICE_MONTHLY_PRICE_ID: bindings.secret(),
    CLOUD_APPLE_VENDOR_CERT: bindings.secret(),
    CLOUD_APPLE_VENDOR_KEY: bindings.secret(),
    HYPERDRIVE: bindings.hyperdrive({
      id: "08d26aaf29c7409e8d211c03ee66ca6e",
      // Local dev only. The Worker reads the individual host/port/user/password/
      // database fields; Hyperdrive's production binding supplies them.
      dev: { connectionString: "mysql://mattrax:mattrax@localhost:3306/mattrax" },
    }),
    STORAGE: bindings.r2({ name: "mattrax" }),
    EMAIL: bindings.sendEmail({ allowedSenderAddresses: ["hello@mattrax.cloud"] }),
  },
};

export type ApiConfig = UnwrapConfig<typeof apiWorker>;
export type ApiEnv = InferEnv<ApiConfig>;

export default defineConfig({ worker: apiWorker });
