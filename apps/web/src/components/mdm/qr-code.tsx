import { createMemo, Show } from "solid-js";
import { cn } from "@mattrax/ui";
import { qrPath } from "~/lib/qr";

/**
 * A compact, dependency-light QR renderer. The SVG is inline (rather than an
 * `<img>` data URI) so it prints and screenshots correctly and inherits the
 * surrounding card's sizing.
 */
export function QrCode(props: { value: string; label?: string; class?: string; size?: number }) {
  const qr = createMemo(() => (props.value ? qrPath(props.value) : null));
  // The fixed light background keeps the code scannable everywhere; a caller
  // that frames it can still override the surface through `cn` merging.
  const classes = () => cn("block h-auto max-w-full bg-[var(--qr-background)]", props.class);

  return (
    <Show when={qr()}>
      {(code) => (
        <svg
          xmlns="http://www.w3.org/2000/svg"
          viewBox={`0 0 ${code().size} ${code().size}`}
          width={props.size ?? 176}
          height={props.size ?? 176}
          role="img"
          aria-label={props.label ?? "Enrollment QR code"}
          {...{ "shape-rendering": "crispEdges" }}
          class={classes()}
        >
          {/* QR codes need absolute contrast to scan. These colours stay fixed
              in every theme; the quiet zone is part of the SVG viewBox, not CSS
              padding, so screenshots and prints preserve it. */}
          <rect width={code().size} height={code().size} fill="var(--qr-background)" />
          <path d={code().path} fill="var(--qr-foreground)" />
        </svg>
      )}
    </Show>
  );
}
