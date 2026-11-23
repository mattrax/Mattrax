import { describe, expect, it } from "vitest";
import {
  buildMsiInstallJob,
  isMsiInstaller,
  isMsiProductCode,
  MSI_INSTALL_LOCURI_PREFIX,
  normalizeMsiProductCode,
  windowsMsiInstallPayload,
  windowsMsiUninstallPayload,
} from "../src/Device/windowsApplications.ts";

const productId = "1803A630-3C38-4D2B-9B9A-0CB37243539C";

describe("Windows MSI application delivery", () => {
  it("recognises an MSI ProductCode and normalises it", () => {
    expect(isMsiProductCode(productId)).toBe(true);
    expect(isMsiProductCode(`{${productId}}`)).toBe(true);
    expect(isMsiProductCode("Google.Chrome")).toBe(false);
    expect(normalizeMsiProductCode(productId)).toBe(`{${productId}}`);
    expect(normalizeMsiProductCode(`{${productId.toLowerCase()}}`)).toBe(`{${productId}}`);
  });

  it("recognises MSI installers without trusting only the URL", () => {
    expect(isMsiInstaller({ fileName: "Chrome.msi" })).toBe(true);
    expect(isMsiInstaller({ installerUrl: "https://cdn.example.test/app.msi?sig=1" })).toBe(true);
    expect(isMsiInstaller({ fileName: "setup.exe" })).toBe(false);
    expect(
      isMsiInstaller({
        fileName: "setup.exe",
        installerUrl: "https://cdn.example.test/app.msi",
      }),
    ).toBe(false);
    expect(isMsiInstaller({ installerUrl: "https://cdn.example.test/app.exe" })).toBe(false);
  });

  it("builds the EnterpriseDesktopAppManagement install job", () => {
    const payload = windowsMsiInstallPayload({
      appId: "app-1",
      productId,
      version: "1.2.3",
      url: "https://cdn.example.test/app.msi",
      sha256: "ab".repeat(32),
    });

    expect(payload.kind).toBe("Exec");
    expect(payload.format).toBe("xml");
    expect(payload.locURI).toBe(
      `${MSI_INSTALL_LOCURI_PREFIX}/${encodeURIComponent(`{${productId}}`)}/DownloadInstall`,
    );
    expect(payload.data).toContain(`<MsiInstallJob id="app-1">`);
    expect(payload.data).toContain(`<Product Version="1.2.3">`);
    expect(payload.data).toContain("<ContentURL>https://cdn.example.test/app.msi</ContentURL>");
    expect(payload.data).toContain(`<FileHash>${"AB".repeat(32)}</FileHash>`);
    expect(payload.data).toContain("<CommandLine>/quiet /norestart</CommandLine>");
  });

  it("builds the EnterpriseDesktopAppManagement uninstall command", () => {
    const payload = windowsMsiUninstallPayload({ productId });

    expect(payload).toEqual({
      kind: "Exec",
      locURI: `${MSI_INSTALL_LOCURI_PREFIX}/${encodeURIComponent(`{${productId}}`)}/Uninstall`,
      data: "/quiet /norestart",
      format: "chr",
    });
  });

  it("escapes values placed in the job XML", () => {
    const job = buildMsiInstallJob({
      appId: "app<1>",
      version: "1.0",
      url: "https://cdn.example.test/app.msi?a=1&b=2",
    });

    expect(job).toContain("app&lt;1&gt;");
    expect(job).toContain("a=1&amp;b=2");
    expect(job).not.toContain("<FileHash>");
  });
});
