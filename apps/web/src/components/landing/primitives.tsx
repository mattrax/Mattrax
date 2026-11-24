import { ArrowRight, buttonVariants } from "@mattrax/ui";
import type { JSX } from "@solidjs/web";
import { cn } from "~/lib/utils";

/** The small tracked label above a section heading. */
export function Eyebrow(props: { children: JSX.Element }) {
  return <p class="label-caps">{props.children}</p>;
}

/**
 * The no-JavaScript primary CTA.
 *
 * This is a real anchor in the server markup so a client that never runs JS can
 * still register. The inline `.js` class in the document head hides it before
 * first paint for JS clients; the pending skeleton beside it is the inverse.
 * Avoid <noscript> children here: browsers parse their contents as text, which
 * breaks Solid hydration for the surrounding subtree.
 */
export function NoJsStartFree(props: { class?: string }) {
  return (
    <a
      href="/register"
      data-no-js-only
      data-slot="button"
      class={cn(buttonVariants({ size: "lg" }), "h-10 px-5", props.class)}
    >
      Start free
      <ArrowRight class="size-3.5" />
    </a>
  );
}

/** A text link that reads as a next step rather than a second button. */
export function SectionLink(props: { href: string; children: JSX.Element; class?: string }) {
  return (
    <a href={props.href} target="_self" class={`lx-link ${props.class ?? ""}`}>
      {props.children}
      <ArrowRight class="size-3" />
    </a>
  );
}
