import { describe, it, expect } from "vitest";
import { Effect, Layer, Predicate } from "effect";
import { HttpRouter } from "effect/http";
import { AppleMdmService, AppleMdmServiceLive, AppleMdmTopic } from "../service.js";
import { AppleMdmConfig } from "../config.js";
import {
  AppleDeviceEvent,
  CheckinScope,
  ManagementBackend,
  ManagementManifest,
  UnknownDevice,
} from "@mattrax/management-backend";
import { appleMdmRoutes } from "../handlers.js";
import { buildAuthenticatePlist, mockManagementBackend } from "./helpers.js";

const TEST_CONFIG = { origin: "https://test.mattrax.app", topic: "com.apple.mgmt.External.test" };

function expectScope(scope: CheckinScope | undefined): CheckinScope {
  if (!scope) throw new Error("expected a check-in scope");

  return scope;
}

async function makeMdmHandler(backendLayer: Layer.Layer<ManagementBackend>) {
  const serviceLayer = AppleMdmServiceLive.pipe(
    Layer.provideMerge(backendLayer),
    Layer.provideMerge(AppleMdmConfig.layer({ origin: TEST_CONFIG.origin })),
    Layer.provideMerge(
      Layer.succeed(AppleMdmTopic, AppleMdmTopic.of({ get: Effect.succeed(TEST_CONFIG.topic) })),
    ),
  );

  const appLayer = appleMdmRoutes.pipe(Layer.provideMerge(serviceLayer));
  const { handler } = HttpRouter.toWebHandler(appLayer);

  return handler;
}

describe("Apple MDM handlers", () => {
  describe("enroll endpoint", () => {
    it("returns an enrollment profile plist", async () => {
      const backend = mockManagementBackend();

      const profile = await Effect.runPromise(
        Effect.gen(function* () {
          const service = yield* AppleMdmService;

          return yield* service.generateEnrollmentProfile();
        }).pipe(
          Effect.provide(
            AppleMdmServiceLive.pipe(
              Layer.provideMerge(backend),
              Layer.provideMerge(AppleMdmConfig.layer({ origin: TEST_CONFIG.origin })),
              Layer.provideMerge(
                Layer.succeed(
                  AppleMdmTopic,
                  AppleMdmTopic.of({ get: Effect.succeed(TEST_CONFIG.topic) }),
                ),
              ),
            ),
          ),
        ),
      );

      expect(profile).toContain("com.mattrax.enrollment");
    });
  });

  describe("PUT /mdm/apple/mdm - Authenticate", () => {
    it("returns 200 for a valid Authenticate message", async () => {
      const backend = mockManagementBackend();
      const handler = await makeMdmHandler(backend);

      const plist = `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>MessageType</key><string>Authenticate</string>
  <key>Topic</key><string>${TEST_CONFIG.topic}</string>
  <key>UDID</key><string>udid-auth-001</string>
  <key>SerialNumber</key><string>SN001</string>
</dict>
</plist>`;

      const response = await handler(
        new Request("http://localhost/mdm/apple/mdm", {
          method: "PUT",
          body: plist,
          headers: { "Content-Type": "application/x-apple-aspen-mdm-checkin" },
        }),
      );

      expect(response.status).toBe(200);
    });

    it("returns the signed ADE enrollment profile from Authenticate", async () => {
      const profile = new TextEncoder().encode(
        `<?xml version="1.0" encoding="UTF-8"?><plist version="1.0"><dict><key>PayloadIdentifier</key><string>com.mattrax.ade.profile-1</string></dict></plist>`,
      );

      const encoded = btoa(String.fromCharCode(...profile));

      const backend = mockManagementBackend({
        appleDeviceEvent: (_scope: CheckinScope, event: AppleDeviceEvent) =>
          Effect.succeed(
            Predicate.isTagged("Authenticate")(event) ? { enrollmentProfile: encoded } : undefined,
          ),
      });

      const handler = await makeMdmHandler(backend);

      const response = await handler(
        new Request("http://localhost/mdm/apple/mdm", {
          method: "PUT",
          body: buildAuthenticatePlist({ UDID: "udid-ade-001", SerialNumber: "SN-ADE-001" }),
          headers: { "Content-Type": "application/x-apple-aspen-mdm-checkin" },
        }),
      );

      expect(response.status).toBe(200);
      expect(response.headers.get("content-type")).toContain("application/xml");

      const body = await response.text();
      const match = /<key>EnrollmentProfile<\/key><data>([^<]+)<\/data>/.exec(body);

      expect(match).not.toBeNull();

      const decoded = Uint8Array.from(atob(match![1]!), (char) => char.charCodeAt(0));
      expect(new TextDecoder().decode(decoded)).toContain("com.mattrax.ade.profile-1");
    });

    it("forwards the mTLS identity certificate serial in the check-in scope", async () => {
      let receivedScope: CheckinScope | undefined;

      const backend = mockManagementBackend({
        appleDeviceEvent: (scope: CheckinScope) =>
          Effect.sync(() => {
            receivedScope = scope;
          }),
      });

      const handler = await makeMdmHandler(backend);

      const plist = `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>MessageType</key><string>Authenticate</string>
  <key>Topic</key><string>${TEST_CONFIG.topic}</string>
  <key>UDID</key><string>udid-auth-002</string>
  <key>SerialNumber</key><string>SN002</string>
</dict>
</plist>`;

      const response = await handler(
        new Request("http://localhost/mdm/apple/mdm", {
          method: "PUT",
          body: plist,
          headers: {
            "Content-Type": "application/x-apple-aspen-mdm-checkin",
            "x-device-identity-certificate-serial": "A1:B2:C3",
          },
        }),
      );

      expect(response.status).toBe(200);
      const scope = expectScope(receivedScope);

      expect(Predicate.isTagged(scope, "device")).toBe(true);
      expect(scope).toMatchObject({
        udid: "udid-auth-002",
        identityCertificateSerial: "A1:B2:C3",
      });
    });
  });

  describe("PUT /mdm/apple/mdm - TokenUpdate", () => {
    it("returns 200 for a valid TokenUpdate message", async () => {
      const backend = mockManagementBackend();
      const handler = await makeMdmHandler(backend);

      const plist = `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>MessageType</key><string>TokenUpdate</string>
  <key>Topic</key><string>${TEST_CONFIG.topic}</string>
  <key>UDID</key><string>udid-token-001</string>
  <key>PushMagic</key><string>magic-001</string>
  <key>Token</key><data>dG9rZW4x</data>
</dict>
</plist>`;

      const response = await handler(
        new Request("http://localhost/mdm/apple/mdm", {
          method: "PUT",
          body: plist,
          headers: { "Content-Type": "application/x-apple-aspen-mdm-checkin" },
        }),
      );

      expect(response.status).toBe(200);
    });
  });

  describe("PUT /mdm/apple/mdm - UserAuthenticate", () => {
    it("returns an empty DigestChallenge for a managed user", async () => {
      let scope: CheckinScope | undefined;

      const backend = mockManagementBackend({
        appleDeviceEvent: (received: CheckinScope) =>
          Effect.sync(() => {
            scope = received;
          }),
      });

      const handler = await makeMdmHandler(backend);

      const plist = `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>MessageType</key><string>UserAuthenticate</string>
  <key>UDID</key><string>udid-user-001</string>
  <key>UserID</key><string>user-001</string>
  <key>UserShortName</key><string>oscar</string>
</dict>
</plist>`;

      const response = await handler(
        new Request("http://localhost/mdm/apple/mdm", {
          method: "PUT",
          body: plist,
          headers: { "Content-Type": "application/x-apple-aspen-mdm-checkin" },
        }),
      );

      expect(response.status).toBe(200);
      expect(await response.text()).toContain("<key>DigestChallenge</key><string></string>");
      const received = expectScope(scope);

      expect(received._tag).toBe("user");
      expect(received).toMatchObject({
        udid: "udid-user-001",
        userId: "user-001",
        source: "user-channel",
      });
    });

    it("returns 410 when the user cannot be bound to the device", async () => {
      const backend = mockManagementBackend({
        appleDeviceEvent: () => Effect.fail(new UnknownDevice()),
      });

      const handler = await makeMdmHandler(backend);

      const plist = `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>MessageType</key><string>UserAuthenticate</string>
  <key>UDID</key><string>udid-user-002</string>
  <key>UserID</key><string>user-002</string>
</dict>
</plist>`;

      const response = await handler(
        new Request("http://localhost/mdm/apple/mdm", {
          method: "PUT",
          body: plist,
          headers: { "Content-Type": "application/x-apple-aspen-mdm-checkin" },
        }),
      );

      expect(response.status).toBe(410);
    });
  });

  describe("PUT /mdm/apple/mdm - GetToken", () => {
    it("rejects a token service it does not implement", async () => {
      const backend = mockManagementBackend();
      const handler = await makeMdmHandler(backend);

      const plist = `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>MessageType</key><string>GetToken</string>
  <key>TokenServiceType</key><string>com.apple.maid</string>
  <key>UDID</key><string>udid-token-service</string>
</dict>
</plist>`;

      const response = await handler(
        new Request("http://localhost/mdm/apple/mdm", {
          method: "PUT",
          body: plist,
          headers: { "Content-Type": "application/x-apple-aspen-mdm-checkin" },
        }),
      );

      expect(response.status).toBe(400);
    });
  });

  describe("PUT /mdm/apple/mdm - user channel", () => {
    it("attributes a TokenUpdate with UserID to the user scope", async () => {
      let scope: CheckinScope | undefined;

      const backend = mockManagementBackend({
        appleDeviceEvent: (received: CheckinScope) =>
          Effect.sync(() => {
            scope = received;
          }),
      });

      const handler = await makeMdmHandler(backend);

      const plist = `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>MessageType</key><string>TokenUpdate</string>
  <key>Topic</key><string>${TEST_CONFIG.topic}</string>
  <key>UDID</key><string>udid-user-token</string>
  <key>UserID</key><string>user-token-1</string>
  <key>PushMagic</key><string>magic-user</string>
  <key>Token</key><data>dG9rZW4=</data>
</dict>
</plist>`;

      const response = await handler(
        new Request("http://localhost/mdm/apple/mdm", {
          method: "PUT",
          body: plist,
          headers: { "Content-Type": "application/x-apple-aspen-mdm-checkin" },
        }),
      );

      expect(response.status).toBe(200);
      const received = expectScope(scope);

      expect(received._tag).toBe("user");
      expect(received).toMatchObject({
        userId: "user-token-1",
        source: "user-channel",
      });
    });

    it("accepts an Apple User Enrollment token update without a UDID", async () => {
      let scope: CheckinScope | undefined;
      let event: AppleDeviceEvent | undefined;

      const backend = mockManagementBackend({
        appleDeviceEvent: (received: CheckinScope, receivedEvent: AppleDeviceEvent) =>
          Effect.sync(() => {
            scope = received;
            event = receivedEvent;
          }),
      });

      const handler = await makeMdmHandler(backend);

      const plist = `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>MessageType</key><string>TokenUpdate</string>
  <key>Topic</key><string>${TEST_CONFIG.topic}</string>
  <key>EnrollmentID</key><string>enrollment-byod-1</string>
  <key>EnrollmentUserID</key><string>byod-user-1</string>
  <key>PushMagic</key><string>magic-byod</string>
  <key>Token</key><data>dG9rZW4=</data>
</dict>
</plist>`;

      const response = await handler(
        new Request("http://localhost/mdm/apple/mdm", {
          method: "PUT",
          body: plist,
          headers: { "Content-Type": "application/x-apple-aspen-mdm-checkin" },
        }),
      );

      expect(response.status).toBe(200);
      const received = expectScope(scope);

      expect(received._tag).toBe("user");
      expect(received).toMatchObject({
        udid: "enrollment-byod-1",
        enrollmentId: "enrollment-byod-1",
        userId: "byod-user-1",
        source: "user-enrollment",
      });
      expect(event && "_tag" in event ? event._tag : null).toBe("TokenUpdate");
    });

    it("polls the user channel for the user's own commands", async () => {
      let scope: CheckinScope | undefined;

      const backend = mockManagementBackend({
        appleManagementCheckin: (received: CheckinScope) =>
          Effect.sync(() => {
            scope = received;

            return ManagementManifest.members[0].make({});
          }),
      });

      const handler = await makeMdmHandler(backend);

      const plist = `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>UDID</key><string>udid-user-poll</string>
  <key>UserID</key><string>user-poll-1</string>
  <key>Status</key><string>Idle</string>
</dict>
</plist>`;

      const response = await handler(
        new Request("http://localhost/mdm/apple/mdm", {
          method: "PUT",
          body: plist,
          headers: { "Content-Type": "application/x-apple-aspen-mdm" },
        }),
      );

      expect(response.status).toBe(200);
      const received = expectScope(scope);

      expect(received._tag).toBe("user");
      expect(received).toMatchObject({ userId: "user-poll-1" });
    });
  });

  describe("PUT /mdm/apple/mdm - CheckOut", () => {
    it("returns 200 for a valid CheckOut message", async () => {
      const backend = mockManagementBackend();
      const handler = await makeMdmHandler(backend);

      const plist = `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>MessageType</key><string>CheckOut</string>
  <key>Topic</key><string>${TEST_CONFIG.topic}</string>
  <key>UDID</key><string>udid-checkout-001</string>
</dict>
</plist>`;

      const response = await handler(
        new Request("http://localhost/mdm/apple/mdm", {
          method: "PUT",
          body: plist,
          headers: { "Content-Type": "application/x-apple-aspen-mdm-checkin" },
        }),
      );

      expect(response.status).toBe(200);
    });
  });

  describe("PUT /mdm/apple/mdm - CommandResult", () => {
    it("returns 200 for a valid CommandResult", async () => {
      const backend = mockManagementBackend();
      const handler = await makeMdmHandler(backend);

      const plist = `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>UDID</key><string>udid-result-001</string>
  <key>Status</key><string>Acknowledged</string>
  <key>CommandUUID</key><string>cmd-001</string>
</dict>
</plist>`;

      const response = await handler(
        new Request("http://localhost/mdm/apple/mdm", {
          method: "PUT",
          body: plist,
          headers: { "Content-Type": "application/x-apple-aspen-mdm" },
        }),
      );

      expect(response.status).toBe(200);
    });
  });

  describe("PUT /mdm/apple/mdm - DeclarativeManagement tokens", () => {
    it("returns a plist with sync tokens", async () => {
      const backend = mockManagementBackend({
        getAppleDeclarationTokens: () =>
          Effect.succeed({
            activationsToken: "act-tok",
            configurationsToken: "cfg-tok",
            assetsToken: "asset-tok",
            managementToken: "mgmt-tok",
            declarationsToken: "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA",
          }),
      });

      const handler = await makeMdmHandler(backend);

      const plist = `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>MessageType</key><string>DeclarativeManagement</string>
  <key>UDID</key><string>udid-ddm-001</string>
  <key>Endpoint</key><string>tokens</string>
  <key>Data</key><dict/>
</dict>
</plist>`;

      const response = await handler(
        new Request("http://localhost/mdm/apple/mdm", {
          method: "PUT",
          body: plist,
          headers: { "Content-Type": "application/x-apple-aspen-mdm-checkin" },
        }),
      );

      expect(response.status).toBe(200);

      const body = await response.json();

      expect(body).toMatchObject({
        SyncTokens: {
          DeclarationsToken: expect.stringMatching(/^[A-F0-9]{64}$/),
          Timestamp: expect.stringMatching(/^\d{4}-\d{2}-\d{2}T/),
        },
      });
    });
  });

  describe("PUT /mdm/apple/mdm - DeclarativeManagement declaration-items", () => {
    it("returns a plist with declaration items", async () => {
      const backend = mockManagementBackend({
        getAppleDeclarationItems: () =>
          Effect.succeed({
            activations: [{ identifier: "act-1", serverToken: "tok-1" }],
            configurations: [{ identifier: "cfg-1", serverToken: "tok-2" }],
            assets: [],
            management: [],
          }),
      });

      const handler = await makeMdmHandler(backend);

      const plist = `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>MessageType</key><string>DeclarativeManagement</string>
  <key>UDID</key><string>udid-ddm-002</string>
  <key>Endpoint</key><string>declaration-items</string>
  <key>Data</key><dict/>
</dict>
</plist>`;

      const response = await handler(
        new Request("http://localhost/mdm/apple/mdm", {
          method: "PUT",
          body: plist,
          headers: { "Content-Type": "application/x-apple-aspen-mdm-checkin" },
        }),
      );

      expect(response.status).toBe(200);

      const body = await response.json();

      expect(body).toMatchObject({
        Declarations: { Activations: [{ Identifier: "act-1" }] },
        DeclarationsToken: expect.stringMatching(/^[A-F0-9]{64}$/),
      });
    });
  });

  describe("PUT /mdm/apple/mdm - command result polling", () => {
    it("returns the next command after an Idle result", async () => {
      const events: Array<AppleDeviceEvent> = [];

      const backend = mockManagementBackend({
        appleDeviceEvent: (_scope: CheckinScope, event: AppleDeviceEvent) =>
          Effect.sync(() => {
            events.push(event);
          }),
        appleManagementCheckin: () =>
          Effect.succeed(
            ManagementManifest.members[1].make({
              commandUUID: "cmd-next",
              requestType: "DeviceInformation",
              payload: {},
            }),
          ),
      });

      const handler = await makeMdmHandler(backend);

      const plist = `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>UDID</key><string>udid-idle-001</string>
  <key>Status</key><string>Idle</string>
</dict>
</plist>`;

      const response = await handler(
        new Request("http://localhost/mdm/apple/mdm", {
          method: "PUT",
          body: plist,
          headers: { "Content-Type": "application/x-apple-aspen-mdm" },
        }),
      );

      expect(response.status).toBe(200);
      expect(await response.text()).toContain("cmd-next");
      // Idle has no CommandUUID and must not be reported as a command result.
      expect(events).toHaveLength(0);
    });
  });

  describe("PUT /mdm/apple/mdm - DDM status", () => {
    it("decodes the base64 JSON status report and forwards it", async () => {
      let report: AppleDeviceEvent | undefined;

      const backend = mockManagementBackend({
        appleDeviceEvent: (_scope: CheckinScope, event: AppleDeviceEvent) =>
          Effect.sync(() => {
            report = event;
          }),
      });

      const handler = await makeMdmHandler(backend);

      // {"StatusItems":{"device.identifier.serial-number":"SN-1"}}
      const data = btoa(
        JSON.stringify({ StatusItems: { "device.identifier.serial-number": "SN-1" } }),
      );

      const plist = `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>MessageType</key><string>DeclarativeManagement</string>
  <key>UDID</key><string>udid-ddm-status</string>
  <key>Endpoint</key><string>status</string>
  <key>Data</key><data>${data}</data>
</dict>
</plist>`;

      const response = await handler(
        new Request("http://localhost/mdm/apple/mdm", {
          method: "PUT",
          body: plist,
          headers: { "Content-Type": "application/x-apple-aspen-mdm-checkin" },
        }),
      );

      expect(response.status).toBe(200);

      if (!report || !Predicate.isTagged(report, "DeclarationStatus"))
        throw new Error("expected a DeclarationStatus event");

      expect(report.statusItems).toEqual({ "device.identifier.serial-number": "SN-1" });
    });
  });

  describe("PUT /mdm/apple/mdm - checkin", () => {
    it("returns a command plist when a command is queued", async () => {
      const backend = mockManagementBackend({
        appleManagementCheckin: () =>
          Effect.succeed({
            _tag: "Command" as const,
            commandUUID: "cmd-001",
            requestType: "DeviceInformation",
            payload: { Queries: ["DeviceName"] },
          }),
      });

      const handler = await makeMdmHandler(backend);

      const plist = `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>UDID</key><string>udid-checkin-001</string>
</dict>
</plist>`;

      const response = await handler(
        new Request("http://localhost/mdm/apple/mdm", {
          method: "PUT",
          body: plist,
          headers: { "Content-Type": "application/x-apple-aspen-mdm" },
        }),
      );

      expect(response.status).toBe(200);
      const body = await response.text();
      expect(body).toContain("CommandUUID");
      expect(body).toContain("DeviceInformation");
    });

    it("returns an empty plist when idle", async () => {
      const backend = mockManagementBackend({
        appleManagementCheckin: () => Effect.succeed(ManagementManifest.members[0].make({})),
      });

      const handler = await makeMdmHandler(backend);

      const plist = `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>UDID</key><string>udid-checkin-002</string>
</dict>
</plist>`;

      const response = await handler(
        new Request("http://localhost/mdm/apple/mdm", {
          method: "PUT",
          body: plist,
          headers: { "Content-Type": "application/x-apple-aspen-mdm" },
        }),
      );

      expect(response.status).toBe(200);
      const body = await response.text();
      expect(body).toContain("<dict></dict>");
    });
  });

  describe("PUT /mdm/apple/mdm - ReturnToService command payload", () => {
    it("turns base64 nested Return to Service values into plist data", async () => {
      const backend = mockManagementBackend({
        appleManagementCheckin: () =>
          Effect.succeed(
            ManagementManifest.members[1]!.make({
              commandUUID: "cmd-rts",
              requestType: "EraseDevice",
              payload: {
                ReturnToService: {
                  Enabled: true,
                  WiFiProfileData: "AQID",
                  BootstrapToken: "BAUG",
                },
              },
            }),
          ),
      });

      const handler = await makeMdmHandler(backend);

      const plist = `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>UDID</key><string>udid-rts-cmd-001</string>
</dict>
</plist>`;

      const response = await handler(
        new Request("http://localhost/mdm/apple/mdm", {
          method: "PUT",
          body: plist,
          headers: { "Content-Type": "application/x-apple-aspen-mdm" },
        }),
      );

      const body = await response.text();
      expect(body).toContain("<string>EraseDevice</string>");
      expect(body).toContain("<key>WiFiProfileData</key><data>AQID</data>");
      expect(body).toContain("<key>BootstrapToken</key><data>BAUG</data>");
    });
  });

  describe("PUT /mdm/apple/mdm - ReturnToService", () => {
    const request = `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>MessageType</key><string>ReturnToService</string>
  <key>UDID</key><string>udid-rts-001</string>
</dict>
</plist>`;

    it("returns the Wi-Fi profile and bootstrap token as data", async () => {
      const backend = mockManagementBackend({
        appleReturnToServiceConfiguration: () =>
          Effect.succeed({
            enabled: true,
            wifiProfileData: new Uint8Array([1, 2, 3]),
            bootstrapToken: new Uint8Array([4, 5, 6]),
          }),
      });

      const handler = await makeMdmHandler(backend);

      const response = await handler(
        new Request("http://localhost/mdm/apple/mdm", {
          method: "PUT",
          body: request,
          headers: { "Content-Type": "application/x-apple-aspen-mdm-checkin" },
        }),
      );

      expect(response.status).toBe(200);
      const body = await response.text();
      expect(body).toContain("<key>ReturnToService</key>");
      expect(body).toContain("<key>Enabled</key><true/>");
      expect(body).toContain("<key>WiFiProfileData</key><data>AQID</data>");
      expect(body).toContain("<key>BootstrapToken</key><data>BAUG</data>");
    });

    it("answers Enabled=false when the device cannot return to service", async () => {
      const backend = mockManagementBackend({
        appleReturnToServiceConfiguration: () =>
          Effect.succeed({ enabled: false, reason: "No Wi-Fi profile" }),
      });

      const handler = await makeMdmHandler(backend);

      const response = await handler(
        new Request("http://localhost/mdm/apple/mdm", {
          method: "PUT",
          body: request,
          headers: { "Content-Type": "application/x-apple-aspen-mdm-checkin" },
        }),
      );

      expect(response.status).toBe(200);
      const body = await response.text();
      expect(body).toContain("<key>ReturnToService</key>");
      expect(body).toContain("<key>Enabled</key><false/>");
      expect(body).not.toContain("WiFiProfileData");
    });
  });
});
