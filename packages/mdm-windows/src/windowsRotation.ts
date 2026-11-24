import {
  windowsBitlockerRotateStatusGet,
  windowsLapsResetStatusGet,
  windowsRotationPollDecision,
} from "@mattrax/enterprise-domain";
import type { Schema } from "effect";

export type WindowsRotationCommandRow = {
  readonly requestType: string;
  readonly status: string;
  readonly payload: Schema.Json | null;
  readonly resultDetail: string | null;
  readonly createdAt: Date;
  readonly updatedAt: Date;
  readonly expiresAt: Date | null;
};

export type WindowsRotationPollPlan = {
  readonly requestType: "WindowsBitLockerRotateStatus" | "WindowsLapsResetPasswordStatus";
  readonly payload: {
    readonly kind: "Get";
    readonly locURI: string;
    readonly format: string;
    readonly requestId?: string;
  };
  readonly expiresAt: Date;
};

const ROTATION_PAIRS = [
  ["WindowsBitLockerRotate", "WindowsBitLockerRotateStatus"],
  ["WindowsLapsResetPassword", "WindowsLapsResetPasswordStatus"],
] as const;

const payloadString = (payload: Schema.Json | null, key: string): string | undefined => {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) return undefined;
  const value = (payload as { readonly [key: string]: Schema.Json })[key];

  return typeof value === "string" ? value : undefined;
};

/**
 * Decide whether a Windows check-in must queue a rotation-status `Get`.
 *
 * Mattrax does not also read `Status/RotateRecoveryPasswordsRequestID`: the
 * action rejects a second rotation while either the Exec or this status row is
 * active, so at most one Mattrax rotation can be in flight and the status node
 * necessarily belongs to it. A rotation started outside Mattrax is not
 * reconciled through this queue.
 *
 * Kept pure so the check-in planner is exercised without a database: the
 * caller inserts the returned command, which the same check-in then delivers.
 * An accepted/queued Exec is polled just like a succeeded one; BitLocker's
 * 1/2 and LAPS E_PENDING are non-terminal, while LAPS E_FAIL stops the poll.
 */
export const planWindowsRotationPoll = (input: {
  readonly rows: ReadonlyArray<WindowsRotationCommandRow>;
  readonly now: Date;
}): WindowsRotationPollPlan | null => {
  const activeStatus = input.rows.some(
    (row) =>
      (row.requestType === "WindowsBitLockerRotateStatus" ||
        row.requestType === "WindowsLapsResetPasswordStatus") &&
      ["queued", "sent", "accepted", "deferred"].includes(row.status) &&
      (row.expiresAt === null || row.expiresAt.getTime() > input.now.getTime()),
  );

  if (activeStatus) return null;

  for (const [execType, statusType] of ROTATION_PAIRS) {
    const exec = input.rows.find((row) => row.requestType === execType);

    if (!exec) continue;

    const status = input.rows.find(
      (row) =>
        row.requestType === statusType &&
        row.createdAt.getTime() >= exec.createdAt.getTime(),
    );
    const decision = windowsRotationPollDecision({
      kind: statusType === "WindowsBitLockerRotateStatus" ? "bitlocker" : "laps",
      execStatus: exec.status,
      latestStatusDetail: status?.resultDetail ?? null,
      now: input.now,
      execUpdatedAt: exec.updatedAt,
    });

    if (decision === "stop") continue;

    const requestId = payloadString(exec.payload, "requestId");
    const command =
      statusType === "WindowsBitLockerRotateStatus"
        ? windowsBitlockerRotateStatusGet()
        : windowsLapsResetStatusGet();

    return {
      requestType: statusType,
      payload: {
        kind: "Get",
        locURI: command.locURI,
        format: command.format,
        ...(requestId ? { requestId } : {}),
      },
      expiresAt: new Date(exec.updatedAt.getTime() + 24 * 60 * 60 * 1000),
    };
  }

  return null;
};
