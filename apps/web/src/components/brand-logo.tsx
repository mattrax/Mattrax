import { cn } from "~/lib/utils";

/**
 * The Mattrax wordmark in both theme variants.
 *
 * The brand ships a white and a dark lockup. Rendering both and letting the
 * theme class pick one keeps the logo correct under an explicit light/dark
 * choice, which `prefers-color-scheme` media queries cannot express. Only one
 * copy is rendered at a time, so both carry the same accessible name.
 */
export default function BrandLogo(props: { class?: string; mark?: boolean }) {
  const sizing = () => props.class ?? "h-4";

  // The collapsed rail has no room for the wordmark; the "M" glyph keeps the
  // brand present without repeating the whole lockup.
  if (props.mark) {
    return (
      <span
        aria-hidden="true"
        class={`inline-flex items-center justify-center font-sans font-bold leading-none tracking-tighter text-foreground ${props.class ?? "text-lg"}`}
      >
        M
      </span>
    );
  }

  return (
    <span class="inline-flex items-center">
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
        alt="Mattrax"
        width="208"
        height="32"
        decoding="async"
        class={cn("hidden w-auto dark:block", sizing())}
      />
    </span>
  );
}
