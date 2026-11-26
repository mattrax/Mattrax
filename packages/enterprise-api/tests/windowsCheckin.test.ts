import { describe, expect, it } from "vitest";
import {
  createWindowsBackend,
  createWindowsTenantToken,
} from "@mattrax/mdm-windows";
import { makeDb, runEffect } from "./helpers.js";

const origin = "https://enterprise.test";
const authSecret = "windows-checkin-test-secret";
const organizationId = "org-1";

const seedDevice = (db: ReturnType<typeof makeDb>) => {
  const at = new Date();

  db.store.device.push({
    id: "win-1",
    organizationId,
    proto: "win",
    status: "enrolled",
    name: "WIN-1",
    dmIdentifier: "device-1",
    serial: "SERIAL-1",
    osEdition: "Windows 11 Enterprise",
    osVersion: "10.0.22631",
    osBuild: "22631.3155",
    enrolledAt: at,
    lastSeenAt: at,
    inventoryUpdatedAt: at,
    capabilities: null,
    model: "Surface",
    bitLockerEnabled: true,
    bitLockerStatus: 0,
    entraDeviceId: "entra-device",
  });
};

const makeCheckin = async () => {
  const db = makeDb();
  seedDevice(db);

  const backend = createWindowsBackend({
    db: db as never,
    origin,
    authSecret,
  });
  const tenantToken = await createWindowsTenantToken(organizationId, authSecret);

  const checkin = (
    statuses: ReadonlyArray<{ cmdRef: string; data: string }> = [],
    results: ReadonlyArray<unknown> = [],
  ) =>
    runEffect(
      backend.windowsManagementCheckin(
        {
          deviceId: "device-1",
          tenantToken,
          mdmOrigin: { url: origin },
        } as never,
        {
          sessionID: "session-1",
          msgID: "1",
          source: "device-1",
          target: origin,
          statuses: [...statuses],
          alerts: [],
          results: [...results],
        },
      ),
    );

  return { db, backend, checkin };
};

describe("Windows rotation check-in lifecycle", () => {
  it("does not put a first status Get in the same response as the Exec", async () => {
    const { db, checkin } = await makeCheckin();
    const at = new Date();

    db.store.device_command.push({
      id: "exec-1",
      organizationId,
      deviceId: "win-1",
      requestType: "WindowsBitLockerRotate",
      payload: { kind: "Exec", locURI: "./Device/Vendor/MSFT/BitLocker/RotateRecoveryPasswords", requestId: "request-1" },
      status: "queued",
      dedupeKey: null,
      expiresAt: new Date(at.getTime() + 24 * 60 * 60 * 1000),
      resultStatus: null,
      resultDetail: null,
      createdAt: at,
      updatedAt: at,
    });

    const response = await checkin();

    expect(response.commands.map((command) => command.cmdID)).toContain("exec-1");
    expect(response.commands.some((command) => command.cmdID !== "exec-1" && command.locURI?.includes("RotateRecoveryPasswordsStatus"))).toBe(false);
    expect(
      db.store.device_command.filter(
        (row: any) => row.requestType === "WindowsBitLockerRotateStatus",
      ),
    ).toHaveLength(0);
  });

  it("queues a status Get after an accepted Exec and delivers it on the next check-in", async () => {
    const { db, checkin } = await makeCheckin();
    const at = new Date();

    db.store.device_command.push({
      id: "exec-1",
      organizationId,
      deviceId: "win-1",
      requestType: "WindowsBitLockerRotate",
      payload: { kind: "Exec", locURI: "./Device/Vendor/MSFT/BitLocker/RotateRecoveryPasswords", requestId: "request-1" },
      status: "queued",
      dedupeKey: null,
      expiresAt: new Date(at.getTime() + 24 * 60 * 60 * 1000),
      resultStatus: null,
      resultDetail: null,
      createdAt: at,
      updatedAt: at,
    });

    await checkin();
    const exec = db.store.device_command.find((row: any) => row.id === "exec-1");
    exec.status = "accepted";
    exec.resultStatus = "0x4000000";
    exec.updatedAt = new Date();

    const afterAccepted = await checkin();

    // The status Get is planned after delivery and belongs to the next check-in.
    expect(
      afterAccepted.commands.some((command) => command.cmdID === "exec-1"),
    ).toBe(false);
    expect(
      db.store.device_command.filter(
        (row: any) => row.requestType === "WindowsBitLockerRotateStatus",
      ),
    ).toHaveLength(1);

    const next = await checkin();
    const statusCommand = next.commands.find((command) =>
      command.locURI?.includes("RotateRecoveryPasswordsStatus"),
    );

    expect(statusCommand).toBeDefined();
    expect(statusCommand?.data ?? "").toBe("");

    await checkin(
      [],
      [
        {
          cmdRef: statusCommand!.cmdID,
          items: [
            {
              source: {
                locURI: "./Device/Vendor/MSFT/BitLocker/Status/RotateRecoveryPasswordsStatus",
              },
              data: "0",
            },
          ],
        },
      ],
    );

    const closedExec = db.store.device_command.find((row: any) => row.id === "exec-1");
    expect(closedExec.status).toBe("succeeded");
    expect(closedExec.resultDetail).toContain("Rotation finished");
  });
});

