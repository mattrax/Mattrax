import { describe, it, expect } from "vitest";
import { Effect, Layer, Predicate, Schema } from "effect";
import { AppleMdmService, AppleMdmServiceLive, AppleMdmTopic } from "../service.js";
import { AppleMdmConfig } from "../config.js";
import type { AppleDeviceEvent } from "@mattrax/management-backend";
import {
  CheckinScope,
  ManagementBackend,
  ManagementManifest,
  ManagementNotSupported,
  UnknownDevice,
  MdmOrigin,
} from "@mattrax/management-backend";
import { mockManagementBackend } from "./helpers.js";
import { parsePlist, PlistValue } from "@mattrax/plist";
import { DeviceUnenrolled } from "../schema.js";

const TEST_CONFIG = { origin: "https://test.mattrax.app", topic: "com.apple.mgmt.External.test" };

const TEST_MDM_ORIGIN = new MdmOrigin({ url: TEST_CONFIG.origin });

const DeviceCheckinScope = CheckinScope.members[0];

const PlistDictionary = Schema.Record(Schema.String, PlistValue);

function expectScope(scope: CheckinScope | undefined): CheckinScope {
  if (!scope) throw new Error("expected a check-in scope");

  return scope;
}

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
      let receivedEvent: AppleDeviceEvent | undefined;

      const backend = mockManagementBackend({
        appleDeviceEvent: (_scope: CheckinScope, event: AppleDeviceEvent) =>
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
      const ev = receivedEvent;

      if (!ev || !Predicate.isTagged(ev, "Authenticate"))
        throw new Error("expected a Authenticate event");

      expect(ev.serialNumber).toBe("SN123");
      expect(ev.model).toBe("MacBookPro18,1");
    });

    it("passes the identity certificate serial to the backend scope", async () => {
      let receivedScope: CheckinScope | undefined;

      const backend = mockManagementBackend({
        appleDeviceEvent: (scope: CheckinScope) =>
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

      const scope = expectScope(receivedScope);

      expect(Predicate.isTagged(scope, "device")).toBe(true);
      expect(scope).toMatchObject({
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
      let receivedEvent: AppleDeviceEvent | undefined;

      const backend = mockManagementBackend({
        appleDeviceEvent: (_scope: CheckinScope, event: AppleDeviceEvent) =>
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

      const ev = receivedEvent;

      if (!ev || !Predicate.isTagged(ev, "Authenticate"))
        throw new Error("expected a Authenticate event");
      expect(ev.model).toBe("MacBookPro17,1");
    });
  });

  describe("handleTokenUpdate", () => {
    it("sends a device-scoped TokenUpdate", async () => {
      let receivedEvent: AppleDeviceEvent | undefined;

      const backend = mockManagementBackend({
        appleDeviceEvent: (_scope: CheckinScope, event: AppleDeviceEvent) =>
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

      const ev = receivedEvent;

      if (!ev || !Predicate.isTagged(ev, "TokenUpdate"))
        throw new Error("expected a TokenUpdate event");

      expect(ev.pushToken).toBe("746573742d746f6b656e"); // hex of base64 "dGVzdC10b2tlbg=="
      expect(ev.channel).toBe("device");
    });

    it("sends a user-scoped TokenUpdate when UserID is present", async () => {
      let receivedEvent: AppleDeviceEvent | undefined;

      const backend = mockManagementBackend({
        appleDeviceEvent: (_scope: CheckinScope, event: AppleDeviceEvent) =>
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

      const ev = receivedEvent;

      if (!ev || !Predicate.isTagged(ev, "TokenUpdate"))
        throw new Error("expected a TokenUpdate event");
      expect(ev.channel).toBe("user");
    });

    it("attributes a user-enrollment user channel to EnrollmentUserID", async () => {
      let receivedScope: CheckinScope | undefined;
      let receivedEvent: AppleDeviceEvent | undefined;

      const backend = mockManagementBackend({
        appleDeviceEvent: (scope: CheckinScope, event: AppleDeviceEvent) =>
          Effect.sync(() => {
            receivedScope = scope;
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
            EnrollmentID: "enrollment-abc",
            EnrollmentUserID: "enrollment-user-1",
            PushMagic: "magic-123",
            Token: "dGVzdA==",
            UserShortName: "oscar",
          });
        }),
      );

      const scope = expectScope(receivedScope);

      expect(scope._tag).toBe("user");
      expect(scope).toMatchObject({
        udid: "enrollment-abc",
        enrollmentId: "enrollment-abc",
        userId: "enrollment-user-1",
        source: "user-enrollment",
        userShortName: "oscar",
      });

      if (!receivedEvent || !Predicate.isTagged(receivedEvent, "TokenUpdate"))
        throw new Error("expected a TokenUpdate event");
      expect(receivedEvent.channel).toBe("user");
      expect(receivedEvent.userId).toBe("enrollment-user-1");
    });

    it("rejects a user-channel TokenUpdate the backend does not know", async () => {
      const backend = mockManagementBackend({
        appleDeviceEvent: () => Effect.fail(new UnknownDevice()),
      });

      const exit = await runWithService(
        backend,
        Effect.gen(function* () {
          const service = yield* AppleMdmService;

          return yield* service.handleTokenUpdate({
            MessageType: "TokenUpdate",
            Topic: TEST_CONFIG.topic,
            UDID: "udid-123",
            UserID: "user-456",
            PushMagic: "magic-123",
            Token: "dGVzdA==",
          });
        }),
      ).then(
        () => "resolved",
        (error: unknown) => error,
      );

      // The user channel must fail (400), unlike a device token for an unknown
      // UDID, which the service deliberately ignores.
      expect(exit).not.toBe("resolved");
    });

    it("ignores a device-channel TokenUpdate for an unknown device", async () => {
      const backend = mockManagementBackend({
        appleDeviceEvent: () => Effect.fail(new UnknownDevice()),
      });

      await expect(
        runWithService(
          backend,
          Effect.gen(function* () {
            const service = yield* AppleMdmService;

            return yield* service.handleTokenUpdate({
              MessageType: "TokenUpdate",
              Topic: TEST_CONFIG.topic,
              UDID: "udid-unknown",
              PushMagic: "magic-123",
              Token: "dGVzdA==",
            });
          }),
        ),
      ).resolves.toBeUndefined();
    });
  });

  describe("handleUserAuthenticate", () => {
    it("opens a user channel with an empty DigestChallenge", async () => {
      let receivedScope: CheckinScope | undefined;

      const backend = mockManagementBackend({
        appleDeviceEvent: (scope: CheckinScope) =>
          Effect.sync(() => {
            receivedScope = scope;
          }),
      });

      const result = await runWithService(
        backend,
        Effect.gen(function* () {
          const service = yield* AppleMdmService;

          return yield* service.handleUserAuthenticate({
            MessageType: "UserAuthenticate",
            UDID: "udid-123",
            UserID: "user-456",
            UserShortName: "oscar",
          });
        }),
      );

      expect(result).toEqual({ digestChallenge: "" });
      expect(receivedScope).toMatchObject({
        udid: "udid-123",
        userId: "user-456",
        userShortName: "oscar",
        source: "user-channel",
      });
      expect(receivedScope?._tag).toBe("user");
    });

    it("returns 410 (null) when the device cannot bind the user", async () => {
      const backend = mockManagementBackend({
        appleDeviceEvent: () => Effect.fail(new UnknownDevice()),
      });

      const result = await runWithService(
        backend,
        Effect.gen(function* () {
          const service = yield* AppleMdmService;

          return yield* service.handleUserAuthenticate({
            MessageType: "UserAuthenticate",
            UDID: "udid-unknown",
            UserID: "user-456",
          });
        }),
      );

      expect(result).toBeNull();
    });

    it("rejects an unsolicited digest with an empty AuthToken", async () => {
      let events = 0;

      const backend = mockManagementBackend({
        appleDeviceEvent: () =>
          Effect.sync(() => {
            events++;
          }),
      });

      const result = await runWithService(
        backend,
        Effect.gen(function* () {
          const service = yield* AppleMdmService;

          return yield* service.handleUserAuthenticate({
            MessageType: "UserAuthenticate",
            UDID: "udid-123",
            UserID: "user-456",
            DigestResponse: "digest",
          });
        }),
      );

      // Apple requires an empty AuthToken rather than a 410 for a rejected
      // digest, and the server never asked for one.
      expect(result).toEqual({ authToken: "" });
      expect(events).toBe(0);
    });
  });

  describe("handleCheckOut", () => {
    it("sends a CheckOut event", async () => {
      let receivedEvent: AppleDeviceEvent | undefined;

      const backend = mockManagementBackend({
        appleDeviceEvent: (_scope: CheckinScope, event: AppleDeviceEvent) =>
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

      if (!receivedEvent || !Predicate.isTagged(receivedEvent, "CheckOut"))
        throw new Error("expected a CheckOut event");
    });
  });

  describe("handleCommandResult", () => {
    it("attributes a user-channel result to the user scope", async () => {
      let receivedScope: CheckinScope | undefined;

      const backend = mockManagementBackend({
        appleDeviceEvent: (scope: CheckinScope) =>
          Effect.sync(() => {
            receivedScope = scope;
          }),
      });

      await runWithService(
        backend,
        Effect.gen(function* () {
          const service = yield* AppleMdmService;

          return yield* service.handleCommandResult({
            UDID: "udid-123",
            UserID: "user-456",
            Status: "Acknowledged",
            CommandUUID: "cmd-user-1",
            QueryResponses: { ProfileList: [] },
          });
        }),
      );

      expect(receivedScope).toMatchObject({
        udid: "udid-123",
        userId: "user-456",
        source: "user-channel",
      });
      expect(receivedScope?._tag).toBe("user");
    });

    it("sends a CommandResult with status", async () => {
      let receivedEvent: AppleDeviceEvent | undefined;

      const backend = mockManagementBackend({
        appleDeviceEvent: (_scope: CheckinScope, event: AppleDeviceEvent) =>
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

      const ev = receivedEvent;

      if (!ev || !Predicate.isTagged(ev, "CommandResult"))
        throw new Error("expected a CommandResult event");

      expect(ev.status).toBe("Acknowledged");
    });

    it("includes errorDetail from ErrorChain", async () => {
      let receivedEvent: AppleDeviceEvent | undefined;

      const backend = mockManagementBackend({
        appleDeviceEvent: (_scope: CheckinScope, event: AppleDeviceEvent) =>
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

      const ev = receivedEvent;

      if (!ev || !Predicate.isTagged(ev, "CommandResult"))
        throw new Error("expected a CommandResult event");
      expect(ev.errorDetail).toContain("MDMClientError:89");
      expect(ev.errorDetail).toContain("MDMErrorDomain:12075");
    });

    it("includes queryResponses when present", async () => {
      let receivedEvent: AppleDeviceEvent | undefined;

      const backend = mockManagementBackend({
        appleDeviceEvent: (_scope: CheckinScope, event: AppleDeviceEvent) =>
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

      const ev = receivedEvent;

      if (!ev || !Predicate.isTagged(ev, "CommandResult"))
        throw new Error("expected a CommandResult event");
      expect(ev.queryResponses).toEqual({ DeviceName: "TestMac" });
    });
  });

  describe("handleCheckin", () => {
    it("returns a command when backend returns Command", async () => {
      const backend = mockManagementBackend({
        appleManagementCheckin: () =>
          Effect.succeed(
            ManagementManifest.members[1].make({
              commandUUID: "cmd-001",
              requestType: "DeviceInformation",
              payload: { Queries: ["DeviceName"] },
            }),
          ),
      });

      const result = await runWithService(
        backend,
        Effect.gen(function* () {
          const service = yield* AppleMdmService;

          return yield* service.handleCheckin(
            DeviceCheckinScope.make({ udid: "udid-123", mdmOrigin: TEST_MDM_ORIGIN }),
          );
        }),
      );

      expect(result).not.toBeNull();
      expect(result!.commandUUID).toBe("cmd-001");
      expect(result!.requestType).toBe("DeviceInformation");
    });

    it("returns null when backend returns Idle", async () => {
      const backend = mockManagementBackend({
        appleManagementCheckin: () => Effect.succeed(ManagementManifest.members[0].make({})),
      });

      const result = await runWithService(
        backend,
        Effect.gen(function* () {
          const service = yield* AppleMdmService;

          return yield* service.handleCheckin(
            DeviceCheckinScope.make({ udid: "udid-123", mdmOrigin: TEST_MDM_ORIGIN }),
          );
        }),
      );

      expect(result).toBeNull();
    });

    it("returns a DeclarativeManagement command for DdmSync", async () => {
      const backend = mockManagementBackend({
        appleManagementCheckin: () =>
          Effect.succeed(
            ManagementManifest.members[2].make({
              serverToken: "token-abc",
            }),
          ),
      });

      const result = await runWithService(
        backend,
        Effect.gen(function* () {
          const service = yield* AppleMdmService;

          return yield* service.handleCheckin(
            DeviceCheckinScope.make({ udid: "udid-123", mdmOrigin: TEST_MDM_ORIGIN }),
          );
        }),
      );

      expect(result).not.toBeNull();
      expect(result!.requestType).toBe("DeclarativeManagement");
      expect(result!.commandUUID).toBeDefined();
    });

    it("tells an unknown device to unenroll (410 Gone)", async () => {
      const backend = mockManagementBackend({
        appleManagementCheckin: () => Effect.fail(new UnknownDevice()),
      });

      const result = await runWithService(
        backend,
        Effect.gen(function* () {
          const service = yield* AppleMdmService;

          return yield* Effect.flip(
            service.handleCheckin(
              DeviceCheckinScope.make({ udid: "unknown", mdmOrigin: TEST_MDM_ORIGIN }),
            ),
          );
        }),
      );

      expect(result).toBeInstanceOf(DeviceUnenrolled);
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

          return yield* service.handleDeclarativeTokens(
            DeviceCheckinScope.make({ udid: "udid-123", mdmOrigin: TEST_MDM_ORIGIN }),
          );
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

          return yield* service.handleDeclarativeTokens(
            DeviceCheckinScope.make({ udid: "unknown", mdmOrigin: TEST_MDM_ORIGIN }),
          );
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

          return yield* service.handleDeclarationItems(
            DeviceCheckinScope.make({ udid: "udid-123", mdmOrigin: TEST_MDM_ORIGIN }),
          );
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
            DeviceCheckinScope.make({ udid: "udid-123", mdmOrigin: TEST_MDM_ORIGIN }),
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
            DeviceCheckinScope.make({ udid: "udid-123", mdmOrigin: TEST_MDM_ORIGIN }),
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
      let receivedEvent: AppleDeviceEvent | undefined;

      const backend = mockManagementBackend({
        appleDeviceEvent: (_scope: CheckinScope, event: AppleDeviceEvent) =>
          Effect.sync(() => {
            receivedEvent = event;
          }),
      });

      await runWithService(
        backend,
        Effect.gen(function* () {
          const service = yield* AppleMdmService;

          return yield* service.handleStatusReport(
            DeviceCheckinScope.make({ udid: "udid-123", mdmOrigin: TEST_MDM_ORIGIN }),
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

      const ev = receivedEvent;

      if (!ev || !Predicate.isTagged(ev, "DeclarationStatus"))
        throw new Error("expected a DeclarationStatus event");

      expect(ev.errors).toHaveLength(1);
      expect(ev.errors?.[0]?.statusItem).toBe("management.declarations");
      expect(ev.errors?.[0]?.reasons?.[0]?.description).toBe("Test error");
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

      const parsed = await Effect.runPromise(parsePlist(profile));

      if (!Schema.is(PlistDictionary)(parsed))
        throw new Error("profile must be a plist dictionary");

      expect(parsed["PayloadType"]).toBe("Configuration");
      expect(parsed["PayloadIdentifier"]).toBe("com.mattrax.enrollment");

      const content = parsed["PayloadContent"];

      if (!Array.isArray(content)) throw new Error("profile must have a PayloadContent array");

      const scepPayload = content.find(
        (payload) =>
          Schema.is(PlistDictionary)(payload) &&
          payload["PayloadType"] === "com.apple.security.scep",
      );

      if (!scepPayload || !Schema.is(PlistDictionary)(scepPayload))
        throw new Error("profile must have an SCEP payload");

      const scepContent = scepPayload["PayloadContent"];

      if (!Schema.is(PlistDictionary)(scepContent))
        throw new Error("SCEP payload must have content");

      expect(scepContent["URL"]).toBe(`${TEST_CONFIG.origin}/mdm/apple/scep/tenant-123`);
      expect(scepContent["Challenge"]).toBe("enrollment-123.signature");
      expect(scepContent["Subject"]).toEqual([
        [["O", "Acme"]],
        [["OU", "tenant-123"]],
        [["CN", "Acme Identity"]],
      ]);

      const mdmPayload = content.find(
        (payload) =>
          Schema.is(PlistDictionary)(payload) && payload["PayloadType"] === "com.apple.mdm",
      );

      if (!mdmPayload || !Schema.is(PlistDictionary)(mdmPayload))
        throw new Error("profile must have an MDM payload");

      expect(mdmPayload["ServerURL"]).toBe(`${TEST_CONFIG.origin}/mdm/apple/mdm`);
      expect(mdmPayload["Topic"]).toBe(TEST_CONFIG.topic);
      expect(mdmPayload["AccessRights"]).toBe(8191);
      expect(mdmPayload["ServerCapabilities"]).toContain("com.apple.mdm.bootstraptoken");
      // GetToken is not implemented, so the capability must not be advertised.
      expect(mdmPayload["ServerCapabilities"]).not.toContain("com.apple.mdm.token");
    });
  });

  describe("verifyDeviceSignature", () => {
    const trustedService = (requireSignature: boolean) =>
      Effect.gen(function* () {
        const backend = yield* ManagementBackend;
        const config = yield* AppleMdmConfig;

        return AppleMdmService.make({
          backend,
          config,
          topic: TEST_CONFIG.topic,
          trust: { requireSignature, caCertPems: () => Effect.succeed([]) },
        });
      }).pipe(
        Effect.provide(
          Layer.mergeAll(
            mockManagementBackend(),
            AppleMdmConfig.layer({ origin: TEST_CONFIG.origin }),
          ),
        ),
      );

    it("fails closed when a signature is required but missing", async () => {
      const service = await Effect.runPromise(trustedService(true));

      const error = await Effect.runPromise(
        service.verifyDeviceSignature({ body: new ArrayBuffer(0) }).pipe(Effect.flip),
      );

      expect(error).toMatchObject({ message: "Missing Mdm-Signature" });
    });

    it("fails closed when a signature is required but no CA is configured", async () => {
      const service = await Effect.runPromise(trustedService(true));

      const error = await Effect.runPromise(
        service
          .verifyDeviceSignature({ signature: "AAAA", body: new ArrayBuffer(0) })
          .pipe(Effect.flip),
      );

      expect(error).toMatchObject({
        message: "No SCEP CA configured to verify Mdm-Signature",
      });
    });

    it("leaves signature checks optional for hosts that do not opt in", async () => {
      const service = await Effect.runPromise(trustedService(false));

      await expect(
        Effect.runPromise(
          service.verifyDeviceSignature({ signature: "AAAA", body: new ArrayBuffer(0) }),
        ),
      ).resolves.toBeNull();
    });
  });
});
