import { Schema } from "effect";
import { describe, expect, it } from "vitest";
import {
  CATALOGUE_TITLES,
  CatalogueTitle,
  catalogueMethodAvailability,
  CATALOGUE_DEPLOYMENT_KINDS,
} from "./index.js";

const titles = Array.from(CATALOGUE_TITLES);

const methodTargetPlatform = (target: string): "apple" | "win" | "android" => {
  if (target === "windows") return "win";
  if (target === "android") return "android";
  return "apple";
};

describe("catalogue data", () => {
  it("decodes against the published schema", () => {
    expect(() => Schema.decodeUnknownSync(Schema.Array(CatalogueTitle))(titles)).not.toThrow();
  });

  it("has unique, stable title ids and non-empty copy", () => {
    const ids = titles.map((title) => title.id);

    expect(new Set(ids).size).toBe(ids.length);

    for (const title of titles) {
      expect(title.id).toMatch(/^[a-z0-9]+(?:-[a-z0-9]+)*$/);
      expect(title.name.trim()).not.toBe("");
      expect(title.vendor.trim()).not.toBe("");
      expect(title.description.trim().length).toBeGreaterThan(20);
      expect(title.website).toMatch(/^https:\/\//);
      expect(title.popularity).toBeGreaterThanOrEqual(0);
    }
  });

  it("keeps deployment methods internally consistent", () => {
    for (const title of titles) {
      const methodIds = title.deployments.map((method) => method.id);

      expect(new Set(methodIds).size, title.id).toBe(methodIds.length);

      for (const method of title.deployments) {
        expect(title.platforms, title.id + "/" + method.id).toContain(method.target);
        expect(method.platform, title.id + "/" + method.id).toBe(
          methodTargetPlatform(method.target),
        );
        expect(CATALOGUE_DEPLOYMENT_KINDS).toContain(method.kind);

        if (method.kind === "apple-app-store") {
          expect(method.storeId, title.id).toMatch(/^\d+$/);
          expect(method.bundleId, title.id).toBeTruthy();
        }

        if (method.kind === "apple-pkg" || method.kind === "apple-upload") {
          expect(method.target, title.id).toBe("macos");
          expect(method.bundleId, title.id).toBeTruthy();
        }

        if (
          method.kind === "apple-pkg" ||
          method.kind === "windows-msi" ||
          method.kind === "windows-msix" ||
          method.kind === "windows-exe" ||
          method.kind === "vendor-download"
        )
          expect(method.url, title.id + "/" + method.id).toMatch(/^https:\/\//);

        if (method.kind === "windows-msi") {
          expect(method.platform, title.id).toBe("win");
          expect(method.target, title.id).toBe("windows");
          expect(method.url, title.id).toMatch(/^https:\/\//);
        }

        if (method.kind === "windows-store")
          expect(method.microsoftStoreId, title.id).toMatch(/^[A-Z0-9]{12,16}$/);

        if (method.kind === "android-play") {
          expect(method.target, title.id).toBe("android");
          expect(method.packageName, title.id).toMatch(/^[a-z][a-z0-9_]*(?:\.[a-z0-9_]+)+$/i);
        }
      }

      // Every iOS title also reaches iPad: no App Store record in this catalogue
      // is iPhone-only.
      if (title.platforms.includes("ios")) expect(title.platforms, title.id).toContain("ipados");
    }
  });

  it("does not invent versions or hashes", () => {
    const serialised = JSON.stringify(titles).toLowerCase();

    expect(serialised).not.toContain("sha256");
    expect(serialised).not.toContain("sha-256");
    for (const title of titles)
      for (const method of title.deployments) {
        expect(method).not.toHaveProperty("version");
        expect(method).not.toHaveProperty("sha256");
      }
  });

  it("covers the titles the software catalogue was opened for", () => {
    const ids = new Set(titles.map((title) => title.id));

    for (const id of [
      "google-chrome",
      "slack",
      "microsoft-teams",
      "microsoft-365-apps",
      "adobe-creative-cloud",
      "spotify",
      "zed",
      "visual-studio-code",
      "iterm2",
      "ghostty",
      "windows-terminal",
      "zoom-workplace",
      "1password",
      "opencode",
      "google-classroom",
      "canvas",
      "kahoot",
      "seesaw",
      "minecraft-education",
      "google-earth",
      "scratchjr",
      "scratch",
    ])
      expect(ids, id).toContain(id);
  });

  it("has real macOS App Store ids for the titles reviewed live", () => {
    const macStoreId = (id: string) =>
      titles
        .find((title) => title.id === id)
        ?.deployments.find(
          (method) => method.kind === "apple-app-store" && method.target === "macos",
        )?.storeId;

    expect(macStoreId("slack")).toBe("803453959");
    expect(macStoreId("trello")).toBe("1278508951");
    expect(macStoreId("bitwarden")).toBe("1352778147");
    expect(macStoreId("tailscale")).toBe("1475387142");
  });

  it("populates education with real store deployments", () => {
    const education = titles.filter((title) => title.category === "education");

    expect(education.length).toBeGreaterThanOrEqual(8);
    for (const title of education)
      if (title.id !== "scratch")
        expect(
          title.deployments.some(
            (method) => method.kind === "apple-app-store" || method.kind === "android-play",
          ),
        ).toBe(true);
  });

  it("marks every method's current delivery status honestly", () => {
    for (const title of titles)
      for (const method of title.deployments) {
        const availability = catalogueMethodAvailability(method);

        if (method.kind === "windows-store" || method.kind === "windows-msix")
          expect(availability.status, title.id).toBe("unsupported");

        if (method.kind === "apple-app-store" || method.kind === "android-play")
          expect(availability.status, title.id).toBe("ready");
      }
  });
});
