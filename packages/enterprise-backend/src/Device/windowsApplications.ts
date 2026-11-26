/**
 * Windows application install delivery over OMA-DM.
 *
 * The `EnterpriseDesktopAppManagement` CSP (Windows 10 1511+) installs an MSI
 * from a URL. Windows MDM has no equivalent of the Intune Management Extension,
 * so an `.exe` or `.intunewin` cannot be installed this way; callers report that
 * instead of queueing an install that can never complete.
 *
 * Status is reported twice: the SyncML `Exec` result carries the msiexec HRESULT
 * and the daily `EnterpriseDesktopAppManagement/MSI?list=StructData` inventory
 * shows the resulting product and managed state.
 */

const MSI_PRODUCT_CODE = /^\{?[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\}?$/i;

export const MSI_INSTALL_LOCURI_PREFIX = "./Device/Vendor/MSFT/EnterpriseDesktopAppManagement/MSI";

/** Whether a catalogue entry's package id is an MSI ProductCode. */
export const isMsiProductCode = (value: string | null | undefined): boolean =>
  Boolean(value?.trim()) && MSI_PRODUCT_CODE.test(value!.trim());

/** Normalise a ProductCode to the `{UPPERCASE-GUID}` form the CSP uses. */
export const normalizeMsiProductCode = (value: string): string => {
  const trimmed = value.trim();

  return trimmed.startsWith("{") ? trimmed.toUpperCase() : `{${trimmed.toUpperCase()}}`;
};

/**
 * Whether the catalogue entry describes an MSI.
 *
 * An explicit non-MSI file name wins over the URL (a signed redirect can hide
 * the extension), and a missing file name falls back to the installer path.
 */
export const isMsiInstaller = (input: {
  readonly fileName?: string | null;
  readonly contentType?: string | null;
  readonly installerUrl?: string | null;
}): boolean => {
  const fileName = input.fileName?.trim().toLowerCase() ?? "";

  if (fileName.endsWith(".msi")) return true;

  if (fileName.length > 0) return false;

  if (input.contentType === "application/x-msi") return true;

  const installerUrl = input.installerUrl?.trim();

  if (!installerUrl) return false;

  try {
    return /\.msi$/i.test(new URL(installerUrl).pathname);
  } catch {
    return false;
  }
};

const xmlEscape = (value: string) =>
  value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&apos;");

/** The `DownloadInstall` XML job accepted by the EnterpriseDesktopAppManagement CSP. */
export const buildMsiInstallJob = (input: {
  readonly appId: string;
  readonly version: string;
  readonly url: string;
  readonly sha256?: string | null;
}): string => {
  const validation = input.sha256
    ? `<Validation><FileHash>${xmlEscape(input.sha256.toUpperCase())}</FileHash></Validation>`
    : "";

  return `<?xml version="1.0" encoding="utf-8"?>
<MsiInstallJob id="${xmlEscape(input.appId)}">
  <Product Version="${xmlEscape(input.version || "1.0.0")}">
    <Download>
      <ContentURLList>
        <ContentURL>${xmlEscape(input.url)}</ContentURL>
      </ContentURLList>
    </Download>
    ${validation}
    <Enforcement>
      <CommandLine>/quiet /norestart</CommandLine>
      <TimeOut>60</TimeOut>
      <RetryCount>3</RetryCount>
      <RetryInterval>5</RetryInterval>
    </Enforcement>
  </Product>
</MsiInstallJob>`;
};

export type WindowsMsiInstallPayload = {
  readonly kind: "Exec";
  readonly locURI: string;
  readonly data: string;
  readonly format: "xml";
};

/** SyncML `Exec` payload for an MSI install. */
export const windowsMsiInstallPayload = (input: {
  readonly appId: string;
  readonly productId: string;
  readonly version: string;
  readonly url: string;
  readonly sha256?: string | null;
}): WindowsMsiInstallPayload => ({
  kind: "Exec",
  locURI: `${MSI_INSTALL_LOCURI_PREFIX}/${encodeURIComponent(
    normalizeMsiProductCode(input.productId),
  )}/DownloadInstall`,
  data: buildMsiInstallJob(input),
  format: "xml",
});

export type WindowsMsiUninstallPayload = {
  readonly kind: "Exec";
  readonly locURI: string;
  readonly data: string;
  readonly format: "chr";
};

/**
 * SyncML `Exec` payload for an MSI uninstall.
 *
 * The CSP `Uninstall` node runs msiexec with the supplied command line; there
 * is no XML job. `/quiet /norestart` matches the install enforcement, but a
 * package whose MSI lacks a silent uninstall sequence is still reported by the
 * device as failed rather than assumed to work.
 */
export const windowsMsiUninstallPayload = (input: {
  readonly productId: string;
}): WindowsMsiUninstallPayload => ({
  kind: "Exec",
  locURI: `${MSI_INSTALL_LOCURI_PREFIX}/${encodeURIComponent(
    normalizeMsiProductCode(input.productId),
  )}/Uninstall`,
  data: "/quiet /norestart",
  format: "chr",
});
