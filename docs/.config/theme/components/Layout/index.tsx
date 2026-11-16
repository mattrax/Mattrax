import { Layout as DefaultLayout, type LayoutProps } from "@rspress/core/theme-original";
import { DocsBreadcrumbJsonLd } from "../DocsBreadcrumbJsonLd";

/**
 * The docs shell.
 *
 * Wraps the default layout so every documentation page ships its
 * `BreadcrumbList` JSON-LD in the statically rendered HTML, whether or not
 * client JavaScript ever runs.
 */
export function Layout(props: LayoutProps) {
  return (
    <>
      <DocsBreadcrumbJsonLd />
      <DefaultLayout {...props} />
    </>
  );
}
