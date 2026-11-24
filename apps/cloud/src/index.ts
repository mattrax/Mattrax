import "reflect-metadata";
import * as Workerd from "@yielded/auth-platform-workerd";
import { createApiRuntime } from "./app.js";

export { PersonalDeviceViewsObject, TenantDeviceViewsObject } from "./deviceViewObjects.js";

/**
 * Cloudflare Worker entry point.
 *
 * The runtime itself lives in `app.ts` so a Node host can run the same routes
 * with its own crypto layer and bindings.
 */
export default createApiRuntime(Workerd.layer);
