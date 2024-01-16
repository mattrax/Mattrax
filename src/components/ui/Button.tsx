import { ParentProps } from "solid-js";
import { Button as KButton } from "@kobalte/core";

export function Button(
  props: ParentProps<{
    onClick?: () => void;
    class?: string;
    classList?: {
      [k: string]: boolean | undefined;
    };
  }>
) {
  return <KButton.Root {...props}>{props.children}</KButton.Root>;
}
