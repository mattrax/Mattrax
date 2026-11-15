/**
 * Constants that describe the public site.
 *
 * The document head, the structured data and the generated `sitemap.xml` all
 * read them from here so a rename cannot leave one surface describing a
 * different product.
 */

export const SITE_TITLE = "Mattrax";

export const SITE_DESCRIPTION =
  "Enrollment, policy, inventory and remote actions for Apple, Windows and Android fleets, with a clean API, a real audit trail and a deployment model that fits how you work.";

/** Absolute path to the social preview card. */
export const SITE_SOCIAL_IMAGE = "/assets/brand/og-image.jpg";

/** iOS pins this icon to the home screen, so it cannot be a content-hashed asset. */
export const SITE_TOUCH_ICON = "/assets/brand/apple-touch-icon.png";

/** Square brand mark used by structured data. */
export const SITE_LOGO = "/assets/brand/apple-touch-icon.png";

export const SITE_CONTACT_EMAIL = "hello@mattrax.app";

/** Profiles that belong to the same organisation as this site. */
export const SITE_SAME_AS = [
  "https://github.com/oscartbeaumont/mattraxe",
  "https://discord.gg/WPBHmDSfAn",
  "https://twitter.com/mattraxapp",
] as const;

/**
 * Canonical origin used only when a request cannot supply one. Every deployed
 * surface derives the origin from the request instead, so self-hosted and
 * preview hosts advertise themselves rather than this default.
 */
export const SITE_DEFAULT_ORIGIN = "https://mattrax.app";

/**
 * `Organization` JSON-LD for the landing page.
 *
 * Takes the serving origin so the URLs stay absolute and correct on every host.
 */
export function organizationStructuredData(origin: string) {
  return {
    "@context": "https://schema.org",
    "@type": "Organization",
    "@id": `${origin}/#organization`,
    name: SITE_TITLE,
    url: `${origin}/`,
    description: SITE_DESCRIPTION,
    logo: {
      "@type": "ImageObject",
      url: `${origin}${SITE_LOGO}`,
      width: 180,
      height: 180,
    },
    sameAs: [...SITE_SAME_AS],
    contactPoint: {
      "@type": "ContactPoint",
      contactType: "customer support",
      email: SITE_CONTACT_EMAIL,
      url: `${origin}/`,
    },
  };
}
