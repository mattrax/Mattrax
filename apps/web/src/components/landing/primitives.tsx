import { ArrowRight } from "@mattrax/ui";
import type { JSX } from "@solidjs/web";

/** The small tracked label above a section heading. */
export function Eyebrow(props: { children: JSX.Element }) {
  return <p class="label-caps">{props.children}</p>;
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
