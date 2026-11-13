/**
 * Device health derivation lives in `@mattrax/enterprise-domain` so both the
 * Enterprise API and the MDM check-in path can evaluate the same rules.
 * Re-exported here to keep the existing backend import path stable.
 */
export {
  DEVICE_STALE_AFTER_DAYS,
  countDeviceHealth,
  declarationReasonLabels,
  deriveDeviceHealth,
  groupDeviceHealthReasons,
  isMacOsDevice,
  needsBatteryService,
  normalizeDeviceHealth,
  parseStorageBytes,
} from "@mattrax/enterprise-domain";

export type {
  DeviceHealthDeclaration,
  DeviceHealthInput,
  DeviceHealthSummary,
} from "@mattrax/enterprise-domain";
