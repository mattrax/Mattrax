import type { ComponentProps } from "@solidjs/web";
import { PasswordInput as PasswordInputPrimitive } from "@mattrax/ui";

type PasswordInputProps = ComponentProps<typeof PasswordInputPrimitive>;

export default function PasswordInput(props: PasswordInputProps) {
  return <PasswordInputPrimitive {...props} />;
}

export type { PasswordInputProps };
