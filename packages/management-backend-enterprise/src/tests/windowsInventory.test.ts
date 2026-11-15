import { describe, expect, it } from "vitest";
import {
  WINDOWS_INVENTORY_COMMAND_ID_PREFIX,
  WINDOWS_INVENTORY_REFRESH_MS,
  WINDOWS_INVENTORY_REQUESTS,
  WINDOWS_INVENTORY_URI,
  hasWindowsInventory,
  parseWindowsInventory,
  parseWindowsOsVersion,
  shouldApplyInventoryName,
  windowsInventoryDue,
  windowsInventoryUpdate,
  windowsInventoryValues,
} from "../windowsInventory.js";

const MEBIBYTE = 1024 * 1024;

const values = (entries: Record<string, string>) => new Map(Object.entries(entries));

const fullReport = () =>
  values({
    [WINDOWS_INVENTORY_URI.osVersion]: "10.0.19045.3803",
    [WINDOWS_INVENTORY_URI.model]: "Surface Laptop 5",
    [WINDOWS_INVENTORY_URI.systemSKU]: "Surface_Laptop_5",
    [WINDOWS_INVENTORY_URI.serial]: "0123456789",
    [WINDOWS_INVENTORY_URI.deviceName]: "DESKTOP-ABC",
    [WINDOWS_INVENTORY_URI.osPlatform]: "Windows 11 Pro",
    [WINDOWS_INVENTORY_URI.totalStorage]: "512000",
    [WINDOWS_INVENTORY_URI.freeStorage]: "128000",
  });

describe("Windows inventory requests", () => {
  it("requests each leaf node with a stable command id", () => {
    const uris = WINDOWS_INVENTORY_REQUESTS.map((request) => request.locURI);

    expect(uris).toContain(WINDOWS_INVENTORY_URI.osVersion);
    expect(uris).toContain(WINDOWS_INVENTORY_URI.serial);
    expect(uris).toContain(WINDOWS_INVENTORY_URI.totalStorage);
    expect(new Set(WINDOWS_INVENTORY_REQUESTS.map((request) => request.cmdID)).size).toBe(
      WINDOWS_INVENTORY_REQUESTS.length,
    );

    for (const request of WINDOWS_INVENTORY_REQUESTS)
      expect(request.cmdID.startsWith(WINDOWS_INVENTORY_COMMAND_ID_PREFIX)).toBe(true);
  });
});

describe("windowsInventoryValues", () => {
  it("reads Source LocURI values from Results items", () => {
    const parsed = windowsInventoryValues([
      {
        cmdID: "3",
        msgRef: "1",
        cmdRef: "2",
        items: [
          { source: { locURI: WINDOWS_INVENTORY_URI.osVersion }, data: "10.0.19045.3803" },
          { source: { locURI: WINDOWS_INVENTORY_URI.serial }, data: "  SERIAL-1  " },
        ],
      },
    ]);

    expect(parsed.get(WINDOWS_INVENTORY_URI.osVersion)).toBe("10.0.19045.3803");
    expect(parsed.get(WINDOWS_INVENTORY_URI.serial)).toBe("SERIAL-1");
  });

  it("falls back to the CmdRef when the device omits Item/Source", () => {
    const parsed = windowsInventoryValues([
      {
        cmdID: "4",
        msgRef: "1",
        cmdRef: `${WINDOWS_INVENTORY_COMMAND_ID_PREFIX}serial`,
        items: [{ data: "SERIAL-2" }],
      },
    ]);

    expect(parsed.get(WINDOWS_INVENTORY_URI.serial)).toBe("SERIAL-2");
  });

  it("ignores malformed entries and empty values instead of failing", () => {
    const parsed = windowsInventoryValues([
      null,
      "not-a-result",
      { cmdID: "5" },
      {
        cmdID: "6",
        cmdRef: "2",
        items: [
          { source: { locURI: WINDOWS_INVENTORY_URI.model }, data: "" },
          { data: "orphan" },
          { source: { locURI: WINDOWS_INVENTORY_URI.serial }, data: 12345 },
        ],
      },
    ]);

    expect(parsed.get(WINDOWS_INVENTORY_URI.model)).toBeUndefined();
    expect(parsed.get(WINDOWS_INVENTORY_URI.serial)).toBe("12345");
    expect(parsed.size).toBe(1);
  });

  it("tolerates a missing results array", () => {
    expect(windowsInventoryValues(undefined).size).toBe(0);
    expect(windowsInventoryValues([]).size).toBe(0);
  });
});

describe("parseWindowsOsVersion", () => {
  it("splits the product version from build and QFE", () => {
    expect(parseWindowsOsVersion("10.0.19045.3803")).toEqual({
      version: "10.0.19045",
      build: "19045.3803",
    });
  });

  it("handles a build without a QFE segment", () => {
    expect(parseWindowsOsVersion("10.0.22631")).toEqual({
      version: "10.0.22631",
      build: "22631",
    });
  });

  it("preserves an unexpected value verbatim", () => {
    expect(parseWindowsOsVersion("Windows 11")).toEqual({ version: "Windows 11" });
    expect(parseWindowsOsVersion(undefined)).toBeUndefined();
  });
});

describe("parseWindowsInventory", () => {
  it("normalises a complete report", () => {
    expect(parseWindowsInventory(fullReport())).toEqual({
      name: "DESKTOP-ABC",
      model: "Surface Laptop 5",
      modelIdentifier: "Surface_Laptop_5",
      serial: "0123456789",
      osEdition: "Windows 11 Pro",
      osVersion: "10.0.19045",
      osBuild: "19045.3803",
      diskTotal: String(512000 * MEBIBYTE),
      diskUsed: String((512000 - 128000) * MEBIBYTE),
    });
  });

  it("falls back to DevDetail/DevTyp for the model", () => {
    expect(
      parseWindowsInventory(values({ [WINDOWS_INVENTORY_URI.deviceType]: "HP EliteBook 840" })),
    ).toMatchObject({ model: "HP EliteBook 840" });
  });

  it("prefers DevInfo/Mod over DevDetail/DevTyp", () => {
    expect(
      parseWindowsInventory(
        values({
          [WINDOWS_INVENTORY_URI.model]: "Surface Laptop 5",
          [WINDOWS_INVENTORY_URI.deviceType]: "Generic Device",
        }),
      ),
    ).toMatchObject({ model: "Surface Laptop 5" });
  });

  it("drops vendor placeholder serials", () => {
    for (const serial of ["To be filled by O.E.M.", "Default string", "Unknown", "0"])
      expect(
        parseWindowsInventory(values({ [WINDOWS_INVENTORY_URI.serial]: serial })).serial,
      ).toBeUndefined();
  });

  it("does not store inconsistent or zero storage figures", () => {
    expect(
      parseWindowsInventory(
        values({
          [WINDOWS_INVENTORY_URI.totalStorage]: "100",
          [WINDOWS_INVENTORY_URI.freeStorage]: "200",
        }),
      ),
    ).toEqual({});

    expect(
      parseWindowsInventory(
        values({
          [WINDOWS_INVENTORY_URI.totalStorage]: "0",
          [WINDOWS_INVENTORY_URI.freeStorage]: "0",
        }),
      ),
    ).toEqual({});
  });

  it("stores total storage without free space when only the total is reported", () => {
    expect(
      parseWindowsInventory(values({ [WINDOWS_INVENTORY_URI.totalStorage]: "1024" })),
    ).toEqual({ diskTotal: String(1024 * MEBIBYTE) });
  });

  it("truncates oversized values to the device column width", () => {
    const parsed = parseWindowsInventory(
      values({ [WINDOWS_INVENTORY_URI.model]: "M".repeat(400) }),
    );

    expect(parsed.model).toHaveLength(255);
  });
});

describe("windowsInventoryDue", () => {
  const now = new Date("2026-01-01T12:00:00Z");
  const hoursAgo = (hours: number) => new Date(now.getTime() - hours * 60 * 60 * 1000);

  it("is due when the device has never been inventoried", () => {
    expect(windowsInventoryDue({ now })).toBe(true);
  });

  it("is not due within the refresh interval", () => {
    expect(windowsInventoryDue({ lastUpdatedAt: hoursAgo(1), now })).toBe(false);
    expect(windowsInventoryDue({ lastRequestedAt: hoursAgo(1), now })).toBe(false);
  });

  it("is due once the refresh interval elapses", () => {
    const stale = new Date(now.getTime() - WINDOWS_INVENTORY_REFRESH_MS);

    expect(windowsInventoryDue({ lastUpdatedAt: stale, lastRequestedAt: stale, now })).toBe(true);
  });

  it("retries an unanswered request only after the interval", () => {
    expect(windowsInventoryDue({ lastRequestedAt: hoursAgo(1), now })).toBe(false);
    expect(windowsInventoryDue({ lastRequestedAt: hoursAgo(7), now })).toBe(true);
  });

  it("accepts date strings", () => {
    expect(windowsInventoryDue({ lastUpdatedAt: hoursAgo(1).toISOString(), now })).toBe(false);
    expect(windowsInventoryDue({ lastUpdatedAt: "not-a-date", now })).toBe(true);
  });
});

describe("name handling", () => {
  it("only fills a blank name or the enrollment DeviceID placeholder", () => {
    expect(shouldApplyInventoryName({ name: "", dmIdentifier: "device-1" })).toBe(true);
    expect(shouldApplyInventoryName({ name: "device-1", dmIdentifier: "device-1" })).toBe(true);
    expect(shouldApplyInventoryName({ name: "DESKTOP-ADMIN", dmIdentifier: "device-1" })).toBe(
      false,
    );
  });

  it("keeps an administrator-edited name out of the patch", () => {
    const inventory = parseWindowsInventory(fullReport());

    expect(
      windowsInventoryUpdate(inventory, { name: "DESKTOP-ADMIN", dmIdentifier: "device-1" }).name,
    ).toBeUndefined();

    expect(
      windowsInventoryUpdate(inventory, { name: "device-1", dmIdentifier: "device-1" }).name,
    ).toBe("DESKTOP-ABC");
  });
});

describe("hasWindowsInventory", () => {
  it("detects usable reports", () => {
    expect(hasWindowsInventory(parseWindowsInventory(fullReport()))).toBe(true);
    expect(hasWindowsInventory(parseWindowsInventory(values({})))).toBe(false);
  });
});
