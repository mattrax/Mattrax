import { cn } from "~/lib/utils";

/**
 * The Mattrax wordmark in both theme variants.
 *
 * One source image keeps the logo visible from first paint in either theme;
 * the dark variant inverts the black lockup instead of mounting a second,
 * initially hidden image that can become a late Largest Contentful Paint.
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
        width={208}
        height={32}
        decoding="async"
        fetchpriority="high"
        class={cn("w-auto dark:invert", sizing())}
      />
    </span>
  );
}
