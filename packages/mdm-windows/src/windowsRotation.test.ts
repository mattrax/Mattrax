import { describe, expect, it } from "vitest";
import { planWindowsRotationPoll } from "./windowsRotation.ts";
import { windowsCommandOutcome } from "./windowsCommands.ts";
import { planCommandDeliveryBatch } from "@mattrax/mdm-core";
import type { WindowsRotationCommandRow } from "./windowsRotation.ts";

const now = new Date("2026-11-24T10:00:00Z");

const row = (
  overrides: Partial<WindowsRotationCommandRow> & Pick<WindowsRotationCommandRow, "requestType" | "status">,
): WindowsRotationCommandRow => ({
  payload: null,
  resultDetail: null,
  createdAt: new Date("2026-11-24T09:00:00Z"),
  updatedAt: new Date("2026-11-24T09:00:00Z"),
  expiresAt: new Date("2026-11-25T09:00:00Z"),
  ...overrides,
});

describe("Windows check-in rotation polling", () => {
  it("queues the first status Get after an accepted BitLocker Exec", () => {
    const plan = planWindowsRotationPoll({
      rows: [
        row({
          requestType: "WindowsBitLockerRotate",
          status: "accepted",
          resultDetail: null,
          payload: { requestId: "request-1" },
        }),
      ],
      now,
    });

    expect(plan).toMatchObject({
      requestType: "WindowsBitLockerRotateStatus",
      payload: {
        kind: "Get",
        locURI: "./Device/Vendor/MSFT/BitLocker/Status/RotateRecoveryPasswordsStatus",
        requestId: "request-1",
      },
    });
  });

  it("does not poll a server-queued or merely sent Exec with no device result", () => {
    for (const status of ["queued", "sent"])
      expect(
        planWindowsRotationPoll({
          rows: [row({ requestType: "WindowsBitLockerRotate", status })],
          now,
        }),
      ).toBeNull();
  });

  it("re-queues while BitLocker reports Pending or NotStarted", () => {
    for (const status of ["1", "2"]) {
      const plan = planWindowsRotationPoll({
        rows: [
          row({ requestType: "WindowsBitLockerRotate", status: "succeeded" }),
          row({
            requestType: "WindowsBitLockerRotateStatus",
            status: "succeeded",
            resultDetail: "Status " + status,
            createdAt: new Date("2026-11-24T09:10:00Z"),
          }),
        ],
        now,
      });

      expect(plan?.requestType).toBe("WindowsBitLockerRotateStatus");
    }
  });

  it("stops on a terminal BitLocker result and does not re-poll", () => {
    expect(
      planWindowsRotationPoll({
        rows: [
          row({ requestType: "WindowsBitLockerRotate", status: "succeeded" }),
          row({
            requestType: "WindowsBitLockerRotateStatus",
            status: "succeeded",
            resultDetail: "Status 0",
            createdAt: new Date("2026-11-24T09:10:00Z"),
          }),
        ],
        now,
      }),
    ).toBeNull();
  });

  it("polls LAPS E_PENDING but not E_FAIL", () => {
    const exec = row({ requestType: "WindowsLapsResetPassword", status: "succeeded" });
    const status = (value: string) =>
      row({
        requestType: "WindowsLapsResetPasswordStatus",
        status: "succeeded",
        resultDetail: "Status " + value,
        createdAt: new Date("2026-11-24T09:10:00Z"),
      });

    expect(
      planWindowsRotationPoll({ rows: [exec, status("0x8000000A")], now })?.requestType,
    ).toBe("WindowsLapsResetPasswordStatus");

    expect(planWindowsRotationPoll({ rows: [exec, status("2147483648")], now })).toBeNull();
  });

  it("ignores an expired status row and does not queue while one is in flight", () => {
    expect(
      planWindowsRotationPoll({
        rows: [
          row({ requestType: "WindowsBitLockerRotate", status: "succeeded" }),
          row({
            requestType: "WindowsBitLockerRotateStatus",
            status: "sent",
            createdAt: new Date("2026-11-24T09:10:00Z"),
            expiresAt: new Date("2026-11-24T09:30:00Z"),
          }),
        ],
        now,
      })?.requestType,
    ).toBe("WindowsBitLockerRotateStatus");

    expect(
      planWindowsRotationPoll({
        rows: [
          row({ requestType: "WindowsBitLockerRotate", status: "succeeded" }),
          row({
            requestType: "WindowsBitLockerRotateStatus",
            status: "sent",
            createdAt: new Date("2026-11-24T09:10:00Z"),
          }),
        ],
        now,
      }),
    ).toBeNull();

    expect(
      planWindowsRotationPoll({
        rows: [row({ requestType: "WindowsBitLockerRotate", status: "succeeded" })],
        now: new Date("2026-11-26T10:00:00Z"),
      }),
    ).toBeNull();
  });
});

describe("Windows command delivery lifecycle", () => {
  const lifecycle = (status: string) => ({
    id: "command-1",
    requestType: "WindowsBitLockerRotate",
    status,
    createdAt: new Date("2026-11-24T08:00:00Z"),
    updatedAt: new Date("2026-11-24T09:00:00Z"),
    expiresAt: new Date("2026-11-25T09:00:00Z"),
  });

  it("never re-delivers a device-accepted async command", () => {
    expect(planCommandDeliveryBatch([lifecycle("accepted")], now).deliver).toEqual([]);
    expect(planCommandDeliveryBatch([lifecycle("accepted")], now).requeue).toEqual([]);

    // A normal command whose accepted alias was rejected is terminal and is
    // not delivered again.
    expect(planCommandDeliveryBatch([lifecycle("failed")], now).deliver).toEqual([]);
  });
});

describe("Windows command status parsing", () => {
  it("accepts DM_S_ACCEPTED_FOR_PROCESSING only when the rotation Exec opts in", () => {
    expect(windowsCommandOutcome("0x4000000", { acceptedForProcessing: true })).toEqual({
      status: "accepted",
      resultStatus: "0x4000000",
    });
    expect(windowsCommandOutcome("67108864", { acceptedForProcessing: true })).toEqual({
      status: "accepted",
      resultStatus: "67108864",
    });

    // Unsupported aliases are not invented.
    for (const status of ["0x400000", "4194304", "202", "accepted"])
      expect(windowsCommandOutcome(status, { acceptedForProcessing: true })).toEqual({
        status: "failed",
        resultStatus: status,
      });

    // Non-rotation commands use the ordinary SyncML mapping.
    expect(windowsCommandOutcome("0x4000000")).toEqual({
      status: "failed",
      resultStatus: "0x4000000",
    });
    expect(windowsCommandOutcome("418")).toEqual({ status: "queued", resultStatus: "418" });
    expect(windowsCommandOutcome("500")).toEqual({ status: "failed", resultStatus: "500" });
  });
});
