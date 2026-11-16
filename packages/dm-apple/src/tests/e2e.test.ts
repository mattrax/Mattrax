import { describe, it, expect } from "vitest";
import { Effect, Layer, Predicate, Schema } from "effect";
import { HttpRouter } from "effect/http";
import { AppleMdmServiceLive, AppleMdmTopic } from "../service.js";
import { AppleMdmConfig } from "../config.js";
import {
  AppleDeviceEvent,
  CheckinScope,
  ManagementBackend,
  ManagementManifest,
} from "@mattrax/management-backend";
import { appleMdmRoutes } from "../handlers.js";
import { parsePlist, PlistValue } from "@mattrax/plist";
import { mockManagementBackend } from "./helpers.js";

const TEST_CONFIG = { origin: "https://test.mattrax.app", topic: "com.apple.mgmt.External.test" };
const PlistDictionary = Schema.Record(Schema.String, PlistValue);

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

describe("Apple MDM E2E", () => {
  it("simulates a full device enrollment lifecycle", async () => {
    const events: Array<AppleDeviceEvent> = [];

    const backend = mockManagementBackend({
      appleDeviceEvent: (_scope: CheckinScope, event: AppleDeviceEvent) =>
        Effect.sync(() => {
          events.push(event);
        }),
      appleManagementCheckin: () =>
        Effect.succeed(
          ManagementManifest.members[1].make({
            commandUUID: "cmd-enroll-001",
            requestType: "DeviceInformation",
            payload: { Queries: ["DeviceName", "SerialNumber"] },
          }),
        ),
    });

    const handler = await makeMdmHandler(backend);
    const udid = "e2e-udid-001";

    // ── Step 1: Authenticate ──────────────────────────────────────────
    const authPlist = `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>MessageType</key><string>Authenticate</string>
  <key>Topic</key><string>${TEST_CONFIG.topic}</string>
  <key>UDID</key><string>${udid}</string>
  <key>SerialNumber</key><string>E2ESN001</string>
  <key>OSVersion</key><string>14.2.1</string>
  <key>Model</key><string>MacBookPro18,1</string>
</dict>
</plist>`;

    const authRes = await handler(
      new Request("http://localhost/mdm/apple/mdm", {
        method: "PUT",
        body: authPlist,
        headers: { "Content-Type": "application/x-apple-aspen-mdm-checkin" },
      }),
    );

    expect(authRes.status).toBe(200);

    // ── Step 2: TokenUpdate ───────────────────────────────────────────
    const tokenPlist = `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>MessageType</key><string>TokenUpdate</string>
  <key>Topic</key><string>${TEST_CONFIG.topic}</string>
  <key>UDID</key><string>${udid}</string>
  <key>PushMagic</key><string>magic-e2e-001</string>
  <key>Token</key><data>${btoa("push-token-e2e-001")}</data>
</dict>
</plist>`;

    const tokenRes = await handler(
      new Request("http://localhost/mdm/apple/mdm", {
        method: "PUT",
        body: tokenPlist,
        headers: { "Content-Type": "application/x-apple-aspen-mdm-checkin" },
      }),
    );

    expect(tokenRes.status).toBe(200);

    // ── Step 3: Checkin (receive command) ─────────────────────────────
    const checkinPlist = `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>UDID</key><string>${udid}</string>
</dict>
</plist>`;

    const checkinRes = await handler(
      new Request("http://localhost/mdm/apple/mdm", {
        method: "PUT",
        body: checkinPlist,
        headers: { "Content-Type": "application/x-apple-aspen-mdm" },
      }),
    );

    expect(checkinRes.status).toBe(200);

    const checkinBody = await checkinRes.text();

    const commandPlist = await parsePlist(checkinBody).pipe(Effect.runPromise);

    if (!Schema.is(PlistDictionary)(commandPlist))
      throw new Error("check-in response must be a plist dictionary");

    expect(commandPlist["CommandUUID"]).toBe("cmd-enroll-001");

    const command = commandPlist["Command"];

    if (!Schema.is(PlistDictionary)(command)) throw new Error("command must be a plist dictionary");

    expect(command["RequestType"]).toBe("DeviceInformation");

    // ── Step 4: CommandResult ─────────────────────────────────────────
    const resultPlist = `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>UDID</key><string>${udid}</string>
  <key>Status</key><string>Acknowledged</string>
  <key>CommandUUID</key><string>cmd-enroll-001</string>
  <key>QueryResponses</key>
  <dict>
    <key>DeviceName</key><string>E2E-MacBook</string>
    <key>SerialNumber</key><string>E2ESN001</string>
  </dict>
</dict>
</plist>`;

    const resultRes = await handler(
      new Request("http://localhost/mdm/apple/mdm", {
        method: "PUT",
        body: resultPlist,
        headers: { "Content-Type": "application/x-apple-aspen-mdm" },
      }),
    );

    expect(resultRes.status).toBe(200);

    // ── Step 5: CheckOut ──────────────────────────────────────────────
    const checkoutPlist = `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>MessageType</key><string>CheckOut</string>
  <key>Topic</key><string>${TEST_CONFIG.topic}</string>
  <key>UDID</key><string>${udid}</string>
</dict>
</plist>`;

    const checkoutRes = await handler(
      new Request("http://localhost/mdm/apple/mdm", {
        method: "PUT",
        body: checkoutPlist,
        headers: { "Content-Type": "application/x-apple-aspen-mdm-checkin" },
      }),
    );

    expect(checkoutRes.status).toBe(200);

    // ── Verify events were recorded in order ──────────────────────────
    expect(events).toHaveLength(4);
    expect(events.map((event) => event._tag)).toEqual([
      "Authenticate",
      "TokenUpdate",
      "CommandResult",
      "CheckOut",
    ]);

    const authEvent = events[0];

    if (!authEvent || !Predicate.isTagged(authEvent, "Authenticate"))
      throw new Error("expected an Authenticate event");

    expect(authEvent.serialNumber).toBe("E2ESN001");

    const tokenEvent = events[1];

    if (!tokenEvent || !Predicate.isTagged(tokenEvent, "TokenUpdate"))
      throw new Error("expected a TokenUpdate event");

    expect(tokenEvent.pushMagic).toBe("magic-e2e-001");

    const resultEvent = events[2];

    if (!resultEvent || !Predicate.isTagged(resultEvent, "CommandResult"))
      throw new Error("expected a CommandResult event");

    expect(resultEvent.status).toBe("Acknowledged");
    expect(resultEvent.queryResponses?.["DeviceName"]).toBe("E2E-MacBook");
  });

  it("handles DDM tokens and declaration-items flow", async () => {
    const backend = mockManagementBackend({
      getAppleDeclarationTokens: () =>
        Effect.succeed({
          activationsToken: "act-e2e",
          configurationsToken: "cfg-e2e",
          assetsToken: "asset-e2e",
          managementToken: "mgmt-e2e",
          declarationsToken: "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA",
        }),
      getAppleDeclarationItems: () =>
        Effect.succeed({
          activations: [{ identifier: "act-1", serverToken: "tok-1" }],
          configurations: [{ identifier: "cfg-1", serverToken: "tok-2" }],
          assets: [{ identifier: "asset-1", serverToken: "tok-3" }],
          management: [{ identifier: "mgmt-1", serverToken: "tok-4" }],
        }),
    });

    const handler = await makeMdmHandler(backend);
    const udid = "e2e-udid-ddm-001";

    // Request tokens
    const tokensPlist = `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>MessageType</key><string>DeclarativeManagement</string>
  <key>UDID</key><string>${udid}</string>
  <key>Endpoint</key><string>tokens</string>
  <key>Data</key><dict/>
</dict>
</plist>`;

    const tokensRes = await handler(
      new Request("http://localhost/mdm/apple/mdm", {
        method: "PUT",
        body: tokensPlist,
        headers: { "Content-Type": "application/x-apple-aspen-mdm-checkin" },
      }),
    );

    expect(tokensRes.status).toBe(200);
    const tokensData = await tokensRes.json();
    expect(tokensData.SyncTokens.DeclarationsToken).toMatch(/^[A-F0-9]{64}$/);
    expect(tokensData.SyncTokens.Timestamp).toMatch(/^\d{4}-\d{2}-\d{2}T/);

    // Request declaration items
    const itemsPlist = `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>MessageType</key><string>DeclarativeManagement</string>
  <key>UDID</key><string>${udid}</string>
  <key>Endpoint</key><string>declaration-items</string>
  <key>Data</key><dict/>
</dict>
</plist>`;

    const itemsRes = await handler(
      new Request("http://localhost/mdm/apple/mdm", {
        method: "PUT",
        body: itemsPlist,
        headers: { "Content-Type": "application/x-apple-aspen-mdm-checkin" },
      }),
    );

    expect(itemsRes.status).toBe(200);
    const itemsData = await itemsRes.json();
    expect(itemsData.Declarations.Activations).toHaveLength(1);
    expect(itemsData.Declarations.Configurations).toHaveLength(1);
    expect(itemsData.Declarations.Assets).toHaveLength(1);
    expect(itemsData.Declarations.Management).toHaveLength(1);
  });
});
