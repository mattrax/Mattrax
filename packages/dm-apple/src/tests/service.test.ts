import { describe, it, expect } from "vitest";
import { Effect, Layer } from "effect";
import { AppleMdmService, AppleMdmServiceLive, AppleMdmTopic } from "../service.js";
import { AppleMdmConfig } from "../config.js";
import {
  ManagementBackend,
  ManagementNotSupported,
  UnknownDevice,
  MdmOrigin,
} from "@mattrax/management-backend";
import { mockManagementBackend } from "./helpers.js";
import { parsePlist } from "@mattrax/plist";

const TEST_CONFIG = { origin: "https://test.mattrax.app", topic: "com.apple.mgmt.External.test" };
const TEST_MDM_ORIGIN = new MdmOrigin({ url: TEST_CONFIG.origin });

function runWithService<A, E>(
  backendLayer: Layer.Layer<ManagementBackend>,
  effect: Effect.Effect<A, E, AppleMdmService>,
) {
  const layer = AppleMdmServiceLive.pipe(
    Layer.provideMerge(backendLayer),
    Layer.provideMerge(AppleMdmConfig.layer({ origin: TEST_CONFIG.origin })),
    Layer.provideMerge(
      Layer.succeed(AppleMdmTopic, AppleMdmTopic.of({ get: Effect.succeed(TEST_CONFIG.topic) })),
    ),
  );
  return effect.pipe(Effect.provide(layer), Effect.runPromise);
}

describe("AppleMdmService", () => {
  describe("handleAuthenticate", () => {
    it("sends an Authenticate event to the backend", async () => {
      let receivedEvent: unknown;
      const backend = mockManagementBackend({
        appleDeviceEvent: (_scope: unknown, event: unknown) =>
          Effect.sync(() => {
            receivedEvent = event;
          }),
      });

      await runWithService(
        backend,
        Effect.gen(function* () {
          const service = yield* AppleMdmService;
          return yield* service.handleAuthenticate({
            MessageType: "Authenticate",
            Topic: TEST_CONFIG.topic,
            UDID: "udid-123",
            SerialNumber: "SN123",
            OSVersion: "14.0",
            Model: "MacBookPro18,1",
          });
        }),
      );

      expect(receivedEvent).toBeDefined();
      const ev = receivedEvent as { _tag: string; serialNumber: string; model: string };
      expect(ev._tag).toBe("Authenticate");
      expect(ev.serialNumber).toBe("SN123");
      expect(ev.model).toBe("MacBookPro18,1");
    });

    it("passes the identity certificate serial to the backend scope", async () => {
      let receivedScope: unknown;
      const backend = mockManagementBackend({
        appleDeviceEvent: (scope: unknown) =>
          Effect.sync(() => {
            receivedScope = scope;
          }),
      });

      await runWithService(
        backend,
        Effect.gen(function* () {
          const service = yield* AppleMdmService;
          return yield* service.handleAuthenticate(
            {
              MessageType: "Authenticate",
              Topic: TEST_CONFIG.topic,
              UDID: "udid-123",
              SerialNumber: "SN123",
            },
            "CN=Device,OU=org-1",
            "fingerprint-1",
            "a1b2c3",
          );
        }),
      );

      expect(receivedScope).toMatchObject({
        _tag: "device",
        udid: "udid-123",
        identityCertificate: "CN=Device,OU=org-1",
        identityCertificateFingerprintSha256: "fingerprint-1",
        identityCertificateSerial: "a1b2c3",
        mdmOrigin: TEST_MDM_ORIGIN,
      });
    });

    it("rejects UnknownDevice", async () => {
      const backend = mockManagementBackend({
        appleDeviceEvent: () => Effect.fail(new UnknownDevice()),
      });

      await expect(
        runWithService(
          backend,
          Effect.gen(function* () {
            const service = yield* AppleMdmService;
            return yield* service.handleAuthenticate({
              MessageType: "Authenticate",
              Topic: TEST_CONFIG.topic,
              UDID: "unknown-udid",
            });
          }),
        ),
      ).rejects.toThrow("Failed to send Authenticate event");
    });

    it("silently handles ManagementNotSupported", async () => {
      const backend = mockManagementBackend({
        appleDeviceEvent: () => Effect.fail(new ManagementNotSupported()),
      });

      await runWithService(
        backend,
        Effect.gen(function* () {
          const service = yield* AppleMdmService;
          return yield* service.handleAuthenticate({
            MessageType: "Authenticate",
            Topic: TEST_CONFIG.topic,
            UDID: "unsupported-udid",
          });
        }),
      );
    });

    it("uses ModelName as fallback for Model", async () => {
      let receivedEvent: unknown;
      const backend = mockManagementBackend({
        appleDeviceEvent: (_scope: unknown, event: unknown) =>
          Effect.sync(() => {
            receivedEvent = event;
          }),
      });

      await runWithService(
        backend,
        Effect.gen(function* () {
          const service = yield* AppleMdmService;
          return yield* service.handleAuthenticate({
            MessageType: "Authenticate",
            Topic: TEST_CONFIG.topic,
            UDID: "udid-123",
            ModelName: "MacBookPro17,1",
          });
        }),
      );

      const ev = receivedEvent as { model: string };
      expect(ev.model).toBe("MacBookPro17,1");
    });
  });

  describe("handleTokenUpdate", () => {
    it("sends a device-scoped TokenUpdate", async () => {
      let receivedEvent: unknown;
      const backend = mockManagementBackend({
        appleDeviceEvent: (_scope: unknown, event: unknown) =>
          Effect.sync(() => {
            receivedEvent = event;
          }),
      });

      await runWithService(
        backend,
        Effect.gen(function* () {
          const service = yield* AppleMdmService;
          return yield* service.handleTokenUpdate({
            MessageType: "TokenUpdate",
            Topic: TEST_CONFIG.topic,
            UDID: "udid-123",
            PushMagic: "magic-123",
            Token: "dGVzdC10b2tlbg==",
          });
        }),
      );

      const ev = receivedEvent as { _tag: string; pushToken: string; channel: string };
      expect(ev._tag).toBe("TokenUpdate");
      expect(ev.pushToken).toBe("746573742d746f6b656e"); // hex of base64 "dGVzdC10b2tlbg=="
      expect(ev.channel).toBe("device");
    });

    it("sends a user-scoped TokenUpdate when UserID is present", async () => {
      let receivedEvent: unknown;
      const backend = mockManagementBackend({
        appleDeviceEvent: (_scope: unknown, event: unknown) =>
          Effect.sync(() => {
            receivedEvent = event;
          }),
      });

      await runWithService(
        backend,
        Effect.gen(function* () {
          const service = yield* AppleMdmService;
          return yield* service.handleTokenUpdate({
            MessageType: "TokenUpdate",
            Topic: TEST_CONFIG.topic,
            UDID: "udid-123",
            PushMagic: "magic-123",
            Token: "dGVzdA==",
            UserID: "user-456",
          });
        }),
      );

      const ev = receivedEvent as { channel: string };
      expect(ev.channel).toBe("user");
    });
  });

  describe("handleCheckOut", () => {
    it("sends a CheckOut event", async () => {
      let receivedEvent: unknown;
      const backend = mockManagementBackend({
        appleDeviceEvent: (_scope: unknown, event: unknown) =>
          Effect.sync(() => {
            receivedEvent = event;
          }),
      });

      await runWithService(
        backend,
        Effect.gen(function* () {
          const service = yield* AppleMdmService;
          return yield* service.handleCheckOut({
            MessageType: "CheckOut",
            Topic: TEST_CONFIG.topic,
            UDID: "udid-123",
          });
        }),
      );

      const ev = receivedEvent as { _tag: string };
      expect(ev._tag).toBe("CheckOut");
    });
  });

  describe("handleCommandResult", () => {
    it("sends a CommandResult with status", async () => {
      let receivedEvent: unknown;
      const backend = mockManagementBackend({
        appleDeviceEvent: (_scope: unknown, event: unknown) =>
          Effect.sync(() => {
            receivedEvent = event;
          }),
      });

      await runWithService(
        backend,
        Effect.gen(function* () {
          const service = yield* AppleMdmService;
          return yield* service.handleCommandResult({
            UDID: "udid-123",
            Status: "Acknowledged",
            CommandUUID: "cmd-001",
          });
        }),
      );

      const ev = receivedEvent as { _tag: string; status: string };
      expect(ev._tag).toBe("CommandResult");
      expect(ev.status).toBe("Acknowledged");
    });

    it("includes errorDetail from ErrorChain", async () => {
      let receivedEvent: unknown;
      const backend = mockManagementBackend({
        appleDeviceEvent: (_scope: unknown, event: unknown) =>
          Effect.sync(() => {
            receivedEvent = event;
          }),
      });

      await runWithService(
        backend,
        Effect.gen(function* () {
          const service = yield* AppleMdmService;
          return yield* service.handleCommandResult({
            UDID: "udid-123",
            Status: "Error",
            CommandUUID: "cmd-002",
            ErrorChain: [
              { ErrorCode: 89, ErrorDomain: "MDMClientError" },
              { ErrorCode: 12075, ErrorDomain: "MDMErrorDomain" },
            ],
          });
        }),
      );

      const ev = receivedEvent as { errorDetail: string };
      expect(ev.errorDetail).toContain("MDMClientError:89");
      expect(ev.errorDetail).toContain("MDMErrorDomain:12075");
    });

    it("includes queryResponses when present", async () => {
      let receivedEvent: unknown;
      const backend = mockManagementBackend({
        appleDeviceEvent: (_scope: unknown, event: unknown) =>
          Effect.sync(() => {
            receivedEvent = event;
          }),
      });

      await runWithService(
        backend,
        Effect.gen(function* () {
          const service = yield* AppleMdmService;
          return yield* service.handleCommandResult({
            UDID: "udid-123",
            Status: "Acknowledged",
            CommandUUID: "cmd-003",
            QueryResponses: { DeviceName: "TestMac" },
          });
        }),
      );

      const ev = receivedEvent as { queryResponses: Record<string, unknown> };
      expect(ev.queryResponses).toEqual({ DeviceName: "TestMac" });
    });
  });

  describe("handleCheckin", () => {
    it("returns a command when backend returns Command", async () => {
      const backend = mockManagementBackend({
        appleManagementCheckin: () =>
          Effect.succeed({
            _tag: "Command" as const,
            commandUUID: "cmd-001",
            requestType: "DeviceInformation",
            payload: { Queries: ["DeviceName"] },
          }),
      });

      const result = await runWithService(
        backend,
        Effect.gen(function* () {
          const service = yield* AppleMdmService;
          return yield* service.handleCheckin({
            _tag: "device",
            udid: "udid-123",
            mdmOrigin: TEST_MDM_ORIGIN,
          });
        }),
      );
      expect(result).not.toBeNull();
      expect(result!.commandUUID).toBe("cmd-001");
      expect(result!.requestType).toBe("DeviceInformation");
    });

    it("returns null when backend returns Idle", async () => {
      const backend = mockManagementBackend({
        appleManagementCheckin: () => Effect.succeed({ _tag: "Idle" } as const),
      });

      const result = await runWithService(
        backend,
        Effect.gen(function* () {
          const service = yield* AppleMdmService;
          return yield* service.handleCheckin({
            _tag: "device",
            udid: "udid-123",
            mdmOrigin: TEST_MDM_ORIGIN,
          });
        }),
      );
      expect(result).toBeNull();
    });

    it("returns a DeclarativeManagement command for DdmSync", async () => {
      const backend = mockManagementBackend({
        appleManagementCheckin: () =>
          Effect.succeed({
            _tag: "DdmSync" as const,
            serverToken: "token-abc",
          }),
      });

      const result = await runWithService(
        backend,
        Effect.gen(function* () {
          const service = yield* AppleMdmService;
          return yield* service.handleCheckin({
            _tag: "device",
            udid: "udid-123",
            mdmOrigin: TEST_MDM_ORIGIN,
          });
        }),
      );
      expect(result).not.toBeNull();
      expect(result!.requestType).toBe("DeclarativeManagement");
      expect(result!.commandUUID).toBeDefined();
    });

    it("handles UnknownDevice by returning Idle", async () => {
      const backend = mockManagementBackend({
        appleManagementCheckin: () => Effect.fail(new UnknownDevice()),
      });

      const result = await runWithService(
        backend,
        Effect.gen(function* () {
          const service = yield* AppleMdmService;
          return yield* service.handleCheckin({
            _tag: "device",
            udid: "unknown",
            mdmOrigin: TEST_MDM_ORIGIN,
          });
        }),
      );
      expect(result).toBeNull();
    });
  });

  describe("handleDeclarativeTokens", () => {
    it("returns tokens from the backend", async () => {
      const backend = mockManagementBackend({
        getAppleDeclarationTokens: () =>
          Effect.succeed({
            activationsToken: "act-1",
            configurationsToken: "cfg-1",
            assetsToken: "asset-1",
            managementToken: "mgmt-1",
            declarationsToken: "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA",
          }),
      });

      const result = await runWithService(
        backend,
        Effect.gen(function* () {
          const service = yield* AppleMdmService;
          return yield* service.handleDeclarativeTokens({
            _tag: "device",
            udid: "udid-123",
            mdmOrigin: TEST_MDM_ORIGIN,
          });
        }),
      );
      expect(result.SyncTokens.DeclarationsToken).toMatch(/^[A-F0-9]{64}$/);
      expect(result.SyncTokens.Timestamp).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    });

    it("fails for unknown devices", async () => {
      const backend = mockManagementBackend({
        getAppleDeclarationTokens: () => Effect.fail(new UnknownDevice()),
      });

      const result = await runWithService(
        backend,
        Effect.gen(function* () {
          const service = yield* AppleMdmService;
          return yield* service.handleDeclarativeTokens({
            _tag: "device",
            udid: "unknown",
            mdmOrigin: TEST_MDM_ORIGIN,
          });
        }),
      )
        .then(() => "Success")
        .catch(() => "Failure");
      expect(result).toBe("Failure");
    });
  });

  describe("handleDeclarationItems", () => {
    it("returns declaration items from the backend", async () => {
      const backend = mockManagementBackend({
        getAppleDeclarationItems: () =>
          Effect.succeed({
            activations: [{ identifier: "act-1", serverToken: "tok-1" }],
            configurations: [{ identifier: "cfg-1", serverToken: "tok-2" }],
            assets: [],
            management: [],
          }),
      });

      const result = await runWithService(
        backend,
        Effect.gen(function* () {
          const service = yield* AppleMdmService;
          return yield* service.handleDeclarationItems({
            _tag: "device",
            udid: "udid-123",
            mdmOrigin: TEST_MDM_ORIGIN,
          });
        }),
      );
      expect(result.Declarations.Activations).toHaveLength(1);
      expect(result.Declarations.Activations[0].Identifier).toBe("act-1");
      expect(result.Declarations.Configurations).toHaveLength(1);
      expect(result.Declarations.Assets).toHaveLength(0);
    });
  });

  describe("handleDeclaration", () => {
    it("returns a declaration from the backend", async () => {
      const backend = mockManagementBackend({
        getAppleDeclaration: () => Effect.succeed({ Payload: { test: true } }),
      });

      const result = await runWithService(
        backend,
        Effect.gen(function* () {
          const service = yield* AppleMdmService;
          return yield* service.handleDeclaration(
            { _tag: "device", udid: "udid-123", mdmOrigin: TEST_MDM_ORIGIN },
            "configurations",
            "decl-1",
          );
        }),
      );
      expect(result).toEqual({ Payload: { test: true } });
    });

    it("fails when declaration is not found", async () => {
      const backend = mockManagementBackend({
        getAppleDeclaration: () => Effect.succeed(null),
      });

      const result = await runWithService(
        backend,
        Effect.gen(function* () {
          const service = yield* AppleMdmService;
          return yield* service.handleDeclaration(
            { _tag: "device", udid: "udid-123", mdmOrigin: TEST_MDM_ORIGIN },
            "configurations",
            "missing",
          );
        }),
      )
        .then(() => "Success")
        .catch(() => "Failure");
      expect(result).toBe("Failure");
    });
  });

  describe("handleStatusReport", () => {
    it("sends a DeclarationStatus event", async () => {
      let receivedEvent: unknown;
      const backend = mockManagementBackend({
        appleDeviceEvent: (_scope: unknown, event: unknown) =>
          Effect.sync(() => {
            receivedEvent = event;
          }),
      });

      await runWithService(
        backend,
        Effect.gen(function* () {
          const service = yield* AppleMdmService;
          return yield* service.handleStatusReport(
            { _tag: "device", udid: "udid-123", mdmOrigin: TEST_MDM_ORIGIN },
            {
              StatusItems: { test: true },
              Errors: [
                {
                  StatusItem: "management.declarations",
                  Reasons: [{ Code: "Error", Description: "Test error" }],
                },
              ],
            },
          );
        }),
      );

      const ev = receivedEvent as { _tag: string; statusItems: unknown; errors: any[] };
      expect(ev._tag).toBe("DeclarationStatus");
      expect(ev.errors).toHaveLength(1);
      expect(ev.errors[0].statusItem).toBe("management.declarations");
      expect(ev.errors[0].reasons[0].description).toBe("Test error");
    });
  });

  describe("generateEnrollmentProfile", () => {
    it("returns a valid enrollment profile plist", async () => {
      const backend = mockManagementBackend();

      const profile = await runWithService(
        backend,
        Effect.gen(function* () {
          const service = yield* AppleMdmService;
          return yield* service.generateEnrollmentProfile({
            challenge: "enrollment-123.signature",
            organizationId: "tenant-123",
            organizationName: "Acme",
          });
        }),
      );
      const parsed = (await Effect.runPromise(parsePlist(profile))) as any;

      expect(parsed.PayloadType).toBe("Configuration");
      expect(parsed.PayloadIdentifier).toBe("com.mattrax.enrollment");
      expect(parsed.PayloadContent).toHaveLength(2);

      const scepPayload = parsed.PayloadContent.find(
        (p: any) => p.PayloadType === "com.apple.security.scep",
      );
      expect(scepPayload).toBeDefined();
      expect(scepPayload.PayloadContent.URL).toBe(`${TEST_CONFIG.origin}/mdm/apple/scep`);
      expect(scepPayload.PayloadContent.Challenge).toBe("enrollment-123.signature");
      expect(scepPayload.PayloadContent.Subject).toEqual([
        [["O", "Acme"]],
        [["OU", "tenant-123"]],
        [["CN", "Acme Identity"]],
      ]);

      const mdmPayload = parsed.PayloadContent.find((p: any) => p.PayloadType === "com.apple.mdm");
      expect(mdmPayload).toBeDefined();
      expect(mdmPayload.ServerURL).toBe(`${TEST_CONFIG.origin}/mdm/apple/mdm`);
      expect(mdmPayload.Topic).toBe(TEST_CONFIG.topic);
      expect(mdmPayload.AccessRights).toBe(8191);
      expect(mdmPayload.ServerCapabilities).toContain("com.apple.mdm.bootstraptoken");
      expect(mdmPayload.ServerCapabilities).toContain("com.apple.mdm.token");
    });
  });
});
