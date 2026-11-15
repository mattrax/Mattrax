import type { PolymorphicProps } from "@kobalte/core/polymorphic";
import { Separator as SeparatorPrimitive, type SeparatorRootProps } from "@kobalte/core/separator";
import type { ComponentProps, ValidComponent } from "@solidjs/web";
import { mergeProps, splitProps } from "~/lib/solid";
import { cn } from "~/lib/utils";

type SeparatorProps<T extends ValidComponent = "hr"> = PolymorphicProps<T, SeparatorRootProps<T>> &
  Pick<ComponentProps<T>, "class">;

const Separator = <T extends ValidComponent = "hr">(props: SeparatorProps<T>) => {
  // SAFETY: the default props object is described by the component props type;
  // `merge` combines it with the caller's props under that same contract.
  const mergedProps = mergeProps({ orientation: "horizontal" } as const, props);
  // SAFETY: `splitProps` must see the concrete component props type to remove
  // the wrapper-owned keys; `T` only varies the polymorphic element and does not
  // change those keys.
  const [local, others] = splitProps(mergedProps as SeparatorProps, ["class"]);

  return (
    <SeparatorPrimitive
      data-slot="separator"
      class={cn(
        "shrink-0 bg-border data-[orientation=horizontal]:h-px data-[orientation=vertical]:h-full data-[orientation=horizontal]:w-full data-[orientation=vertical]:w-px",
        local.class,
      )}
      {...others}
    />
  );
};

export { Separator, type SeparatorProps };
