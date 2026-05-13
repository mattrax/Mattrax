import { Settings } from "~/components/ui/icons";

export default function SettingsPage() {
  return (
    <div class="flex flex-1 flex-col gap-6 p-6">
      <div>
        <h1 class="text-xl font-semibold text-stone-900">Settings</h1>
        <p class="text-sm text-stone-500 mt-1">Configure your Mattrax workspace.</p>
      </div>

      <div class="flex flex-col items-center justify-center rounded-xl border border-dashed border-border bg-muted/30 py-20 text-center gap-4">
        <div class="flex h-12 w-12 items-center justify-center rounded-full bg-muted">
          <Settings class="size-6 text-muted-foreground" />
        </div>
        <div>
          <p class="text-sm font-medium text-stone-700">Coming soon</p>
          <p class="text-sm text-muted-foreground mt-1 max-w-xs">
            Settings are on the way. Check back soon for workspace configuration options.
          </p>
        </div>
      </div>
    </div>
  );
}
