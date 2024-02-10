import { ParentProps, JSX } from "solid-js";

export function OutlineLayout(
  props: ParentProps & { title: string; topRight?: JSX.Element }
) {
  return (
    <div class="flex-1 px-4 py-8 flex flex-col">
      <div class="flex flex-row justify-between">
        <h1 class="text-3xl font-bold mb-4">{props.title}</h1>
        {props.topRight}
      </div>
      {props.children}
    </div>
  );
}
