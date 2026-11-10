/**
 * Tenant branding helpers shared by the API, dashboard and protocol packages.
 *
 * Branding is optional: every field falls back to the hosted Mattrax defaults
 * so an unconfigured tenant keeps the existing behaviour.
 */

export const DEFAULT_BRAND_NAME = "Mattrax";
export const DEFAULT_SUPPORT_EMAIL = "hello@mattrax.app";
/** Stone-900, the colour used by the default dashboard chrome. */
export const DEFAULT_BRAND_COLOR = "#1c1917";

const HEX_COLOR = /^#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/;
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const LOGO_DATA_URL = /^data:image\/(?:png|jpe?g|gif|webp|svg\+xml);base64,[a-z0-9+/=\s]+$/i;
const HTTP_URL = /^https?:\/\/[^\s]+$/i;

export type TenantBrandingSource = {
  readonly name: string;
  readonly displayName?: string | null;
  readonly logo?: string | null;
  readonly supportEmail?: string | null;
  readonly brandColor?: string | null;
};

export type ResolvedTenantBranding = {
  readonly displayName: string;
  readonly logo: string | null;
  readonly supportEmail: string;
  readonly brandColor: string;
};

const nonEmpty = (value: string | null | undefined): string | undefined => {
  const trimmed = value?.trim();
  return trimmed ? trimmed : undefined;
};

export const isBrandColor = (value: string): boolean => HEX_COLOR.test(value.trim());

/** Expand `#rgb` to `#rrggbb` and lowercase so stored values are canonical. */
export const normalizeBrandColor = (value: string): string | null => {
  const trimmed = value.trim();
  if (!HEX_COLOR.test(trimmed)) return null;
  if (trimmed.length === 4)
    return `#${trimmed
      .slice(1)
      .split("")
      .map((char) => `${char}${char}`)
      .join("")}`.toLowerCase();
  return trimmed.toLowerCase();
};

export const isSupportEmail = (value: string): boolean => EMAIL.test(value.trim());

/**
 * A logo may be an http(s) URL, an inline image data URL, or a same-origin
 * path. Anything else (notably `javascript:` and other schemes) is rejected.
 */
export const isLogoUrl = (value: string): boolean => {
  const trimmed = value.trim();
  return (
    HTTP_URL.test(trimmed) ||
    LOGO_DATA_URL.test(trimmed) ||
    (trimmed.startsWith("/") && !trimmed.startsWith("//"))
  );
};

export const resolveTenantBranding = (source: TenantBrandingSource): ResolvedTenantBranding => ({
  displayName: nonEmpty(source.displayName) ?? nonEmpty(source.name) ?? DEFAULT_BRAND_NAME,
  logo: nonEmpty(source.logo) ?? null,
  supportEmail: nonEmpty(source.supportEmail) ?? DEFAULT_SUPPORT_EMAIL,
  brandColor: normalizeBrandColor(source.brandColor ?? "") ?? DEFAULT_BRAND_COLOR,
});

/** Field-level validation used by the dashboard and write endpoints. */
export const validateTenantBranding = (input: {
  readonly displayName?: string | null;
  readonly logo?: string | null;
  readonly supportEmail?: string | null;
  readonly brandColor?: string | null;
}): Partial<Record<"displayName" | "logo" | "supportEmail" | "brandColor", string>> => {
  const errors: Partial<Record<"displayName" | "logo" | "supportEmail" | "brandColor", string>> =
    {};
  if (input.displayName && input.displayName.trim().length > 255)
    errors.displayName = "Display name must be 255 characters or fewer";
  if (input.logo?.trim() && !isLogoUrl(input.logo))
    errors.logo = "Logo must be an http(s) URL, a data: image URL, or an absolute path";
  if (input.supportEmail?.trim()) {
    if (!isSupportEmail(input.supportEmail))
      errors.supportEmail = "Enter a valid support email address";
    else if (input.supportEmail.trim().length > 320)
      errors.supportEmail = "Support email must be 320 characters or fewer";
  }
  if (input.brandColor?.trim() && !isBrandColor(input.brandColor))
    errors.brandColor = "Brand colour must be a hex value like #1c1917";
  return errors;
};
