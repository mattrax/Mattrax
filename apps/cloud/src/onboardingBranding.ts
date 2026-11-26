import type { OnboardingEmailBranding } from "@mattrax/enterprise-backend";

/**
 * The deployment-wide brand used before an account has a tenant. It feeds both
 * the immediate verification hook and the delayed welcome sweep, so a retried
 * welcome cannot arrive with different branding.
 */
export type DeploymentBrandingSource = {
  readonly MATTRAX_BRAND_NAME?: string | undefined;
  readonly MATTRAX_BRAND_LOGO_URL?: string | undefined;
  readonly MATTRAX_BRAND_COLOR?: string | undefined;
};

export const resolveDeploymentBranding = (
  source: DeploymentBrandingSource,
): OnboardingEmailBranding | undefined => {
  const brandName = source.MATTRAX_BRAND_NAME?.trim();
  const logoUrl = source.MATTRAX_BRAND_LOGO_URL?.trim();
  const brandColor = source.MATTRAX_BRAND_COLOR?.trim();

  if (!brandName && !logoUrl && !brandColor) return undefined;

  return {
    ...(brandName ? { brandName } : {}),
    ...(logoUrl ? { logoUrl } : {}),
    ...(brandColor ? { brandColor } : {}),
  };
};
