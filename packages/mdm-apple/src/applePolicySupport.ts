import {
  appleOsFamily,
  applePayloadMinimumOs,
  applePayloadOsVersions,
  applePayloadRemovedIn,
  applePayloadSupportForDevice,
} from "@mattrax/dm-apple";
import type { ApplePolicySupport } from "@mattrax/mdm-core";
import { configurationPayloadTypes } from "./policy.js";

/** Apple metadata adapter used by shared policy scope and delivery code. */
export const applePolicySupport: ApplePolicySupport = {
  osFamily: appleOsFamily,
  payloadTypes: configurationPayloadTypes,
  payloadVersions: applePayloadOsVersions,
  payloadMinimum: applePayloadMinimumOs,
  payloadRemoved: applePayloadRemovedIn,
  payloadSupport: applePayloadSupportForDevice,
};
