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
          shape-rendering="crispEdges"
          class={props.class ?? "rounded-lg bg-white p-2"}
        >
          <rect width={code().size} height={code().size} fill="#ffffff" />
          <path d={code().path} fill="#1c1917" />
        </svg>
      )}
    </Show>
  );
}
