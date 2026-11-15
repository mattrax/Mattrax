/**
 * Apple publishes one product image per hardware model identifier. The legacy
 * `mttx` dashboard shipped those renders; this build serves a 320px WebP copy
 * from `public/device-artwork/apple` so the device page can identify a machine
 * at a glance without bundling hundreds of megabytes of source PNGs.
 */
export const APPLE_DEVICE_ARTWORK_PATH = "/device-artwork/apple";

/** Source images are 1688px wide; 320px covers the 160px render at 2x. */
export const DEVICE_ARTWORK_WIDTH = 320;

/** Apple model identifiers contain letters, digits, commas and dots. */
const APPLE_MODEL_IDENTIFIER = /^[A-Za-z0-9][A-Za-z0-9,._-]*$/;

/**
 * Resolve the artwork URL for a device.
 *
 * Windows, Android and unknown models have no Apple render. Identifiers are
 * restricted to the characters Apple uses, so a crafted value cannot escape
 * the artwork directory. Commas are intentionally left unescaped: the static
 * asset server rejects `%2C` for these filenames.
 */
export const appleDeviceArtworkUrl = (
  proto: string | null | undefined,
  modelIdentifier: string | null | undefined,
): string | undefined => {
  if (proto !== "apple") return undefined;

  const identifier = modelIdentifier?.trim();

  if (!identifier || !APPLE_MODEL_IDENTIFIER.test(identifier)) return undefined;

  return `${APPLE_DEVICE_ARTWORK_PATH}/${identifier}.webp`;
};

/** Apple's coverage checker accepts a serial in the query string. */
export const appleWarrantyUrl = (
  proto: string | null | undefined,
  serial: string | null | undefined,
): string | undefined => {
  if (proto !== "apple") return undefined;

  const value = serial?.trim();

  if (!value) return undefined;

  return `https://checkcoverage.apple.com/?sn=${encodeURIComponent(value)}`;
};
