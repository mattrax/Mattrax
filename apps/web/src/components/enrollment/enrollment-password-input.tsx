import type { ComponentProps } from "@solidjs/web";
import { isServer } from "@solidjs/web";
import { createSignal, isHydrating, onHydrationEnd, Show } from "solid-js";
import { Input } from "~/components/ui/input";
import { Eye, EyeOff } from "~/components/ui/icons";

type EnrollmentPasswordInputProps = Omit<ComponentProps<"input">, "type">;

/**
 * A native password field that is fully submittable before JavaScript loads.
 * The reveal control is mounted only after hydration, so the server HTML and
 * no-JavaScript experience contain nothing that depends on client state.
 */
export function EnrollmentPasswordInput(props: EnrollmentPasswordInputProps) {
  const [enhanced, setEnhanced] = createSignal(false);
  const [visible, setVisible] = createSignal(false);
  let input: HTMLInputElement | undefined;

  if (!isServer) {
    if (isHydrating()) onHydrationEnd(() => setEnhanced(true));
    else setEnhanced(true);
  }

  return (
    <div class="relative">
      <Input
        {...props}
        ref={input}
        type={visible() ? "text" : "password"}
        class={"h-12 pr-12 text-base sm:text-sm" + (props.class ? " " + props.class : "")}
      />
      <Show when={enhanced()}>
        <button
          type="button"
          class="absolute inset-y-1 right-1 my-auto flex size-11 items-center justify-center rounded-[5px] text-muted-foreground outline-none transition-[background-color,color,transform] duration-[var(--duration-hover)] ease-swift hover:bg-hover hover:text-foreground active:scale-90 focus-visible:ring-[3px] focus-visible:ring-ring/30"
          aria-pressed={visible() ? "true" : "false"}
          aria-label={visible() ? "Hide password" : "Show password"}
          aria-controls={props.id}
          onClick={() => {
            setVisible((value) => !value);
            input?.focus();
          }}
        >
          <Show when={visible()} fallback={<Eye class="size-4" />}>
            <EyeOff class="size-4" />
          </Show>
        </button>
      </Show>
    </div>
  );
}
