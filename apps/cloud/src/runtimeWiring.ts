import { makeGoogleTokenCache } from "@mattrax/cloud-services";
import { makeAzureGraphTokenCache } from "@mattrax/azure-graph";
import { BackgroundDeliveryKeepAlive } from "@mattrax/mdm-core";

/** The subset of Cloudflare's ExecutionContext the runtime needs. */
export type WaitUntilContext = {
  readonly waitUntil: (promise: Promise<unknown>) => void;
};

/**
 * Provider state that is safe to share across rebuilt request graphs.
 *
 * These caches hold only serializable tokens. Database sockets and HTTP
 * transports stay inside each request's layer.
 */
export const hostedRuntimeCaches = {
  azureGraph: makeAzureGraphTokenCache(),
  google: makeGoogleTokenCache(),
} as const;

export const hostedAzureGraphOptions = {
  tokenCache: hostedRuntimeCaches.azureGraph,
} as const;

export const hostedAndroidManagementOptions = {
  tokenCache: hostedRuntimeCaches.google,
} as const;

export const hostedAndroidRouteOptions = {
  sharedJwks: true,
} as const;

/**
 * Tie queued delivery jobs to the Worker invocation. Every accepted job gets a
 * promise that resolves when it settles, so `waitUntil` keeps the isolate alive
 * without delaying the response.
 */
export const backgroundDeliveryKeepAlive = (ctx: WaitUntilContext) =>
  BackgroundDeliveryKeepAlive.of({
    track: (work) => ctx.waitUntil(work),
  });
