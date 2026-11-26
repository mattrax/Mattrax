import type { ComponentProps } from "@solidjs/web";
import { createSignal, Show } from "solid-js";
import { splitProps } from "./lib/solid";
import { cn } from "./lib/cn";
import { Eye, EyeOff } from "./icons";
import { Input } from "./input";

export type PasswordInputProps = Omit<ComponentProps<"input">, "type">;

/** A password field with a reveal toggle that keeps its accessible name in sync. */
export default function PasswordInput(props: PasswordInputProps) {
  const [local, others] = splitProps(props, ["class"]);
  const [visible, setVisible] = createSignal(false);

  return (
    <div class="relative">
      <Input {...others} type={visible() ? "text" : "password"} class={cn("pr-9", local.class)} />
      <button
        type="button"
        class="absolute inset-y-0 right-1 my-auto flex size-6.5 items-center justify-center rounded-sm text-muted-foreground outline-none transition duration-150 ease-out hover:bg-hover hover:text-foreground active:scale-90 focus-visible:ring-3 focus-visible:ring-ring/30"
        aria-pressed={visible() ? "true" : "false"}
        aria-label={visible() ? "Hide password" : "Show password"}
        onClick={() => setVisible((value) => !value)}
      >
        <Show when={visible()} fallback={<Eye class="size-3.5" />}>
          <EyeOff class="size-3.5" />
        </Show>
      </button>
    </div>
  );
}
