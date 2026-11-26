import type { ComponentProps } from "@solidjs/web";
import { Separator as SeparatorPrimitive } from "@mattrax/ui";

export default function Separator(props: ComponentProps<typeof SeparatorPrimitive>) {
  return <SeparatorPrimitive {...props} />;
}
