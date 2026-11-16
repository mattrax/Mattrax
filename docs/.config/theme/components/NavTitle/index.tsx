// This component shadows the theme's own `NavTitle`, so the bundler never
// loads that module and its stylesheet — the only place the light/dark wordmark
// swap is defined — is dropped from the build. The three rules live in
// `docs/styles/global.css` instead of a deep import into the package's `dist/`.
import { normalizeImagePath, useSite } from "@rspress/core/runtime";
import type { ComponentProps } from "react";

type LogoPair = { light: string; dark: string; width?: number; height?: number };

/**
 * The logo config accepts one path or an explicit light/dark pair. The site
 * data is untyped at this boundary, so the pair is recognised structurally.
 */
function isLogoPair(value: unknown): value is LogoPair {
  if (typeof value !== "object" || value === null) return false;

  // SAFETY: the object and null checks above prove this is a non-null object;
  // the fields are still narrowed by the `typeof` checks below.
  const candidate = value as { light?: ComponentProps<"img">["src"]; dark?: string };

  return typeof candidate.light === "string" && typeof candidate.dark === "string";
}

/**
 * Nav wordmark.
 *
 * A copy of the default `NavTitle` that links to the site root with a plain
 * anchor instead of the router `Link`. Rspress resolves root-relative hrefs
 * against `base` (`/docs/`), so the default link can never leave the docs; the
 * wordmark should return to the product home in the same tab.
 *
 * The markup and classes match the default component so the theme's own styles
 * (including the light/dark image swap) keep working.
 */
export const NavTitle = () => {
  const { site } = useSite();
  const { logo: rawLogo, logoText, title } = site;
  const name = title || "Mattrax";
  const alt = logoText ? "" : name;

  const renderLogo = () => {
    if (!rawLogo) return null;

    if (isLogoPair(rawLogo)) {
      return (
        <>
          <img
            src={normalizeImagePath(rawLogo.light)}
            alt={alt}
            id="logo"
            width={rawLogo.width ?? 104}
            height={rawLogo.height ?? 16}
            className="rspress-logo rp-nav__title__logo-image rp-nav__title__logo-image--light"
          />
          <img
            src={normalizeImagePath(rawLogo.dark)}
            alt={alt}
            width={rawLogo.width ?? 104}
            height={rawLogo.height ?? 16}
            className="rspress-logo rp-nav__title__logo-image rp-nav__title__logo-image--dark"
          />
        </>
      );
    }

    return (
      <img
        src={normalizeImagePath(rawLogo)}
        alt={alt}
        id="logo"
        width={104}
        height={16}
        className="rspress-logo rp-nav__title__logo-image"
      />
    );
  };

  return (
    <div className="rp-nav__title">
      <a href="/" className="rp-nav__title__link" aria-label={`${name} home`}>
        {rawLogo && <div className="rp-nav__title__logo">{renderLogo()}</div>}
        {logoText && <span>{logoText}</span>}
        {!rawLogo && !logoText && <span>{name}</span>}
      </a>
    </div>
  );
};
