import { For, Show } from "solid-js";
import { cn } from "~/lib/utils";
import { resolvedTheme, setThemePreference, themePreference, THEME_PREFERENCES } from "~/lib/theme";
import type { ThemePreference } from "~/lib/theme";
import { Monitor, Moon, Sun } from "~/components/ui/icons";
import { Input } from "~/components/ui/input";

const LABELS: Record<ThemePreference, string> = {
  system: "System",
  light: "Light",
  dark: "Dark",
};

const DESCRIPTIONS: Record<ThemePreference, string> = {
  system: "Follow your operating system setting.",
  light: "Always use the light palette.",
  dark: "Always use the dark palette.",
};

function ThemeIcon(props: { preference: ThemePreference; class?: string }) {
  return (
    <Show
      when={props.preference !== "system"}
      fallback={<Monitor class="size-3.5" aria-hidden="true" />}
    >
      <Show
        when={props.preference === "dark"}
        fallback={<Sun class="size-3.5" aria-hidden="true" />}
      >
        <Moon class="size-3.5" aria-hidden="true" />
      </Show>
    </Show>
  );
}

/**
 * `system | light | dark` picker.
 *
 * Native radio inputs carry the semantics (arrow keys, checked state, form
 * labels) and the visible tile is just their label, so the control behaves like
 * the radio group it is. The choice is stored per account on this device and
 * applied immediately; the resolved theme (what `system` currently means) is
 * spelled out so the control explains itself.
 */
export default function ThemeSwitcher(props: { userId?: string; class?: string }) {
  return (
    <div class={cn("space-y-3", props.class)}>
      <div
        role="radiogroup"
        aria-label="Colour theme"
        class="grid grid-cols-3 gap-1 rounded-lg border border-border bg-surface p-1"
      >
        <For each={THEME_PREFERENCES}>
          {(preference) => {
            const selected = () => themePreference() === preference;

            return (
              <label
                class={cn(
                  "flex h-8 cursor-pointer items-center justify-center gap-1.5 rounded-md text-xs font-medium transition-colors",
                  "has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-ring/50",
                  selected()
                    ? "bg-card text-foreground shadow-card"
                    : "text-muted-foreground hover:text-foreground",
                )}
              >
                <Input
                  type="radio"
                  name="mattrax-theme"
                  value={preference}
                  class="sr-only"
                  checked={selected()}
                  onChange={() => setThemePreference(preference, props.userId)}
                />
                <ThemeIcon preference={preference} class="size-3.5" />
                {LABELS[preference]}
              </label>
            );
          }}
        </For>
      </div>
      <p class="text-xs leading-relaxed text-muted-foreground">
        {DESCRIPTIONS[themePreference()]}
        <Show when={themePreference() === "system"}>
          {" "}
          Your system currently asks for the {resolvedTheme()} theme.
        </Show>
      </p>
    </div>
  );
}
