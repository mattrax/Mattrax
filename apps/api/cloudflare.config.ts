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
    // `ORIGIN` is a secret so local dev and whitelabel deployments can set
    // their own canonical origin. Production sets the hosted Mattrax domain.
    ORIGIN: bindings.secret(),
    TRUSTED_ORIGINS: bindings.secret(),
    AUTH_RESET_URL: bindings.secret(),
    AUTH_SECRET: bindings.secret(),
    STRIPE_SECRET_KEY: bindings.secret(),
    STRIPE_WEBHOOK_SECRET: bindings.secret(),
    STRIPE_DEVICE_MONTHLY_PRICE_ID: bindings.secret(),
    CLOUD_APPLE_VENDOR_CERT: bindings.secret(),
    CLOUD_APPLE_VENDOR_KEY: bindings.secret(),
    APNS_RELAY_URL: bindings.secret(),
    APNS_RELAY_SECRET: bindings.secret(),
    HYPERDRIVE: bindings.hyperdrive({
      id: "239e6b5c776b47a2bcdd180e8798ce7a",
      // Local dev only. The Worker reads the individual host/port/user/password/
      // database fields; Hyperdrive's production binding supplies them.
      dev: { connectionString: "mysql://mattrax:mattrax@localhost:3306/mattraxe" },
    }),
    STORAGE: bindings.r2({ name: "mattrax" }),
    EMAIL: bindings.sendEmail({
      allowedSenderAddresses: ["hello@mattrax.cloud"],
      // Keep local test mail in the local explorer instead of the remote service.
      dev: { remote: false },
    }),
  },
};

export type ApiConfig = UnwrapConfig<typeof apiWorker>;
export type ApiEnv = InferEnv<ApiConfig>;

export default defineConfig({ worker: apiWorker });
