import { Errored, onSettled } from "solid-js";
import { ErrorPanel } from "~/components/error-boundary";

/**
 * Documentation is served as static files by the Worker; this route only exists
 * so an in-app navigation to `/docs/` reloads the document and hands over to
 * them. A render error here would otherwise leave a blank page, so the boundary
 * offers reload and the dashboard instead.
 */
export default function Page() {
  if (import.meta.env.DEV)
    return (
      <p class="p-4 text-[13px] text-muted-foreground">
        Documentation is not available in development.
      </p>
    );

  onSettled(() => {
    // If this is hit in prod, we did an SPA route (forgot `target="_self"`) so this should reload and make the docs show correctly.
    location.reload();
  });

  return (
    <Errored
      fallback={(error, reset) => (
        <div class="min-h-svh bg-background text-foreground">
          <ErrorPanel
            boundary="docs"
            error={error()}
            reset={reset}
            label="Documentation"
            variant="page"
          />
        </div>
      )}
    >
      <div class="min-h-svh bg-background p-6 text-[13px] text-muted-foreground">
        Opening the documentation…
      </div>
    </Errored>
  );
}
