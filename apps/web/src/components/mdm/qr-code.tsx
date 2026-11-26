import { createMemo, Show } from "solid-js";
import { cn } from "@mattrax/ui";
import { qrPath } from "~/lib/qr";

/**
 * A compact, dependency-light QR renderer. The SVG is inline (rather than an
 * `<img>` data URI) so it prints and screenshots correctly and inherits the
 * surrounding card's sizing.
 */
export default function QrCode(props: { value: string; label?: string; class?: string; size?: number }) {
  const qr = createMemo(() => (props.value ? qrPath(props.value) : null));
  // The SVG's own rect paints the fixed light background, so the root only
  // needs layout classes; a caller can still style the frame via `cn`.
  const classes = () => cn("block h-auto max-w-full", props.class);

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
