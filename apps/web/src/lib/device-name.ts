/**
 * Whether saving the device-details sheet should also queue a
 * `set-device-name` action.
 *
 * The decision must use the values captured before the optimistic rename
 * write. Reading the live row in `onSuccess` compares against the name the
 * UI already put there, so a real rename looks like "no change" and never
 * reaches the device.
 */
export type DeviceNamePushPlanInput = {
  /** The server advertises `set-device-name` and the operator may command. */
  readonly supported: boolean;
  /** The "Apply name to device" checkbox. */
  readonly applyName: boolean;
  readonly submittedName: string;
  /** The management name before the optimistic update. */
  readonly previousName?: string | null;
  /** The persisted opt-in before this save; null means "never chosen". */
  readonly previousApplyName?: boolean | null;
};

export const shouldQueueDeviceNamePush = (input: DeviceNamePushPlanInput): boolean => {
  if (!input.supported || !input.applyName) return false;

  const name = input.submittedName.trim();

  if (!name) return false;

  const nameChanged = Boolean(input.previousName && name !== input.previousName);
  const optionTurnedOn = input.previousApplyName !== true;

  return nameChanged || optionTurnedOn;
};

/**
 * Mattrax cannot detect Apple supervision (only User Enrollment is
 * distinguishable), so the opt-in starts off rather than claiming a
 * supervised device. A stored `true` is preserved.
 */
export const defaultApplyNameToDevice = (namePushEnabled: boolean | null | undefined): boolean =>
  namePushEnabled === true;
