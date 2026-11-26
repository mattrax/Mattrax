import { describe, expect, it } from "vitest";
import {
  backgroundDeliveryKeepAlive,
  hostedAndroidManagementOptions,
  hostedAndroidRouteOptions,
  hostedAzureGraphOptions,
  hostedRuntimeCaches,
} from "./runtimeWiring.js";

describe("hosted runtime cache wiring", () => {
  it("passes each request keep-alive to ctx.waitUntil without wrapping it", () => {
    const tracked: Array<Promise<unknown>> = [];
    const keepAlive = backgroundDeliveryKeepAlive({
      waitUntil: (work) => {
        tracked.push(work);
      },
    });
    const first = Promise.resolve("first");
    const second = Promise.resolve("second");

    keepAlive.track(first);
    keepAlive.track(second);

    expect(tracked).toEqual([first, second]);
  });

  it("shares the isolate token caches with the layers that use them", () => {
    expect(hostedAzureGraphOptions.tokenCache).toBe(hostedRuntimeCaches.azureGraph);
    expect(hostedAndroidManagementOptions.tokenCache).toBe(hostedRuntimeCaches.google);
    expect(hostedAzureGraphOptions.tokenCache).not.toBe(hostedRuntimeCaches.google);
  });

  it("enables the shared Pub/Sub key set for hosted Android routes", () => {
    expect(hostedAndroidRouteOptions).toEqual({ sharedJwks: true });
  });
});
