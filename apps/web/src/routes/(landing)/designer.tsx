import { PolicyDesigner } from "~/components/mdm/policy-designer";

export default function DesignerPage() {
  return (
    <main class="mx-auto w-full max-w-7xl px-6 py-8">
      <h1 class="sr-only">MDM policy designer</h1>
      <PolicyDesigner mode="public" />
    </main>
  );
}
