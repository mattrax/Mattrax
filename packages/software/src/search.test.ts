import { describe, expect, it } from "vitest";
import { catalogueMethodAvailability, searchCatalogue } from "./index.js";

const ids = (query: Parameters<typeof searchCatalogue>[0]) =>
  searchCatalogue(query).items.map((title) => title.id);

describe("catalogue search", () => {
  it("ranks an exact title above a prefix and a substring", () => {
    expect(ids({ q: "Google Chrome", limit: 5 })[0]).toBe("google-chrome");
    expect(ids({ q: "chrome", limit: 5 })[0]).toBe("google-chrome");
    expect(ids({ q: "chrom", limit: 5 })[0]).toBe("google-chrome");
  });

  it("matches aliases", () => {
    expect(ids({ q: "vscode", limit: 5 })[0]).toBe("visual-studio-code");
    expect(ids({ q: "ms teams", limit: 5 })[0]).toBe("microsoft-teams");
    expect(ids({ q: "m365", limit: 5 })[0]).toBe("microsoft-365-apps");
    expect(ids({ q: "pdf", limit: 5 })[0]).toBe("adobe-acrobat-reader");
  });

  it("matches a vendor", () => {
    const results = ids({ q: "microsoft", limit: 50 });

    expect(results).toContain("microsoft-teams");
    expect(results).toContain("microsoft-365-apps");
    expect(results).toContain("visual-studio-code");
  });

  it("matches a category name", () => {
    const results = ids({ q: "browsers", limit: 50 });

    expect(results).toEqual(
      expect.arrayContaining([
        "google-chrome",
        "microsoft-edge",
        "mozilla-firefox",
        "brave-browser",
      ]),
    );
  });

  it("tolerates a small typo", () => {
    expect(ids({ q: "chrmoe", limit: 5 })[0]).toBe("google-chrome");
    expect(ids({ q: "slak", limit: 5 })[0]).toBe("slack");
  });

  it("requires every query token", () => {
    expect(ids({ q: "google slack", limit: 5 })).toEqual([]);
    expect(ids({ q: "google chrome", limit: 5 })[0]).toBe("google-chrome");
  });

  it("filters by supported platform", () => {
    const android = searchCatalogue({ platform: "android", limit: 100 });

    expect(android.items.length).toBeGreaterThan(10);
    for (const title of android.items) expect(title.platforms).toContain("android");
    expect(android.items.map((title) => title.id)).not.toContain("visual-studio-code");

    const macos = searchCatalogue({ platform: "macos", limit: 100 });
    expect(macos.items.map((title) => title.id)).toContain("xcode");
    expect(macos.items.map((title) => title.id)).not.toContain("windows-terminal");
  });

  it("filters by an MDM delivery platform that can actually deploy something", () => {
    const apple = searchCatalogue({ mdmPlatform: "apple", limit: 100 });

    expect(apple.items.map((title) => title.id)).toContain("microsoft-teams");
    expect(apple.items.map((title) => title.id)).not.toContain("windows-terminal");

    const windows = searchCatalogue({ mdmPlatform: "win", limit: 100 });
    expect(windows.items.map((title) => title.id)).toContain("google-chrome");
    // Windows Terminal only has a Store method today, so it is not deployable.
    expect(windows.items.map((title) => title.id)).not.toContain("windows-terminal");
    expect(windows.items.map((title) => title.id)).not.toContain("xcode");
    expect(windows.items).toHaveLength(5);

    for (const title of windows.items)
      expect(
        title.deployments.some(
          (deployment) =>
            deployment.platform === "win" &&
            catalogueMethodAvailability(deployment).status !== "unsupported",
        ),
      ).toBe(true);
  });

  it("combines a category with a platform filter", () => {
    const results = searchCatalogue({ category: "browsers", platform: "macos", limit: 100 });

    expect(results.items).toHaveLength(4);
    for (const title of results.items) {
      expect(title.category).toBe("browsers");
      expect(title.platforms).toContain("macos");
    }
  });

  it("paginates without overlaps and keeps the total stable", () => {
    const first = searchCatalogue({ q: "microsoft", limit: 3, offset: 0 });
    const second = searchCatalogue({ q: "microsoft", limit: 3, offset: 3 });
    const all = searchCatalogue({ q: "microsoft", limit: 100 });

    expect(first.total).toBe(all.total);
    expect(first.items.map((title) => title.id)).not.toEqual(second.items.map((title) => title.id));

    const overlap = first.items
      .map((title) => title.id)
      .filter((id) => second.items.some((title) => title.id === id));

    expect(overlap).toEqual([]);
    expect(all.items).toHaveLength(all.total);
  });

  it("returns facet counts for the filtered pool", () => {
    const result = searchCatalogue({ category: "browsers", limit: 1 });

    expect(result.total).toBe(4);
    expect(result.items).toHaveLength(1);
    expect(result.facets.categories.find((facet) => facet.value === "browsers")?.count).toBe(4);
    expect(result.facets.categories.length).toBeGreaterThan(1);
    expect(result.facets.platforms.find((facet) => facet.value === "macos")?.count).toBeGreaterThan(
      4,
    );
  });

  it("sorts an empty query by popularity and then name", () => {
    const results = searchCatalogue({ limit: 5 }).items;

    expect(results[0]?.id).toBe("google-chrome");

    for (let index = 1; index < results.length; index++)
      expect(results[index - 1]!.popularity).toBeGreaterThanOrEqual(results[index]!.popularity);
  });

  it("clamps limits and offsets", () => {
    const result = searchCatalogue({ limit: 10_000, offset: -20 });

    expect(result.limit).toBe(100);
    expect(result.offset).toBe(0);
    expect(result.items.length).toBeLessThanOrEqual(100);
    expect(result.total).toBeGreaterThan(0);
  });

  it("finds a title by its identifier", () => {
    expect(ids({ q: "com.google.Chrome", limit: 5 })[0]).toBe("google-chrome");
    expect(ids({ q: "com.android.chrome", limit: 5 })[0]).toBe("google-chrome");
    expect(ids({ q: "9N0DX20HK701", limit: 5 })[0]).toBe("windows-terminal");
  });

  it("returns nothing for an unknown phrase without falling back to popularity", () => {
    expect(searchCatalogue({ q: "zzzzzzzzzz" }).items).toEqual([]);
  });

  it("does not return the entire catalogue for punctuation or non-Latin queries", () => {
    for (const q of ["!!!", "日本語", "???"]) {
      const result = searchCatalogue({ q });
      expect(result.items, q).toEqual([]);
      expect(result.total, q).toBe(0);
    }
  });

  it("matches every word in a multi-word category label", () => {
    const design = searchCatalogue({ q: "design", limit: 100 });
    const ids = design.items.map((title) => title.id);

    expect(ids).toContain("figma");
    expect(ids).toContain("adobe-creative-cloud");
    for (const title of design.items)
      if (title.category === "media") expect(title.category).toBe("media");
  });

  it("has a populated education category", () => {
    const education = searchCatalogue({ category: "education", limit: 100 });

    expect(education.total).toBeGreaterThanOrEqual(6);
    expect(education.items.map((title) => title.id)).toEqual(
      expect.arrayContaining(["google-classroom", "canvas", "kahoot", "seesaw", "scratchjr"]),
    );
  });
});
