import { Button } from "~/components/ui/button";
import { ArrowUpRight, BookOpen } from "~/components/ui/icons";
import { cn } from "~/lib/utils";

/**
 * A documentation link to a vendor's site.
 *
 * Opens in a new tab and carries the destination in its accessible name, since
 * the visible label is intentionally short in dense editors.
 */
export function DocumentationLink(props: {
  href: string;
  source: "Apple" | "Microsoft";
  subject: string;
  class?: string;
}) {
  return (
    <Button
      as="a"
      href={props.href}
      target="_blank"
      rel="noreferrer noopener"
      variant="ghost"
      size="xs"
      class={cn("shrink-0 text-muted-foreground hover:text-foreground", props.class)}
      aria-label={`Open ${props.source} documentation for ${props.subject} (opens in a new tab)`}
      title={`${props.source} documentation`}
    >
      <BookOpen class="size-3" />
      <span>Documentation</span>
      <ArrowUpRight class="size-2.5 opacity-60" />
    </Button>
  );
}
