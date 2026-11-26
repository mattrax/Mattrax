import { Button } from "~/components/ui/button";
import { ArrowUpRight, BookOpen } from "~/components/ui/icons";

/**
 * A documentation link to a vendor's site.
 *
 * Opens in a new tab and carries the destination in its accessible name, since
 * the visible label is intentionally short in dense editors.
 */
export default function DocumentationLink(props: {
  href: string;
  source: "Apple" | "Microsoft";
  subject: string;
  class?: string;
}) {
  return (
    <span class={props.class}>
      <Button
      as="a"
      href={props.href}
      target="_blank"
      rel="noreferrer noopener"
      variant="ghost"
      size="xs"
      class="shrink-0"
      aria-label={`Open ${props.source} documentation for ${props.subject} (opens in a new tab)`}
      title={`${props.source} documentation`}
    >
      <BookOpen class="size-3" />
      <span>Documentation</span>
      <ArrowUpRight class="size-2.5" />
      </Button>
    </span>
  );
}
