import { useParams } from "@solidjs/router";
import { useInfiniteQuery } from "@tanstack/solid-query";
import { createEffect, createMemo, createSignal, For, onCleanup, Show } from "solid-js";
import ApplicationViewTabs from "~/components/mdm/application-view-tabs";
import {
  EmptyState,
  LinkButton,
  Page,
  PageHeader,
  Panel,
  QueryError,
} from "~/components/mdm/common";
import { Badge } from "~/components/ui/badge";
import { Button } from "~/components/ui/button";
import { Input } from "~/components/ui/input";
import { ArrowRightLeft, Package, Search, X } from "~/components/ui/icons";
import { formatCatalogueVerifiedAt } from "~/lib/catalogue-date";
import { enterpriseQueries } from "~/lib/enterprise";
import type { CatalogueTitle } from "~/lib/enterprise";
import { useCan } from "~/lib/permissions";
import { routes } from "~/lib/routes";

const PAGE_SIZE = 24;

const CATEGORY_LABELS = {
  browsers: "Browsers",
  communication: "Communication",
  productivity: "Productivity",
  developer: "Developer",
  security: "Security",
  media: "Media and design",
  utilities: "Utilities",
  education: "Education",
  business: "Business",
  "remote-support": "Remote support",
};

const PLATFORM_LABELS = {
  macos: "macOS",
  windows: "Windows",
  ios: "iOS",
  ipados: "iPadOS",
  android: "Android",
  web: "Web",
};

const MDM_LABELS = {
  apple: "Apple",
  win: "Windows",
  android: "Android",
};

const label = (labels: Readonly<Record<string, string>>, value: string) => labels[value] ?? value;

const selectClass =
  "h-9 w-full rounded-lg border border-input bg-transparent px-2.5 text-xs text-foreground outline-none transition-colors focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/50 dark:bg-input/30";

const platformSummary = (title: CatalogueTitle) => {
  const visible = title.platforms.slice(0, 4);
  const hidden = title.platforms.length - visible.length;

  return { visible, hidden };
};

export default function SoftwareCataloguePage() {
  const params = useParams();
  const { can } = useCan();

  const [q, setQ] = createSignal("");
  const [debouncedQ, setDebouncedQ] = createSignal("");
  const [category, setCategory] = createSignal("");
  const [platform, setPlatform] = createSignal("");
  const [mdmPlatform, setMdmPlatform] = createSignal("");

  let settleTimer: ReturnType<typeof setTimeout> | undefined;
  onCleanup(() => clearTimeout(settleTimer));
  createEffect(
    () => q(),
    (value) => {
      clearTimeout(settleTimer);
      settleTimer = setTimeout(() => setDebouncedQ(value), 250);
    },
  );

  const filters = createMemo(() => ({
    q: debouncedQ().trim() || undefined,
    category: (category() || undefined) as never,
    platform: (platform() || undefined) as never,
    mdmPlatform: (mdmPlatform() || undefined) as never,
    limit: PAGE_SIZE,
  }));

  const catalogue = useInfiniteQuery(() =>
    enterpriseQueries.searchSoftwareCatalogue(params.tenantId, filters()),
  );

  const rows = () => catalogue.data?.pages.flatMap((page) => page.items) ?? [];
  const total = () => catalogue.data?.pages.at(-1)?.total ?? 0;
  const additions = () => catalogue.data?.pages.flatMap((page) => page.additions) ?? [];

  const addedCount = (titleId: string) =>
    additions().filter((addition) => addition.titleId === titleId).length;

  const hasFilters = () =>
    q().trim() !== "" || category() !== "" || platform() !== "" || mdmPlatform() !== "";

  const clearFilters = () => {
    setQ("");
    setDebouncedQ("");
    setCategory("");
    setPlatform("");
    setMdmPlatform("");
  };

  return (
    <Page>
      <PageHeader
        eyebrow="Applications"
        title="Software catalogue"
        description="Common business, school and consumer apps with their vendor download and store details. Add a title to create tenant applications with the right install method for each platform."
        meta={
          <Show when={catalogue.data}>
            <span class="tabular-nums">
              {total()} title{total() === 1 ? "" : "s"}
            </span>
            <span class="text-muted-foreground/40" aria-hidden="true">
              ·
            </span>
            <span class="tabular-nums">{rows().length} loaded</span>
            <Show when={catalogue.data?.pages[0]?.verifiedAt}>
              <span class="text-muted-foreground/40" aria-hidden="true">
                ·
              </span>
              <span>Catalogue checked {formatCatalogueVerifiedAt(catalogue.data?.pages[0]?.verifiedAt)}</span>
            </Show>
          </Show>
        }
        actions={
          <Show when={can("applications.read")}>
            <LinkButton href={routes.tenant(params.tenantId).applications()} variant="outline">
              My applications
            </LinkButton>
          </Show>
        }
      />

      <ApplicationViewTabs tenantId={params.tenantId ?? ""} active="catalogue" />

      <Panel
        title="Find software"
        description="Search names, vendors and aliases, or narrow by supported platform and category."
      >
        <div class="space-y-3">
          <label class="relative block text-muted-foreground">
            <span class="sr-only">Search the software catalogue</span>
            <Search class="pointer-events-none absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2" />
            <div class="pl-8">
              <Input
                type="search"
                value={q()}
                onInput={(event) => setQ(event.currentTarget.value)}
                placeholder="Search Chrome, Slack, Microsoft, browsers…"
                class="w-full"
              />
            </div>
          </label>
          <div class="grid gap-3 sm:grid-cols-3">
            <label class="space-y-1">
              <span class="block text-xs font-medium text-muted-foreground">Category</span>
              <select
                class={selectClass}
                value={category()}
                onChange={(event) => setCategory(event.currentTarget.value)}
              >
                <option value="">All categories</option>
                <For each={Object.entries(CATEGORY_LABELS)}>
                  {([value, label]) => <option value={value}>{label}</option>}
                </For>
              </select>
            </label>
            <label class="space-y-1">
              <span class="block text-xs font-medium text-muted-foreground">
                Supported platform
              </span>
              <select
                class={selectClass}
                value={platform()}
                onChange={(event) => setPlatform(event.currentTarget.value)}
              >
                <option value="">All platforms</option>
                <For each={Object.entries(PLATFORM_LABELS)}>
                  {([value, label]) => <option value={value}>{label}</option>}
                </For>
              </select>
            </label>
            <label class="space-y-1">
              <span class="block text-xs font-medium text-muted-foreground">
                Deployable with
              </span>
              <select
                class={selectClass}
                value={mdmPlatform()}
                onChange={(event) => setMdmPlatform(event.currentTarget.value)}
              >
                <option value="">Any delivery path</option>
                <For each={Object.entries(MDM_LABELS)}>
                  {([value, label]) => <option value={value}>{label}</option>}
                </For>
              </select>
            </label>
          </div>
          <Show when={hasFilters()}>
            <div class="flex items-center justify-between gap-3">
              <span class="text-xs text-muted-foreground">
                Showing titles that match the active filters.
              </span>
              <Button variant="ghost" size="sm" onClick={clearFilters}>
                <X class="size-3.5" />
                Clear filters
              </Button>
            </div>
          </Show>
        </div>
      </Panel>

      <Show when={catalogue.error}>
        <QueryError error={catalogue.error} onRetry={() => void catalogue.refetch()} />
      </Show>

      <Show when={catalogue.isPending}>
        <div class="grid gap-3 md:grid-cols-2 xl:grid-cols-3" aria-hidden="true">
          <For each={Array.from({ length: 6 }, (_, index) => index)}>
            {() => <div class="h-44 animate-pulse rounded-xl border border-border bg-surface" />}
          </For>
        </div>
      </Show>

      <Show when={!catalogue.error && !catalogue.isPending && rows().length === 0}>
        <EmptyState
          icon={(props) => <Package {...props} />}
          title={hasFilters() ? "No matching software" : "The catalogue is empty"}
          description={
            hasFilters()
              ? "Adjust the search or clear the filters to see the whole catalogue."
              : "The bundled catalogue did not load a title."
          }
          action={
            <Show when={hasFilters()}>
              <Button variant="outline" size="sm" onClick={clearFilters}>
                Clear filters
              </Button>
            </Show>
          }
        />
      </Show>

      <Show when={!catalogue.error && rows().length > 0}>
        <div class="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
          <For each={rows()}>
            {(title) => {
              const platforms = platformSummary(title);
              const added = addedCount(title.id);

              return (
                <a
                  href={routes.tenant(params.tenantId).softwareCatalogueTitle(title.id)}
                  class="group flex min-h-44 flex-col rounded-xl border border-border bg-card p-4 shadow-card outline-none transition-colors duration-150 ease-swift hover:border-brand/40 hover:bg-hover focus-visible:ring-2 focus-visible:ring-ring/50"
                >
                  <div class="flex items-start justify-between gap-3">
                    <div class="min-w-0">
                      <h2 class="truncate text-sm font-semibold tracking-normal text-foreground">
                        {title.name}
                      </h2>
                      <p class="mt-0.5 truncate text-xs text-muted-foreground">
                        {title.vendor}
                      </p>
                    </div>
                    <Show when={added > 0}>
                      <Badge variant="secondary" class="shrink-0">
                        Added{added > 1 ? " " + added : ""}
                      </Badge>
                    </Show>
                  </div>

                  <p class="mt-3 line-clamp-2 text-xs leading-5 text-muted-foreground">
                    {title.description}
                  </p>

                  <div class="mt-3 flex flex-wrap gap-1">
                    <For each={platforms.visible}>
                      {(value) => (
                        <Badge variant="outline">
                          {label(PLATFORM_LABELS, value)}
                        </Badge>
                      )}
                    </For>
                    <Show when={platforms.hidden > 0}>
                      <Badge variant="outline">
                        +{platforms.hidden}
                      </Badge>
                    </Show>
                  </div>

                  <div class="mt-auto flex items-center justify-between gap-2 pt-4">
                    <span class="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                      {label(CATEGORY_LABELS, title.category)}
                    </span>
                    <span class="flex items-center gap-1 text-xs font-medium text-muted-foreground transition-colors group-hover:text-foreground">
                      View
                      <ArrowRightLeft class="size-3" aria-hidden="true" />
                    </span>
                  </div>
                </a>
              );
            }}
          </For>
        </div>

        <div class="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-border bg-card px-3.5 py-2 shadow-card">
          <span
            role="status"
            aria-live="polite"
            class="text-xs tabular-nums text-muted-foreground"
          >
            {rows().length} of {total()} title{total() === 1 ? "" : "s"} loaded
          </span>
          <Show
            when={catalogue.hasNextPage}
            fallback={
              <span class="text-xs text-muted-foreground">All matching titles are loaded.</span>
            }
          >
            <Button
              variant="outline"
              size="sm"
              disabled={catalogue.isFetchingNextPage || catalogue.isPlaceholderData}
              onClick={() => void catalogue.fetchNextPage()}
            >
              {catalogue.isFetchingNextPage ? "Loading…" : "Load more"}
            </Button>
          </Show>
        </div>
      </Show>
    </Page>
  );
}