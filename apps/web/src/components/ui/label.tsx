import type { ComponentProps } from "@solidjs/web";
import { Label as LabelPrimitive } from "@mattrax/ui";

export default function Label(props: ComponentProps<typeof LabelPrimitive>) {
  return <LabelPrimitive {...props} />;
}
