import { describe, expect, it } from "vitest";
import { DEVICE_INFORMATION_STATUS_ITEMS, deviceInformationConfigurationToken } from "@mattrax/mdm-apple";

describe("DDM status subscription token", () => {
  it("is stable for the same item list", async () => {
    const first = await deviceInformationConfigurationToken();
    const second = await deviceInformationConfigurationToken([...DEVICE_INFORMATION_STATUS_ITEMS]);
    expect(second).toBe(first);
  });

  it("changes when the subscribed status items change", async () => {
    const current = await deviceInformationConfigurationToken();

    const added = await deviceInformationConfigurationToken([
      ...DEVICE_INFORMATION_STATUS_ITEMS,
      "device.power.battery-level",
    ]);

    const removed = await deviceInformationConfigurationToken(
      DEVICE_INFORMATION_STATUS_ITEMS.filter((item) => item !== "diskmanagement.storage.total"),
    );

    expect(added).not.toBe(current);
    expect(removed).not.toBe(current);
    expect(added).not.toBe(removed);
  });
});
