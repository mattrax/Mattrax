import assert from "node:assert/strict";
import { Effect } from "effect";
import { signAppleProfileToken } from "@mattrax/dm-apple";
import type { Check } from "../types.ts";
import {
  appleMdmRequest,
  applePlistResponse,
  base64Utf8,
  createAppleHarness,
  parseAppleBody,
} from "../harness/apple.ts";

const origin = "https://mdm.example.test";
const udid = "00008030-001A2B3C4D5E6F70";
const topic = "com.apple.mgmt.External.compliance";

const authenticate = () => ({
  MessageType: "Authenticate",
  Topic: topic,
  UDID: udid,
  SerialNumber: "C02COMPLIANCE",
  OSVersion: "15.4",
  Model: "MacBookPro18,3",
});

const tokenUpdate = (overrides: Record<string, unknown> = {}) => ({
  MessageType: "TokenUpdate",
  Topic: topic,
  UDID: udid,
  PushMagic: "push-magic",
  Token: btoa(String.fromCharCode(0xde, 0xad, 0xbe, 0xef)),
  ...overrides,
});

const declarative = (endpoint: string, extra: Record<string, unknown> = {}) => ({
  MessageType: "DeclarativeManagement",
  UDID: udid,
  Endpoint: endpoint,
  ...extra,
});

const rawMdmRequest = (body: string, headers: Record<string, string> = {}) =>
  new Request(`${origin}/mdm/apple/mdm`, {
    method: "PUT",
    headers: {
      "content-type": "application/x-apple-aspen-mdm",
      ...headers,
    },
    body,
  });

const eventTags = (harness: ReturnType<typeof createAppleHarness>) =>
  harness.state.events.map((entry) => entry.event._tag);

const check = (
  id: string,
  category: Check["category"],
  name: string,
  description: string,
  run: Check["run"],
  dayN = false,
): Check => ({
  id: `apple.${id}`,
  platform: "apple",
  category,
  name,
  description,
  ...(dayN ? { dayN: true } : {}),
  run,
});

export const appleChecks: ReadonlyArray<Check> = [
  check(
    "profile.enrollment",
    "enrollment",
    "Enrollment profile contains SCEP and MDM payloads",
    "The profile must bind a per-enrollment SCEP challenge to the MDM check-in URL and advertise bootstrap-token support.",
    async () => {
      const harness = createAppleHarness();

      const raw = await Effect.runPromise(
        harness.service.generateEnrollmentProfile({
          challenge: "challenge-compliance",
          organizationId: "tenant-compliance",
          organizationName: "Compliance Test",
        }),
      );

      const profile = (await parseAppleBody(raw)) as any;
      assert.equal(profile.PayloadType, "Configuration");
      assert.equal(profile.PayloadContent.length, 2);

      const scep = profile.PayloadContent.find(
        (payload: any) => payload.PayloadType === "com.apple.security.scep",
      );

      const mdm = profile.PayloadContent.find(
        (payload: any) => payload.PayloadType === "com.apple.mdm",
      );

      assert.ok(scep && mdm);
      assert.equal(scep.PayloadContent.Challenge, "challenge-compliance");
      assert.equal(scep.PayloadContent.URL, `${origin}/mdm/apple/scep`);
      assert.equal(scep.PayloadContent["Key Usage"], 5);
      assert.equal(mdm.IdentityCertificateUUID, scep.PayloadUUID);
      assert.equal(mdm.ServerURL, `${origin}/mdm/apple/mdm`);
      assert.equal(mdm.CheckInURL, `${origin}/mdm/apple/mdm`);
      assert.equal(mdm.CheckOutWhenRemoved, true);
      assert.equal(mdm.SignMessage, true);
      assert.ok(mdm.ServerCapabilities.includes("com.apple.mdm.bootstraptoken"));
      assert.ok(mdm.ServerCapabilities.includes("com.apple.mdm.token"));
    },
  ),
  check(
    "checkin.authenticate",
    "check-in",
    "Authenticate records device identity",
    "A valid Authenticate check-in must be accepted and surface serial, model, OS version and UDID to the backend.",
    async () => {
      const harness = createAppleHarness();
      const response = await harness.handler(await appleMdmRequest(authenticate()));
      assert.equal(response.status, 200);
      assert.equal(harness.state.events.length, 1);
      const recorded = harness.state.events[0]!;
      assert.equal(recorded.event._tag, "Authenticate");
      assert.equal(recorded.scope._tag, "device");
      assert.equal(recorded.scope.udid, udid);

      if (recorded.event._tag === "Authenticate") {
        assert.equal(recorded.event.serialNumber, "C02COMPLIANCE");
        assert.equal(recorded.event.osVersion, "15.4");
        assert.equal(recorded.event.model, "MacBookPro18,3");
      }
    },
  ),
  check(
    "checkin.authenticate-invalid",
    "errors",
    "Authenticate without required fields is rejected",
    "Malformed check-in plists must be rejected with HTTP 400 rather than partially processed.",
    async () => {
      const harness = createAppleHarness();

      const response = await harness.handler(
        await appleMdmRequest({ MessageType: "Authenticate", UDID: udid }),
      );

      assert.equal(response.status, 400);
      assert.equal(harness.state.events.length, 0);
    },
  ),
  check(
    "checkin.token-update-device",
    "check-in",
    "Device TokenUpdate records APNs push token",
    "The base64 APNs token must be converted to lowercase hexadecimal and recorded with PushMagic and topic.",
    async () => {
      const harness = createAppleHarness();

      const response = await harness.handler(
        await appleMdmRequest(tokenUpdate({ EnrollmentID: "enrollment-1" })),
      );

      assert.equal(response.status, 200);
      const event = harness.state.events[0]!.event;
      assert.equal(event._tag, "TokenUpdate");

      if (event._tag !== "TokenUpdate") return;
      assert.equal(event.pushToken, "deadbeef");
      assert.equal(event.pushMagic, "push-magic");
      assert.equal(event.topic, topic);
      assert.equal(event.channel, "device");
      assert.equal(event.enrollmentId, "enrollment-1");
    },
  ),
  check(
    "checkin.token-update-user",
    "check-in",
    "User TokenUpdate retains user channel",
    "User-channel TokenUpdate must be attributed to the user scope with unlock token and user metadata.",
    async () => {
      const harness = createAppleHarness();

      const response = await harness.handler(
        await appleMdmRequest(
          tokenUpdate({
            UserID: "user-1",
            UserShortName: "oscar",
            UserLongName: "Oscar Beaumont",
            UnlockToken: "dW5sb2Nr",
            AwaitingConfiguration: true,
          }),
        ),
      );

      assert.equal(response.status, 200);
      const recorded = harness.state.events[0]!;
      assert.equal(recorded.scope._tag, "user");

      if (recorded.scope._tag === "user") assert.equal(recorded.scope.userId, "user-1");
      const event = recorded.event;
      assert.equal(event._tag, "TokenUpdate");

      if (event._tag !== "TokenUpdate") return;
      assert.equal(event.channel, "user");
      assert.equal(event.userId, "user-1");
      assert.equal(event.unlockToken, "dW5sb2Nr");
      assert.equal(event.awaitingConfiguration, true);
      assert.equal(event.userShortName, "oscar");
      assert.equal(event.userLongName, "Oscar Beaumont");
    },
  ),
  check(
    "checkin.token-update-invalid",
    "errors",
    "TokenUpdate without a token is rejected",
    "A TokenUpdate missing the APNs token cannot be stored and must return HTTP 400.",
    async () => {
      const harness = createAppleHarness();

      const response = await harness.handler(
        await appleMdmRequest({
          MessageType: "TokenUpdate",
          Topic: topic,
          UDID: udid,
          PushMagic: "push-magic",
        }),
      );

      assert.equal(response.status, 400);
    },
  ),
  check(
    "checkin.checkout-device",
    "check-in",
    "Device CheckOut is recorded",
    "Device CheckOut must be accepted and forwarded as a CheckOut event.",
    async () => {
      const harness = createAppleHarness();

      const response = await harness.handler(
        await appleMdmRequest({ MessageType: "CheckOut", Topic: topic, UDID: udid }),
      );

      assert.equal(response.status, 200);
      assert.equal(harness.state.events[0]!.event._tag, "CheckOut");
    },
  ),
  check(
    "checkin.checkout-user",
    "check-in",
    "User CheckOut is scoped to the user",
    "A user-channel CheckOut must identify the user so only that user's management context is removed.",
    async () => {
      const harness = createAppleHarness();

      const response = await harness.handler(
        await appleMdmRequest({
          MessageType: "CheckOut",
          Topic: topic,
          UDID: udid,
          UserID: "user-1",
        }),
      );

      assert.equal(response.status, 200);
      assert.equal(harness.state.events[0]!.scope._tag, "user");
      const event = harness.state.events[0]!.event;
      assert.equal(event._tag, "CheckOut");

      if (event._tag === "CheckOut") assert.equal(event.userId, "user-1");
    },
  ),
  check(
    "commands.poll",
    "commands",
    "Command poll returns the queued MDM command",
    "Idle device polls must receive a plist containing CommandUUID and Command.RequestType.",
    async () => {
      const harness = createAppleHarness();
      harness.state.checkinQueue.push({
        _tag: "Command",
        commandUUID: "command-1",
        requestType: "DeviceInformation",
        payload: { Queries: ["DeviceName"] },
      });
      const response = await harness.handler(await appleMdmRequest({ UDID: udid, Status: "Idle" }));
      assert.equal(response.status, 200);
      assert.match(response.headers.get("content-type") ?? "", /xml/);
      const plist = (await applePlistResponse(response)) as any;
      assert.equal(plist.CommandUUID, "command-1");
      assert.equal(plist.Command.RequestType, "DeviceInformation");
      assert.deepEqual(plist.Command.Queries, ["DeviceName"]);
    },
  ),
  check(
    "commands.poll-idle",
    "commands",
    "Idle poll returns an empty response",
    "When there is no work, the server must return 200 with no command body rather than an error.",
    async () => {
      const harness = createAppleHarness();
      const response = await harness.handler(await appleMdmRequest({ UDID: udid, Status: "Idle" }));
      assert.equal(response.status, 200);
      const text = await response.text();

      if (text.trim() !== "") {
        const plist = (await parseAppleBody(text)) as Record<string, unknown>;
        assert.equal(Object.keys(plist).length, 0);
      }
    },
  ),
  check(
    "commands.result-follow-up",
    "commands",
    "Acknowledged command result triggers the next poll",
    "A Status=Acknowledged result must be recorded and the same response may carry the next command.",
    async () => {
      const harness = createAppleHarness();
      harness.state.checkinQueue.push({
        _tag: "Command",
        commandUUID: "command-2",
        requestType: "SecurityInfo",
        payload: {},
      });

      const response = await harness.handler(
        await appleMdmRequest({
          UDID: udid,
          Status: "Acknowledged",
          CommandUUID: "command-1",
          Command: { RequestType: "DeviceInformation" },
          QueryResponses: { DeviceName: "Mac" },
        }),
      );

      assert.equal(response.status, 200);
      const event = harness.state.events[0]!.event;
      assert.equal(event._tag, "CommandResult");

      if (event._tag === "CommandResult") {
        assert.equal(event.commandUUID, "command-1");
        assert.equal(event.status, "Acknowledged");
        assert.deepEqual(event.queryResponses, { DeviceName: "Mac" });
      }

      const plist = (await applePlistResponse(response)) as any;
      assert.equal(plist.CommandUUID, "command-2");
      assert.equal(plist.Command.RequestType, "SecurityInfo");
    },
  ),
  check(
    "commands.result-error",
    "commands",
    "Error command result preserves ErrorChain",
    "The server must record ErrorDomain and ErrorCode from a failed command result.",
    async () => {
      const harness = createAppleHarness();

      const response = await harness.handler(
        await appleMdmRequest({
          UDID: udid,
          Status: "Error",
          CommandUUID: "command-3",
          ErrorChain: [
            { ErrorDomain: "MCMDMErrorDomain", ErrorCode: 12013 },
            { ErrorDomain: "MCMDMErrorDomain", ErrorCode: 12014 },
          ],
        }),
      );

      assert.equal(response.status, 200);
      const event = harness.state.events[0]!.event;
      assert.equal(event._tag, "CommandResult");

      if (event._tag === "CommandResult")
        assert.equal(event.errorDetail, "MCMDMErrorDomain:12013, MCMDMErrorDomain:12014");
    },
  ),
  check(
    "commands.result-no-uuid",
    "commands",
    "Command result without CommandUUID is not misfiled",
    "A Status payload with no CommandUUID must not be recorded as a command result.",
    async () => {
      const harness = createAppleHarness();

      const response = await harness.handler(
        await appleMdmRequest({ UDID: udid, Status: "Acknowledged" }),
      );

      assert.equal(response.status, 200);
      assert.equal(eventTags(harness).includes("CommandResult"), false);
    },
  ),
  check(
    "commands.not-now",
    "commands",
    "NotNow result is recorded without acknowledging the command",
    "NotNow means later, not never: the device status must be preserved for the backend to retry.",
    async () => {
      const harness = createAppleHarness();

      const response = await harness.handler(
        await appleMdmRequest({
          UDID: udid,
          Status: "NotNow",
          CommandUUID: "command-not-now",
        }),
      );

      assert.equal(response.status, 200);
      const event = harness.state.events[0]!.event;
      assert.equal(event._tag, "CommandResult");

      if (event._tag === "CommandResult") {
        assert.equal(event.status, "NotNow");
        assert.equal(event.commandUUID, "command-not-now");
      }
    },
  ),
  check(
    "commands.clear-passcode",
    "commands",
    "ClearPasscode sends UnlockToken as plist data",
    "The backend stores UnlockToken as base64 but the device command must contain binary plist data.",
    async () => {
      const harness = createAppleHarness();
      harness.state.checkinQueue.push({
        _tag: "Command",
        commandUUID: "command-clear",
        requestType: "ClearPasscode",
        payload: { UnlockToken: btoa(String.fromCharCode(1, 2, 3, 4)) },
      });
      const response = await harness.handler(await appleMdmRequest({ UDID: udid, Status: "Idle" }));
      assert.equal(response.status, 200);
      const text = await response.text();
      assert.match(text, /<key>UnlockToken<\/key><data>AQIDBA==<\/data>/);
      const plist = (await parseAppleBody(text)) as any;
      assert.equal(plist.Command.RequestType, "ClearPasscode");
      assert.equal(plist.Command.UnlockToken, "AQIDBA==");
    },
  ),
  check(
    "commands.unenroll-410",
    "management",
    "Server-initiated unenrollment returns 410",
    "A backend unenrollment decision must produce HTTP 410 Gone so the device removes its MDM profile.",
    async () => {
      const harness = createAppleHarness();
      harness.state.checkinError = "unenrolled";
      const response = await harness.handler(await appleMdmRequest({ UDID: udid, Status: "Idle" }));
      assert.equal(response.status, 410);
    },
  ),
  check(
    "ddm.tokens",
    "declarative-management",
    "DDM tokens endpoint returns SyncTokens",
    "DeclarativeManagement Endpoint=tokens must return SyncTokens.DeclarationsToken and an RFC 3339 timestamp.",
    async () => {
      const harness = createAppleHarness();
      const response = await harness.handler(await appleMdmRequest(declarative("tokens")));
      assert.equal(response.status, 200);
      assert.match(response.headers.get("content-type") ?? "", /json/);
      const body = (await response.json()) as any;
      assert.equal(body.SyncTokens.DeclarationsToken, "declarations-token");
      assert.match(body.SyncTokens.Timestamp, /^\d{4}-\d{2}-\d{2}T/);
    },
  ),
  check(
    "ddm.declaration-items",
    "declarative-management",
    "DDM declaration-items classifies every declaration",
    "Activations, configurations, assets and management declarations must be returned in separate arrays with the current token.",
    async () => {
      const harness = createAppleHarness();

      const response = await harness.handler(
        await appleMdmRequest(declarative("declaration-items")),
      );

      assert.equal(response.status, 200);
      const body = (await response.json()) as any;
      assert.equal(body.DeclarationsToken, "declarations-token");
      assert.deepEqual(body.Declarations.Activations, [
        { Identifier: "activation.one", ServerToken: "a1" },
      ]);
      assert.deepEqual(body.Declarations.Configurations, [
        { Identifier: "configuration.one", ServerToken: "c1" },
      ]);
      assert.deepEqual(body.Declarations.Assets, [{ Identifier: "asset.one", ServerToken: "s1" }]);
      assert.deepEqual(body.Declarations.Management, [
        { Identifier: "management.one", ServerToken: "m1" },
      ]);
    },
  ),
  check(
    "ddm.declaration",
    "declarative-management",
    "DDM declaration returns the signed declaration document",
    "A declaration fetch must return the exact declaration object for the requested identifier.",
    async () => {
      const harness = createAppleHarness();

      const response = await harness.handler(
        await appleMdmRequest(declarative("declaration/configuration/configuration.one")),
      );

      assert.equal(response.status, 200);
      const body = (await response.json()) as any;
      assert.equal(body.Identifier, "configuration.one");
      assert.equal(body.Type, "com.apple.configuration.management.test");
      assert.equal(body.Payload.Enabled, true);
    },
  ),
  check(
    "ddm.declaration-unknown-type",
    "errors",
    "DDM declaration rejects an unknown type",
    "Only activation, configuration, asset and management declaration types are valid.",
    async () => {
      const harness = createAppleHarness();

      const response = await harness.handler(
        await appleMdmRequest(declarative("declaration/unknown/configuration.one")),
      );

      assert.equal(response.status, 404);
    },
  ),
  check(
    "ddm.status",
    "declarative-management",
    "DDM status report records status items and errors",
    "The base64 JSON status report must be decoded and forwarded with mapped error reasons.",
    async () => {
      const harness = createAppleHarness();

      const report = {
        StatusItems: { "device.operating-system.version": "15.4" },
        Errors: [
          {
            StatusItem: "configuration.one",
            Reasons: [{ Code: "Error", Description: "Invalid payload", Details: { field: "x" } }],
          },
        ],
      };

      const response = await harness.handler(
        await appleMdmRequest(declarative("status", { Data: base64Utf8(JSON.stringify(report)) })),
      );

      assert.equal(response.status, 200);
      const event = harness.state.events[0]!.event;
      assert.equal(event._tag, "DeclarationStatus");

      if (event._tag === "DeclarationStatus") {
        assert.deepEqual(event.statusItems, report.StatusItems);
        assert.equal(event.errors?.[0]?.statusItem, "configuration.one");
        assert.equal(event.errors?.[0]?.reasons?.[0]?.code, "Error");
      }
    },
  ),
  check(
    "ddm.status-invalid",
    "errors",
    "DDM status with invalid JSON is rejected",
    "A status Data value that is not base64 JSON must return HTTP 400.",
    async () => {
      const harness = createAppleHarness();

      const response = await harness.handler(
        await appleMdmRequest(declarative("status", { Data: "bm90LWpzb24=" })),
      );

      assert.equal(response.status, 400);
    },
  ),
  check(
    "ddm.unknown-endpoint",
    "errors",
    "DDM unknown endpoint returns 404",
    "Unknown DeclarativeManagement endpoints must not be treated as commands.",
    async () => {
      const harness = createAppleHarness();

      const response = await harness.handler(
        await appleMdmRequest(declarative("not-a-real-endpoint")),
      );

      assert.equal(response.status, 404);
    },
  ),
  check(
    "bootstrap.set",
    "check-in",
    "SetBootstrapToken escrows the bootstrap token",
    "A SetBootstrapToken check-in must forward the opaque bootstrap token with the device UDID.",
    async () => {
      const harness = createAppleHarness();

      const response = await harness.handler(
        await appleMdmRequest({
          MessageType: "SetBootstrapToken",
          UDID: udid,
          BootstrapToken: "Ym9vdHN0cmFwLXRva2Vu",
        }),
      );

      assert.equal(response.status, 200);
      const event = harness.state.events[0]!.event;
      assert.equal(event._tag, "BootstrapToken");

      if (event._tag === "BootstrapToken") assert.equal(event.token, "Ym9vdHN0cmFwLXRva2Vu");
    },
  ),
  check(
    "bootstrap.get",
    "check-in",
    "GetBootstrapToken returns plist data",
    "A GetBootstrapToken request must return the escrowed token as binary plist data.",
    async () => {
      const harness = createAppleHarness();

      const response = await harness.handler(
        await appleMdmRequest({ MessageType: "GetBootstrapToken", UDID: udid }),
      );

      assert.equal(response.status, 200);
      const text = await response.text();
      assert.match(text, /<key>BootstrapToken<\/key><data>/);
      const plist = (await parseAppleBody(text)) as any;
      assert.equal(plist.BootstrapToken, "Ym9vdHN0cmFwLXRva2Vu");
    },
  ),
  check(
    "bootstrap.get-empty",
    "check-in",
    "GetBootstrapToken with no escrowed token is a quiet success",
    "A device that has no bootstrap token must receive an empty 200 response, not an error.",
    async () => {
      const harness = createAppleHarness();
      harness.state.bootstrapToken = null;

      const response = await harness.handler(
        await appleMdmRequest({ MessageType: "GetBootstrapToken", UDID: udid }),
      );

      assert.equal(response.status, 200);
      assert.equal((await response.text()).trim(), "");
    },
  ),
  check(
    "bootstrap.get-missing-udid",
    "errors",
    "GetBootstrapToken without UDID is rejected",
    "Bootstrap token lookup cannot be ambiguous; a missing UDID must return HTTP 400.",
    async () => {
      const harness = createAppleHarness();

      const response = await harness.handler(
        await appleMdmRequest({ MessageType: "GetBootstrapToken" }),
      );

      assert.equal(response.status, 400);
    },
  ),
  check(
    "errors.user-authenticate",
    "errors",
    "UserAuthenticate is refused with 410",
    "The user channel must not be issued an MDM identity through the device endpoint.",
    async () => {
      const harness = createAppleHarness();

      const response = await harness.handler(
        await appleMdmRequest({ MessageType: "UserAuthenticate", UDID: udid }),
      );

      assert.equal(response.status, 410);
    },
  ),
  check(
    "errors.get-token",
    "errors",
    "Legacy GetToken is rejected",
    "GetToken is not supported and must return HTTP 400.",
    async () => {
      const harness = createAppleHarness();

      const response = await harness.handler(
        await appleMdmRequest({ MessageType: "GetToken", UDID: udid }),
      );

      assert.equal(response.status, 400);
    },
  ),
  check(
    "errors.unknown-message",
    "errors",
    "Unknown check-in MessageType is rejected",
    "Unrecognised MessageType values must not fall through to command polling.",
    async () => {
      const harness = createAppleHarness();

      const response = await harness.handler(
        await appleMdmRequest({ MessageType: "SomethingElse", UDID: udid }),
      );

      assert.equal(response.status, 400);
    },
  ),
  check(
    "errors.malformed-plist",
    "errors",
    "Malformed plist is rejected",
    "A non-plist body must return HTTP 400 without logging a 500.",
    async () => {
      const harness = createAppleHarness();
      const response = await harness.handler(rawMdmRequest("<not-a-plist>"));
      assert.equal(response.status, 400);
    },
  ),
  check(
    "errors.signature-required",
    "authentication",
    "Required Mdm-Signature is enforced",
    "When the host requires signed device messages, a request without Mdm-Signature must be rejected.",
    async () => {
      const harness = createAppleHarness({
        trust: { requireSignature: true, caCertPems: Effect.succeed([]) },
      });

      const response = await harness.handler(await appleMdmRequest(authenticate()));
      assert.equal(response.status, 400);
    },
  ),
  check(
    "assets.fetch",
    "management",
    "Assets are served with their content type",
    "A signed/known asset request must return the backend bytes and media type.",
    async () => {
      const harness = createAppleHarness();
      harness.state.assets.set("asset-1", {
        content: new TextEncoder().encode("asset-content"),
        contentType: "application/octet-stream",
      });

      const response = await harness.handler(
        new Request(`${origin}/mdm/apple/assets/asset-1?token=asset-token`, {
          headers: { "x-device-identity-certificate": "device-cert" },
        }),
      );

      assert.equal(response.status, 200);
      assert.equal(response.headers.get("content-type"), "application/octet-stream");
      assert.equal(await response.text(), "asset-content");
    },
  ),
  check(
    "assets.unknown",
    "errors",
    "Unknown asset returns 404",
    "A missing asset must not leak a 500 or an empty 200 response.",
    async () => {
      const harness = createAppleHarness();
      const response = await harness.handler(new Request(`${origin}/mdm/apple/assets/missing`));
      assert.equal(response.status, 404);
    },
  ),
  check(
    "profiles.signed",
    "management",
    "Signed legacy profile URL serves mobileconfig",
    "DDM legacy profile fetches must verify the HMAC token before returning the profile bytes.",
    async () => {
      const harness = createAppleHarness();
      harness.state.profile = {
        content: new TextEncoder().encode("profile-content"),
        contentType: "application/x-apple-aspen-config",
      };

      const token = await signAppleProfileToken(harness.config.authSecret, {
        deviceToken: "device-token",
        policyId: "policy-1",
        kind: "configuration",
      });

      const response = await harness.handler(
        new Request(
          `${origin}/mdm/apple/profiles/device-token/policy-1/configuration?token=${encodeURIComponent(token)}`,
        ),
      );

      assert.equal(response.status, 200);
      assert.equal(response.headers.get("content-type"), "application/x-apple-aspen-config");
      assert.match(response.headers.get("content-disposition") ?? "", /policy-1\.mobileconfig/);
      assert.equal(await response.text(), "profile-content");
    },
  ),
  check(
    "profiles.invalid-token",
    "errors",
    "Legacy profile URL rejects an invalid HMAC",
    "A profile URL with a bad token must return 404 without calling the backend.",
    async () => {
      const harness = createAppleHarness();
      harness.state.profile = {
        content: new TextEncoder().encode("secret-profile"),
        contentType: "application/x-apple-aspen-config",
      };

      const response = await harness.handler(
        new Request(`${origin}/mdm/apple/profiles/device-token/policy-1/configuration?token=bad`),
      );

      assert.equal(response.status, 404);
    },
  ),
  check(
    "profiles.missing-parts",
    "errors",
    "Malformed profile path returns 404",
    "Profile URLs must include device token, policy id and kind.",
    async () => {
      const harness = createAppleHarness();

      const response = await harness.handler(
        new Request(`${origin}/mdm/apple/profiles/only-a-token`),
      );

      assert.equal(response.status, 404);
    },
  ),
  check(
    "day-n.ddm-resync",
    "day-n",
    "DDM re-sync uses a stable deterministic command UUID",
    "Repeated DDM sync tokens must produce the same command UUID per UDID/token pair, and a new token a different UUID.",
    async () => {
      const harness = createAppleHarness();
      harness.state.checkinQueue.push(
        { _tag: "DdmSync", serverToken: "server-token-a" },
        { _tag: "DdmSync", serverToken: "server-token-b" },
      );

      const first = (await applePlistResponse(
        await harness.handler(await appleMdmRequest({ UDID: udid, Status: "Idle" })),
      )) as any;

      const second = (await applePlistResponse(
        await harness.handler(await appleMdmRequest({ UDID: udid, Status: "Idle" })),
      )) as any;

      assert.equal(first.Command.RequestType, "DeclarativeManagement");
      assert.equal(second.Command.RequestType, "DeclarativeManagement");
      assert.notEqual(first.CommandUUID, second.CommandUUID);
      assert.match(
        first.CommandUUID,
        /^[0-9a-f]{8}-[0-9a-f]{4}-5[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
      );
    },
    true,
  ),
  check(
    "day-n.token-rotation",
    "day-n",
    "APNs token rotation is recorded without losing older state",
    "A device whose APNs token changes must produce a second TokenUpdate event with the new token.",
    async () => {
      const harness = createAppleHarness();
      await harness.handler(
        await appleMdmRequest(
          tokenUpdate({
            Token: btoa(String.fromCharCode(1, 1, 1, 1)),
          }),
        ),
      );
      await harness.handler(
        await appleMdmRequest(
          tokenUpdate({
            Token: btoa(String.fromCharCode(2, 2, 2, 2)),
          }),
        ),
      );

      const tokens = harness.state.events
        .map((entry) => entry.event)
        .filter((event) => event._tag === "TokenUpdate")
        .map((event) => event.pushToken);

      assert.deepEqual(tokens, ["01010101", "02020202"]);
    },
    true,
  ),
];
