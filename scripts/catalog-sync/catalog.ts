/**
 * Platform metadata and helpers shared by the catalogue loaders. The browser
 * contract lives in `apps/web/src/lib/policy-designer/catalog.ts`; these shapes
 * must stay compatible with it.
 */

export type PlatformId = "apple" | "android" | "windows";

export type PropertyType =
  | "string"
  | "integer"
  | "real"
  | "boolean"
  | "date"
  | "data"
  | "array"
  | "dictionary"
  | "enum"
  | "unknown";

export interface PropertyEnumValue {
  value: string;
  description?: string;
}

/** One setting, matching the `Property` struct served to the designer. */
export interface Property {
  key: string;
  name: string;
  type: PropertyType;
  description: string;
  defaultValue?: unknown;
  required?: boolean;
  enum?: PropertyEnumValue[];
  deprecated?: boolean;
  minOs?: string;
  introducedIn?: string;
  children?: Property[];
  address?: string;
  scope?: "device" | "user" | "system";
  category?: string;
  pattern?: string;
  min?: number;
  max?: number;
  source?: string;
}

/** One profile, declaration, policy or CSP, matching the served `Collection`. */
export interface Collection {
  id: string;
  platform: PlatformId;
  kind: "profile" | "declaration" | "policy" | "csp";
  surface: string;
  identifier: string;
  name: string;
  description: string;
  group?: string;
  deprecated?: boolean;
  minOs?: string;
  osVersions?: string[];
  properties: Property[];
  source?: string;
}

export interface Platform {
  id: PlatformId;
  name: string;
  short: string;
  description: string;
  docUrl: string;
}

export const PLATFORMS: Platform[] = [
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
export const countProperties = (properties: readonly Property[]): number => {
  let total = 0;

  for (const property of properties) {
    total += 1;

    if (property.children?.length) total += countProperties(property.children);
  }

  return total;
};
