import { describe, expect, it } from "vitest";
import { Effect, Layer } from "effect";
import { HttpRouter } from "effect/http";
import {
  AppleMdmConfig,
  AppleMdmServiceLive,
  AppleMdmTopic,
  appleMdmRoutesWith,
} from "@mattrax/dm-apple";
import {
  ManagementBackend,
  ManagementManifest,
  ManagementNotSupported,
  UnknownDevice,
} from "@mattrax/management-backend";
import type { CheckinScope } from "@mattrax/management-backend";
import { deviceIdentityHeaders, NODE_PEER_ADDRESS_HEADER } from "./deviceIdentity.js";
import { parseTrustedPeerAddresses } from "./trustedPeer.js";

const origin = "https://apple-ingress.test";
const verifiedFingerprint = "a".repeat(64);
const trustedPeers = parseTrustedPeerAddresses("127.0.0.1,::1");
const forgedIdentityHeaders = {
  "x-device-identity-certificate": "CN=device-dummy,OU=org-dummy",
  "x-device-identity-certificate-serial": "A1:B2:C3",
  "x-device-identity-certificate-sha256": verifiedFingerprint,
  "x-device-identity-certificate-der-base64": "ZHVtbXktZGVy",
};
const bootstrapMarker = "TRUSTED_BOOTSTRAP_MARKER";
const ddmMarker = "TRUSTED_DDM_MARKER";

const plist = (fields: Record<string, string>) =>
  '<?xml version="1.0" encoding="UTF-8"?>' +
  '<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">' +
  '<plist version="1.0"><dict>' +
  Object.entries(fields)
    .map(([key, value]) => "<key>" + key + "</key><string>" + value + "</string>")
    .join("") +
  "</dict></plist>";

const makeHandler = (observedFingerprints: Array<string | undefined>) => {
  const requireVerifiedIdentity = (scope: CheckinScope) => {
    observedFingerprints.push(scope.identityCertificateFingerprintSha256);

    if (
      scope.identityCertificateFingerprintSha256 !== verifiedFingerprint ||
      scope.identityCertificateSerial !== "A1:B2:C3" ||
      !scope.identityCertificate?.includes("OU=org-dummy")
    )
      return Effect.fail(new UnknownDevice());

    return Effect.void;
  };

  const backend = Layer.succeed(
    ManagementBackend,
    ManagementBackend.of({
      getAppleBootstrapToken: (scope) =>
        requireVerifiedIdentity(scope).pipe(Effect.as(btoa(bootstrapMarker))),
      appleReturnToServiceConfiguration: () => Effect.succeed({ enabled: false }),
      appleDeviceEvent: () => Effect.void,
      appleManagementCheckin: () => Effect.succeed(ManagementManifest.members[0].make({})),
      getAppleDeclarationTokens: (scope) =>
        requireVerifiedIdentity(scope).pipe(
          Effect.as({
            activationsToken: "activation-token",
            configurationsToken: "configuration-token",
            assetsToken: "asset-token",
            managementToken: "management-token",
            declarationsToken: "declarations-token",
          }),
        ),
      getAppleDeclarationItems: (scope) =>
        requireVerifiedIdentity(scope).pipe(
          Effect.as({
            activations: [],
            configurations: [{ identifier: "trusted-config", serverToken: "trusted-token" }],
            assets: [],
            management: [],
          }),
        ),
      getAppleDeclaration: (scope, type, identifier) =>
        requireVerifiedIdentity(scope).pipe(
          Effect.as(
            type === "configuration" && identifier === "trusted-config"
              ? {
                  Type: "com.apple.configuration.app.settings",
                  Identifier: identifier,
                  ServerToken: "trusted-token",
                  Payload: { TRUSTED_DDM_MARKER: ddmMarker },
                }
              : null,
          ),
        ),
      getAppleAsset: () => Effect.succeed(null),
      getAppleManifest: () => Effect.succeed(null),
      getAppleProfile: () => Effect.succeed(null),
      windowsDiscovery: () => Effect.fail(new ManagementNotSupported()),
      getWindowsEnrollmentPolicy: () => Effect.fail(new ManagementNotSupported()),
      windowsEnroll: () => Effect.fail(new ManagementNotSupported()),
      windowsManagementCheckin: () => Effect.fail(new ManagementNotSupported()),
      windowsDeviceEvent: () => Effect.fail(new ManagementNotSupported()),
    }),
  );
  const serviceLayer = AppleMdmServiceLive.pipe(
    Layer.provideMerge(backend),
    Layer.provideMerge(AppleMdmConfig.layer({ origin })),
    Layer.provideMerge(
      Layer.succeed(
        AppleMdmTopic,
        AppleMdmTopic.of({ get: Effect.succeed("com.apple.mgmt.External.test") }),
      ),
    ),
  );
  const appLayer = appleMdmRoutesWith().pipe(Layer.provideMerge(serviceLayer));

  return HttpRouter.toWebHandler(appLayer);
};

const send = async (
  handler: Awaited<ReturnType<typeof makeHandler>>["handler"],
  body: string,
  options: {
    readonly peer?: string;
    readonly headers?: Record<string, string>;
    readonly cf?: unknown;
  } = {},
) => {
  const request = new Request("https://apple-ingress.test/mdm/apple/mdm", {
    method: "PUT",
    body,
    headers: {
      "Content-Type": "application/x-apple-aspen-mdm-checkin",
      ...(options.peer ? { [NODE_PEER_ADDRESS_HEADER]: options.peer } : {}),
      ...options.headers,
    },
  });
  const cfRequest = options.cf === undefined ? request : Object.assign(request, { cf: options.cf });
  const ingressRequest = new Request(cfRequest, {
    headers: deviceIdentityHeaders(cfRequest, {
      trustIdentityHeaders: true,
      trustedPeers,
      trustForwarded: false,
    }),
  });

  return handler(ingressRequest);
};

const scenarios = [
  {
    name: "bootstrap token",
    body: plist({ MessageType: "GetBootstrapToken", UDID: "udid-dummy" }),
    marker: btoa(bootstrapMarker),
    untrustedStatus: 200,
  },
  {
    name: "DDM tokens",
    body: plist({
      MessageType: "DeclarativeManagement",
      UDID: "udid-dummy",
      Endpoint: "tokens",
    }),
    marker: "declarations-token",
    untrustedStatus: 400,
  },
  {
    name: "DDM items",
    body: plist({
      MessageType: "DeclarativeManagement",
      UDID: "udid-dummy",
      Endpoint: "declaration-items",
    }),
    marker: "trusted-config",
    untrustedStatus: 400,
  },
  {
    name: "DDM content",
    body: plist({
      MessageType: "DeclarativeManagement",
      UDID: "udid-dummy",
      Endpoint: "declaration/configuration/trusted-config",
    }),
    marker: ddmMarker,
    untrustedStatus: 400,
  },
] as const;

describe("Apple MDM identity ingress boundary", () => {
  it.each(scenarios)(
    "does not release $name to an untrusted peer but releases it to a trusted verified identity",
    async ({ body, marker, untrustedStatus }) => {
      const observedFingerprints: Array<string | undefined> = [];
      const { handler } = makeHandler(observedFingerprints);

      const untrusted = await send(handler, body, {
        peer: "198.51.100.25",
        headers: forgedIdentityHeaders,
      });
      expect(untrusted.status).toBe(untrustedStatus);
      expect(await untrusted.text()).not.toContain(marker);

      const trusted = await send(handler, body, {
        peer: "127.0.0.1",
        headers: forgedIdentityHeaders,
      });
      expect(trusted.status).toBe(200);
      expect(await trusted.text()).toContain(marker);

      expect(observedFingerprints).toContain(undefined);
      expect(observedFingerprints).toContain(verifiedFingerprint);
    },
  );

  it("does not release content when a trusted proxy omits the verified fingerprint", async () => {
    const observedFingerprints: Array<string | undefined> = [];
    const { handler } = makeHandler(observedFingerprints);
    const { "x-device-identity-certificate-sha256": _fingerprint, ...withoutFingerprint } =
      forgedIdentityHeaders;

    const response = await send(
      handler,
      plist({
        MessageType: "DeclarativeManagement",
        UDID: "udid-dummy",
        Endpoint: "declaration/configuration/trusted-config",
      }),
      { peer: "127.0.0.1", headers: withoutFingerprint },
    );

    expect(response.status).toBe(400);
    expect(await response.text()).not.toContain(ddmMarker);
    expect(observedFingerprints.every((fingerprint) => fingerprint === undefined)).toBe(true);
  });

  it("uses Cloudflare's verified mTLS bundle instead of caller-forged identity headers", async () => {
    const observedFingerprints: Array<string | undefined> = [];
    const { handler } = makeHandler(observedFingerprints);
    const body = plist({
      MessageType: "DeclarativeManagement",
      UDID: "udid-dummy",
      Endpoint: "declaration/configuration/trusted-config",
    });
    const cf = {
      tlsClientAuth: {
        certVerified: "SUCCESS",
        certSubjectDN: "CN=device-dummy,OU=org-dummy",
        certSerial: "A1:B2:C3",
        certFingerprintSHA256: verifiedFingerprint,
      },
    };

    const trusted = await send(handler, body, {
      headers: {
        ...forgedIdentityHeaders,
        "x-device-identity-certificate": "CN=attacker,OU=org-attacker",
        "x-device-identity-certificate-sha256": "b".repeat(64),
      },
      cf,
    });
    expect(trusted.status).toBe(200);
    expect(await trusted.text()).toContain(ddmMarker);
    expect(observedFingerprints).toContain(verifiedFingerprint);

    const revoked = await send(handler, body, {
      headers: forgedIdentityHeaders,
      cf: {
        tlsClientAuth: {
          ...cf.tlsClientAuth,
          certRevoked: true,
        },
      },
    });
    expect(revoked.status).toBe(400);
    expect(await revoked.text()).not.toContain(ddmMarker);
  });
});
