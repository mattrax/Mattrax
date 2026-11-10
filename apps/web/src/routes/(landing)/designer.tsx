import { PolicyDesigner } from "~/components/mdm/policy-designer";

export default function DesignerPage() {
  return (
    <main class="flex h-[calc(100svh-4rem)] min-h-0 w-full flex-col overflow-hidden bg-stone-50">
      <h1 class="sr-only">MDM policy designer</h1>
      <PolicyDesigner mode="public" />
    </main>
  );
}
