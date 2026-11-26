import { describe, expect, it } from "vitest";
import { deploymentIdFromResponse } from "./deployment-meta";
import {
  CHUNK_RELOAD_PARAM,
  chunkFailureAssetUrl,
  chunkReloadAllowed,
  chunkReloadTarget,
  clearDeploymentAnnouncement,
  isChunkAssetUrl,
  isChunkLoadFailure,
  markDeploymentAnnounced,
  preloadFailureMessage,
  shouldAnnounceDeployment,
  stripChunkReloadMarker,
} from "./skew-protection";
import type { DeploymentStorage } from "./skew-protection";

const memoryStorage = (): DeploymentStorage => {
  const values = new Map<string, string>();

  return {
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => void values.set(key, value),
    removeItem: (key) => void values.delete(key),
  };
};

describe("chunk load failures", () => {
  it.each([
    "Failed to fetch dynamically imported module: https://e.mattrax.app/assets/devices-abc.js",
    "error loading dynamically imported module",
    "Importing a module script failed.",
    "Failed to load module script: Expected a JavaScript module script",
    "ChunkLoadError: Loading chunk 42 failed.",
    "Unable to preload CSS for /assets/app.css",
  ])("recognises %s", (message) => {
    expect(isChunkLoadFailure(message)).toBe(true);
  });

  it("leaves ordinary application errors alone", () => {
    expect(isChunkLoadFailure("Cannot read properties of undefined")).toBe(false);
    expect(isChunkLoadFailure("The device list request failed")).toBe(false);
  });
});

describe("chunk failure attribution", () => {
  const origin = "https://e.mattrax.app";

  it("accepts only same-origin build assets", () => {
    expect(isChunkAssetUrl("https://e.mattrax.app/assets/devices-abc.js", origin)).toBe(true);
    expect(isChunkAssetUrl("/assets/app.css", origin)).toBe(true);
    expect(isChunkAssetUrl("https://cdn.example.com/assets/devices.js", origin)).toBe(false);
    expect(isChunkAssetUrl("https://e.mattrax.app/media/devices.js", origin)).toBe(false);
  });

  it("extracts a same-origin asset URL from a browser message", () => {
    expect(
      chunkFailureAssetUrl(
        "Failed to fetch dynamically imported module: https://e.mattrax.app/assets/devices-abc.js",
        origin,
      ),
    ).toBe("https://e.mattrax.app/assets/devices-abc.js");

    expect(chunkFailureAssetUrl("Unable to preload CSS for /assets/app.css", origin)).toBe(
      "/assets/app.css",
    );
  });

  it("ignores third-party import failures", () => {
    expect(
      chunkFailureAssetUrl(
        "Failed to fetch dynamically imported module: https://cdn.example.com/assets/analytics.js",
        origin,
      ),
    ).toBeUndefined();

    expect(
      chunkFailureAssetUrl(
        "Importing a module script failed: https://cdn.example.com/assets/analytics.js",
        origin,
      ),
    ).toBeUndefined();
  });

  it("fails closed when the message has no verifiable URL", () => {
    expect(chunkFailureAssetUrl("Importing a module script failed.", origin)).toBeUndefined();
    expect(chunkFailureAssetUrl("Loading chunk 42 failed.", origin)).toBeUndefined();
  });
});

describe("Vite preload error events", () => {
  it("reads the payload Vite assigns to a plain Event", () => {
    const event = new Event("vite:preloadError");

    Object.defineProperty(event, "payload", {
      value: new Error("Failed to fetch dynamically imported module: /assets/devices.js"),
    });

    expect(preloadFailureMessage(event)).toBe(
      "Failed to fetch dynamically imported module: /assets/devices.js",
    );
  });

  it("accepts a CustomEvent detail for compatibility", () => {
    const event = new CustomEvent("vite:preloadError", {
      detail: new Error("Unable to preload CSS for /assets/app.css"),
    });

    expect(preloadFailureMessage(event)).toBe("Unable to preload CSS for /assets/app.css");
  });

  it("ignores an event without an error payload", () => {
    expect(preloadFailureMessage(new Event("vite:preloadError"))).toBeUndefined();
  });
});

describe("chunk reload guard", () => {
  it("allows one automatic reload inside the cooldown", () => {
    const storage = memoryStorage();

    expect(chunkReloadAllowed(storage, 1_000)).toBe(true);
    expect(chunkReloadAllowed(storage, 2_000)).toBe(false);
    expect(chunkReloadAllowed(storage, 31_000)).toBe(false);
  });

  it("allows another reload once the cooldown has passed", () => {
    const storage = memoryStorage();

    expect(chunkReloadAllowed(storage, 1_000)).toBe(true);
    expect(chunkReloadAllowed(storage, 1_000 + 60_000)).toBe(true);
  });

  it("does not let unavailable storage trap the caller", () => {
    const storage: DeploymentStorage = {
      getItem: () => {
        throw new Error("storage disabled");
      },
      setItem: () => {
        throw new Error("storage disabled");
      },
      removeItem: () => {
        throw new Error("storage disabled");
      },
    };

    expect(chunkReloadAllowed(storage, 1_000)).toBe(true);
  });

  it("reloads once when storage is blocked and the marker survives the reload", () => {
    const storage: DeploymentStorage = {
      getItem: () => {
        throw new Error("storage disabled");
      },
      setItem: () => {
        throw new Error("storage disabled");
      },
      removeItem: () => {
        throw new Error("storage disabled");
      },
    };

    const first = stripChunkReloadMarker("https://e.mattrax.app/dashboard");

    const target = chunkReloadTarget({
      href: first.url,
      storage,
      now: 1_000,
      alreadyAttempted: first.attempted,
    });

    expect(target).toContain(CHUNK_RELOAD_PARAM);

    if (!target) throw new Error("expected a reload target");

    const second = stripChunkReloadMarker(target);

    expect(second.attempted).toBe(true);
    expect(
      chunkReloadTarget({
        href: second.url,
        storage,
        now: 2_000,
        alreadyAttempted: second.attempted,
      }),
    ).toBeUndefined();
  });

  it("refuses a second reload while the URL still carries the marker", () => {
    const storage = memoryStorage();

    expect(
      chunkReloadTarget({
        href: `https://e.mattrax.app/dashboard?${CHUNK_RELOAD_PARAM}=1`,
        storage,
        now: 1_000,
      }),
    ).toBeUndefined();
  });

  it("keeps unrelated query parameters when stripping the marker", () => {
    const stripped = stripChunkReloadMarker(
      `https://e.mattrax.app/enroll/abc?code=secret&${CHUNK_RELOAD_PARAM}=1`,
    );

    expect(stripped.attempted).toBe(true);
    expect(stripped.url).toBe("https://e.mattrax.app/enroll/abc?code=secret");
  });
});

describe("deployment notice dedupe", () => {
  it("announces only a different build", () => {
    const storage = memoryStorage();

    expect(shouldAnnounceDeployment(storage, "build-a", "build-b")).toBe(true);
    expect(shouldAnnounceDeployment(storage, "build-a", "build-a")).toBe(false);
    expect(shouldAnnounceDeployment(storage, undefined, "build-b")).toBe(false);
    expect(shouldAnnounceDeployment(storage, "build-a", undefined)).toBe(false);
  });

  it("keeps a dismissed build quiet for the tab", () => {
    const storage = memoryStorage();

    markDeploymentAnnounced(storage, "build-b");

    expect(shouldAnnounceDeployment(storage, "build-a", "build-b")).toBe(false);
    expect(shouldAnnounceDeployment(storage, "build-b", "build-c")).toBe(true);
  });

  it("allows the notice again when a reload did not move the tab", () => {
    const storage = memoryStorage();

    markDeploymentAnnounced(storage, "build-b");
    clearDeploymentAnnouncement(storage);

    expect(shouldAnnounceDeployment(storage, "build-a", "build-b")).toBe(true);
  });
});

describe("deployment id parsing", () => {
  it("prefers the response header", () => {
    expect(
      deploymentIdFromResponse(JSON.stringify({ build: "body-build" }), " header-build "),
    ).toBe("header-build");
  });

  it("falls back to the version payload", () => {
    expect(deploymentIdFromResponse(JSON.stringify({ build: "body-build" }), null)).toBe(
      "body-build",
    );
    expect(deploymentIdFromResponse(JSON.stringify({ build: "body-build" }), "  ")).toBe(
      "body-build",
    );
  });

  it("ignores a malformed or empty payload", () => {
    expect(deploymentIdFromResponse(undefined, null)).toBeUndefined();
    expect(deploymentIdFromResponse("{not json", null)).toBeUndefined();
    expect(deploymentIdFromResponse(JSON.stringify({ version: "1.0.0" }), null)).toBeUndefined();
    expect(deploymentIdFromResponse(JSON.stringify({ build: "   " }), null)).toBeUndefined();
  });
});
