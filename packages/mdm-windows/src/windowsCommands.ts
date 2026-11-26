import { Option, Schema } from "effect";

/**
 * Stable request types for Windows SyncML commands. They are also the keys
 * used to keep policy and inventory rows out of the imperative-command
 * delivery planner.
 */
export const WINDOWS_POLICY_REPLACE_REQUEST_TYPE = "WindowsPolicyReplace";

export const WINDOWS_POLICY_DELETE_REQUEST_TYPE = "WindowsPolicyDelete";

export const WINDOWS_INVENTORY_GET_REQUEST_TYPE = "WindowsInventoryGet";

export const WINDOWS_APPLICATION_INVENTORY_GET_REQUEST_TYPE = "WindowsApplicationInventoryGet";

export const WINDOWS_UNENROLL_REQUEST_TYPE = "WindowsUnenroll";

/** Request types whose delivery is generated from device state, not a queue. */
export const WINDOWS_STATE_COMMAND_REQUEST_TYPES: ReadonlySet<string> = new Set([
  WINDOWS_POLICY_REPLACE_REQUEST_TYPE,
  WINDOWS_POLICY_DELETE_REQUEST_TYPE,
  WINDOWS_INVENTORY_GET_REQUEST_TYPE,
  WINDOWS_APPLICATION_INVENTORY_GET_REQUEST_TYPE,
]);

/**
 * How long a rejected OMA-URI is left visible before it is retried. Without a
 * delay a permanent rejection would be re-sent on every SyncML poll and the
 * failure would never be readable on the device.
 */
export const WINDOWS_POLICY_RETRY_MS = 30 * 60 * 1000;

/** OMA-DM "Generic Alert" a Windows client sends when it leaves management. */
export const WINDOWS_UNENROLL_ALERT = "1226";

const encoder = new TextEncoder();

const hex = (bytes: Uint8Array) =>
  Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");

const sha256 = async (value: string): Promise<string> =>
  hex(new Uint8Array(await crypto.subtle.digest("SHA-256", encoder.encode(value))));

/**
 * Command id for one OMA-URI on one device. It is stable across check-ins (so
 * a status can always be matched to its row) and globally unique (it is the
 * `device_command` primary key and the SyncML `CmdID`).
 */
export const windowsPolicyCommandId = (
  deviceId: string,
  operation: "replace" | "delete",
  uri: string,
): Promise<string> =>
  sha256(`${deviceId}\u0000${operation}\u0000${uri}`).then(
    (digest) => `winp-${operation[0]}-${digest.slice(0, 32)}`,
  );

/**
 * `device_command` row id for an inventory `Get`. The SyncML `CmdID` stays the
 * human-readable request id (`windows-inventory-os-version`) so the results
 * parser can keep correlating `CmdRef` -> OMA-URI.
 */
export const windowsInventoryCommandRowId = (deviceId: string, cmdID: string): Promise<string> =>
  sha256(`${deviceId}\u0000inventory\u0000${cmdID}`).then(
    (digest) => `winv-${digest.slice(0, 32)}`,
  );

/** Hash of the value and format delivered for an OMA-URI. */
export const windowsPolicyNodeHash = (data: string, format: string | undefined): Promise<string> =>
  sha256(`${format ?? ""}\u0000${data}`);

/**
 * `DM_S_ACCEPTED_FOR_PROCESSING` is documented as 0x4000000. The asynchronous
 * BitLocker and LAPS rotation Execs treat it as an acknowledgement because both
 * have a status node; other commands keep the normal SyncML status handling.
 *
 * OMA-DM `Status` values are SyncML codes, not HTTP codes: `202 Accepted` is
 * not a rotation acknowledgement and remains a failure. The pre-existing
 * `418` handling is unchanged and still marks a command queued for delivery.
 */
export const WINDOWS_ACCEPTED_FOR_PROCESSING_STATUS = "0x4000000";

export type WindowsCommandOutcome = {
  readonly status: "succeeded" | "queued" | "accepted" | "failed";
  readonly resultStatus: string;
};

/**
 * Map a SyncML status code onto the shared command lifecycle. `200` is the
 * only success; `418` means the client queued the work and will report again.
 * Everything else is a rejection unless the caller explicitly accepts
 * `DM_S_ACCEPTED_FOR_PROCESSING` for an asynchronous command.
 */
export const windowsCommandOutcome = (
  data: string,
  options: { readonly acceptedForProcessing?: boolean } = {},
): WindowsCommandOutcome => {
  const resultStatus = data.trim() || "unknown";

  if (resultStatus === "200") return { status: "succeeded", resultStatus };

  if (resultStatus === "418") return { status: "queued", resultStatus };

  if (
    options.acceptedForProcessing === true &&
    (resultStatus.toLowerCase() === WINDOWS_ACCEPTED_FOR_PROCESSING_STATUS ||
      resultStatus === String(0x4000000))
  )
    return { status: "accepted", resultStatus };

  return { status: "failed", resultStatus };
};

export const windowsPolicyRejectionDetail = (uri: string, resultStatus: string): string =>
  `OMA-URI ${uri} was rejected by the device with SyncML status ${resultStatus}.`;

export type WindowsPolicyFailure = {
  readonly uri: string;
  readonly hash: string;
  readonly resultStatus: string;
  readonly detail: string;
  /** ISO timestamp. */
  readonly at: string;
};

export type WindowsDeliveredPolicyNode = {
  readonly uri: string;
  readonly hash: string;
};

export type WindowsPolicyPlan = {
  /** Desired nodes that must be sent with `Replace`. */
  readonly replace: ReadonlyArray<{ readonly uri: string; readonly hash: string }>;
  /** Previously delivered nodes that are no longer desired; send `Delete`. */
  readonly remove: ReadonlyArray<string>;
};

/**
 * Diff the currently delivered Windows policy against the resolved policy.
 *
 * A node is re-sent when its value changed, when it was never acknowledged, or
 * when an earlier attempt was rejected outside the retry window. A node that
 * is no longer in any policy is deleted even if its `Replace` was never
 * acknowledged, because the device may have applied it before the status was
 * lost.
 */
export const planWindowsPolicyDelivery = (input: {
  readonly desired: ReadonlyMap<string, WindowsDeliveredPolicyNode>;
  readonly delivered: ReadonlyArray<WindowsDeliveredPolicyNode>;
  readonly applied: ReadonlyArray<string>;
  readonly failures: ReadonlyArray<WindowsPolicyFailure>;
  readonly now: Date;
}): WindowsPolicyPlan => {
  const delivered = new Map(input.delivered.map((node) => [node.uri, node.hash]));
  const applied = new Set(input.applied);
  const failures = new Map(input.failures.map((failure) => [failure.uri, failure]));
  const replace: Array<{ uri: string; hash: string }> = [];

  for (const [uri, node] of input.desired) {
    const failure = failures.get(uri);

    const failedRecently =
      failure?.hash === node.hash &&
      Number.isFinite(Date.parse(failure.at)) &&
      input.now.getTime() - Date.parse(failure.at) < WINDOWS_POLICY_RETRY_MS;

    // Keep a rejection visible instead of overwriting it on every poll.
    if (failedRecently) continue;

    // An acknowledged node with an unchanged value needs no further work.
    if (applied.has(uri) && delivered.get(uri) === node.hash) continue;

    replace.push({ uri, hash: node.hash });
  }

  const remove = [...delivered.keys()].filter((uri) => !input.desired.has(uri));

  return { replace, remove };
};

/** Read the value a Windows SyncML command or alert carries. */
export const windowsSyncMLData = (value: Schema.Json | undefined): string | undefined => {
  if (Schema.is(Schema.String)(value)) return value;

  if (Schema.is(Schema.Number)(value) && Number.isFinite(value)) return String(value);

  return undefined;
};

/** A `<Source><LocURI>` or `<Target><LocURI>` from an alert item, if any. */
export const windowsSyncMLLocURI = (value: Schema.Json): string | undefined => {
  const parsed = Schema.decodeUnknownOption(
    Schema.Struct({
      source: Schema.optional(Schema.Struct({ locURI: Schema.optional(Schema.Json) })),
      target: Schema.optional(Schema.Struct({ locURI: Schema.optional(Schema.Json) })),
    }),
  )(value);

  if (Option.isNone(parsed)) return undefined;
  const source = parsed.value.source?.locURI;
  const target = parsed.value.target?.locURI;

  if (Schema.is(Schema.String)(source) && source.trim()) return source.trim();

  if (Schema.is(Schema.String)(target) && target.trim()) return target.trim();

  return undefined;
};
