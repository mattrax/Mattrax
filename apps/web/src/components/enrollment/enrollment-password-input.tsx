import type { ComponentProps } from "@solidjs/web";
import { isServer } from "@solidjs/web";
import { createSignal, isHydrating, onHydrationEnd, Show } from "solid-js";
import { Input } from "~/components/ui/input";
import { Eye, EyeOff } from "~/components/ui/icons";
import { Button } from "~/components/ui/button";

type EnrollmentPasswordInputProps = Omit<ComponentProps<"input">, "type">;

/**
 * A native password field that is fully submittable before JavaScript loads.
 * The reveal control is mounted only after hydration, so the server HTML and
 * no-JavaScript experience contain nothing that depends on client state.
 */
export default function EnrollmentPasswordInput(props: EnrollmentPasswordInputProps) {
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
        class="h-12"
      />
      <Show when={enhanced()}>
        {/* A changing label is the whole state: announce either a reveal or a
            conceal action, and leave `aria-pressed` off so assistive tech never
            hears a pressed toggle whose label also changed. */}
        <Button
          type="button"
          class="absolute inset-y-1 right-1 my-auto flex size-11 items-center justify-center motion-safe:active:scale-95"
          aria-label={visible() ? "Hide password" : "Show password"}
          onClick={() => {
            setVisible((value) => !value);
            input?.focus();
          }}
        >
          <Show when={visible()} fallback={<Eye class="size-4" />}>
            <EyeOff class="size-4" />
          </Show>
        </Button>
      </Show>
    </div>
  );
}
