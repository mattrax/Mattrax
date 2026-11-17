import { describe, expect, it } from "vitest";
import { deploymentIdFromResponse } from "./deployment-meta";
import {
  chunkReloadAllowed,
  clearDeploymentAnnouncement,
  type DeploymentStorage,
  isChunkLoadFailure,
  markDeploymentAnnounced,
  shouldAnnounceDeployment,
} from "./skew-protection";

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
