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

/** The landing page's search and social copy. */
export const LANDING_TITLE = "MDM for Apple, Windows and Android fleets | Mattrax";

export const LANDING_DESCRIPTION =
  "Device management for Apple, Windows and Android from one MDM. Native protocols, a readable policy trace, audit export, self-host or cloud. Free in alpha.";

export const LANDING_OG_TITLE = "Mattrax — device management without the black box";

export const LANDING_OG_DESCRIPTION =
  "One control plane for Apple, Windows and Android fleets. Native protocols, a policy trace you can read, and an audit trail you can export. Cloud or self-hosted.";

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
 * `FAQPage` JSON-LD for the landing page.
 *
 * Only the questions rendered on the page belong here; the answers are the
 * same plain text a reader sees, so the structured data cannot drift into a
 * claim the page does not make.
 */
export function faqStructuredData(entries: readonly FaqEntry[]) {
  return {
    "@context": "https://schema.org",
    "@type": "FAQPage",
    mainEntity: entries.map((entry) => ({
      "@type": "Question",
      name: entry.question,
      acceptedAnswer: {
        "@type": "Answer",
        text: entry.answer,
      },
    })),
  };
}

export type FaqEntry = {
  readonly question: string;
  readonly answer: string;
};

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
