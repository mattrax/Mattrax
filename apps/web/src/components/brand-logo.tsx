import { cn } from "~/lib/utils";

/**
 * The Mattrax wordmark in both theme variants.
 *
 * The brand ships a white and a dark lockup. Rendering both and letting the
 * theme class pick one keeps the logo correct under an explicit light/dark
 * choice, which `prefers-color-scheme` media queries cannot express. The second
 * copy is hidden from assistive technology so the link is announced once.
 */
export function BrandLogo(props: { class?: string }) {
  const sizing = () => props.class ?? "h-4";

  return (
    <>
      <img
        src="/assets/brand/mattrax.png"
        alt="Mattrax"
        width="208"
        height="32"
        decoding="async"
        class={cn("w-auto dark:hidden", sizing())}
      />
      <img
        src="/assets/brand/mattrax-white-208.png"
        alt=""
        aria-hidden="true"
        width="208"
        height="32"
        decoding="async"
        class={cn("hidden w-auto dark:block", sizing())}
      />
    </>
  );
}
