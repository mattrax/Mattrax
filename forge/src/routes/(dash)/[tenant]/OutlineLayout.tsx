import { ParentProps, JSX } from "solid-js";

export function OutlineLayout(
  props: ParentProps & { title: string; topRight?: JSX.Element }
) {
  return (
    <div class="flex-1 flex flex-col">
      <div class="flex flex-row justify-between pt-8 px-4">
        <h1 class="text-3xl font-bold">{props.title}</h1>
        {props.topRight}
      </div>
      {props.children}
    </div>
  );
}
