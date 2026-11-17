import { describe, expect, it } from "vitest";
import {
  ADDITIONAL_STATUS_ITEMS,
  DEVICE_INFORMATION_BASE_STATUS_ITEMS,
  appleStatusItemsForDevice,
} from "@mattrax/mdm-core";

const has = (items: ReadonlyArray<string>, item: string) => items.includes(item);

describe("appleStatusItemsForDevice", () => {
  it("subscribes only the base list when the OS is unknown", () => {
    expect(appleStatusItemsForDevice({})).toEqual([...DEVICE_INFORMATION_BASE_STATUS_ITEMS]);
    expect(appleStatusItemsForDevice({ osEdition: "UnknownOS", osVersion: "1.0" })).toEqual([
      ...DEVICE_INFORMATION_BASE_STATUS_ITEMS,
    ]);
  });

  it("does not subscribe passcode or mdm.app on macOS", () => {
    const items = appleStatusItemsForDevice({ osEdition: "macOS", osVersion: "15.1" });

    expect(has(items, "passcode.is-present")).toBe(false);
    expect(has(items, "passcode.is-compliant")).toBe(false);
    expect(has(items, "mdm.app")).toBe(false);
    expect(has(items, "softwareupdate.install-state")).toBe(true);
    expect(has(items, "softwareupdate.pending-version")).toBe(true);
    expect(has(items, "softwareupdate.failure-reason")).toBe(true);
    expect(has(items, "security.certificate.list")).toBe(true);
    // Introduced in macOS 27.
    expect(has(items, "security.lockdown-mode")).toBe(false);
  });

  it("subscribes passcode, mdm.app and security items on iOS 17", () => {
    const items = appleStatusItemsForDevice({ osEdition: "iPadOS", osVersion: "17.4" });

    expect(has(items, "passcode.is-present")).toBe(true);
    expect(has(items, "passcode.is-compliant")).toBe(true);
    expect(has(items, "mdm.app")).toBe(true);
    expect(has(items, "softwareupdate.install-state")).toBe(true);
    expect(has(items, "security.certificate.list")).toBe(true);
  });

  it("does not subscribe items the OS version predates", () => {
    const items = appleStatusItemsForDevice({ osEdition: "iOS", osVersion: "15.8" });

    expect(has(items, "passcode.is-present")).toBe(false);
    expect(has(items, "mdm.app")).toBe(false);
    expect(has(items, "softwareupdate.install-state")).toBe(false);
  });

  it("gates lockdown mode to macOS 27", () => {
    expect(
      has(
        appleStatusItemsForDevice({ osEdition: "macOS", osVersion: "27.0" }),
        "security.lockdown-mode",
      ),
    ).toBe(true);
  });

  it("declares support only for families Apple documents", () => {
    const passcode = ADDITIONAL_STATUS_ITEMS.find((item) => item.item === "passcode.is-present");

    expect(passcode?.families.macOS).toBeUndefined();
    expect(passcode?.families.iOS).toBe("16.0");
  });
});
