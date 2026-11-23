import { Schema } from "effect";
import { isPlistObject, plistText } from "./internal/plistValue.js";
import type { PlistInput, PlistObject } from "./internal/plistValue.js";

/**
 * `DeviceLocation` command-result parsing.
 *
 * Apple reports Lost Mode location from the separate `DeviceLocation` command,
 * not from `EnableLostMode`. The payload normally arrives under
 * `QueryResponses`, but protocol shims flatten it onto the response root, so
 * both parents are accepted.
 */

export type AppleLostModeLocation = {
  readonly latitude: number;
  readonly longitude: number;
  /** Radius of uncertainty in metres; negative when Apple does not know it. */
  readonly horizontalAccuracy?: number;
  readonly verticalAccuracy?: number;
  readonly altitude?: number;
  readonly speed?: number;
  readonly course?: number;
  /** RFC 3339 instant Apple sampled the location, when reported. */
  readonly reportedAt?: string;
};

const finiteNumber = (value: PlistInput): number | undefined => {
  if (Schema.is(Schema.Number)(value) && Number.isFinite(value)) return value;

  if (Schema.is(Schema.String)(value)) {
    const parsed = Number(value.trim());

    return Number.isFinite(parsed) ? parsed : undefined;
  }

  return undefined;
};

const responseContainer = (queryResponses: PlistInput): PlistObject | undefined =>
  isPlistObject(queryResponses) ? queryResponses : undefined;

/**
 * Read the `DeviceLocation` response. Returns `undefined` when the payload is
 * not a location answer (or when Apple omits either coordinate), so unrelated
 * command results are ignored instead of writing a half-populated fix.
 */
export const parseAppleLostModeLocation = (
  queryResponses: PlistInput,
): AppleLostModeLocation | undefined => {
  const container = responseContainer(queryResponses);

  if (!container) return undefined;
  const location = isPlistObject(container.DeviceLocation) ? container.DeviceLocation : container;
  const latitude = finiteNumber(location.Latitude);
  const longitude = finiteNumber(location.Longitude);

  if (latitude === undefined || longitude === undefined) return undefined;

  const accuracy = (value: PlistInput) => {
    const parsed = finiteNumber(value);

    // Apple uses a negative value to mean "unknown".
    return parsed !== undefined && parsed >= 0 ? parsed : undefined;
  };

  const reportedAt = plistText(location.Timestamp);
  const horizontalAccuracy = accuracy(location.HorizontalAccuracy);
  const verticalAccuracy = accuracy(location.VerticalAccuracy);
  const altitude = finiteNumber(location.Altitude);
  const speed = accuracy(location.Speed);
  const course = accuracy(location.Course);

  return {
    latitude,
    longitude,
    ...(horizontalAccuracy === undefined ? {} : { horizontalAccuracy }),
    ...(verticalAccuracy === undefined ? {} : { verticalAccuracy }),
    ...(altitude === undefined ? {} : { altitude }),
    ...(speed === undefined ? {} : { speed }),
    ...(course === undefined ? {} : { course }),
    ...(reportedAt && !Number.isNaN(Date.parse(reportedAt)) ? { reportedAt } : {}),
  };
};
