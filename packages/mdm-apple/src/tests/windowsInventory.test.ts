import { describe, expect, it } from "vitest";
import {
  WINDOWS_APPLICATION_INVENTORY_REQUESTS,
  WINDOWS_APPLICATION_INVENTORY_URI,
  WINDOWS_INVENTORY_COMMAND_ID_PREFIX,
  WINDOWS_INVENTORY_REFRESH_MS,
  WINDOWS_INVENTORY_REQUESTS,
  WINDOWS_INVENTORY_URI,
  WINDOWS_MDM_PROVIDER_ID,
  hasWindowsInventory,
  hasWindowsSecurityInventory,
  mergeWindowsApplicationReport,
  parseWindowsApplications,
  parseWindowsApplicationsReport,
  parseWindowsInventory,
  parseWindowsOsVersion,
  windowsApplicationInventoryDue,
  windowsEntraDeviceIdUri,
  windowsInventoryDue,
  windowsInventoryRequests,
  windowsInventoryUpdate,
  windowsInventoryValues,
  windowsUnenrollUri,
} from "@mattrax/mdm-windows";

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

  it("collects BitLocker, TPM, Secure Boot and join state", () => {
    const uris = WINDOWS_INVENTORY_REQUESTS.map((request) => request.locURI);

    expect(uris).toContain(WINDOWS_INVENTORY_URI.bitLockerCompliance);
    expect(uris).toContain(WINDOWS_INVENTORY_URI.bitLockerStatus);
    expect(uris).toContain(WINDOWS_INVENTORY_URI.tpmVersion);
    expect(uris).toContain(WINDOWS_INVENTORY_URI.secureBootState);
    expect(uris).toContain(WINDOWS_INVENTORY_URI.domainName);
    expect(uris).toContain(windowsEntraDeviceIdUri());
  });

  it("addresses the provider the enrollment wrote into the device", () => {
    const requests = windowsInventoryRequests("Contoso MDM");
    const entra = requests.find((request) => request.locURI.includes("AADDeviceID"));

    expect(entra?.locURI).toBe("./Vendor/MSFT/DMClient/Provider/Contoso%20MDM/AADDeviceID");
    expect(windowsUnenrollUri(WINDOWS_MDM_PROVIDER_ID)).toBe(
      "./Vendor/MSFT/DMClient/Provider/Mattrax/Unenroll",
    );
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

    expect(parsed.get(WINDOWS_INVENTORY_URI.model)).toBe("");
    expect(parsed.get(WINDOWS_INVENTORY_URI.serial)).toBe("12345");
    // An answered empty node is retained so security/join state can be
    // cleared; an item without a URI is still ignored.
    expect(parsed.size).toBe(2);
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

  it("parses security and join state", () => {
    expect(
      parseWindowsInventory(
        values({
          [WINDOWS_INVENTORY_URI.bitLockerCompliance]: "1",
          [WINDOWS_INVENTORY_URI.bitLockerStatus]: "0",
          [WINDOWS_INVENTORY_URI.tpmVersion]: "2.0",
          [WINDOWS_INVENTORY_URI.secureBootState]: "1",
          [WINDOWS_INVENTORY_URI.domainName]: "corp.contoso.com",
          [windowsEntraDeviceIdUri()]: "11111111-2222-3333-4444-555555555555",
        }),
      ),
    ).toEqual({
      bitLockerEnabled: true,
      bitLockerStatus: 0,
      tpmVersion: "2.0",
      secureBootState: 1,
      domainName: "corp.contoso.com",
      entraDeviceId: "11111111-2222-3333-4444-555555555555",
    });
  });

  it("keeps a reported off state distinct from an unreported node", () => {
    expect(
      parseWindowsInventory(
        values({
          [WINDOWS_INVENTORY_URI.bitLockerCompliance]: "0",
          [WINDOWS_INVENTORY_URI.secureBootState]: "2",
        }),
      ),
    ).toMatchObject({ bitLockerEnabled: false, secureBootState: 2 });
    expect(parseWindowsInventory(values({})).bitLockerEnabled).toBeUndefined();
  });

  it("ignores malformed security values instead of dropping the report", () => {
    expect(
      parseWindowsInventory(
        values({
          [WINDOWS_INVENTORY_URI.bitLockerCompliance]: "enabled",
          [WINDOWS_INVENTORY_URI.bitLockerStatus]: "-1",
          [WINDOWS_INVENTORY_URI.secureBootState]: "unknown",
          [WINDOWS_INVENTORY_URI.model]: "Surface Laptop 5",
        }),
      ),
    ).toEqual({ model: "Surface Laptop 5" });
  });

  it("clears an answered security node while leaving unanswered nodes alone", () => {
    expect(
      parseWindowsInventory(
        values({
          [WINDOWS_INVENTORY_URI.domainName]: "",
          [WINDOWS_INVENTORY_URI.tpmVersion]: "",
          [windowsEntraDeviceIdUri()]: "",
        }),
      ),
    ).toEqual({ domainName: null, tpmVersion: null, entraDeviceId: null });

    // The node missing from the report keeps its previous value (undefined
    // here means "do not write").
    expect(parseWindowsInventory(values({ [WINDOWS_INVENTORY_URI.domainName]: "" }))).toEqual({
      domainName: null,
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
    expect(parseWindowsInventory(values({ [WINDOWS_INVENTORY_URI.totalStorage]: "1024" }))).toEqual(
      { diskTotal: String(1024 * MEBIBYTE) },
    );
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
  it("stores the reported name as the physical name without renaming a managed device", () => {
    const inventory = parseWindowsInventory(fullReport());

    const edited = windowsInventoryUpdate(inventory, {
      name: "DESKTOP-ADMIN",
      dmIdentifier: "device-1",
      physicalName: "DESKTOP-OLD",
    });

    expect(edited.name).toBeUndefined();
    expect(edited.physicalName).toBe("DESKTOP-ABC");

    expect(
      windowsInventoryUpdate(inventory, { name: "device-1", dmIdentifier: "device-1" }).name,
    ).toBe("DESKTOP-ABC");

    expect(
      windowsInventoryUpdate(inventory, { name: "DESKTOP-OLD", physicalName: "DESKTOP-OLD" }).name,
    ).toBe("DESKTOP-ABC");
  });
});

describe("Windows application inventory", () => {
  const win32 = (key: string, field: string, value: string) =>
    [
      `./Vendor/MSFT/Win32AppInventory/Win32InstalledProgram/InstalledProgram/${key}/${field}`,
      value,
    ] as const;

  it("requests the Win32 inventory and the deployed MSI state", () => {
    expect(WINDOWS_APPLICATION_INVENTORY_REQUESTS.map((request) => request.locURI)).toEqual([
      WINDOWS_APPLICATION_INVENTORY_URI.win32,
      WINDOWS_APPLICATION_INVENTORY_URI.msi,
    ]);

    for (const request of WINDOWS_APPLICATION_INVENTORY_REQUESTS)
      expect(request.locURI).toContain("?list=StructData");
  });

  it("normalises Win32 programs, keyed by MSI product code when there is one", () => {
    const applications = parseWindowsApplications(
      values(
        Object.fromEntries([
          win32("Google Chrome", "Name", "Google Chrome"),
          win32("Google Chrome", "Version", "131.0.6778.86"),
          win32("Google Chrome", "Publisher", "Google LLC"),
          win32("Google Chrome", "RegKey", "Google Chrome"),
          win32("Slack", "Name", "Slack"),
          win32("Slack", "Version", "4.41.96"),
          win32("Slack", "MsiProductCode", "{A1B2C3D4-0000-0000-0000-000000000000}"),
        ]),
      ),
    );

    expect(applications).toEqual([
      {
        bundleId: "Google Chrome",
        name: "Google Chrome",
        version: "131.0.6778.86",
        publisher: "Google LLC",
      },
      {
        bundleId: "{A1B2C3D4-0000-0000-0000-000000000000}",
        name: "Slack",
        version: "4.41.96",
        publisher: undefined,
      },
    ]);
  });

  it("marks successfully deployed MSI packages as managed and skips failed installs", () => {
    const prefix = "./Device/Vendor/MSFT/EnterpriseDesktopAppManagement/MSI";

    const applications = parseWindowsApplications(
      values({
        [`${prefix}/COMPANY-APP/Name`]: "Contoso Client",
        [`${prefix}/COMPANY-APP/Version`]: "2.0.1",
        [`${prefix}/COMPANY-APP/Publisher`]: "Contoso",
        [`${prefix}/COMPANY-APP/Status`]: "70",
        [`${prefix}/BROKEN-APP/Name`]: "Broken",
        [`${prefix}/BROKEN-APP/Status`]: "60",
      }),
    );

    expect(applications).toEqual([
      {
        bundleId: "COMPANY-APP",
        name: "Contoso Client",
        version: "2.0.1",
        publisher: "Contoso",
        isManaged: true,
      },
    ]);
  });

  it("returns undefined when the device did not answer an application Get", () => {
    expect(parseWindowsApplications(values({}))).toBeUndefined();
    expect(
      parseWindowsApplications(values({ [WINDOWS_INVENTORY_URI.deviceName]: "DESKTOP-ABC" })),
    ).toBeUndefined();
  });

  it("classifies which application sources answered", () => {
    const prefix = "./Device/Vendor/MSFT/EnterpriseDesktopAppManagement/MSI";

    const report = parseWindowsApplicationsReport(
      values({
        [`${prefix}/COMPANY-APP/Name`]: "Contoso Client",
        [`${prefix}/COMPANY-APP/Status`]: "70",
      }),
    );

    expect(report?.sources).toEqual({ win32: false, msi: true });
  });

  it("treats an answered empty Get as a complete source", () => {
    expect(
      parseWindowsApplicationsReport(values({}), {
        reportedCommandIds: new Set(["windows-app-inventory-win32"]),
      }),
    ).toEqual({ applications: [], sources: { win32: true, msi: false } });
  });

  it("keeps Win32 rows when only the MSI source answered", () => {
    const prefix = "./Device/Vendor/MSFT/EnterpriseDesktopAppManagement/MSI";

    const report = parseWindowsApplicationsReport(
      values({
        [`${prefix}/MANAGED-APP/Name`]: "Managed Client",
        [`${prefix}/MANAGED-APP/Version`]: "2.0.0",
        [`${prefix}/MANAGED-APP/Status`]: "70",
      }),
    )!;

    const merged = mergeWindowsApplicationReport(
      [
        { bundleId: "WIN32-APP", name: "Win32 App", publisher: "Contoso" },
        { bundleId: "STALE-MANAGED", name: "Gone", isManaged: true },
      ],
      report,
    );

    expect(merged.map((application) => application.bundleId).sort()).toEqual([
      "MANAGED-APP",
      "WIN32-APP",
    ]);
    expect(merged.find((application) => application.bundleId === "MANAGED-APP")).toMatchObject({
      isManaged: true,
    });
  });

  it("keeps managed rows when only Win32 answered, including the managed flag", () => {
    const report = parseWindowsApplicationsReport(
      values({
        "./Vendor/MSFT/Win32AppInventory/Win32InstalledProgram/InstalledProgram/MANAGED-APP/Name":
          "Managed Client",
      }),
    )!;

    const merged = mergeWindowsApplicationReport(
      [{ bundleId: "MANAGED-APP", name: "Old name", isManaged: true }],
      report,
    );

    expect(merged).toEqual([
      expect.objectContaining({ bundleId: "MANAGED-APP", name: "Managed Client", isManaged: true }),
    ]);
  });
});

describe("windowsApplicationInventoryDue", () => {
  const now = new Date("2026-01-01T12:00:00Z");
  const hoursAgo = (hours: number) => new Date(now.getTime() - hours * 60 * 60 * 1000);

  it("runs on a daily cadence rather than the six-hour device cadence", () => {
    expect(windowsApplicationInventoryDue({ now })).toBe(true);
    expect(windowsApplicationInventoryDue({ lastUpdatedAt: hoursAgo(1), now })).toBe(false);
    expect(windowsApplicationInventoryDue({ lastUpdatedAt: hoursAgo(7), now })).toBe(false);
    expect(windowsApplicationInventoryDue({ lastUpdatedAt: hoursAgo(25), now })).toBe(true);
    expect(windowsApplicationInventoryDue({ lastRequestedAt: hoursAgo(25), now })).toBe(true);
  });
});

describe("hasWindowsInventory", () => {
  it("detects usable reports", () => {
    expect(hasWindowsInventory(parseWindowsInventory(fullReport()))).toBe(true);
    expect(hasWindowsInventory(parseWindowsInventory(values({})))).toBe(false);
    expect(
      hasWindowsInventory(
        parseWindowsInventory(values({ [WINDOWS_INVENTORY_URI.secureBootState]: "1" })),
      ),
    ).toBe(true);
  });

  it("distinguishes a security snapshot", () => {
    expect(
      hasWindowsSecurityInventory(
        parseWindowsInventory(values({ [WINDOWS_INVENTORY_URI.tpmVersion]: "2.0" })),
      ),
    ).toBe(true);
    expect(hasWindowsSecurityInventory(parseWindowsInventory(fullReport()))).toBe(false);
  });
});

describe("windowsInventoryUpdate security columns", () => {
  it("maps parsed security values onto the device patch", () => {
    const inventory = parseWindowsInventory(
      values({
        [WINDOWS_INVENTORY_URI.bitLockerCompliance]: "1",
        [WINDOWS_INVENTORY_URI.tpmVersion]: "2.0",
        [WINDOWS_INVENTORY_URI.secureBootState]: "1",
        [WINDOWS_INVENTORY_URI.domainName]: "corp.contoso.com",
      }),
    );

    expect(windowsInventoryUpdate(inventory, {})).toMatchObject({
      bitLockerEnabled: true,
      tpmVersion: "2.0",
      secureBootState: 1,
      domainName: "corp.contoso.com",
    });
  });
});
