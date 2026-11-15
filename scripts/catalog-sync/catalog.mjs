/**
 * Platform metadata and helpers shared by the catalogue loaders. The browser
 * contract lives in `apps/web/src/lib/policy-designer/catalog.ts`; these shapes
 * must stay compatible with it.
 */
export const PLATFORMS = [
  {
    id: "apple",
    name: "Apple",
    short: "Apple",
    description:
      "Configuration profile payloads (.mobileconfig) and Declarative Device Management declarations for macOS, iOS, iPadOS and tvOS.",
    docUrl: "https://developer.apple.com/documentation/devicemanagement",
  },
  {
    id: "android",
    name: "Android",
    short: "Android",
    description:
      "Android Management API Policy and device/app configuration fields, applied as JSON through enterprises.policies.",
    docUrl:
      "https://developers.google.com/android/management/reference/rest/v1/enterprises.policies",
  },
  {
    id: "windows",
    name: "Windows",
    short: "Windows",
    description:
      "MDM configuration service providers (CSPs) addressed by OMA-URI and applied over OMA-DM / SyncML.",
    docUrl:
      "https://learn.microsoft.com/en-us/windows/client-management/mdm/configuration-service-provider-reference",
  },
];

/** Total number of settings, counting nested children. */
export const countProperties = (properties) => {
  let total = 0;

  for (const property of properties) {
    total += 1;

    if (property.children?.length) total += countProperties(property.children);
  }

  return total;
};
