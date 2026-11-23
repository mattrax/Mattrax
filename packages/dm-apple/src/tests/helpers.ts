import { Layer, Effect } from "effect";
import {
  ManagementBackend,
  ManagementManifest,
  ManagementNotSupported,
} from "@mattrax/management-backend";

type ManagementBackendType = InstanceType<typeof ManagementBackend>;

export function mockManagementBackend(
  overrides?: Partial<{
    appleDeviceEvent: ManagementBackendType["appleDeviceEvent"];
    appleManagementCheckin: ManagementBackendType["appleManagementCheckin"];
    appleReturnToServiceConfiguration: ManagementBackendType["appleReturnToServiceConfiguration"];
    getAppleDeclarationTokens: ManagementBackendType["getAppleDeclarationTokens"];
    getAppleDeclarationItems: ManagementBackendType["getAppleDeclarationItems"];
    getAppleDeclaration: ManagementBackendType["getAppleDeclaration"];
    getAppleAsset: ManagementBackendType["getAppleAsset"];
    getAppleManifest: ManagementBackendType["getAppleManifest"];
    getAppleProfile: ManagementBackendType["getAppleProfile"];
    windowsDiscovery: ManagementBackendType["windowsDiscovery"];
    getWindowsEnrollmentPolicy: ManagementBackendType["getWindowsEnrollmentPolicy"];
    windowsEnroll: ManagementBackendType["windowsEnroll"];
    windowsManagementCheckin: ManagementBackendType["windowsManagementCheckin"];
    windowsDeviceEvent: ManagementBackendType["windowsDeviceEvent"];
  }>,
) {
  return Layer.succeed(
    ManagementBackend,
    ManagementBackend.of({
      getAppleBootstrapToken: () => Effect.succeed(null),
      appleReturnToServiceConfiguration:
        overrides?.appleReturnToServiceConfiguration ?? (() => Effect.succeed({ enabled: false })),
      appleDeviceEvent: overrides?.appleDeviceEvent ?? (() => Effect.void),
      appleManagementCheckin:
        overrides?.appleManagementCheckin ??
        (() => Effect.succeed(ManagementManifest.members[0].make({}))),
      getAppleDeclarationTokens:
        overrides?.getAppleDeclarationTokens ??
        (() =>
          Effect.succeed({
            activationsToken: "act-token",
            configurationsToken: "cfg-token",
            assetsToken: "asset-token",
            managementToken: "mgmt-token",
            declarationsToken: "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA",
          })),
      getAppleDeclarationItems:
        overrides?.getAppleDeclarationItems ??
        (() =>
          Effect.succeed({
            activations: [],
            configurations: [],
            assets: [],
            management: [],
          })),
      getAppleDeclaration: overrides?.getAppleDeclaration ?? (() => Effect.succeed({})),
      getAppleAsset: overrides?.getAppleAsset ?? (() => Effect.succeed(null)),
      getAppleManifest: overrides?.getAppleManifest ?? (() => Effect.succeed(null)),
      getAppleProfile: overrides?.getAppleProfile ?? (() => Effect.succeed(null)),
      windowsDiscovery:
        overrides?.windowsDiscovery ?? (() => Effect.fail(new ManagementNotSupported())),
      getWindowsEnrollmentPolicy:
        overrides?.getWindowsEnrollmentPolicy ?? (() => Effect.fail(new ManagementNotSupported())),
      windowsEnroll: overrides?.windowsEnroll ?? (() => Effect.fail(new ManagementNotSupported())),
      windowsManagementCheckin:
        overrides?.windowsManagementCheckin ?? (() => Effect.fail(new ManagementNotSupported())),
      windowsDeviceEvent:
        overrides?.windowsDeviceEvent ?? (() => Effect.fail(new ManagementNotSupported())),
    }),
  );
}

// ─── Plist Builders ────────────────────────────────────────────────

export function buildAuthenticatePlist(
  overrides?: Partial<{ UDID: string; SerialNumber: string; Topic: string }>,
): string {
  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>UDID</key>
  <string>${overrides?.UDID ?? "test-udid-123"}</string>
  <key>SerialNumber</key>
  <string>${overrides?.SerialNumber ?? "ABC123"}</string>
  <key>Topic</key>
  <string>${overrides?.Topic ?? "com.apple.mgmt.External"}</string>
  <key>MessageType</key>
  <string>Authenticate</string>
  <key>OSVersion</key>
  <string>14.0</string>
  <key>Model</key>
  <string>MacBookPro18,1</string>
</dict>
</plist>`;
}

export function buildTokenUpdatePlist(
  overrides?: Partial<{
    UDID: string;
    PushMagic: string;
    Token: string;
    Topic: string;
    UserID?: string;
  }>,
): string {
  const userIdSection = overrides?.UserID
    ? `<key>UserID</key><string>${overrides.UserID}</string>`
    : "";

  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>UDID</key>
  <string>${overrides?.UDID ?? "test-udid-123"}</string>
  <key>PushMagic</key>
  <string>${overrides?.PushMagic ?? "push-magic-123"}</string>
  <key>Token</key>
  <data>${overrides?.Token ?? "dGVzdC10b2tlbg=="}</data>
  <key>Topic</key>
  <string>${overrides?.Topic ?? "com.apple.mgmt.External"}</string>
  <key>MessageType</key>
  <string>TokenUpdate</string>
  ${userIdSection}
</dict>
</plist>`;
}

export function buildCheckOutPlist(overrides?: Partial<{ UDID: string; Topic: string }>): string {
  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>UDID</key>
  <string>${overrides?.UDID ?? "test-udid-123"}</string>
  <key>Topic</key>
  <string>${overrides?.Topic ?? "com.apple.mgmt.External"}</string>
  <key>MessageType</key>
  <string>CheckOut</string>
</dict>
</plist>`;
}

export function buildCommandResultPlist(
  overrides?: Partial<{ UDID: string; Status: string; CommandUUID: string }>,
): string {
  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>UDID</key>
  <string>${overrides?.UDID ?? "test-udid-123"}</string>
  <key>Status</key>
  <string>${overrides?.Status ?? "Acknowledged"}</string>
  <key>CommandUUID</key>
  <string>${overrides?.CommandUUID ?? "cmd-uuid-001"}</string>
  <key>Command</key>
  <dict>
    <key>RequestType</key>
    <string>DeviceInformation</string>
  </dict>
</dict>
</plist>`;
}

export function buildDeclarativeManagementTokensPlist(
  overrides?: Partial<{ UDID: string }>,
): string {
  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>UDID</key>
  <string>${overrides?.UDID ?? "test-udid-123"}</string>
  <key>MessageType</key>
  <string>DeclarativeManagement</string>
  <key>Endpoint</key>
  <string>tokens</string>
  <key>Data</key>
  <dict/>
</dict>
</plist>`;
}

export function buildDeclarativeManagementDeclarationItemsPlist(
  overrides?: Partial<{ UDID: string }>,
): string {
  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>UDID</key>
  <string>${overrides?.UDID ?? "test-udid-123"}</string>
  <key>MessageType</key>
  <string>DeclarativeManagement</string>
  <key>Endpoint</key>
  <string>declaration-items</string>
  <key>Data</key>
  <dict/>
</dict>
</plist>`;
}

export function buildDeclarativeManagementStatusPlist(
  overrides?: Partial<{ UDID: string }>,
): string {
  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>UDID</key>
  <string>${overrides?.UDID ?? "test-udid-123"}</string>
  <key>MessageType</key>
  <string>DeclarativeManagement</string>
  <key>Endpoint</key>
  <string>status</string>
  <key>Data</key>
  <dict>
    <key>StatusItems</key>
    <dict/>
  </dict>
</dict>
</plist>`;
}

export function buildDeclarativeManagementDeclarationPlist(
  declarationType: string,
  identifier: string,
  overrides?: Partial<{ UDID: string }>,
): string {
  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>UDID</key>
  <string>${overrides?.UDID ?? "test-udid-123"}</string>
  <key>MessageType</key>
  <string>DeclarativeManagement</string>
  <key>Endpoint</key>
  <string>declaration/${declarationType}/${identifier}</string>
  <key>Data</key>
  <dict/>
</dict>
</plist>`;
}

export function buildCheckinPlist(overrides?: Partial<{ UDID: string }>): string {
  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>UDID</key>
  <string>${overrides?.UDID ?? "test-udid-123"}</string>
</dict>
</plist>`;
}

// ─── Certificate Helpers ───────────────────────────────────────────

export async function generateTestCertPem(topic: string, useUid = true): Promise<string> {
  // This is a minimal self-signed RSA cert encoded as PEM for testing.
  // In a real test we'd generate it with WebCrypto, but for unit tests
  // we use a pre-baked minimal DER wrapped in PEM.
  const oidUid = useUid ? "0.9.2342.19200300.100.1.1" : "2.5.4.3";

  // Minimal self-signed cert with just the subject we need.
  // We'll generate a real one using WebCrypto for integration tests,
  // but for cert.ts unit tests a static PEM is fine.
  return generateRealTestCertPem(topic, oidUid);
}

async function generateRealTestCertPem(topic: string, oidUid: string): Promise<string> {
  const algorithm: RsaHashedKeyGenParams = {
    name: "RSASSA-PKCS1-v1_5",
    hash: "SHA-256",
    modulusLength: 2048,
    publicExponent: new Uint8Array([1, 0, 1]),
  };

  const keyPair = await crypto.subtle.generateKey(algorithm, true, ["sign", "verify"] as const);

  // Build a minimal self-signed cert with pkijs
  const pkijs = await import("pkijs");
  const asn1js = await import("asn1js");

  const cert = new pkijs.Certificate();
  cert.version = 2;
  cert.serialNumber = new asn1js.Integer({ value: 1 });

  const subjectRdn = new pkijs.RelativeDistinguishedNames({
    typesAndValues: [
      new pkijs.AttributeTypeAndValue({
        type: oidUid,
        value: new asn1js.Utf8String({ value: topic }),
      }),
    ],
  });

  cert.issuer = subjectRdn;
  cert.subject = subjectRdn;
  cert.notBefore.value = new Date();
  const notAfter = new Date();
  notAfter.setUTCFullYear(notAfter.getUTCFullYear() + 1);
  cert.notAfter.value = notAfter;

  await cert.subjectPublicKeyInfo.importKey(keyPair.publicKey);
  await cert.sign(keyPair.privateKey, "SHA-256");

  const { pemEncode } = await import("@mattrax/crypto");

  return pemEncode("CERTIFICATE", cert.toSchema().toBER(false));
}
