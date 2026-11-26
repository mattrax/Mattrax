import { describe, expect, it } from "vitest";
import { Effect } from "effect";
import {
  applePasswordHash,
  generateLocalAdminPassword,
  localAccountRefreshDue,
  localAdminRotationDue,
  parseAppleLocalAccounts,
  parseAppleLostModeLocation,
  setAutoAdminPasswordPayload,
} from "@mattrax/mdm-core";

describe("parseAppleLostModeLocation", () => {
  it("reads the DeviceLocation response and keeps the reported accuracy", () => {
    expect(
      parseAppleLostModeLocation({
        Latitude: -33.8688,
        Longitude: 151.2093,
        HorizontalAccuracy: 12.5,
        VerticalAccuracy: 5,
        Altitude: 58,
        Speed: 0,
        Course: -1,
        Timestamp: "2026-11-23T04:05:06Z",
      }),
    ).toEqual({
      latitude: -33.8688,
      longitude: 151.2093,
      horizontalAccuracy: 12.5,
      verticalAccuracy: 5,
      altitude: 58,
      speed: 0,
      reportedAt: "2026-11-23T04:05:06Z",
    });
  });

  it("accepts a nested payload and drops unknown accuracy values", () => {
    expect(
      parseAppleLostModeLocation({
        DeviceLocation: {
          Latitude: "1.5",
          Longitude: "-2.25",
          HorizontalAccuracy: -1,
          VerticalAccuracy: -1,
        },
      }),
    ).toEqual({ latitude: 1.5, longitude: -2.25 });
  });

  it("ignores payloads that are not a location answer", () => {
    expect(parseAppleLostModeLocation(undefined)).toBeUndefined();
    expect(parseAppleLostModeLocation({ SecurityInfo: {} })).toBeUndefined();
    expect(parseAppleLostModeLocation({ Latitude: 1 })).toBeUndefined();
    expect(parseAppleLostModeLocation({ Longitude: 2 })).toBeUndefined();
  });
});

describe("parseAppleLocalAccounts", () => {
  it("reads each users item Apple reports", () => {
    expect(
      parseAppleLocalAccounts({
        Users: [
          {
            UserName: "mattrax-admin",
            FullName: "Mattrax Administrator",
            UID: 501,
            UserGUID: "11111111-AAAA-BBBB-CCCC-222222222222",
            HasSecureToken: true,
            IsLoggedIn: false,
            MobileAccount: false,
          },
          {
            UserName: "shared",
            FullName: "Shared Account",
            UID: 502,
            HasSecureToken: false,
            IsLoggedIn: true,
          },
        ],
      }),
    ).toEqual([
      {
        username: "mattrax-admin",
        fullName: "Mattrax Administrator",
        uid: 501,
        guid: "11111111-AAAA-BBBB-CCCC-222222222222",
        hasSecureToken: true,
        isLoggedIn: false,
        mobileAccount: false,
      },
      {
        username: "shared",
        fullName: "Shared Account",
        uid: 502,
        hasSecureToken: false,
        isLoggedIn: true,
      },
    ]);
  });

  it("accepts a nested payload, skips unnamed and duplicate accounts", () => {
    expect(
      parseAppleLocalAccounts({
        UserList: {
          Users: [
            { UserName: "oscar", UID: 501 },
            { FullName: "No name" },
            { UserName: "oscar", UID: 502 },
          ],
        },
      }),
    ).toEqual([{ username: "oscar", uid: 501 }]);
  });

  it("distinguishes a missing payload from an empty account list", () => {
    expect(parseAppleLocalAccounts(undefined)).toBeUndefined();
    expect(parseAppleLocalAccounts({ SecurityInfo: {} })).toBeUndefined();
    expect(parseAppleLocalAccounts({ Users: [] })).toEqual([]);
  });
});

describe("SetAutoAdminPassword", () => {
  it("builds the documented GUID and passwordHash payload", () => {
    expect(setAutoAdminPasswordPayload({ guid: "GUID-123", passwordHash: "SALTED-HASH" })).toEqual({
      GUID: "GUID-123",
      passwordHash: "SALTED-HASH",
    });
  });

  it("generates a policy-compliant password and a SALTED-SHA512-PBKDF2 hash", async () => {
    const password = generateLocalAdminPassword();

    expect(password).toHaveLength(28);
    expect(password).toMatch(/[A-Z]/);
    expect(password).toMatch(/[a-z]/);
    expect(password).toMatch(/\d/);
    expect(password).toMatch(/[^A-Za-z0-9]/);

    const hash = await Effect.runPromise(applePasswordHash(password));
    const decoded = atob(hash);

    expect(decoded).toContain("SALTED-SHA512-PBKDF2");
    expect(decoded).toContain("<integer>35000</integer>");
    expect(decoded).toContain("<key>salt</key>");
    expect(decoded).toContain("<key>entropy</key>");
    expect(decoded).not.toContain(password);
  });

  it("salts the same password differently on each call", async () => {
    const first = await Effect.runPromise(applePasswordHash("SamePassword1!"));
    const second = await Effect.runPromise(applePasswordHash("SamePassword1!"));

    expect(first).not.toBe(second);
  });
});

describe("local account and rotation schedules", () => {
  it("refreshes missing or stale local-account inventories once a day", () => {
    const now = new Date("2026-11-23T00:00:00Z");

    expect(
      localAccountRefreshDue({ localAccountsUpdatedAt: null, localAccountsRequestedAt: null }, now),
    ).toBe(true);
    expect(
      localAccountRefreshDue(
        {
          localAccountsUpdatedAt: new Date("2026-11-21T23:00:00Z"),
          localAccountsRequestedAt: null,
        },
        now,
      ),
    ).toBe(true);
    expect(
      localAccountRefreshDue(
        {
          localAccountsUpdatedAt: new Date("2026-11-22T12:00:00Z"),
          localAccountsRequestedAt: null,
        },
        now,
      ),
    ).toBe(false);
    expect(
      localAccountRefreshDue(
        {
          localAccountsUpdatedAt: null,
          localAccountsRequestedAt: new Date("2026-11-22T23:00:00Z"),
        },
        now,
      ),
    ).toBe(false);
  });

  it("rotates only when the policy interval elapsed and a GUID is known", () => {
    const now = new Date("2026-11-23T00:00:00Z");

    expect(
      localAdminRotationDue({
        rotationDays: 30,
        rotatedAt: new Date("2026-10-01T00:00:00Z"),
        now,
        hasGuid: true,
      }),
    ).toBe(true);
    expect(
      localAdminRotationDue({
        rotationDays: 30,
        rotatedAt: new Date("2026-11-01T00:00:00Z"),
        now,
        hasGuid: true,
      }),
    ).toBe(false);
    expect(
      localAdminRotationDue({
        rotationDays: 30,
        rotatedAt: new Date("2026-10-01T00:00:00Z"),
        now,
        hasGuid: false,
      }),
    ).toBe(false);
    expect(
      localAdminRotationDue({
        rotationDays: null,
        rotatedAt: new Date("2026-10-01T00:00:00Z"),
        now,
        hasGuid: true,
      }),
    ).toBe(false);
  });
});
