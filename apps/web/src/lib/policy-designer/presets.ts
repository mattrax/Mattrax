import { serializePlist } from "./build";

const uuid = () => crypto.randomUUID();

const escapeXml = (value: string) =>
  value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&apos;");

const base64 = (value: string) => {
  const bytes = new TextEncoder().encode(value);
  let binary = "";

  for (const byte of bytes) binary += String.fromCharCode(byte);

  return btoa(binary);
};

export type WifiSecurity = "wpa2" | "wpa3" | "open";

export type WifiPreset = {
  ssid: string;
  security: WifiSecurity;
  password: string;
  autoJoin: boolean;
  hidden: boolean;
};

export type PresetConfiguration = {
  kind: string;
  data: Record<string, unknown>;
};

/** Apple Wi-Fi payload expressed as a signed-ready `.mobileconfig`. */
export const appleWifiConfiguration = (preset: WifiPreset): PresetConfiguration => {
  const encryption =
    preset.security === "wpa3" ? "WPA3" : preset.security === "wpa2" ? "WPA2" : "None";

  const payload: Record<string, unknown> = {
    PayloadType: "com.apple.wifi.managed",
    PayloadIdentifier: `app.mattrax.wifi.${preset.ssid.replace(/[^A-Za-z0-9]+/g, "-")}`,
    PayloadUUID: uuid(),
    PayloadVersion: 1,
    PayloadDisplayName: `Wi-Fi: ${preset.ssid}`,
    SSID_STR: preset.ssid,
    EncryptionType: encryption,
    AutoJoin: preset.autoJoin,
    HIDDEN_NETWORK: preset.hidden,
    ...(preset.security !== "open" && preset.password ? { Password: preset.password } : {}),
  };

  const profile = {
    PayloadContent: [payload],
    PayloadDisplayName: `Wi-Fi: ${preset.ssid}`,
    PayloadIdentifier: `app.mattrax.wifi.${preset.ssid.replace(/[^A-Za-z0-9]+/g, "-")}`,
    PayloadOrganization: "Mattrax",
    PayloadType: "Configuration",
    PayloadUUID: uuid(),
    PayloadVersion: 1,
  };

  return {
    kind: "mttx.apple.custom.wifi",
    data: {
      content: base64(serializePlist(profile)),
      preset: "wifi",
      ssid: preset.ssid,
      security: preset.security,
    },
  };
};

/** Windows Wi-Fi profile delivered through the WiFi CSP. */
export const windowsWifiConfiguration = (preset: WifiPreset): PresetConfiguration => {
  const protectedNetwork = preset.security !== "open";

  const xml = `<?xml version="1.0"?>
<WLANProfile xmlns="http://www.microsoft.com/networking/WLAN/profile/v1">
  <name>${escapeXml(preset.ssid)}</name>
  <SSIDConfig><SSID><name>${escapeXml(preset.ssid)}</name></SSID></SSIDConfig>
  <connectionType>ESS</connectionType>
  <connectionMode>auto</connectionMode>
  <MSM>
    <security>
      <authEncryption>
        <authentication>${protectedNetwork ? "WPA2PSK" : "open"}</authentication>
        <encryption>${protectedNetwork ? "AES" : "none"}</encryption>
        <useOneX>false</useOneX>
      </authEncryption>
      ${
        protectedNetwork
          ? `<sharedKey><keyType>passPhrase</keyType><protected>false</protected><keyMaterial>${escapeXml(
              preset.password,
            )}</keyMaterial></sharedKey>`
          : ""
      }
    </security>
  </MSM>
</WLANProfile>`;

  return {
    kind: "mttx.windows.custom.wifi",
    data: {
      nodes: [
        {
          omaUri: `./Vendor/MSFT/WiFi/Profile/${preset.ssid}/WlanXml`,
          value: xml,
          format: "chr",
        },
      ],
      preset: "wifi",
      ssid: preset.ssid,
      security: preset.security,
    },
  };
};

export type PasscodePreset = {
  minimumLength: number;
  requireAlphanumeric: boolean;
  allowSimple: boolean;
};

/** Apple passcode policy; Windows for Workgroups is not equivalent. */
export const applePasscodeConfiguration = (preset: PasscodePreset): PresetConfiguration => {
  const payload = {
    PayloadType: "com.apple.mobiledevice.passwordpolicy",
    PayloadIdentifier: "app.mattrax.passcode",
    PayloadUUID: uuid(),
    PayloadVersion: 1,
    PayloadDisplayName: "Passcode requirements",
    minLength: preset.minimumLength,
    requireAlphanumeric: preset.requireAlphanumeric,
    allowSimple: preset.allowSimple,
    forcePIN: true,
  };

  const profile = {
    PayloadContent: [payload],
    PayloadDisplayName: "Passcode requirements",
    PayloadIdentifier: "app.mattrax.passcode",
    PayloadOrganization: "Mattrax",
    PayloadType: "Configuration",
    PayloadUUID: uuid(),
    PayloadVersion: 1,
  };

  return {
    kind: "mttx.apple.custom.passcode",
    data: { content: base64(serializePlist(profile)), preset: "passcode" },
  };
};
