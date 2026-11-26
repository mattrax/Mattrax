import { ArrowRight } from "@mattrax/ui";
import type { JSX } from "@solidjs/web";

export function LandingEyebrow(props: { children: JSX.Element }) {
  return (
    <p class="lr-eyebrow">
      <span class="lr-eyebrow__dot" aria-hidden="true" />
      {props.children}
    </p>
  );
}

export function LandingLink(props: { href: string; children: JSX.Element; class?: string }) {
  return (
    <a href={props.href} target="_self" class={`lr-link ${props.class ?? ""}`}>
      {props.children}
      <ArrowRight aria-hidden="true" />
    </a>
  );
}
