import { onSettled } from "solid-js";

export default function Page() {
  if (import.meta.env.DEV) return <p class="p-4">Documentation is not available in development!</p>;
  onSettled(() => {
    // If this is hit in prod, we did an SPA route (forgot `target="_self"`) so this should reload and make the docs show correctly.
    location.reload();
  });
  return undefined;
}
