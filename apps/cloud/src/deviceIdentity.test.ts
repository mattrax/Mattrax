import { describe, expect, it } from "vitest";
import { Effect, Layer, Schema } from "effect";
import { HttpRouter } from "effect/http";
import { ManagementBackend, ManagementNotSupported } from "@mattrax/management-backend";
import type { WindowsEnrollmentRequest, WindowsManagementScope } from "@mattrax/management-backend";
import { WindowsMdmServiceLive, windowsMdmRoutes } from "@mattrax/dm-windows";
import { deviceIdentityHeaders, NODE_PEER_ADDRESS_HEADER } from "./deviceIdentity.js";
import { parseTrustedPeerAddresses } from "./trustedPeer.js";

const identityHeaders = {
  "x-device-identity-certificate": "O=Mattrax,OU=org-dummy,CN=device-dummy",
  "x-device-identity-certificate-serial": "A1:B2:C3",
  "x-device-identity-certificate-sha256": "a".repeat(64),
  "x-device-identity-certificate-der-base64": "ZHVtbXktZGVy",
};

const trustedPeers = parseTrustedPeerAddresses("127.0.0.1,::1");

const request = (headers: Record<string, string>, cf?: unknown) => {
  const value = new Request("https://mattrax.example.com/mdm/windows/management", { headers });

  return cf === undefined ? value : Object.assign(value, { cf });
};

const identity = (headers: Headers) => ({
  certificate: headers.get("x-device-identity-certificate"),
  serial: headers.get("x-device-identity-certificate-serial"),
  fingerprint: headers.get("x-device-identity-certificate-sha256"),
  derBase64: headers.get("x-device-identity-certificate-der-base64"),
});

const expectedIdentity = {
  certificate: identityHeaders["x-device-identity-certificate"],
  serial: identityHeaders["x-device-identity-certificate-serial"],
  fingerprint: identityHeaders["x-device-identity-certificate-sha256"],
  derBase64: identityHeaders["x-device-identity-certificate-der-base64"],
};

const noIdentity = {
  certificate: null,
  serial: null,
  fingerprint: null,
  derBase64: null,
};

describe("device identity trust boundary", () => {
  it("strips direct caller-forged identity and internal peer headers by default", () => {
    const headers = deviceIdentityHeaders(
      request({
        ...identityHeaders,
        [NODE_PEER_ADDRESS_HEADER]: "127.0.0.1",
        "x-mattrax-client-address": "203.0.113.9",
      }),
      { trustIdentityHeaders: false, trustedPeers, trustForwarded: false },
    );

    expect(identity(headers)).toEqual(noIdentity);
    expect(headers.get(NODE_PEER_ADDRESS_HEADER)).toBeNull();
    expect(headers.get("x-mattrax-client-address")).toBeNull();
  });

  it("rebuilds a complete identity bundle from an explicitly trusted proxy", () => {
    const headers = deviceIdentityHeaders(
      request({ ...identityHeaders, [NODE_PEER_ADDRESS_HEADER]: "127.0.0.1" }),
      { trustIdentityHeaders: true, trustedPeers, trustForwarded: false },
    );

    expect(identity(headers)).toEqual(expectedIdentity);
    expect(headers.get(NODE_PEER_ADDRESS_HEADER)).toBeNull();
  });

  it("accepts an IPv6 trusted peer and an IPv4-mapped socket peer", () => {
    for (const peer of ["::1", "::ffff:127.0.0.1"]) {
      const headers = deviceIdentityHeaders(
        request({ ...identityHeaders, [NODE_PEER_ADDRESS_HEADER]: peer }),
        { trustIdentityHeaders: true, trustedPeers, trustForwarded: false },
      );

      expect(identity(headers)).toEqual(expectedIdentity);
    }
  });

  it("discards identity headers from an untrusted peer", () => {
    const headers = deviceIdentityHeaders(
      request({ ...identityHeaders, [NODE_PEER_ADDRESS_HEADER]: "198.51.100.25" }),
      { trustIdentityHeaders: true, trustedPeers, trustForwarded: false },
    );

    expect(identity(headers)).toEqual(noIdentity);
  });

  it("discards identity headers when the Node peer header is absent", () => {
    const headers = deviceIdentityHeaders(request(identityHeaders), {
      trustIdentityHeaders: true,
      trustedPeers,
      trustForwarded: false,
    });

    expect(identity(headers)).toEqual(noIdentity);
  });

  it("never substitutes a forwarded client address for the trusted socket peer", () => {
    const headers = deviceIdentityHeaders(
      request({ ...identityHeaders, "x-forwarded-for": "127.0.0.1" }),
      { trustIdentityHeaders: true, trustedPeers, trustForwarded: true },
    );

    expect(identity(headers)).toEqual(noIdentity);
    expect(headers.get("x-mattrax-client-address")).toBe("127.0.0.1");
  });

  it("discards the whole bundle when the trusted certificate has no CN", () => {
    const headers = deviceIdentityHeaders(
      request({
        "x-device-identity-certificate": "O=Mattrax,OU=org-dummy",
        "x-device-identity-certificate-serial": "A1:B2:C3",
        "x-device-identity-certificate-sha256": "a".repeat(64),
        "x-device-identity-certificate-der-base64":
          identityHeaders["x-device-identity-certificate-der-base64"],
        [NODE_PEER_ADDRESS_HEADER]: "127.0.0.1",
      }),
      { trustIdentityHeaders: true, trustedPeers, trustForwarded: false },
    );

    expect(identity(headers)).toEqual(noIdentity);
  });

  it("discards the whole bundle when the trusted certificate has no serial", () => {
    const headers = deviceIdentityHeaders(
      request({
        "x-device-identity-certificate": identityHeaders["x-device-identity-certificate"],
        "x-device-identity-certificate-sha256":
          identityHeaders["x-device-identity-certificate-sha256"],
        "x-device-identity-certificate-der-base64":
          identityHeaders["x-device-identity-certificate-der-base64"],
        [NODE_PEER_ADDRESS_HEADER]: "127.0.0.1",
      }),
      { trustIdentityHeaders: true, trustedPeers, trustForwarded: false },
    );

    expect(identity(headers)).toEqual(noIdentity);
  });

  it("accepts a URI-encoded subject from a trusted proxy", () => {
    const headers = deviceIdentityHeaders(
      request({
        ...identityHeaders,
        "x-device-identity-certificate": encodeURIComponent(
          identityHeaders["x-device-identity-certificate"],
        ),
        [NODE_PEER_ADDRESS_HEADER]: "127.0.0.1",
      }),
      { trustIdentityHeaders: true, trustedPeers, trustForwarded: false },
    );

    expect(headers.get("x-device-identity-certificate")).toBe(
      encodeURIComponent(identityHeaders["x-device-identity-certificate"]),
    );
    expect(headers.get("x-device-identity-certificate-serial")).toBe("A1:B2:C3");
  });

  it("keeps the existing client-address policy while removing its caller value", () => {
    const headers = deviceIdentityHeaders(
      request({
        "x-mattrax-client-address": "203.0.113.9",
        "x-forwarded-for": "198.51.100.4",
      }),
      { trustIdentityHeaders: false, trustedPeers, trustForwarded: true },
    );

    expect(headers.get("x-mattrax-client-address")).toBe("198.51.100.4");
  });

  it("rebuilds Cloudflare identity and plain DER from the verified RFC 9440 leaf", () => {
    const headers = deviceIdentityHeaders(
      request(
        { ...identityHeaders, [NODE_PEER_ADDRESS_HEADER]: "127.0.0.1" },
        {
          tlsClientAuth: {
            certVerified: "SUCCESS",
            certSubjectDN: "CN=edge-verified,OU=org-edge",
            certSerial: "ED:GE",
            certRFC9440: ":base64-DER:Y2xvdWRmbGFyZS1kZXI=:",
          },
        },
      ),
      { trustIdentityHeaders: true, trustedPeers, trustForwarded: false },
    );

    expect(identity(headers)).toEqual({
      certificate: "CN=edge-verified,OU=org-edge",
      serial: "ED:GE",
      fingerprint: null,
      derBase64: "Y2xvdWRmbGFyZS1kZXI=",
    });
    expect(headers.get(NODE_PEER_ADDRESS_HEADER)).toBeNull();
  });

  it("does not forward a Cloudflare DER value that is malformed or too large", () => {
    for (const tlsClientAuth of [
      { certVerified: "SUCCESS", certRFC9440: "not-rfc-9440" },
      {
        certVerified: "SUCCESS",
        certRFC9440: ":base64-DER:Y2xvdWRmbGFyZS1kZXI=:",
        certRFC9440TooLarge: true,
      },
    ]) {
      const headers = deviceIdentityHeaders(request(identityHeaders, { tlsClientAuth }), {
        trustIdentityHeaders: true,
        trustedPeers,
        trustForwarded: false,
      });

      expect(headers.get("x-device-identity-certificate-der-base64")).toBeNull();
    }
  });
});

describe("Windows device identity ingress", () => {
  const config = { origin: "https://mattrax.example.com", providerId: "Mattrax" };
  const IdleManifest = Schema.TaggedStruct("Idle", {});
  const enrollBody =
    '<wst:RequestSecurityToken xmlns:wst="http://docs.oasis-open.org/ws-sx/ws-trust/200512"><TokenType>token</TokenType><RequestType>issue</RequestType><BinarySecurityToken ValueType="pkcs10" EncodingType="base64">csr</BinarySecurityToken><ac:AdditionalContext xmlns:ac="http://schemas.xmlsoap.org/ws/2006/12/authorization"><ContextItem Name="DeviceID"><Value>device-dummy</Value></ContextItem></ac:AdditionalContext></wst:RequestSecurityToken>';
  const enrollEnvelope = `<?xml version="1.0" encoding="UTF-8"?>
<s:Envelope xmlns:s="http://www.w3.org/2003/05/soap-envelope"><s:Header><wsse:Security xmlns:wsse="http://docs.oasis-open.org/wss/2004/01/oasis-200401-wss-wssecurity-secext-1.0.xsd"><wsse:BinarySecurityToken>token</wsse:BinarySecurityToken></wsse:Security></s:Header><s:Body>${enrollBody}</s:Body></s:Envelope>`;
  const managementBody =
    '<SyncML xmlns="SYNCML:SYNCML1.2"><SyncHdr><VerDTD>1.2</VerDTD><VerProto>DM/1.2</VerProto><SessionID>1</SessionID><MsgID>1</MsgID><Target><LocURI>server</LocURI></Target><Source><LocURI>device-dummy</LocURI></Source></SyncHdr><SyncBody><Final/></SyncBody></SyncML>';

  type BackendCall =
    | { readonly kind: "enroll"; readonly request: WindowsEnrollmentRequest }
    | { readonly kind: "checkin"; readonly scope: WindowsManagementScope };

  const handler = (calls: BackendCall[]) => {
    const backend = ManagementBackend.of({
      getAppleBootstrapToken: () => Effect.succeed(null),
      appleReturnToServiceConfiguration: () => Effect.succeed({ enabled: false }),
      appleDeviceEvent: () => Effect.void,
      appleManagementCheckin: () => Effect.succeed(IdleManifest.make({})),
      getAppleDeclarationTokens: () =>
        Effect.succeed({
          activationsToken: "a",
          configurationsToken: "c",
          assetsToken: "as",
          managementToken: "m",
          declarationsToken: "d",
        }),
      getAppleDeclarationItems: () =>
        Effect.succeed({ activations: [], configurations: [], assets: [], management: [] }),
      getAppleDeclaration: () => Effect.succeed(null),
      getAppleAsset: () => Effect.succeed(null),
      windowsDiscovery: () => Effect.fail(new ManagementNotSupported()),
      getWindowsEnrollmentPolicy: () => Effect.fail(new ManagementNotSupported()),
      windowsEnroll: (request) => {
        calls.push({ kind: "enroll", request });

        return Effect.succeed({
          deviceId: "device-dummy",
          signedCertificate: "signed",
          identityCertificate: "identity",
          username: "device-dummy",
          secret: "secret",
          providerId: "Mattrax",
        });
      },
      windowsManagementCheckin: (scope) => {
        calls.push({ kind: "checkin", scope });

        return Effect.succeed({ commands: [] });
      },
      windowsDeviceEvent: () => Effect.void,
      windowsRecordFailure: () => Effect.void,
    });

    return HttpRouter.toWebHandler(
      windowsMdmRoutes.pipe(
        Layer.provideMerge(
          WindowsMdmServiceLive(config).pipe(
            Layer.provideMerge(Layer.succeed(ManagementBackend, backend)),
          ),
        ),
      ),
    ).handler;
  };

  const send = async (
    routeHandler: ReturnType<typeof handler>,
    path: string,
    body: string,
    headers: Headers,
  ) =>
    routeHandler(
      new Request(`https://mattrax.example.com${path}`, {
        method: "POST",
        body,
        headers,
      }),
    );

  it("strips an untrusted peer's forged bundle before both Windows backend methods", async () => {
    const calls: BackendCall[] = [];
    const routeHandler = handler(calls);
    const headers = deviceIdentityHeaders(
      request({ ...identityHeaders, [NODE_PEER_ADDRESS_HEADER]: "198.51.100.25" }),
      { trustIdentityHeaders: true, trustedPeers, trustForwarded: false },
    );

    expect(identity(headers)).toEqual(noIdentity);
    expect((await send(routeHandler, "/mdm/windows/enroll", enrollEnvelope, headers)).status).toBe(
      200,
    );
    expect(
      (await send(routeHandler, "/mdm/windows/management", managementBody, headers)).status,
    ).toBe(200);

    expect(calls.map((call) => call.kind)).toEqual(["enroll", "checkin"]);
    for (const call of calls) {
      const value = call.kind === "enroll" ? call.request : call.scope;

      expect(value.identityCertificate).toBeUndefined();
      expect(value.identityCertificateSerial).toBeUndefined();
      expect(value.identityCertificateDerBase64).toBeUndefined();
    }
  });

  it("preserves the trusted proxy's verified DER through both Windows backend methods", async () => {
    const calls: BackendCall[] = [];
    const routeHandler = handler(calls);
    const headers = deviceIdentityHeaders(
      request({ ...identityHeaders, [NODE_PEER_ADDRESS_HEADER]: "127.0.0.1" }),
      { trustIdentityHeaders: true, trustedPeers, trustForwarded: false },
    );

    expect(identity(headers)).toEqual(expectedIdentity);
    expect((await send(routeHandler, "/mdm/windows/enroll", enrollEnvelope, headers)).status).toBe(
      200,
    );
    expect(
      (await send(routeHandler, "/mdm/windows/management", managementBody, headers)).status,
    ).toBe(200);

    expect(calls.map((call) => call.kind)).toEqual(["enroll", "checkin"]);
    for (const call of calls) {
      const value = call.kind === "enroll" ? call.request : call.scope;

      expect(value).toMatchObject({
        identityCertificate: identityHeaders["x-device-identity-certificate"],
        identityCertificateSerial: identityHeaders["x-device-identity-certificate-serial"],
        identityCertificateDerBase64: identityHeaders["x-device-identity-certificate-der-base64"],
      });
    }
  });
});
