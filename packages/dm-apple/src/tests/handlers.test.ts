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
} from "@mattrax/management-backend";
import { appleMdmRoutes } from "../handlers.js";
import { mockManagementBackend } from "./helpers.js";

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
        appleManagementCheckin: () =>
          Effect.succeed(ManagementManifest.members[0].make({})),
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
});
