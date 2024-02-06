import { ParentProps } from "solid-js";

export function OutlineLayout(props: ParentProps & { title: string }) {
  return (
    <div class="flex-1 px-4 py-8">
      <h1 class="text-3xl font-bold mb-4">{props.title}</h1>
      {props.children}
    </div>
  );
}
