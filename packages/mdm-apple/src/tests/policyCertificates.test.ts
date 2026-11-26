import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import { Effect, Schema } from "effect";
import { parsePlist } from "@mattrax/plist";
import { certificateDer, pemEncode } from "@mattrax/scep";
import { createTestSignerCert, generateKeyPair } from "@mattrax/scep/testing";
import {
  MAX_PFX_BYTES,
  prepareCertificateConfiguration,
  windowsPfxCertInstallParent,
  windowsPolicyNodes,
} from "@mattrax/mdm-core";
import type { PlistObject, PolicyConfigurationRow } from "@mattrax/mdm-core";
import {
  buildAssetContent,
  buildAssetDeclaration,
  buildConfigurationDeclaration,
  buildLegacyProfile,
  validateConfiguration,
} from "../policy.js";
import type { DeclarationContext } from "../policy.js";
import {
  installProfilePayload,
  openCommandPayload,
  sealCommandPayload,
} from "../legacyDelivery.js";
import {
  TEST_CERT_ONLY_PFX_BASE64,
  TEST_PFX_BASE64,
  TEST_PFX_CERTIFICATE_PEM,
  TEST_PFX_PASSWORD,
} from "./pfxFixture.js";
import type { PolicyCertificateMaterial } from "@mattrax/mdm-core";

const context: DeclarationContext = {
  origin: "https://mdm.example.com",
  authSecret: "certificate-test-secret",
  deviceToken: "device-token",
  deviceId: "device-1",
  now: 1_700_000_000_000,
};

const row = (overrides: Partial<PolicyConfigurationRow> = {}): PolicyConfigurationRow => ({
  policyId: "policy-1",
  kind: "mttx.apple.device",
  data: { camera: false },
  hash: "hash-1",
  organizationId: "tenant-1",
  ...overrides,
});

const certificate = async () => {
  const keys = await generateKeyPair();
  const cert = await createTestSignerCert(keys, "device.example.com");
  const der = new Uint8Array(cert.toSchema().toBER(false));

  return {
    der,
    pem: pemEncode("CERTIFICATE", der.buffer as ArrayBuffer),
    notAfter: cert.notAfter.value,
  };
};

const material = (): PolicyCertificateMaterial => ({
  pfx: new Uint8Array([0x30, 0x82, 0x01, 0x02, 0x03]),
  password: "pfx-secret",
});

const config = async () => {
  const leaf = await certificate();

  return {
    certificatePem: leaf.pem,
    subject: "device.example.com",
    notAfter: leaf.notAfter.toISOString(),
    fingerprintSha256: "a".repeat(64),
    materialSha256: "b".repeat(64),
    channel: "device" as const,
  };
};

const plistPayloads = async (content: Uint8Array) => {
  const plist = await Effect.runPromise(parsePlist(new TextDecoder().decode(content)));

  return (plist as { PayloadContent: Array<PlistObject> }).PayloadContent;
};

const validationWithKinds = async (
  kind: string,
  data: Schema.Json,
  configurationKinds: ReadonlyArray<string>,
  scope: "device" | "user" = "device",
) =>
  Effect.runPromise(
    Effect.match(validateConfiguration(kind, data, { scope, configurationKinds }), {
      onFailure: (message) => message,
      onSuccess: () => null,
    }),
  );

const validation = async (kind: string, data: Schema.Json, scope: "device" | "user" = "device") =>
  validationWithKinds(kind, data, [], scope);

describe("certificate profiles", () => {
  it("parses a real PKCS#12 and derives metadata from its leaf", async () => {
    const result = await prepareCertificateConfiguration({
      kind: "mttx.apple.pfx.smime",
      data: {
        pfx: TEST_PFX_BASE64,
        password: TEST_PFX_PASSWORD,
        certificatePem: TEST_PFX_CERTIFICATE_PEM,
        fileName: "person.pfx",
      },
      authSecret: "certificate-material-secret",
    });

    expect(result.ok).toBe(true);

    if (!result.ok) return;
    expect(result.data).toMatchObject({
      subject: "person@example.com",
      certificatePem: expect.stringContaining("BEGIN CERTIFICATE"),
    });
    expect(result.material?.materialSha256).toMatch(/^[a-f0-9]{64}$/);
    expect(result.material?.sealedPfx).not.toContain(TEST_PFX_BASE64);
  });

  it("rejects a certificate-only PFX without a private key", async () => {
    const result = await prepareCertificateConfiguration({
      kind: "mttx.apple.pfx.smime",
      data: {
        pfx: TEST_CERT_ONLY_PFX_BASE64,
        password: TEST_PFX_PASSWORD,
        certificatePem: TEST_PFX_CERTIFICATE_PEM,
      },
      authSecret: "certificate-material-secret",
    });

    expect(result.ok).toBe(false);
    expect(!result.ok && result.message).toContain("no private key");
  });

  it("rejects a PFX above the storage boundary", async () => {
    const oversized = "A".repeat(Math.ceil((MAX_PFX_BYTES + 1) / 3) * 4);
    const result = await prepareCertificateConfiguration({
      kind: "mttx.apple.pfx.smime",
      data: {
        pfx: oversized,
        password: "x",
        certificatePem: TEST_PFX_CERTIFICATE_PEM,
      },
      authSecret: "certificate-material-secret",
    });

    expect(result.ok).toBe(false);
    expect(!result.ok && result.message).toContain("larger than");
  });

  it("rejects junk bytes, a wrong password and a mismatched leaf certificate", async () => {
    const base = {
      kind: "mttx.apple.pfx.smime",
      authSecret: "certificate-material-secret",
    };
    const junk = await prepareCertificateConfiguration({
      ...base,
      data: {
        pfx: Buffer.from("not a pfx").toString("base64"),
        password: TEST_PFX_PASSWORD,
        certificatePem: TEST_PFX_CERTIFICATE_PEM,
      },
    });

    expect(junk.ok).toBe(false);
    expect(!junk.ok && junk.message).toContain("not a valid PKCS#12");

    const wrongPassword = await prepareCertificateConfiguration({
      ...base,
      data: {
        pfx: TEST_PFX_BASE64,
        password: "wrong",
        certificatePem: TEST_PFX_CERTIFICATE_PEM,
      },
    });

    expect(wrongPassword.ok).toBe(false);
    expect(!wrongPassword.ok && wrongPassword.message).toContain("password is wrong");

    const wrongLeaf = await prepareCertificateConfiguration({
      ...base,
      data: {
        pfx: TEST_PFX_BASE64,
        password: TEST_PFX_PASSWORD,
        certificatePem: await (async () => {
          const leaf = await certificate();

          return leaf.pem;
        })(),
      },
    });

    expect(wrongLeaf.ok).toBe(false);
    expect(!wrongLeaf.ok && wrongLeaf.message).toContain("not a certificate inside the PFX");
  });

  it("installs a Windows trusted root through RootCATrustedCertificates", async () => {
    const leaf = await certificate();
    const nodes = await windowsPolicyNodes(
      row({ kind: "mttx.windows.certificate.root", data: { pem: leaf.pem } }),
    );
    const sha1 = createHash("sha1").update(certificateDer(leaf.pem)).digest("hex").toUpperCase();

    expect(nodes).toHaveLength(1);
    expect(nodes[0]).toMatchObject({
      omaUri: `./Device/Vendor/MSFT/RootCATrustedCertificates/Root/${sha1}/EncodedCertificate`,
      format: "b64",
    });
    expect(nodes[0]?.value).toBe(
      Buffer.from(certificateDer(leaf.pem)).toString("base64"),
    );
  });

  it("installs an imported PFX into the Windows device or user store", async () => {
    const data = await config();
    const pfxRow = row({
      kind: "mttx.windows.pfx.wifi",
      data: { ...data, keyLocation: "software", exportable: true },
    });
    const nodes = await windowsPolicyNodes(pfxRow, material());
    const prefix =
      "./Device/Vendor/MSFT/ClientCertificateInstall/PFXCertInstall/policy-1-mttx-windows-pfx-wifi";

    expect(nodes.map((node) => node.omaUri)).toEqual([
      `${prefix}/KeyLocation`,
      `${prefix}/PFXKeyExportable`,
      `${prefix}/PFXCertPasswordEncryptionType`,
      `${prefix}/PFXCertPassword`,
      `${prefix}/PFXCertBlob`,
    ]);
    expect(nodes[0]?.value).toBe(3);
    expect(nodes[1]?.value).toBe(true);
    expect(nodes[3]?.value).toBe("pfx-secret");
    expect(nodes[4]?.value).toBe(Buffer.from(material().pfx).toString("base64"));

    const userNodes = await windowsPolicyNodes(
      row({
        kind: "mttx.windows.pfx.wifi",
        data: { ...data, channel: "user" },
      }),
      material(),
    );

    expect(userNodes[0]?.omaUri).toContain("./User/Vendor/MSFT/ClientCertificateInstall");

    expect(nodes.find((node) => node.omaUri.endsWith("/PFXCertBlob"))?.operation).toBe("Add");
  });

  it("deletes a Windows identity through its PFXCertInstall parent", () => {
    expect(
      windowsPfxCertInstallParent(
        "./Device/Vendor/MSFT/ClientCertificateInstall/PFXCertInstall/id-1/PFXCertBlob",
      ),
    ).toBe("./Device/Vendor/MSFT/ClientCertificateInstall/PFXCertInstall/id-1");
    expect(
      windowsPfxCertInstallParent("./Device/Vendor/MSFT/Policy/Config/Update/AllowAutoUpdate"),
    ).toBeNull();
  });

  it("defaults PFX keys to non-exportable and names a Windows Hello container", async () => {
    const data = await config();
    const nodes = await windowsPolicyNodes(
      row({
        kind: "mttx.windows.pfx.wifi",
        data: { ...data, keyLocation: "windows-hello" },
      }),
      material(),
    );

    expect(nodes.find((node) => node.omaUri.endsWith("/PFXKeyExportable"))?.value).toBe(false);
    expect(nodes.find((node) => node.omaUri.endsWith("/ContainerName"))?.value).toBe(
      "mattrax-policy-1-mttx-windows-pfx-wifi",
    );
  });

  it("emits Apple's DDM identity asset and identity declaration", async () => {
    const data = await config();
    const pfxRow = row({ kind: "mttx.apple.pfx.smime", data, hash: "pfx-hash" });

    await expect(buildConfigurationDeclaration(pfxRow, context)).resolves.toMatchObject({
      Type: "com.apple.configuration.security.identity",
      Payload: { CredentialAssetReference: "policy-1.mttx.apple.pfx.smime.asset" },
    });
    await expect(buildAssetDeclaration(pfxRow, context)).resolves.toMatchObject({
      Type: "com.apple.asset.credential.identity",
      Payload: {
        Reference: { ContentType: "application/json" },
      },
    });

    const content = buildAssetContent(pfxRow, { material: material() });
    expect(content?.contentType).toBe("application/json");
    expect(
      JSON.parse(new TextDecoder().decode(content?.content)),
    ).toEqual({
      Password: "pfx-secret",
      Identity: Buffer.from(material().pfx).toString("base64"),
    });
  });

  it("puts a PKCS#12 payload in a legacy Apple profile", async () => {
    const data = await config();
    const profile = await buildLegacyProfile(
      row({ kind: "mttx.apple.pfx.smime", data }),
      { material: material() },
    );

    expect(profile).not.toBeNull();
    const payloads = await plistPayloads(profile!.content);

    expect(payloads).toHaveLength(1);
    expect(payloads[0]).toMatchObject({
      PayloadType: "com.apple.security.pkcs12",
      Password: "pfx-secret",
    });
    expect(payloads[0]?.PayloadContent).toEqual(
      Buffer.from(material().pfx).toString("base64"),
    );
  });

  it("seals a legacy identity command payload so the PFX and password are not stored", async () => {
    const data = await config();
    const profile = await buildLegacyProfile(
      row({ kind: "mttx.apple.pfx.smime", data }),
      { material: material() },
    );

    expect(profile).not.toBeNull();
    const plaintext = installProfilePayload({
      identifier: "app.mattrax.policy-1.mttx.apple.pfx.smime",
      policyId: "policy-1",
      kind: "mttx.apple.pfx.smime",
      ...profile!,
    });
    const decoded = Buffer.from(plaintext.Payload, "base64").toString("utf8");
    const pfxBase64 = Buffer.from(material().pfx).toString("base64");

    expect(decoded).toContain(pfxBase64);
    expect(decoded).toContain(material().password);

    const sealed = await sealCommandPayload("command-secret", plaintext);
    const stored = JSON.stringify(sealed);

    expect(stored).not.toContain(material().password);
    expect(stored).not.toContain(pfxBase64);
    await expect(openCommandPayload("command-secret", sealed)).resolves.toEqual(plaintext);
  });

  it("emits a DDM mail declaration whose S/MIME references the identity asset", async () => {
    const declaration = await buildConfigurationDeclaration(
      row({
        kind: "mttx.apple.mail.work",
        data: {
          visibleName: "Work Mail",
          incoming: {
            serverType: "IMAP",
            hostName: "imap.example.com",
            authenticationMethod: "None",
          },
          outgoing: { hostName: "smtp.example.com", authenticationMethod: "None" },
          smime: {
            signing: { enabled: true, certificateKind: "mttx.apple.pfx.smime" },
            encryption: {
              enabled: true,
              encryptByDefault: true,
              certificateKind: "mttx.apple.pfx.smime",
            },
          },
        },
      }),
      context,
    );

    expect(declaration).toMatchObject({
      Type: "com.apple.configuration.account.mail",
      Payload: {
        IncomingServer: { ServerType: "IMAP", HostName: "imap.example.com" },
        SMIME: {
          Signing: {
            Enabled: true,
            IdentityAssetReference: "policy-1.mttx.apple.pfx.smime.asset",
          },
          Encryption: {
            Enabled: true,
            IdentityAssetReference: "policy-1.mttx.apple.pfx.smime.asset",
          },
        },
      },
    });
  });

  it("omits S/MIME from a macOS account.mail declaration", async () => {
    const declaration = await buildConfigurationDeclaration(
      row({
        kind: "mttx.apple.mail.work",
        data: {
          incoming: {
            serverType: "IMAP",
            hostName: "imap.example.com",
            authenticationMethod: "None",
          },
          outgoing: { hostName: "smtp.example.com", authenticationMethod: "None" },
          smime: { signing: { enabled: true, certificateKind: "mttx.apple.pfx.smime" } },
        },
      }),
      { ...context, osFamily: "macOS" },
    );

    expect(declaration?.Payload).not.toHaveProperty("SMIME");
  });

  it("links S/MIME mail settings to the embedded identity payload", async () => {
    const mail = {
      visibleName: "Work Mail",
      emailAddress: "person@example.com",
      incoming: {
        serverType: "IMAP",
        hostName: "imap.example.com",
        authenticationMethod: "Password",
      },
      outgoing: { hostName: "smtp.example.com", authenticationMethod: "CRAMMD5" },
      smime: {
        signing: {
          enabled: true,
          certificateKind: "mttx.apple.pfx.smime",
          userOverrideable: true,
        },
        encryption: {
          enabled: true,
          encryptByDefault: true,
          certificateKind: "mttx.apple.pfx.smime",
        },
      },
    };
    const profile = await buildLegacyProfile(row({ kind: "mttx.apple.mail.work", data: mail }), {
      materialFor: (kind) => (kind === "mttx.apple.pfx.smime" ? material() : null),
    });

    expect(profile).not.toBeNull();
    const payloads = await plistPayloads(profile!.content);
    const identity = payloads.find(
      (payload) => payload.PayloadType === "com.apple.security.pkcs12",
    );
    const mailPayload = payloads.find(
      (payload) => payload.PayloadType === "com.apple.mail.managed",
    );

    expect(identity).toBeDefined();
    expect(mailPayload).toMatchObject({
      IncomingMailServerAuthentication: "EmailAuthPassword",
      OutgoingMailServerAuthentication: "EmailAuthCRAMMD5",
      SMIMESigningEnabled: true,
      SMIMESigningUserOverrideable: true,
      SMIMESigningCertificateUUID: identity?.PayloadUUID,
      SMIMEEncryptionEnabled: true,
      SMIMEEncryptionCertificateUUID: identity?.PayloadUUID,
      SMIMEEncryptByDefault: true,
    });
    expect(mailPayload).not.toHaveProperty("IncomingMailServerPassword");
    expect(mailPayload).not.toHaveProperty("OutgoingMailServerPassword");
    expect(mailPayload).not.toHaveProperty("SMIMESigningEnabledUserOverrideable");
  });

  it("rejects client certificates on Android with a reason", async () => {
    expect(
      await validation("mttx.android.pfx.wifi", {
        ...(await config()),
      }),
    ).toContain("Android Management API cannot install client certificates");

    expect(
      await validation("mttx.android.pkcs.wifi", {
        ...(await config()),
        ca: {},
        template: "WiFi",
        subjectNameFormat: "CN={{device.name}}",
        keyUsage: "digitalSignature",
      }),
    ).toContain("Android Management API cannot install client certificates");
  });

  it("rejects a Windows certificate whose stored channel disagrees with its scope", async () => {
    const data = await config();

    expect(
      await validation("mttx.windows.pfx.wifi", { ...data, channel: "device" }, "user"),
    ).toContain('is "device" but the configuration scope is "user"');
  });

  it("rejects a missing S/MIME identity and a root certificate with no PEM", async () => {
    expect(
      await validationWithKinds(
        "mttx.apple.mail.work",
        {
          incoming: {
            serverType: "IMAP",
            hostName: "imap.example.com",
            authenticationMethod: "None",
          },
          outgoing: { hostName: "smtp.example.com", authenticationMethod: "None" },
          smime: { signing: { enabled: true, certificateKind: "mttx.apple.pfx.missing" } },
        },
        ["mttx.apple.mail.work"],
      ),
    ).toContain("not part of this policy");

    expect(await validation("mttx.windows.certificate.root", { pem: "not a pem" })).toContain(
      "must contain exactly one PEM certificate",
    );
    expect(
      await validation("mttx.windows.certificate.root", {
        pem: "-----BEGIN CERTIFICATE-----\nAAAA\n-----END CERTIFICATE-----",
      }),
    ).toContain("not a parseable X.509 certificate");
  });

  it("rejects mail server passwords in policy JSON", async () => {
    expect(
      await validation("mttx.apple.mail.work", {
        incoming: {
          serverType: "IMAP",
          hostName: "imap.example.com",
          authenticationMethod: "Password",
          password: "secret",
        },
        outgoing: { hostName: "smtp.example.com", authenticationMethod: "None" },
      }),
    ).toContain("must not contain mail server passwords");
  });

  it("requires the PKCS issuance metadata alongside the material", async () => {
    const data = await config();

    expect(
      await validation("mttx.apple.pkcs.wifi", {
        ...data,
        ca: {},
        template: "",
        subjectNameFormat: "",
        keyUsage: "",
      }),
    ).toContain('"mttx.apple.pkcs.wifi.template" is required');
  });
});
