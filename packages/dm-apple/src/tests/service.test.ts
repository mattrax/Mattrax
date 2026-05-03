import { describe, it, expect } from "vitest";
import { Effect, Layer } from "effect";
import { AppleMdmService, AppleMdmServiceLive } from "../service.js";
import { ManagementBackend, ManagementNotSupported, UnknownDevice } from "@mattrax/management-backend";
import { mockManagementBackend } from "./helpers.js";

const TEST_CONFIG = { origin: "https://test.mattrax.app", topic: "com.apple.mgmt.External.test" };

function runWithService<A, E>(
  backendLayer: Layer.Layer<ManagementBackend>,
  effect: Effect.Effect<A, E, AppleMdmService>,
) {
  const layer = AppleMdmServiceLive(TEST_CONFIG).pipe(Layer.provide(backendLayer));
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

      await runWithService(backend, Effect.gen(function* () {
        const service = yield* AppleMdmService;
        return yield* service.handleAuthenticate({
          MessageType: "Authenticate",
          Topic: TEST_CONFIG.topic,
          UDID: "udid-123",
          SerialNumber: "SN123",
          OSVersion: "14.0",
          Model: "MacBookPro18,1",
        });
      }));

      expect(receivedEvent).toBeDefined();
      const ev = receivedEvent as { _tag: string; serialNumber: string; model: string };
      expect(ev._tag).toBe("Authenticate");
      expect(ev.serialNumber).toBe("SN123");
      expect(ev.model).toBe("MacBookPro18,1");
    });

    it("silently handles UnknownDevice", async () => {
      const backend = mockManagementBackend({
        appleDeviceEvent: () => Effect.fail(new UnknownDevice()),
      });

      await runWithService(backend, Effect.gen(function* () {
        const service = yield* AppleMdmService;
        return yield* service.handleAuthenticate({
          MessageType: "Authenticate",
          Topic: TEST_CONFIG.topic,
          UDID: "unknown-udid",
        });
      }));
      // Should not throw
    });

    it("silently handles ManagementNotSupported", async () => {
      const backend = mockManagementBackend({
        appleDeviceEvent: () => Effect.fail(new ManagementNotSupported()),
      });

      await runWithService(backend, Effect.gen(function* () {
        const service = yield* AppleMdmService;
        return yield* service.handleAuthenticate({
          MessageType: "Authenticate",
          Topic: TEST_CONFIG.topic,
          UDID: "unsupported-udid",
        });
      }));
    });

    it("uses ModelName as fallback for Model", async () => {
      let receivedEvent: unknown;
      const backend = mockManagementBackend({
        appleDeviceEvent: (_scope: unknown, event: unknown) =>
          Effect.sync(() => {
            receivedEvent = event;
          }),
      });

      await runWithService(backend, Effect.gen(function* () {
        const service = yield* AppleMdmService;
        return yield* service.handleAuthenticate({
          MessageType: "Authenticate",
          Topic: TEST_CONFIG.topic,
          UDID: "udid-123",
          ModelName: "MacBookPro17,1",
        });
      }));

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

      await runWithService(backend, Effect.gen(function* () {
        const service = yield* AppleMdmService;
        return yield* service.handleTokenUpdate({
          MessageType: "TokenUpdate",
          Topic: TEST_CONFIG.topic,
          UDID: "udid-123",
          PushMagic: "magic-123",
          Token: "dGVzdC10b2tlbg==",
        });
      }));

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

      await runWithService(backend, Effect.gen(function* () {
        const service = yield* AppleMdmService;
        return yield* service.handleTokenUpdate({
          MessageType: "TokenUpdate",
          Topic: TEST_CONFIG.topic,
          UDID: "udid-123",
          PushMagic: "magic-123",
          Token: "dGVzdA==",
          UserID: "user-456",
        });
      }));

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

      await runWithService(backend, Effect.gen(function* () {
        const service = yield* AppleMdmService;
        return yield* service.handleCheckOut({
          MessageType: "CheckOut",
          Topic: TEST_CONFIG.topic,
          UDID: "udid-123",
        });
      }));

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

      await runWithService(backend, Effect.gen(function* () {
        const service = yield* AppleMdmService;
        return yield* service.handleCommandResult({
          UDID: "udid-123",
          Status: "Acknowledged",
          CommandUUID: "cmd-001",
        });
      }));

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

      await runWithService(backend, Effect.gen(function* () {
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
      }));

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

      await runWithService(backend, Effect.gen(function* () {
        const service = yield* AppleMdmService;
        return yield* service.handleCommandResult({
          UDID: "udid-123",
          Status: "Acknowledged",
          CommandUUID: "cmd-003",
          QueryResponses: { DeviceName: "TestMac" },
        });
      }));

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

      const result = await runWithService(backend, Effect.gen(function* () {
        const service = yield* AppleMdmService;
        return yield* service.handleCheckin({ _tag: "device", udid: "udid-123" });
      }));
      expect(result).not.toBeNull();
      expect(result!.commandUUID).toBe("cmd-001");
      expect(result!.requestType).toBe("DeviceInformation");
    });

    it("returns null when backend returns Idle", async () => {
      const backend = mockManagementBackend({
        appleManagementCheckin: () => Effect.succeed({ _tag: "Idle" } as const),
      });

      const result = await runWithService(backend, Effect.gen(function* () {
        const service = yield* AppleMdmService;
        return yield* service.handleCheckin({ _tag: "device", udid: "udid-123" });
      }));
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

      const result = await runWithService(backend, Effect.gen(function* () {
        const service = yield* AppleMdmService;
        return yield* service.handleCheckin({ _tag: "device", udid: "udid-123" });
      }));
      expect(result).not.toBeNull();
      expect(result!.requestType).toBe("DeclarativeManagement");
      expect(result!.commandUUID).toBeDefined();
    });

    it("handles UnknownDevice by returning Idle", async () => {
      const backend = mockManagementBackend({
        appleManagementCheckin: () => Effect.fail(new UnknownDevice()),
      });

      const result = await runWithService(backend, Effect.gen(function* () {
        const service = yield* AppleMdmService;
        return yield* service.handleCheckin({ _tag: "device", udid: "unknown" });
      }));
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
          }),
      });

      const result = await runWithService(backend, Effect.gen(function* () {
        const service = yield* AppleMdmService;
        return yield* service.handleDeclarativeTokens({ _tag: "device", udid: "udid-123" });
      }));
      expect(result.SyncTokens.Tokens).toHaveLength(4);
      const cfg = result.SyncTokens.Tokens.find((t) => t.Type === "configurations");
      expect(cfg?.Token).toBe("cfg-1");
    });

    it("fails for unknown devices", async () => {
      const backend = mockManagementBackend({
        getAppleDeclarationTokens: () => Effect.fail(new UnknownDevice()),
      });

      const result = await runWithService(backend, Effect.gen(function* () {
        const service = yield* AppleMdmService;
        return yield* service.handleDeclarativeTokens({ _tag: "device", udid: "unknown" });
      })).then(() => "Success").catch(() => "Failure");
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

      const result = await runWithService(backend, Effect.gen(function* () {
        const service = yield* AppleMdmService;
        return yield* service.handleDeclarationItems({ _tag: "device", udid: "udid-123" });
      }));
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

      const result = await runWithService(backend, Effect.gen(function* () {
        const service = yield* AppleMdmService;
        return yield* service.handleDeclaration(
          { _tag: "device", udid: "udid-123" },
          "configurations",
          "decl-1",
        );
      }));
      expect(result).toEqual({ Payload: { test: true } });
    });

    it("fails when declaration is not found", async () => {
      const backend = mockManagementBackend({
        getAppleDeclaration: () => Effect.succeed(null),
      });

      const result = await runWithService(backend, Effect.gen(function* () {
        const service = yield* AppleMdmService;
        return yield* service.handleDeclaration(
          { _tag: "device", udid: "udid-123" },
          "configurations",
          "missing",
        );
      })).then(() => "Success").catch(() => "Failure");
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

      await runWithService(backend, Effect.gen(function* () {
        const service = yield* AppleMdmService;
        return yield* service.handleStatusReport(
          { _tag: "device", udid: "udid-123" },
          {
            StatusItems: { test: true },
            Errors: [
              {
                Identifier: "decl-1",
                ServerToken: "tok-1",
                Active: true,
                Valid: "invalid",
                Reasons: [{ Description: "Test error" }],
              },
            ],
          },
        );
      }));

      const ev = receivedEvent as { _tag: string; statusItems: unknown; errors: any[] };
      expect(ev._tag).toBe("DeclarationStatus");
      expect(ev.errors).toHaveLength(1);
      expect(ev.errors[0].identifier).toBe("decl-1");
      expect(ev.errors[0].reasons[0].description).toBe("Test error");
    });
  });

  describe("generateEnrollmentProfile", () => {
    it("returns a valid enrollment profile JSON", async () => {
      const backend = mockManagementBackend();

      const profile = await runWithService(backend, Effect.gen(function* () {
        const service = yield* AppleMdmService;
        return yield* service.generateEnrollmentProfile();
      }));
      const parsed = JSON.parse(profile);

      expect(parsed.PayloadType).toBe("Configuration");
      expect(parsed.PayloadIdentifier).toBe("com.mattrax.enrollment");
      expect(parsed.PayloadContent).toHaveLength(2);

      const scepPayload = parsed.PayloadContent.find(
        (p: any) => p.PayloadType === "com.apple.security.scep",
      );
      expect(scepPayload).toBeDefined();
      expect(scepPayload.PayloadContent.URL).toBe(`${TEST_CONFIG.origin}/mdm/apple/scep`);
      expect(scepPayload.PayloadContent.Challenge).toBe("mattrax-scep-challenge");

      const mdmPayload = parsed.PayloadContent.find(
        (p: any) => p.PayloadType === "com.apple.mdm",
      );
      expect(mdmPayload).toBeDefined();
      expect(mdmPayload.ServerURL).toBe(`${TEST_CONFIG.origin}/mdm/apple/mdm`);
      expect(mdmPayload.Topic).toBe(TEST_CONFIG.topic);
      expect(mdmPayload.AccessRights).toBe(8191);
      expect(mdmPayload.ServerCapabilities).toContain("com.apple.mdm.bootstraptoken");
    });
  });
});
