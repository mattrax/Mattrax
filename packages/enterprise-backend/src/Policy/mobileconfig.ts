import { Effect, Option, Schema } from "effect";
import { PlistValue, parsePlist } from "@mattrax/plist";
import type { MobileconfigPreview, MobileconfigPayloadPreview } from "@mattrax/enterprise-domain";

/**
 * Friendly payload categories ported from mttx's `mx-mobileconfig` crate.
 * Unknown types fall back to their raw payload type.
 */
export const payloadCategory = (payloadType: string): string => {
  switch (payloadType) {
    case "com.apple.applicationaccess":
    case "com.apple.applicationaccess.new":
      return "App Access";
    case "com.apple.restrictions":
    case "com.apple.restrictions.managed":
      return "Restrictions";
    case "com.apple.screensharing":
      return "Screen Sharing";
    case "com.apple.security.scep":
      return "SCEP Certificate";
    case "com.apple.security.pkcs1":
      return "PKCS#1 Certificate";
    case "com.apple.security.pkcs12":
      return "PKCS#12 Certificate";
    case "com.apple.security.pem":
      return "PEM Certificate";
    case "com.apple.security.root":
      return "Root Certificate";
    case "com.apple.wifi.managed":
      return "Wi-Fi";
    case "com.apple.vpn.managed":
      return "VPN";
    case "com.apple.vpn.managed.alwayson":
      return "Always-On VPN";
    case "com.apple.proxy.http.global":
      return "HTTP Proxy";
    case "com.apple.caldav.account":
      return "CalDAV Account";
    case "com.apple.carddav.account":
      return "CardDAV Account";
    case "com.apple.mail.managed":
      return "Email Account";
    case "com.apple.ldap.account":
      return "LDAP Account";
    case "com.apple.subscribedcalendar.account":
      return "Subscribed Calendar";
    case "com.apple.webcontent-filter":
    case "com.apple.webcontentfilter.managed":
      return "Web Content Filter";
    case "com.apple.airplay":
      return "AirPlay";
    case "com.apple.airprint":
      return "AirPrint";
    case "com.apple.dock":
      return "Dock";
    case "com.apple.finder":
      return "Finder";
    case "com.apple.loginwindow":
      return "Login Window";
    case "com.apple.mcx":
      return "Managed Client";
    case "com.apple.menuextra.clock":
      return "Menu Bar Clock";
    case "com.apple.preference.datetime":
      return "Date & Time";
    case "com.apple.preference.desktopscreeneffect":
      return "Desktop Screen Effect";
    case "com.apple.preference.displays":
      return "Displays";
    case "com.apple.preference.energysaver":
      return "Energy Saver";
    case "com.apple.preference.expose":
      return "Mission Control";
    case "com.apple.preference.general":
      return "General";
    case "com.apple.preference.mouse":
      return "Mouse";
    case "com.apple.preference.network":
      return "Network";
    case "com.apple.preference.parentalcontrols":
      return "Parental Controls";
    case "com.apple.preference.printfax":
      return "Printers & Scanners";
    case "com.apple.preference.security":
      return "Security & Privacy";
    case "com.apple.preference.sharing":
      return "Sharing";
    case "com.apple.preference.sound":
      return "Sound";
    case "com.apple.preference.spotlight":
      return "Spotlight";
    case "com.apple.preference.trackpad":
      return "Trackpad";
    case "com.apple.preference.universalaccess":
      return "Accessibility";
    case "com.apple.systempolicy.managed":
      return "System Policy";
    case "com.apple.systempolicy.control":
      return "System Policy Control";
    case "com.apple.systempolicy.rule":
      return "System Policy Rule";
    case "com.apple.systemuiserver":
      return "System UI Server";
    case "com.apple.systempreferences":
      return "System Preferences";
    case "com.apple.TimeMachine":
      return "Time Machine";
    case "com.apple.ManagedClient.preferences":
      return "Managed Client Preferences";
    case "com.apple.mdm":
      return "Mobile Device Management";
    case "com.apple.security.firewall":
      return "Firewall";
    case "com.apple.configurationprofile.identification":
      return "Configuration Profile ID";
    default:
      return payloadType;
  }
};

const PlistRecord = Schema.Record(Schema.String, PlistValue);

type PlistDictionary = Schema.Schema.Type<typeof PlistRecord>;

const isRecord = (value: PlistValue): value is PlistDictionary => Schema.is(PlistRecord)(value);

const plistString = (value: PlistValue | undefined) =>
  Option.getOrUndefined(Schema.decodeUnknownOption(Schema.String)(value));

/** A profile larger than this cannot reasonably be a configuration profile. */
const MAX_MOBILECONFIG_CHARS = 8 * 1024 * 1024;

const decodeBase64 = (value: string): Uint8Array => {
  const cleaned = value.replace(/^data:[^;]+;base64,/, "").replaceAll(/\s/g, "");

  if (cleaned.length > MAX_MOBILECONFIG_CHARS)
    throw new Error("The mobileconfig is too large to preview");

  const binary = atob(cleaned);

  return Uint8Array.from(binary, (char) => char.charCodeAt(0));
};

/**
 * Extract the plist bytes from a PKCS#7 signed mobileconfig. We deliberately do
 * not validate the signature: the device owns that decision, and the preview
 * only needs readable content.
 */
const extractSignedContent = async (bytes: Uint8Array): Promise<Uint8Array | null> => {
  try {
    const pkijs = await import("pkijs");

    const der = new Uint8Array(bytes.byteLength);
    der.set(bytes);

    const contentInfo = pkijs.ContentInfo.fromBER(der.buffer);

    if (contentInfo.contentType !== pkijs.ContentInfo.SIGNED_DATA) return null;
    const signedData = new pkijs.SignedData({ schema: contentInfo.content });
    const content = signedData.encapContentInfo.eContent;

    if (!content) return null;

    const value = content.getValue();

    return value ? new Uint8Array(value) : null;
  } catch {
    return null;
  }
};

const textFromBytes = async (bytes: Uint8Array): Promise<string> => {
  const decoder = new TextDecoder();
  const text = decoder.decode(bytes).trim();
  // PKCS#7 can be supplied as PEM or as raw DER.
  const pem = /-----BEGIN (?:PKCS7|CMS)-----([\s\S]*?)-----END (?:PKCS7|CMS)-----/.exec(text);

  if (pem) {
    return decoder.decode((await extractSignedContent(decodeBase64(pem[1]))) ?? new Uint8Array());
  }

  if (text.startsWith("<?xml") || text.startsWith("<plist")) return text;
  const extracted = await extractSignedContent(bytes);

  return extracted ? decoder.decode(extracted) : text;
};

const payloadPreview = (payload: PlistDictionary): MobileconfigPayloadPreview => {
  const type = plistString(payload.PayloadType) ?? "Unknown";

  return {
    type,
    identifier: plistString(payload.PayloadIdentifier),
    displayName: plistString(payload.PayloadDisplayName),
    description: plistString(payload.PayloadDescription),
    category: payloadCategory(type),
  };
};

/**
 * Parse a base64 encoded `.mobileconfig` into the preview model consumed by the
 * policy editor. Throws an Error with a user-facing message on invalid input.
 */
export const parseMobileconfigPreview = async (base64: string): Promise<MobileconfigPreview> => {
  if (base64.trim().length === 0) {
    throw new Error("The mobileconfig is empty");
  }

  let bytes: Uint8Array;

  try {
    bytes = decodeBase64(base64);
  } catch {
    throw new Error("The mobileconfig is not valid base64");
  }

  const text = await textFromBytes(bytes);

  const plist = await Effect.runPromise(
    parsePlist(text).pipe(
      Effect.mapError((cause) => new Error(`Invalid mobileconfig: ${cause.message}`)),
    ),
  );

  if (!isRecord(plist)) throw new Error("The mobileconfig root must be a dictionary");

  const content = plist.PayloadContent;

  const payloads = Array.isArray(content)
    ? content.filter(isRecord)
    : isRecord(content)
      ? [content]
      : [];

  if (!Array.isArray(content) && !isRecord(content)) {
    throw new Error("The mobileconfig is missing PayloadContent");
  }

  const scope = plistString(plist.PayloadScope) === "User" ? "user" : "device";

  return {
    displayName: plistString(plist.PayloadDisplayName),
    description: plistString(plist.PayloadDescription),
    organization: plistString(plist.PayloadOrganization),
    identifier: plistString(plist.PayloadIdentifier),
    uuid: plistString(plist.PayloadUUID),
    type: plistString(plist.PayloadType),
    scope,
    payloadDisplayName: plistString(plist.PayloadDisplayName),
    payloadDescription: plistString(plist.PayloadDescription),
    payloadOrganization: plistString(plist.PayloadOrganization),
    payloads: payloads.map(payloadPreview),
  };
};

/**
 * Return the embedded plist for an uploaded profile. Signed profiles are
 * unwrapped but the signature is intentionally not verified here: the caller
 * is asking to drop it and edit the contents.
 */
export const extractMobileconfigPlist = async (base64: string): Promise<string> => {
  const bytes = decodeBase64(base64);
  const text = await textFromBytes(bytes);

  if (!text.includes("<plist") && !text.includes("<?xml"))
    throw new Error("No plist content could be extracted from this profile");

  return text;
};
