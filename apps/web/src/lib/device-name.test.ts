import { describe, expect, it } from "vitest";
import { defaultApplyNameToDevice, shouldQueueDeviceNamePush } from "./device-name";

describe("shouldQueueDeviceNamePush", () => {
  it("queues a real rename against the pre-save name despite the optimistic row", () => {
    // Regression: onSuccess used to compare the submitted name with the row
    // that onMutate had already optimistically renamed, so this returned false.
    expect(
      shouldQueueDeviceNamePush({
        supported: true,
        applyName: true,
        submittedName: "Reception Mac",
        previousName: "C02XK1AB",
        previousApplyName: true,
      }),
    ).toBe(true);
  });

  it("queues when the default-off option is turned on for the first time", () => {
    expect(
      shouldQueueDeviceNamePush({
        supported: true,
        applyName: true,
        submittedName: "C02XK1AB",
        previousName: "C02XK1AB",
        previousApplyName: null,
      }),
    ).toBe(true);

    expect(
      shouldQueueDeviceNamePush({
        supported: true,
        applyName: true,
        submittedName: "C02XK1AB",
        previousName: "C02XK1AB",
        previousApplyName: false,
      }),
    ).toBe(true);
  });

  it("does not queue an unrelated edit or a rename with the option off", () => {
    expect(
      shouldQueueDeviceNamePush({
        supported: true,
        applyName: true,
        submittedName: "C02XK1AB",
        previousName: "C02XK1AB",
        previousApplyName: true,
      }),
    ).toBe(false);

    expect(
      shouldQueueDeviceNamePush({
        supported: true,
        applyName: false,
        submittedName: "Reception Mac",
        previousName: "C02XK1AB",
        previousApplyName: true,
      }),
    ).toBe(false);
  });

  it("never queues when the action is unavailable or the name is blank", () => {
    expect(
      shouldQueueDeviceNamePush({
        supported: false,
        applyName: true,
        submittedName: "Reception Mac",
        previousName: "C02XK1AB",
        previousApplyName: null,
      }),
    ).toBe(false);

    expect(
      shouldQueueDeviceNamePush({
        supported: true,
        applyName: true,
        submittedName: "   ",
        previousName: "C02XK1AB",
        previousApplyName: true,
      }),
    ).toBe(false);
  });
});

describe("defaultApplyNameToDevice", () => {
  it("defaults off because Apple supervision is not detectable", () => {
    // An enrolled Apple device that is not a User Enrollment still has an
    // unknown supervision state, so the checkbox must not claim otherwise.
    expect(defaultApplyNameToDevice(null)).toBe(false);
    expect(defaultApplyNameToDevice(undefined)).toBe(false);
  });

  it("preserves an explicit choice", () => {
    expect(defaultApplyNameToDevice(true)).toBe(true);
    expect(defaultApplyNameToDevice(false)).toBe(false);
  });
});
