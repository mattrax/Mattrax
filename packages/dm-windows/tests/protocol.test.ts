import { describe, expect, it } from "vitest";
import { Effect, Layer, Schema } from "effect";
import {
  MdmOrigin,
  WindowsEnrollmentRequest,
  WindowsManagementScope,
} from "@mattrax/management-backend";
import { WindowsMdmService, WindowsMdmServiceLive } from "../src/service.js";
import { mockManagementBackend } from "./helpers.js";

const config = { origin: "https://test.mattrax.app", providerId: "Mattrax" };

const policyBody =
  '<GetPolicies xmlns="http://schemas.microsoft.com/windows/pki/2009/01/enrollmentpolicy"><client/></GetPolicies>';

const enrollBody =
  '<wst:RequestSecurityToken xmlns:wst="http://docs.oasis-open.org/ws-sx/ws-trust/200512"><TokenType>token</TokenType><RequestType>issue</RequestType><BinarySecurityToken ValueType="pkcs10" EncodingType="base64">csr</BinarySecurityToken><ac:AdditionalContext xmlns:ac="http://schemas.xmlsoap.org/ws/2006/12/authorization"><ContextItem Name="DeviceID"><Value>device-1</Value></ContextItem></ac:AdditionalContext></wst:RequestSecurityToken>';

const envelope = (body: string, security: string) => `<?xml version="1.0"?>
<s:Envelope xmlns:s="http://www.w3.org/2003/05/soap-envelope">
  <s:Header><wsse:Security xmlns:wsse="http://docs.oasis-open.org/wss/2004/01/oasis-200401-wss-wssecurity-secext-1.0.xsd">${security}</wsse:Security></s:Header>
  <s:Body>${body}</s:Body>
</s:Envelope>`;

const service = (overrides?: Parameters<typeof mockManagementBackend>[0]) =>
  Effect.gen(function* () {
    return yield* WindowsMdmService;
  }).pipe(
    Effect.provide(
      WindowsMdmServiceLive(config).pipe(Layer.provide(mockManagementBackend(overrides))),
    ),
  );

describe("Windows SOAP protocol boundaries", () => {
  const expectHeaderRejected = async (route: "policy" | "enroll") => {
    let backendCalls = 0;
    const implementation = await Effect.runPromise(
      service({
        getWindowsEnrollmentPolicy: () => {
          backendCalls++;

          return Effect.succeed({
            authToken: "token",
            minimalKeyLength: "2048",
            certificateValidityPeriodSeconds: "31536000",
            renewalPeriodSeconds: "15552000",
          });
        },
        windowsEnroll: () => {
          backendCalls++;

          return Effect.succeed({
            deviceId: "device-1",
            signedCertificate: "signed",
            identityCertificate: "identity",
            username: "device-1",
            secret: "secret",
            providerId: "Mattrax",
          });
        },
      }),
    );
    const security = Array.from({ length: 5_000 }, () => "<wsse:BinarySecurityToken/>").join("");
    const started = performance.now();
    const result = await Effect.runPromise(
      implementation[route](envelope(route === "policy" ? policyBody : enrollBody, security)).pipe(
        Effect.result,
      ),
    );

    expect(performance.now() - started).toBeLessThan(2_000);
    expect(result).toMatchObject({
      _tag: "Failure",
      failure: {
        _tag: "WindowsMdmError",
        code: "invalid_envelope",
        cause: { reason: "header_too_large" },
      },
    });
    expect(backendCalls).toBe(0);
  };

  it("rejects thousands of token-shaped elements on the policy route", async () => {
    await expectHeaderRejected("policy");
  });

  it("rejects thousands of token-shaped elements on the enroll route", async () => {
    await expectHeaderRejected("enroll");
  });

  const expectBodyRejected = async (route: "policy" | "enroll") => {
    let backendCalls = 0;
    const implementation = await Effect.runPromise(
      service({
        getWindowsEnrollmentPolicy: () => {
          backendCalls++;

          return Effect.die("backend must not run");
        },
        windowsEnroll: () => {
          backendCalls++;

          return Effect.die("backend must not run");
        },
      }),
    );
    const result = await Effect.runPromise(
      implementation[route](envelope(`<Payload>${"x".repeat(1024 * 1024 + 1)}</Payload>`, "")).pipe(
        Effect.result,
      ),
    );

    expect(result).toMatchObject({
      _tag: "Failure",
      failure: { cause: { reason: "request_too_large" } },
    });
    expect(backendCalls).toBe(0);
  };

  it("rejects an oversized body on the policy route before token validation", async () => {
    await expectBodyRejected("policy");
  });

  it("rejects an oversized body on the enroll route before token validation", async () => {
    await expectBodyRejected("enroll");
  });

  it("reads exactly one direct WS-Security token and strips XML whitespace", async () => {
    let token: string | undefined;
    const implementation = await Effect.runPromise(
      service({
        getWindowsEnrollmentPolicy: (presented: string) => {
          token = presented;

          return Effect.succeed({
            authToken: "next",
            minimalKeyLength: "2048",
            certificateValidityPeriodSeconds: "31536000",
            renewalPeriodSeconds: "15552000",
          });
        },
      }),
    );

    await Effect.runPromise(
      implementation.policy(
        envelope(policyBody, "<wsse:BinarySecurityToken>  token-123\n </wsse:BinarySecurityToken>"),
      ),
    );

    expect(token).toBe("token-123");
  });

  it("forwards renewal possession proof only from trusted request identity", async () => {
    const EnrollmentProof = Schema.Struct({
      identityCertificate: Schema.optional(Schema.String),
      identityCertificateSerial: Schema.optional(Schema.String),
      identityCertificateDerBase64: Schema.optional(Schema.String),
    });
    type CapturedEnrollment = Pick<WindowsEnrollmentRequest, "tenantToken" | "context"> &
      typeof EnrollmentProof.Type;
    const requests: CapturedEnrollment[] = [];
    const implementation = await Effect.runPromise(
      service({
        windowsEnroll: (request: WindowsEnrollmentRequest) => {
          requests.push({
            tenantToken: request.tenantToken,
            context: request.context,
            ...Schema.decodeUnknownSync(EnrollmentProof)(request),
          });

          return Effect.succeed({
            deviceId: "device-1",
            signedCertificate: "signed",
            identityCertificate: "identity",
            username: "device-1",
            secret: "secret",
            providerId: "Mattrax",
          });
        },
      }),
    );
    const body =
      '<wst:RequestSecurityToken xmlns:wst="http://docs.oasis-open.org/ws-sx/ws-trust/200512"><TokenType>token</TokenType><RequestType>issue</RequestType><BinarySecurityToken ValueType="pkcs10" EncodingType="base64">csr</BinarySecurityToken><ac:AdditionalContext xmlns:ac="http://schemas.xmlsoap.org/ws/2006/12/authorization"><ContextItem Name="DeviceID"><Value>device-1</Value></ContextItem><ContextItem Name="identityCertificateSerial"><Value>spoofed-serial</Value></ContextItem><ContextItem Name="identityCertificateDerBase64"><Value>spoofed-der</Value></ContextItem></ac:AdditionalContext></wst:RequestSecurityToken>';

    await Effect.runPromise(
      implementation.enroll(
        envelope(body, "<wsse:BinarySecurityToken>token</wsse:BinarySecurityToken>"),
        {
          identityCertificate: "CN=device-1,OU=org-1",
          identityCertificateSerial: "trusted-serial",
          identityCertificateDerBase64: "trusted-der",
          tenantToken: "tenant-token",
        },
      ),
    );
    await Effect.runPromise(
      implementation.enroll(
        envelope(body, "<wsse:BinarySecurityToken>token</wsse:BinarySecurityToken>"),
      ),
    );

    expect(requests[0]).toMatchObject({
      identityCertificate: "CN=device-1,OU=org-1",
      identityCertificateSerial: "trusted-serial",
      identityCertificateDerBase64: "trusted-der",
      tenantToken: "tenant-token",
      context: {
        identityCertificateSerial: "spoofed-serial",
        identityCertificateDerBase64: "spoofed-der",
      },
    });
    expect(requests[1].identityCertificate).toBeUndefined();
    expect(requests[1].identityCertificateSerial).toBeUndefined();
    expect(requests[1].identityCertificateDerBase64).toBeUndefined();
  });

  it("round-trips optional trusted identity proof in the enrollment request schema", () => {
    const input = {
      authToken: "token",
      csr: "csr",
      deviceId: "device-1",
      context: { DeviceID: "device-1" },
      mdmOrigin: new MdmOrigin({ url: config.origin }),
      identityCertificate: "CN=device-1,OU=org-1",
      identityCertificateSerial: "abcd",
      identityCertificateDerBase64: "ZGVy",
    };
    const decoded = Schema.decodeUnknownSync(WindowsEnrollmentRequest)(input);

    expect(decoded).toEqual(input);
    expect(Schema.encodeSync(WindowsEnrollmentRequest)(decoded)).toEqual(input);

    const {
      identityCertificate: _certificate,
      identityCertificateSerial: _serial,
      identityCertificateDerBase64: _der,
      ...firstEnrollment
    } = input;
    expect(Schema.decodeUnknownSync(WindowsEnrollmentRequest)(firstEnrollment)).toEqual(
      firstEnrollment,
    );
  });

  it("round-trips verified DER identity in the management scope schema", () => {
    const input = {
      deviceId: "device-1",
      identityCertificate: "CN=device-1,OU=org-1",
      identityCertificateSerial: "abcd",
      identityCertificateDerBase64: "ZGVy",
      mdmOrigin: new MdmOrigin({ url: config.origin }),
    };
    const decoded = Schema.decodeUnknownSync(WindowsManagementScope)(input);

    expect(decoded).toEqual(input);
    expect(Schema.encodeSync(WindowsManagementScope)(decoded)).toEqual(input);
  });

  it("ignores tokens in the wrong namespace, nested tokens, and ambiguous duplicates", async () => {
    const implementation = await Effect.runPromise(service());
    const securities = [
      '<wrong:BinarySecurityToken xmlns:wrong="urn:wrong">token</wrong:BinarySecurityToken>',
      "<wrapper><wsse:BinarySecurityToken>token</wsse:BinarySecurityToken></wrapper>",
      "<wsse:BinarySecurityToken>one</wsse:BinarySecurityToken><wsse:BinarySecurityToken>two</wsse:BinarySecurityToken>",
    ];

    for (const security of securities) {
      const result = await Effect.runPromise(
        implementation.policy(envelope(policyBody, security)).pipe(Effect.result),
      );

      expect(result).toMatchObject({
        _tag: "Failure",
        failure: { _tag: "WindowsMdmError", code: "missing_token" },
      });
    }
  });

  it("returns malformed envelopes through the typed error channel", async () => {
    const result = await Effect.runPromise(
      service().pipe(
        Effect.flatMap((implementation) => implementation.policy("<invalid")),
        Effect.result,
      ),
    );

    expect(result).toMatchObject({
      _tag: "Failure",
      failure: {
        _tag: "WindowsMdmError",
        code: "invalid_envelope",
        cause: { _tag: "SoapEnvelopeError", reason: "invalid_xml" },
      },
    });
  });
});
