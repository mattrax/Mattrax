import { createMemo, Show } from "solid-js";
import { qrPath } from "~/lib/qr";

/**
 * A compact, dependency-light QR renderer. The SVG is inline (rather than an
 * `<img>` data URI) so it prints and screenshots correctly and inherits the
 * surrounding card's sizing.
 */
export function QrCode(props: { value: string; label?: string; class?: string; size?: number }) {
  const qr = createMemo(() => (props.value ? qrPath(props.value) : null));

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
          class={props.class ?? "rounded-lg bg-[var(--qr-background)] p-2"}
        >
          {/* QR codes need absolute contrast to scan, so these two tokens are
              fixed white/black in every theme rather than theme surfaces. */}
          <rect width={code().size} height={code().size} class="fill-[var(--qr-background)]" />
          <path d={code().path} class="fill-[var(--qr-foreground)]" />
        </svg>
      )}
    </Show>
  );
}
