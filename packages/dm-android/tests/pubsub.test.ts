import { describe, expect, it } from "vitest";
import type { Schema } from "effect";
import { Effect } from "effect";
import {
  PubSubDecodeError,
  decodePubSubData,
  decodePubSubNotification,
  decodePubSubPush,
  commandStatus,
  enrollmentState,
  notificationType,
} from "../src/index.js";

function base64Json(value: Schema.Json): string {
  const bytes = new TextEncoder().encode(JSON.stringify(value));
  let binary = "";

  for (const byte of bytes) binary += String.fromCharCode(byte);

  return btoa(binary);
}

function pushOf(data: Schema.Json, attributes: Record<string, string> = {}) {
  return {
    message: {
      data: base64Json(data),
      attributes,
      messageId: "message-1",
      publishTime: "2026-11-10T00:00:00Z",
    },
    subscription: "projects/test-project/subscriptions/android",
  };
}

const device = {
  name: "enterprises/LC123/devices/device-1",
  state: "ACTIVE",
};

describe("decodePubSubPush", () => {
  it("decodes the current Google format (type in attributes, resource in data)", async () => {
    const push = await Effect.runPromise(
      decodePubSubPush(pushOf(device, { notificationType: "ENROLLMENT" })),
    );

    expect(push.notificationType).toBe("ENROLLMENT");
    expect(push.messageId).toBe("message-1");
    expect(push.subscription).toBe("projects/test-project/subscriptions/android");
    expect(push.attributes).toEqual({ notificationType: "ENROLLMENT" });
    expect(push.data).toEqual(device);
    expect(notificationType(push)).toBe("ENROLLMENT");
    expect(enrollmentState(push)).toBe("ACTIVE");
    expect(commandStatus(push)).toBeUndefined();
  });

  it("reads command status from an Operation payload", async () => {
    const push = await Effect.runPromise(
      decodePubSubPush(
        pushOf(
          {
            name: "enterprises/LC123/devices/device-1/operations/op-1",
            done: true,
          },
          { notificationType: "COMMAND" },
        ),
      ),
    );

    expect(notificationType(push)).toBe("COMMAND");
    expect(commandStatus(push)).toBe("COMPLETED");
    expect(enrollmentState(push)).toBeUndefined();
  });

  it("supports older payloads with the type inline in data", async () => {
    const push = await Effect.runPromise(
      decodePubSubPush(
        pushOf({
          notificationType: "ENROLLMENT",
          state: "PROVISIONING",
          deviceName: "enterprises/LC123/devices/device-1",
        }),
      ),
    );

    expect(push.notificationType).toBe("ENROLLMENT");
    expect(notificationType(push)).toBe("ENROLLMENT");
    expect(enrollmentState(push)).toBe("PROVISIONING");
  });

  it("accepts a raw JSON string body", async () => {
    const push = await Effect.runPromise(
      decodePubSubPush(JSON.stringify(pushOf(device, { notificationType: "STATUS_REPORT" }))),
    );

    expect(push.notificationType).toBe("STATUS_REPORT");
    expect(push.data).toEqual(device);
  });

  it("rejects a message without data", async () => {
    const error = await Effect.runPromise(
      Effect.flip(
        decodePubSubPush({
          message: { messageId: "message-1" },
          subscription: "projects/test-project/subscriptions/android",
        }),
      ),
    );

    expect(error).toBeInstanceOf(PubSubDecodeError);
    expect(error.message).toContain("no data");
  });

  it("rejects an invalid envelope", async () => {
    const error = await Effect.runPromise(Effect.flip(decodePubSubPush({ message: {} })));
    expect(error).toBeInstanceOf(PubSubDecodeError);
    expect(error.message).toContain("envelope");
  });

  it("rejects invalid base64 data", async () => {
    const error = await Effect.runPromise(
      Effect.flip(
        decodePubSubPush({
          message: { data: "!!!not-base64!!!", messageId: "message-1" },
          subscription: "projects/test-project/subscriptions/android",
        }),
      ),
    );

    expect(error).toBeInstanceOf(PubSubDecodeError);
    expect(error.message).toContain("base64");
  });

  it("rejects data that is not valid JSON", async () => {
    const data = btoa("not json");
    const error = await Effect.runPromise(Effect.flip(decodePubSubData(data)));
    expect(error).toBeInstanceOf(PubSubDecodeError);
    expect(error.message).toContain("JSON");
  });

  it("decodes data to arbitrary JSON and returns it from decodePubSubNotification", async () => {
    await expect(Effect.runPromise(decodePubSubData(base64Json(device)))).resolves.toEqual(device);

    await expect(
      Effect.runPromise(
        decodePubSubNotification(pushOf(device, { notificationType: "ENROLLMENT" })),
      ),
    ).resolves.toEqual(device);
  });
});
