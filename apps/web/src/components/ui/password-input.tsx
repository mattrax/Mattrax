import { createSignal, Show } from "solid-js";
import type { ComponentProps } from "@solidjs/web";
import { Eye, EyeOff } from "~/components/ui/icons";
import { Input } from "~/components/ui/input";
import { splitProps } from "~/lib/solid";
import { cn } from "~/lib/utils";

type PasswordInputProps = Omit<ComponentProps<"input">, "type">;

/**
 * A password field with a reveal toggle.
 *
 * Passwords on enrollment and policy screens are long and usually copied, so a
 * typo there is expensive. The toggle stays a real button (not a click handler
 * on the icon) with `aria-pressed` so assistive technology announces the
 * current state, and the input keeps every caller-supplied attribute such as
 * `id`, `name`, `autocomplete` and `aria-describedby`.
 */
const PasswordInput = (props: PasswordInputProps) => {
  const [local, others] = splitProps(props, ["class"]);
  const [visible, setVisible] = createSignal(false);

  return (
    <div class="relative">
      <Input {...others} type={visible() ? "text" : "password"} class={cn("pr-10", local.class)} />
      <button
        type="button"
        class="absolute inset-y-0 right-1 my-auto flex size-7 items-center justify-center rounded-md text-muted-foreground outline-none transition-colors hover:bg-muted/60 hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/50"
        aria-pressed={visible() ? "true" : "false"}
        aria-label={visible() ? "Hide password" : "Show password"}
        onClick={() => setVisible((value) => !value)}
      >
        <Show when={visible()} fallback={<Eye class="size-4" aria-hidden="true" />}>
          <EyeOff class="size-4" aria-hidden="true" />
        </Show>
      </button>
    </div>
  );
};

export { PasswordInput, type PasswordInputProps };
