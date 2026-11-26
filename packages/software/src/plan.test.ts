import { describe, expect, it } from "vitest";
import { planCatalogueAddition } from "./index.js";

describe("catalogue add plan", () => {
  it("plans an App Store and Managed Google Play install from one title", () => {
    const plan = planCatalogueAddition({
      titleId: "google-chrome",
      methods: [{ methodId: "ios-app-store" }, { methodId: "android-play" }],
    });

    expect(plan.ok).toBe(true);
    if (!plan.ok) return;

    expect(plan.applications).toEqual([
      expect.objectContaining({
        methodId: "ios-app-store",
        platform: "apple",
        target: "ios",
        name: "Google Chrome (iOS)",
        source: "store",
        bundleId: "com.google.chrome.ios",
        storeId: "535886823",
        manifestUrl: null,
      }),
      expect.objectContaining({
        methodId: "android-play",
        platform: "android",
        target: "android",
        name: "Google Chrome (Android)",
        source: "store",
        bundleId: "com.android.chrome",
        storeId: null,
      }),
    ]);
  });

  it("maps a vendor PKG to the existing manifest source", () => {
    const plan = planCatalogueAddition({
      titleId: "microsoft-teams",
      methods: [{ methodId: "macos-pkg" }],
    });

    expect(plan.ok).toBe(true);
    if (!plan.ok) return;

    expect(plan.applications[0]).toMatchObject({
      platform: "apple",
      source: "manifest",
      bundleId: "com.microsoft.teams2",
      manifestUrl: "https://go.microsoft.com/fwlink/?linkid=2249065",
    });
  });

  it("creates an upload placeholder when the vendor does not ship a PKG", () => {
    const plan = planCatalogueAddition({
      titleId: "visual-studio-code",
      methods: [{ methodId: "macos-upload" }],
    });

    expect(plan.ok).toBe(true);
    if (!plan.ok) return;

    expect(plan.applications[0]).toMatchObject({
      platform: "apple",
      source: "upload",
      bundleId: "com.microsoft.VSCode",
      manifestUrl: null,
      storeId: null,
    });
    expect(plan.applications[0]!.notes).toContain("From the Mattrax software catalogue");
  });

  it("requires a ProductCode for a Windows MSI and normalises it", () => {
    const missing = planCatalogueAddition({
      titleId: "google-chrome",
      methods: [{ methodId: "windows-msi" }],
    });

    expect(missing).toMatchObject({ ok: false });
    if (!missing.ok) expect(missing.problem).toContain("ProductCode");

    const invalid = planCatalogueAddition({
      titleId: "google-chrome",
      methods: [{ methodId: "windows-msi", productCode: "not-a-guid" }],
    });
    expect(invalid).toMatchObject({ ok: false });

    const plan = planCatalogueAddition({
      titleId: "google-chrome",
      methods: [
        {
          methodId: "windows-msi",
          productCode: "8a69f5d9-4b3d-4f7e-9c5a-1b2c3d4e5f60",
        },
      ],
    });

    expect(plan.ok).toBe(true);
    if (!plan.ok) return;

    expect(plan.applications[0]).toMatchObject({
      platform: "win",
      source: "manifest",
      bundleId: "{8A69F5D9-4B3D-4F7E-9C5A-1B2C3D4E5F60}",
      version: "1.0.0",
      manifestUrl: "https://dl.google.com/dl/chrome/install/googlechromestandaloneenterprise64.msi",
    });
    expect(plan.applications[0]!.notes).toContain("does not hash-verify");
  });

  it("rejects unbalanced ProductCode braces instead of trimming them", () => {
    const base = {
      titleId: "google-chrome",
      methods: [
        {
          methodId: "windows-msi",
          productCode: "{8A69F5D9-4B3D-4F7E-9C5A-1B2C3D4E5F60}",
        },
      ],
    };

    const balanced = planCatalogueAddition(base);
    expect(balanced).toMatchObject({ ok: true });
    if (balanced.ok)
      expect(balanced.applications[0]!.bundleId).toBe("{8A69F5D9-4B3D-4F7E-9C5A-1B2C3D4E5F60}");

    for (const productCode of [
      "{8A69F5D9-4B3D-4F7E-9C5A-1B2C3D4E5F60",
      "8A69F5D9-4B3D-4F7E-9C5A-1B2C3D4E5F60}",
      "{{8A69F5D9-4B3D-4F7E-9C5A-1B2C3D4E5F60}}",
    ])
      expect(
        planCatalogueAddition({
          titleId: "google-chrome",
          methods: [{ methodId: "windows-msi", productCode }],
        }),
      ).toMatchObject({ ok: false });
  });

  it("collects an explicit MSI installer version", () => {
    const plan = planCatalogueAddition({
      titleId: "zoom-workplace",
      methods: [
        {
          methodId: "windows-msi",
          productCode: "{8A69F5D9-4B3D-4F7E-9C5A-1B2C3D4E5F60}",
          version: "6.6.11",
        },
      ],
    });

    expect(plan).toMatchObject({ ok: true });
    if (plan.ok) expect(plan.applications[0]!.version).toBe("6.6.11");
  });

  it("uses the official signed macOS PKGs for Firefox and Microsoft 365", () => {
    const firefox = planCatalogueAddition({
      titleId: "mozilla-firefox",
      methods: [{ methodId: "macos-pkg" }],
    });
    expect(firefox).toMatchObject({ ok: true });
    if (firefox.ok)
      expect(firefox.applications[0]).toMatchObject({
        source: "manifest",
        manifestUrl:
          "https://download.mozilla.org/?product=firefox-pkg-latest-ssl&os=osx&lang=en-US",
      });

    const office = planCatalogueAddition({
      titleId: "microsoft-365-apps",
      methods: [{ methodId: "macos-pkg" }],
    });
    expect(office).toMatchObject({ ok: true });
    if (office.ok)
      expect(office.applications[0]).toMatchObject({
        source: "manifest",
        bundleId: "com.microsoft.Word",
        manifestUrl: "https://go.microsoft.com/fwlink/?linkid=525133",
      });
  });

  it("rejects a title the delivery pipeline cannot perform", () => {
    const result = planCatalogueAddition({
      titleId: "windows-terminal",
      methods: [{ methodId: "windows-store" }],
    });

    expect(result).toMatchObject({ ok: false });
    if (!result.ok) expect(result.problem).toContain("#568");
  });

  it("rejects empty, duplicate and unknown selections", () => {
    expect(planCatalogueAddition({ titleId: "slack", methods: [] })).toMatchObject({ ok: false });

    const duplicate = planCatalogueAddition({
      titleId: "slack",
      methods: [{ methodId: "ios-app-store" }, { methodId: "ios-app-store" }],
    });
    expect(duplicate).toMatchObject({ ok: false });
    if (!duplicate.ok) expect(duplicate.problem).toContain("once");

    expect(
      planCatalogueAddition({ titleId: "slack", methods: [{ methodId: "nope" }] }),
    ).toMatchObject({ ok: false });

    expect(planCatalogueAddition({ titleId: "not-a-title", methods: [] })).toMatchObject({
      ok: false,
    });
  });

  it("disambiguates two methods that share an OS target", () => {
    const plan = planCatalogueAddition({
      titleId: "slack",
      methods: [{ methodId: "macos-app-store" }, { methodId: "macos-upload" }],
    });

    expect(plan).toMatchObject({ ok: true });
    if (!plan.ok) return;

    expect(plan.applications.map((application) => application.name)).toEqual([
      "Slack (macOS · Apple App Store)",
      "Slack (macOS · Upload a signed package)",
    ]);
  });

  it("keeps a single-target title's name unsuffixed", () => {
    const plan = planCatalogueAddition({
      titleId: "xcode",
      methods: [{ methodId: "macos-app-store" }],
    });

    expect(plan.ok).toBe(true);
    if (!plan.ok) return;
    expect(plan.applications[0]!.name).toBe("Xcode");
  });

  it("rejects OpenCode's CLI download until an administrator packages it", () => {
    const result = planCatalogueAddition({
      titleId: "opencode",
      methods: [{ methodId: "macos-vendor-download" }],
    });

    expect(result).toMatchObject({ ok: false });
    if (!result.ok) expect(result.problem).toContain("packaging");
  });

  it("rejects an unsupported known method, not just an unknown one", () => {
    const plan = planCatalogueAddition({
      titleId: "whatsapp",
      methods: [{ methodId: "macos-vendor-download" }],
    });

    expect(plan).toMatchObject({ ok: false });
    if (!plan.ok) expect(plan.problem).toContain("packaging");
  });
});
