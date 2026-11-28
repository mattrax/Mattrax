import { Button } from "@mattrax/ui";

/**
 * Inline resolution for a 412 conflict. The editor keeps its draft; the
 * operator chooses whether to discard it for the latest saved version or to
 * deliberately save their version over it.
 */
export default function StaleWriteBanner(props: {
  readonly reloading?: boolean;
  readonly onReload: () => void;
  readonly onKeepMine: () => void;
}) {
  return (
    <div
      role="status"
      class="flex shrink-0 flex-wrap items-center gap-x-4 gap-y-2 rounded-lg border border-warning/30 bg-warning/[0.07] px-3 py-2.5 text-xs text-foreground"
    >
      <div class="min-w-0 flex-1">
        <p class="font-semibold">This record changed while you were editing</p>
        <p class="mt-0.5 text-xs leading-relaxed text-muted-foreground">
          Your changes are kept. Reload the latest version to merge them yourself, or save yours
          over it on purpose.
        </p>
      </div>
      <div class="flex shrink-0 items-center gap-2">
        <Button size="sm" variant="outline" disabled={props.reloading} onClick={props.onReload}>
          {props.reloading ? "Reloading…" : "Reload latest"}
        </Button>
        <Button size="sm" variant="ghost" onClick={props.onKeepMine}>
          Save mine over it
        </Button>
      </div>
    </div>
  );
}
