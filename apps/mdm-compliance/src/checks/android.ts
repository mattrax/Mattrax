import assert from "node:assert/strict";
import type { Schema } from "effect";
import { Effect } from "effect";
import {
  PolicyMergeError,
  androidPolicyHash,
  androidPolicyIdForHash,
  commandStatus,
  compileAndroidPolicy,
  compileAndroidPolicyWithHash,
  decodePubSubData,
  decodePubSubPush,
  enrollmentState,
  mergeAndroidPolicies,
  notificationType,
} from "@mattrax/dm-android";
import type { AndroidPubSubResult } from "@mattrax/enterprise-backend";
import type { Check } from "../types.ts";
import { createAndroidHarness } from "../harness/android.ts";

const enterpriseName = "enterprises/LC123456";

const deviceName = `${enterpriseName}/devices/device-1`;

const base64 = (value: Schema.Json): string => {
  const bytes = new TextEncoder().encode(JSON.stringify(value));
  let binary = "";

  for (const byte of bytes) binary += String.fromCharCode(byte);

  return btoa(binary);
};

const push = (data: Schema.Json, type: string, messageId = "message-1") => ({
  message: {
    data: base64(data),
    attributes: { notificationType: type },
    messageId,
  },
  subscription: "projects/compliance-project/subscriptions/mattrax-android",
});

const withDayN = (result: Check, dayN: boolean): Check =>
  dayN ? { ...result, dayN: true } : result;

const check = (
  id: string,
  category: Check["category"],
  name: string,
  description: string,
  run: Check["run"],
  dayN = false,
): Check =>
  withDayN(
    {
      id: `android.${id}`,
      platform: "android",
      category,
      name,
      description,
      run,
    },
    dayN,
  );

const assertResult = (
  result: AndroidPubSubResult,
  status: AndroidPubSubResult["status"],
  type: string,
): void => {
  const { reason, ...rest } = result;

  assert.equal(reason, undefined);
  assert.deepEqual(rest, { status, type });
};

const assertOkResult = (result: AndroidPubSubResult, type: string): void =>
  assertResult(result, "ok", type);

const rejectsKind = async (work: Promise<object>, kind: string): Promise<void> => {
  await assert.rejects(work, (error: { readonly _tag?: string; readonly kind?: string }) => {
    assert.equal(error._tag, "AndroidDeliveryError");
    assert.equal(error.kind, kind);

    return true;
  });
};

export const androidChecks: ReadonlyArray<Check> = [
  check(
    "pubsub.decode",
    "notifications",
    "Pub/Sub push envelope decodes base64 JSON",
    "The push envelope must preserve messageId, subscription and the notificationType attribute.",
    async () => {
      const body = push({ name: deviceName, state: "ACTIVE" }, "ENROLLMENT", "msg-decode");
      const decoded = await Effect.runPromise(decodePubSubPush(body));
      assert.equal(decoded.messageId, "msg-decode");
      assert.equal(
        decoded.subscription,
        "projects/compliance-project/subscriptions/mattrax-android",
      );
      assert.equal(decoded.notificationType, "ENROLLMENT");
      assert.deepEqual(decoded.data, { name: deviceName, state: "ACTIVE" });
    },
  ),
  check(
    "pubsub.invalid-json",
    "errors",
    "Pub/Sub body must be valid JSON",
    "A non-JSON push body must fail decoding before any tenant state is touched.",
    async () => {
      await assert.rejects(Effect.runPromise(decodePubSubPush("{not-json")));
    },
  ),
  check(
    "pubsub.missing-data",
    "errors",
    "Pub/Sub message requires data",
    "A push envelope without message.data cannot represent an event.",
    async () => {
      await assert.rejects(
        Effect.runPromise(decodePubSubPush({ message: { messageId: "m" }, subscription: "s" })),
      );
    },
  ),
  check(
    "pubsub.invalid-base64",
    "errors",
    "Pub/Sub data must be valid base64",
    "Malformed base64 must be rejected without partial processing.",
    async () => {
      await assert.rejects(Effect.runPromise(decodePubSubData("!!!!")));
    },
  ),
  check(
    "pubsub.invalid-json-data",
    "errors",
    "Pub/Sub decoded data must be JSON",
    "A base64 value that does not contain JSON is not a valid Android notification.",
    async () => {
      const data = btoa("not-json");
      await assert.rejects(Effect.runPromise(decodePubSubData(data)));
    },
  ),
  check(
    "pubsub.inline-type",
    "notifications",
    "Inline notificationType is accepted",
    "Older simplified payloads carry notificationType inside data; the decoder must expose it.",
    async () => {
      const body = push({ notificationType: "STATUS_REPORT", state: "ACTIVE" }, "UNUSED");
      const decoded = await Effect.runPromise(decodePubSubPush(body));
      assert.equal(decoded.notificationType, "UNUSED");
      assert.equal(notificationType({ data: decoded.data }), "STATUS_REPORT");
    },
  ),
  check(
    "pubsub.enrollment-state",
    "notifications",
    "Enrollment state is read from the Device resource",
    "Both state and appliedState are accepted for enrollment/status notifications.",
    async () => {
      assert.equal(enrollmentState({ data: { state: "ACTIVE" } }), "ACTIVE");
      assert.equal(enrollmentState({ data: { appliedState: "DELETED" } }), "DELETED");
      assert.equal(enrollmentState({ data: { name: deviceName } }), undefined);
    },
  ),
  check(
    "pubsub.command-status",
    "notifications",
    "Command status maps operation completion and errors",
    "done=true is COMPLETED, an error/metadata error is FAILED, and in-flight work is PENDING.",
    async () => {
      assert.equal(commandStatus({ data: { done: true } }), "COMPLETED");
      assert.equal(commandStatus({ data: { done: false } }), "PENDING");
      assert.equal(commandStatus({ data: { error: { code: 1 } } }), "FAILED");
      assert.equal(commandStatus({ data: { metadata: { errorCode: "COMMAND_ERROR" } } }), "FAILED");
      assert.equal(commandStatus({ data: { name: "operation" } }), undefined);
    },
  ),
  check(
    "oidc.valid",
    "authentication",
    "Pub/Sub OIDC bearer token verifies",
    "A signed token with Google issuer, matching audience, email and expiry must be accepted.",
    async () => {
      const harness = await createAndroidHarness();
      const token = await harness.signToken();
      const claims = await harness.verifyOidc(token);
      assert.equal(claims.issuer, "https://accounts.google.com");
      assert.equal(claims.audience, harness.config.pubsubAudience);
      assert.equal(claims.email, harness.config.serviceAccount.clientEmail);
      assert.equal(claims.emailVerified, true);
    },
  ),
  check(
    "oidc.wrong-audience",
    "errors",
    "Pub/Sub OIDC token audience is enforced",
    "A token minted for another endpoint must not authorise this push subscription.",
    async () => {
      const harness = await createAndroidHarness();
      const token = await harness.signToken({ aud: "https://other.example.test/pubsub" });
      await assert.rejects(harness.verifyOidc(token));
    },
  ),
  check(
    "oidc.expired",
    "errors",
    "Expired Pub/Sub OIDC token is rejected",
    "Expired tokens must fail even when the signature is valid.",
    async () => {
      const harness = await createAndroidHarness();
      const token = await harness.signToken({ exp: Math.floor(Date.now() / 1000) - 3600 });
      await assert.rejects(harness.verifyOidc(token));
    },
  ),
  check(
    "oidc.wrong-service-account",
    "errors",
    "Pub/Sub OIDC token email is enforced",
    "Only the configured Google service account may publish to the push subscription.",
    async () => {
      const harness = await createAndroidHarness();
      const token = await harness.signToken({ email: "attacker@example.test" });
      await assert.rejects(harness.verifyOidc(token));
    },
  ),
  check(
    "policy.merge",
    "policy",
    "Android policies merge deterministically",
    "Scalars win in order, objects merge deeply and arrays de-duplicate by canonical value.",
    async () => {
      const merged = mergeAndroidPolicies([
        {
          cameraDisabled: true,
          applications: [{ packageName: "com.example", installType: "AVAILABLE" }],
          statusReportingSettings: { deviceSettingsEnabled: true },
        },
        {
          cameraDisabled: false,
          applications: [{ installType: "AVAILABLE", packageName: "com.example" }],
          statusReportingSettings: { softwareInfoEnabled: true },
        },
      ]);

      assert.deepEqual(merged, {
        applications: [{ installType: "AVAILABLE", packageName: "com.example" }],
        cameraDisabled: false,
        statusReportingSettings: {
          deviceSettingsEnabled: true,
          softwareInfoEnabled: true,
        },
      });
      assert.deepEqual(Object.keys(merged), [
        "applications",
        "cameraDisabled",
        "statusReportingSettings",
      ]);
    },
  ),
  check(
    "policy.forbidden-name",
    "errors",
    "Android policy cannot smuggle a resource name",
    "name and policyName identify Google resources and must be rejected at the top level.",
    async () => {
      assert.throws(
        () => mergeAndroidPolicies([{ name: "enterprises/LC123/policies/other" }]),
        PolicyMergeError,
      );
      assert.throws(() => mergeAndroidPolicies([{ policyName: "other" }]), PolicyMergeError);
    },
  ),
  check(
    "policy.compile",
    "policy",
    "Android policy compiler filters platform and strips drafts",
    "Only mttx.android.policy.* configurations contribute, and designer draft state is never sent to Google.",
    async () => {
      const policy = compileAndroidPolicy([
        { kind: "mttx.apple.custom.designer", data: { content: "ignored" } },
        {
          kind: "mttx.android.policy.designer",
          data: { policy: { cameraDisabled: true }, draft: { name: "draft" } },
        },
        { kind: "mttx.android.policy.handwritten", data: { screenCaptureDisabled: true } },
      ]);

      assert.deepEqual(policy, { cameraDisabled: true, screenCaptureDisabled: true });
    },
  ),
  check(
    "policy.hash",
    "policy",
    "Policy hash and id are stable across key order",
    "A no-op policy rewrite must not produce a new AMAPI policy id.",
    async () => {
      const first = await compileAndroidPolicyWithHash([
        { kind: "mttx.android.policy.designer", data: { policy: { cameraDisabled: true } } },
      ]);

      const second = await compileAndroidPolicyWithHash([
        {
          kind: "mttx.android.policy.designer",
          data: { policy: { cameraDisabled: true, screenCaptureDisabled: false } },
        },
      ]);

      const reordered = await androidPolicyHash({
        screenCaptureDisabled: false,
        cameraDisabled: true,
      });

      assert.equal(first.hash, await androidPolicyHash({ cameraDisabled: true }));
      assert.equal(
        reordered,
        await androidPolicyHash({ cameraDisabled: true, screenCaptureDisabled: false }),
      );
      assert.notEqual(first.hash, second.hash);
      assert.match(androidPolicyIdForHash(first.hash), /^mattrax-[a-z0-9]{1,24}$/);
      assert.equal(androidPolicyIdForHash(first.hash), androidPolicyIdForHash(first.hash));
    },
  ),
  check(
    "pubsub.enrollment",
    "notifications",
    "ENROLLMENT notification upserts the device",
    "A valid Pub/Sub ENROLLMENT event must authenticate, decode and store the Android device exactly once.",
    async () => {
      const harness = await createAndroidHarness();
      const token = await harness.signToken();

      const body = harness.pushBody(
        {
          name: `${enterpriseName}/devices/device-2`,
          enterpriseName,
          state: "ACTIVE",
          displayName: "Pixel Compliance",
          hardwareInfo: {
            model: "Pixel 9",
            manufacturer: "Google",
            serialNumber: "ANDROID-SERIAL-2",
          },
          softwareInfo: { androidVersion: "15" },
          enrollmentTime: new Date().toISOString(),
          lastStatusReportTime: new Date().toISOString(),
        },
        "ENROLLMENT",
        "message-enrollment-1",
      );

      const result = await harness.handlePubSub({
        body,
        authorization: `Bearer ${token}`,
      });

      assertOkResult(result, "ENROLLMENT");
      assert.ok(
        harness.db.store.device.some(
          (row) => row.dmIdentifier === `${enterpriseName}/devices/device-2`,
        ),
      );
    },
  ),
  check(
    "pubsub.duplicate",
    "notifications",
    "Duplicate Pub/Sub messageId is idempotent",
    "Pub/Sub is at-least-once, so a redelivered message must not apply twice.",
    async () => {
      const harness = await createAndroidHarness();
      const token = await harness.signToken();

      const body = harness.pushBody(
        {
          name: `${enterpriseName}/devices/device-3`,
          enterpriseName,
          state: "ACTIVE",
        },
        "ENROLLMENT",
        "message-duplicate",
      );

      const first = await harness.handlePubSub({
        body,
        authorization: `Bearer ${token}`,
      });

      const second = await harness.handlePubSub({
        body,
        authorization: `Bearer ${token}`,
      });

      assertOkResult(first, "ENROLLMENT");
      assertResult(second, "duplicate", "ENROLLMENT");
      assert.equal(
        harness.db.store.device.filter(
          (row) => row.dmIdentifier === `${enterpriseName}/devices/device-3`,
        ).length,
        1,
      );
    },
  ),
  check(
    "pubsub.command",
    "notifications",
    "COMMAND notification is accepted for a known device",
    "A completed operation for an enrolled device must be applied without touching another device.",
    async () => {
      const harness = await createAndroidHarness();
      const token = await harness.signToken();

      const body = harness.pushBody(
        {
          name: `${enterpriseName}/operations/op-1`,
          done: true,
          metadata: { deviceName },
        },
        "COMMAND",
        "message-command-1",
      );

      const result = await harness.handlePubSub({
        body,
        authorization: `Bearer ${token}`,
      });

      assertOkResult(result, "COMMAND");
      assert.equal(harness.calls.commands.length, 0);
    },
  ),
  check(
    "pubsub.inactive-enterprise",
    "errors",
    "Notifications for an inactive enterprise are ignored",
    "A suspended tenant must not have devices or policies mutated by a stray notification.",
    async () => {
      const harness = await createAndroidHarness();
      harness.db.store.android_enterprise[0].status = "disabled";
      const token = await harness.signToken();

      const body = harness.pushBody(
        { name: `${enterpriseName}/devices/device-1`, enterpriseName, state: "ACTIVE" },
        "ENROLLMENT",
      );

      const result = await harness.handlePubSub({
        body,
        authorization: `Bearer ${token}`,
      });

      assert.deepEqual(result, {
        status: "ignored",
        type: "ENROLLMENT",
        reason: "enterprise is not active",
      });
    },
  ),
  check(
    "pubsub.unknown-enterprise",
    "errors",
    "Notifications for an unknown enterprise are ignored",
    "A notification must never create tenant state from a Google enterprise name.",
    async () => {
      const harness = await createAndroidHarness();
      const token = await harness.signToken();

      const body = harness.pushBody(
        { name: "enterprises/LC999/devices/device-1", enterpriseName: "enterprises/LC999" },
        "ENROLLMENT",
      );

      const result = await harness.handlePubSub({
        body,
        authorization: `Bearer ${token}`,
      });

      assert.equal(result.status, "ignored");
    },
  ),
  check(
    "pubsub.missing-auth",
    "authentication",
    "Pub/Sub without a bearer token is unauthorised",
    "The push endpoint is public and must reject unauthenticated deliveries with 401 semantics.",
    async () => {
      const harness = await createAndroidHarness();
      await rejectsKind(
        harness.handlePubSub({
          body: harness.pushBody({ name: deviceName }, "ENROLLMENT"),
        }),
        "unauthorized",
      );
    },
  ),
  check(
    "signup.callback",
    "enrollment",
    "Android signup completes and rejects replay",
    "A valid signed state must create the Google enterprise once; replaying the consumed state must not create another.",
    async () => {
      const harness = await createAndroidHarness();
      harness.db.store.android_enterprise = [];
      await harness.createSignup({ id: "org-compliance", name: "Compliance Test" });
      assert.equal(harness.calls.signupUrls.length, 1);
      const callback = new URL(harness.calls.signupUrls[0].callbackUrl);
      const state = callback.searchParams.get("state");
      assert.ok(state);
      const completion = new URL(callback.toString());
      completion.searchParams.set("state", state);
      completion.searchParams.set("enterpriseToken", "enterprise-token");
      const response = await harness.routeHandler(new Request(completion));
      assert.equal(response.status, 302);
      assert.match(
        response.headers.get("location") ?? "",
        /\/t\/org-compliance\/settings\/management\?android=connected/,
      );
      assert.equal(harness.calls.enterprises.length, 1);
      const enterprise = harness.db.store.android_enterprise[0];
      assert.equal(enterprise.status, "active");
      assert.equal(enterprise.enterpriseName, enterpriseName);
      const replay = await harness.routeHandler(new Request(completion));
      assert.equal(replay.status, 400);
      assert.equal(harness.calls.enterprises.length, 1);
    },
  ),
  check(
    "route.callback-missing-params",
    "enrollment",
    "Android signup callback requires state and enterpriseToken",
    "A callback missing either query parameter cannot complete signup.",
    async () => {
      const harness = await createAndroidHarness();

      const response = await harness.routeHandler(
        new Request("https://mdm.example.test/api/v1/android/signup/callback"),
      );

      assert.equal(response.status, 400);
    },
  ),
  check(
    "route.callback-invalid-state",
    "enrollment",
    "Android signup callback rejects an unsigned state",
    "The state token binds the callback to the tenant that started signup.",
    async () => {
      const harness = await createAndroidHarness();

      const response = await harness.routeHandler(
        new Request(
          "https://mdm.example.test/api/v1/android/signup/callback?state=tampered&enterpriseToken=token",
        ),
      );

      assert.equal(response.status, 400);
    },
  ),
  check(
    "route.pubsub-missing-auth",
    "authentication",
    "Android Pub/Sub route maps missing auth to 401",
    "The route must expose the delivery error kind as an HTTP status.",
    async () => {
      const harness = await createAndroidHarness();

      const response = await harness.routeHandler(
        new Request("https://mdm.example.test/api/v1/android/pubsub", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(harness.pushBody({ name: deviceName }, "ENROLLMENT")),
        }),
      );

      assert.equal(response.status, 401);
    },
  ),
  check(
    "pubsub.malformed-payload",
    "errors",
    "Malformed Pub/Sub payload is a 400-class delivery error",
    "After authentication, invalid base64 data must be rejected without mutating tenant state.",
    async () => {
      const harness = await createAndroidHarness();
      const token = await harness.signToken();
      await rejectsKind(
        harness.handlePubSub({
          body: {
            message: {
              data: "!!!!",
              messageId: "message-malformed",
              attributes: { notificationType: "ENROLLMENT" },
            },
            subscription: "projects/compliance-project/subscriptions/mattrax-android",
          },
          authorization: `Bearer ${token}`,
        }),
        "invalid_payload",
      );
      assert.equal(harness.db.store.device.length, 0);
    },
  ),
  check(
    "day-n.deleted-device",
    "day-n",
    "DELETED notification moves the device out of management",
    "A terminal DELETED state must not leave the device eligible for policy or commands.",
    async () => {
      const harness = await createAndroidHarness();
      harness.db.store.device.push({
        id: "device-1",
        organizationId: "org-compliance",
        proto: "android",
        status: "enrolled",
        dmIdentifier: `${enterpriseName}/devices/device-1`,
        name: "Pixel",
        vendor: "Google",
        enrolledAt: new Date(),
        lastSeenAt: new Date(),
      });
      const token = await harness.signToken();

      const result = await harness.handlePubSub({
        body: harness.pushBody(
          {
            name: `${enterpriseName}/devices/device-1`,
            enterpriseName,
            state: "DELETED",
          },
          "ENROLLMENT",
          "message-deleted",
        ),
        authorization: `Bearer ${token}`,
      });

      assertOkResult(result, "ENROLLMENT");
      assert.equal(harness.db.store.device[0]?.status, "unenrolled");
      assert.equal(harness.db.store.android_device[0]?.state, "DELETED");
    },
    true,
  ),
  check(
    "day-n.policy-change",
    "day-n",
    "A policy change produces a new hash and policy id",
    "Day-N policy edits must re-sync only when the compiled policy actually changes.",
    async () => {
      const before = await compileAndroidPolicyWithHash([
        { kind: "mttx.android.policy.designer", data: { policy: { cameraDisabled: true } } },
      ]);

      const after = await compileAndroidPolicyWithHash([
        { kind: "mttx.android.policy.designer", data: { policy: { cameraDisabled: false } } },
      ]);

      assert.notEqual(before.hash, after.hash);
      assert.notEqual(androidPolicyIdForHash(before.hash), androidPolicyIdForHash(after.hash));
      assert.equal(
        before.hash,
        await androidPolicyHash(
          compileAndroidPolicy([
            { kind: "mttx.android.policy.designer", data: { policy: { cameraDisabled: true } } },
          ]),
        ),
      );
    },
    true,
  ),
];
