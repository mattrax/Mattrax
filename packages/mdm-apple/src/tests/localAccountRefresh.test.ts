import { describe, expect, it } from "vitest";
import { Effect } from "effect";
import { schema } from "@mattrax/enterprise-core";
import { refreshAppleLocalAccounts } from "@mattrax/mdm-core";
import { makeDb, tableName } from "./fake-db.js";
import type { Row } from "./fake-db.js";

const now = new Date("2026-11-23T10:00:00.000Z");
const run = <A, E>(effect: Effect.Effect<A, E, never>) => Effect.runPromise(effect);

const deviceRow = (overrides: Partial<Row>) => ({
  id: "device",
  organizationId: "org-1",
  proto: "apple",
  status: "enrolled",
  name: "Device",
  enrolledAt: now,
  lastSeenAt: now,
  ...overrides,
});

describe("refreshAppleLocalAccounts", () => {
  it("selects only positively identified Macs and respects the limit", async () => {
    const db = makeDb({
      [tableName(schema.device)]: [
        deviceRow({ id: "mac-1", name: "Mac", osEdition: "macOS 15.1" }),
        deviceRow({ id: "mac-2", name: "Mac 2", model: "MacBookPro18,2" }),
        deviceRow({ id: "iphone", name: "iPhone", osEdition: "iOS 18.1" }),
        deviceRow({ id: "unknown-apple", name: "Unknown" }),
        deviceRow({ id: "windows", name: "PC", proto: "win", osEdition: "Windows 11" }),
      ],
      [tableName(schema.deviceApple)]: [
        { deviceId: "mac-1" },
        { deviceId: "mac-2" },
        { deviceId: "iphone" },
        { deviceId: "unknown-apple" },
        { deviceId: "windows" },
      ],
    });

    const result = await run(refreshAppleLocalAccounts(db as any, { now, limit: 2 }));

    expect(result).toEqual({ requested: 2, skipped: 0 });

    const commands = db.store[tableName(schema.deviceCommand)]!;

    expect(commands.map((command) => command.deviceId).sort()).toEqual(["mac-1", "mac-2"]);
    expect(commands.every((command) => command.requestType === "UserList")).toBe(true);

    const requested = db.store[tableName(schema.deviceApple)]!.filter(
      (row) => row.localAccountsRequestedAt instanceof Date,
    )
      .map((row) => row.deviceId)
      .sort();

    expect(requested).toEqual(["mac-1", "mac-2"]);
  });

  it("does not request a Mac with a fresh inventory or an in-flight refresh", async () => {
    const db = makeDb({
      [tableName(schema.device)]: [deviceRow({ id: "mac-1", osEdition: "macOS 15.1" })],
      [tableName(schema.deviceApple)]: [
        {
          deviceId: "mac-1",
          localAccountsUpdatedAt: new Date(now.getTime() - 2 * 60 * 60 * 1000),
        },
      ],
    });

    expect(await run(refreshAppleLocalAccounts(db as any, { now }))).toEqual({
      requested: 0,
      skipped: 1,
    });

    expect(db.store[tableName(schema.deviceCommand)] ?? []).toEqual([]);
  });
});
