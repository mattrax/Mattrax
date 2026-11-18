import { useQuery } from "@tanstack/solid-query";
import { isServer } from "@solidjs/web";
import { createMemo, createSignal, For, Show } from "solid-js";
import { Option, Schema } from "effect";
import { ErrorText, Field, PageHeader, Panel } from "~/components/mdm/common";
import { ChevronDown } from "~/components/ui/icons";
import { Input } from "~/components/ui/input";

/**
 * Settings → Legal: the open-source licence inventory.
 *
 * `apps/web/scripts/generate-licences.ts` walks the pnpm production dependency graph on
 * every web build and writes `public/licenses.json`. The notices are served as
 * a static asset so the settings page can stay out of the Worker bundle and the
 * data can be inspected directly at `/licenses.json`.
 */

const LicencePackage = Schema.Struct({
  name: Schema.String,
  version: Schema.String,
  license: Schema.String,
  repository: Schema.optional(Schema.String),
  text: Schema.optional(Schema.String),
});

const LicenceBundle = Schema.Struct({
  packages: Schema.Array(LicencePackage),
  texts: Schema.Record(Schema.String, Schema.String),
});

type LicencePackage = typeof LicencePackage.Type;

type LicenceBundle = typeof LicenceBundle.Type;

const loadLicences = async (): Promise<LicenceBundle> => {
  const response = await fetch("/licenses.json", { headers: { accept: "application/json" } });

  if (!response.ok) throw new Error(`Licence inventory is unavailable (${response.status})`);

  const decoded = Option.getOrUndefined(
    Schema.decodeUnknownOption(LicenceBundle)(await response.json()),
  );

  if (!decoded) throw new Error("Licence inventory has an unexpected shape");

  return decoded;
};

const licenceSummary = (packages: ReadonlyArray<LicencePackage>, limit = 6): string => {
  const counts = new Map<string, number>();

  for (const entry of packages) counts.set(entry.license, (counts.get(entry.license) ?? 0) + 1);

  const sorted = [...counts.entries()].sort(
    (left, right) => right[1] - left[1] || left[0].localeCompare(right[0]),
  );

  const shown = sorted
    .slice(0, limit)
    .map(([license, count]) => `${license} (${count})`)
    .join(", ");

  const remaining = sorted.length - limit;

  return remaining > 0 ? `${shown}, +${remaining} more` : shown;
};

export default function LegalSettingsPage() {
  const licences = useQuery(() => ({
    queryKey: ["licences"],
    queryFn: loadLicences,
    // The inventory is a build artifact: it cannot change while this tab lives.
    staleTime: Number.POSITIVE_INFINITY,
    // A relative URL has no origin during SSR; the client fetches after hydration.
    enabled: !isServer,
  }));

  const [query, setQuery] = createSignal("");

  const packages = () => licences.data?.packages ?? [];

  const filtered = createMemo(() => {
    const needle = query().trim().toLowerCase();

    if (!needle) return packages();

    return packages().filter(
      (entry) =>
        entry.name.toLowerCase().includes(needle) || entry.license.toLowerCase().includes(needle),
    );
  });

  const textFor = (entry: LicencePackage): string | undefined =>
    entry.text ? licences.data?.texts[entry.text] : undefined;

  return (
    <div class="space-y-5">
      <PageHeader
        title="Legal"
        description="Open-source software included in this deployment, with the licence notices those projects require."
      />

      <Show when={licences.error}>
        <ErrorText error={licences.error} />
      </Show>

      <Panel
        title="Third-party software"
        description="Generated from the production dependency graph on every build. Select a package to read its licence text."
      >
        <Show
          when={licences.data}
          fallback={
            <p class="text-[12px] text-muted-foreground" role="status">
              Loading licence inventory…
            </p>
          }
        >
          {(bundle) => (
            <div class="space-y-4">
              <p class="text-[12px] text-muted-foreground">
                {bundle().packages.length} packages · {Object.keys(bundle().texts).length} licence
                texts · {licenceSummary(bundle().packages)}
              </p>

              <div class="max-w-sm">
                <Field label="Filter packages">
                  <Input
                    type="search"
                    placeholder="Package name or licence"
                    value={query()}
                    onInput={(event) => setQuery(event.currentTarget.value)}
                  />
                </Field>
              </div>

              <ul class="divide-y divide-border border-y border-border">
                <For each={filtered()}>
                  {(entry) => {
                    const text = () => textFor(entry);

                    return (
                      <li>
                        <details class="group py-2">
                          <summary class="flex cursor-pointer list-none items-center gap-2 rounded-[4px] text-[12px] outline-none focus-visible:ring-2 focus-visible:ring-ring [&::-webkit-details-marker]:hidden">
                            <span class="flex min-w-0 flex-1 flex-wrap items-baseline gap-x-2 gap-y-1">
                              <span class="font-medium text-foreground">{entry.name}</span>
                              <span class="text-muted-foreground transition-colors duration-[var(--duration-hover)] ease-swift group-hover:text-foreground">
                                {entry.version}
                              </span>
                              <span class="rounded-full border border-border px-2 py-px text-[10px] uppercase tracking-wide text-muted-foreground">
                                {entry.license}
                              </span>
                            </span>
                            <ChevronDown class="disclosure-chevron size-3.5 shrink-0 text-muted-foreground" />
                          </summary>
                          <div class="mt-2 space-y-2 pb-2 pl-1">
                            <Show when={entry.repository}>
                              {(repository) => (
                                <a
                                  class="text-[11px] text-muted-foreground underline underline-offset-2 hover:text-foreground"
                                  href={repository()}
                                  rel="noreferrer"
                                  target="_blank"
                                >
                                  {repository()}
                                </a>
                              )}
                            </Show>
                            <Show
                              when={text()}
                              fallback={
                                <p class="text-[11px] text-muted-foreground">
                                  No licence file was bundled with this package. Its declared
                                  licence is {entry.license}.
                                </p>
                              }
                            >
                              {(content) => (
                                <pre class="max-h-80 overflow-auto whitespace-pre-wrap rounded-md border border-border bg-hover/40 p-3 text-[11px] leading-relaxed text-muted-foreground">
                                  {content()}
                                </pre>
                              )}
                            </Show>
                          </div>
                        </details>
                      </li>
                    );
                  }}
                </For>
              </ul>

              <Show when={filtered().length === 0}>
                <p class="text-[12px] text-muted-foreground">No package matches that filter.</p>
              </Show>
            </div>
          )}
        </Show>
      </Panel>
    </div>
  );
}
