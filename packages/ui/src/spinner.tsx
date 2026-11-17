import type { ComponentProps } from "@solidjs/web";
import { splitProps } from "./lib/solid";
import { cn } from "./lib/cn";

/** A small, quiet activity indicator that inherits the current text colour. */
function Spinner(props: ComponentProps<"span"> & { class?: string }) {
  const [local, others] = splitProps(props, ["class"]);

  return (
    <span
      role="status"
      aria-label="Loading"
      data-slot="spinner"
      class={cn(
        "inline-block size-4 shrink-0 animate-spin rounded-full border-[1.5px] border-current border-r-transparent align-[-0.125em]",
        local.class,
      )}
      {...others}
    />
  );
}

export { Spinner };
