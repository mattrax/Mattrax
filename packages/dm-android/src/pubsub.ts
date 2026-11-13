import { Data, Effect, Schema } from "effect";
import { PubSubPushEnvelope } from "./schema.js";

/**
 * Published by Android Device Policy in the `notificationType` Pub/Sub message
 * attribute. `USAGE_LOGS` may also appear as `usageLogEvents`.
 */
export const NOTIFICATION_TYPES = [
  "ENROLLMENT",
  "STATUS_REPORT",
  "COMMAND",
  "USAGE_LOGS",
  "ENTERPRISE_UPGRADE",
] as const;

export type NotificationType = (typeof NOTIFICATION_TYPES)[number];

/** Device states carried by `ENROLLMENT` / `STATUS_REPORT` notifications. */
export const ENROLLMENT_STATES = [
  "PROVISIONING",
  "ACTIVE",
  "DISABLED",
  "DELETED",
  "LOST",
  "PRE_PROVISIONING",
] as const;

export type EnrollmentState = (typeof ENROLLMENT_STATES)[number];

/** Values seen on `commandStatus` in command notifications. */
export const COMMAND_STATUSES = [
  "COMMAND_STATUS_UNSPECIFIED",
  "PENDING",
  "COMPLETED",
  "FAILED",
  "CANCELLED",
] as const;

export type CommandStatus = (typeof COMMAND_STATUSES)[number];

/** Attribute key Google uses to label the notification type. */
export const NOTIFICATION_TYPE_ATTRIBUTE = "notificationType";

export class PubSubDecodeError extends Data.TaggedError("PubSubDecodeError")<{
  message: string;
  cause?: unknown;
}> {}

/**
 * A decoded Pub/Sub push delivery.
 *
 * `data` is the JSON resource Google sent (Device for `ENROLLMENT` /
 * `STATUS_REPORT`, Operation for `COMMAND`, UsageLogEvent for `USAGE_LOGS`, …).
 */
export type DecodedPubSubPush = {
  readonly notificationType: string | undefined;
  readonly data: unknown;
  readonly messageId: string;
  readonly subscription: string;
  readonly attributes: Readonly<Record<string, string>>;
};

/** Anything carrying the notification fields the helpers read. */
export type NotificationLike = {
  readonly notificationType?: string | undefined;
  readonly attributes?: Readonly<Record<string, string>> | undefined;
  readonly data?: unknown;
};

function decodeBase64Utf8(data: string): string {
  const normalized = data.replace(/\s/g, "").replace(/-/g, "+").replace(/_/g, "/");
  const padded = normalized.padEnd(normalized.length + ((4 - (normalized.length % 4)) % 4), "=");
  const binary = atob(padded);
  const bytes = new Uint8Array(binary.length);

  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);

  return new TextDecoder().decode(bytes);
}

function parsePushBody(input: unknown): Effect.Effect<PubSubPushEnvelope, PubSubDecodeError> {
  const json =
    typeof input === "string"
      ? Effect.try({
          try: () => JSON.parse(input) as unknown,
          catch: (cause) =>
            new PubSubDecodeError({ message: "Push body is not valid JSON", cause }),
        })
      : Effect.succeed(input);

  return json.pipe(
    Effect.flatMap((value) =>
      (
        Schema.decodeUnknownEffect(PubSubPushEnvelope)(value) as Effect.Effect<
          PubSubPushEnvelope,
          unknown
        >
      ).pipe(
        Effect.mapError(
          (cause) => new PubSubDecodeError({ message: "Invalid Pub/Sub push envelope", cause }),
        ),
      ),
    ),
  );
}

/** Decode the base64 `message.data` field into parsed JSON. */
export function decodePubSubData(data: string): Effect.Effect<unknown, PubSubDecodeError> {
  return Effect.gen(function* () {
    const json = yield* Effect.try({
      try: () => decodeBase64Utf8(data),
      catch: (cause) =>
        new PubSubDecodeError({ message: "Pub/Sub message data is not valid base64", cause }),
    });

    return yield* Effect.try({
      try: () => JSON.parse(json) as unknown,
      catch: (cause) =>
        new PubSubDecodeError({ message: "Pub/Sub message data is not valid JSON", cause }),
    });
  });
}

/**
 * Decode a Pub/Sub push request body.
 *
 * Accepts either a raw JSON string or an already-parsed object. The
 * notification type is read from the `notificationType` message attribute
 * (Google's current format) and also exposed from `data.notificationType` when
 * present (older/simplified payloads).
 */
export function decodePubSubPush(
  input: unknown,
): Effect.Effect<DecodedPubSubPush, PubSubDecodeError> {
  return Effect.gen(function* () {
    const envelope = yield* parsePushBody(input);

    if (envelope.message.data === undefined) {
      return yield* Effect.fail(
        new PubSubDecodeError({ message: "Pub/Sub message has no data field" }),
      );
    }

    const data = yield* decodePubSubData(envelope.message.data);
    const attributes = envelope.message.attributes ?? {};

    const dataRecord =
      typeof data === "object" && data !== null && !Array.isArray(data)
        ? (data as Record<string, unknown>)
        : undefined;

    const inlineType = dataRecord?.["notificationType"];

    return {
      notificationType:
        attributes[NOTIFICATION_TYPE_ATTRIBUTE] ??
        (typeof inlineType === "string" ? inlineType : undefined),
      data,
      messageId: envelope.message.messageId,
      subscription: envelope.subscription,
      attributes,
    } satisfies DecodedPubSubPush;
  });
}

/** Decode a Pub/Sub push body and return only the JSON resource payload. */
export function decodePubSubNotification(
  input: unknown,
): Effect.Effect<unknown, PubSubDecodeError> {
  return decodePubSubPush(input).pipe(Effect.map((push) => push.data));
}

function readString(source: unknown, key: string): string | undefined {
  if (typeof source !== "object" || source === null) return undefined;
  const value = (source as Record<string, unknown>)[key];

  return typeof value === "string" ? value : undefined;
}

/** Notification type, from the push attributes or an inline field. */
export function notificationType(notification: NotificationLike): string | undefined {
  return (
    notification.notificationType ??
    notification.attributes?.[NOTIFICATION_TYPE_ATTRIBUTE] ??
    readString(notification.data, NOTIFICATION_TYPE_ATTRIBUTE)
  );
}

/**
 * Enrollment state for `ENROLLMENT` notifications.
 *
 * Google currently sends a Device resource in `data`, so this also checks the
 * resource for an `enrollmentState` field. Returns `undefined` for other
 * notification types.
 */
export function enrollmentState(notification: NotificationLike): string | undefined {
  return readString(notification.data, "state") ?? readString(notification.data, "appliedState");
}

/**
 * Command status for `COMMAND` notifications.
 *
 * Returns `undefined` for other notification types or when Google sent an
 * Operation without a `commandStatus` field.
 */
export function commandStatus(notification: NotificationLike): string | undefined {
  if (typeof notification.data !== "object" || notification.data === null) return undefined;
  const operation = notification.data as Record<string, unknown>;

  const metadata =
    typeof operation.metadata === "object" && operation.metadata !== null
      ? (operation.metadata as Record<string, unknown>)
      : undefined;

  if (metadata && typeof metadata.errorCode === "string") return "FAILED";

  if (operation.error !== undefined) return "FAILED";

  if (typeof operation.done === "boolean") return operation.done ? "COMPLETED" : "PENDING";

  return undefined;
}
