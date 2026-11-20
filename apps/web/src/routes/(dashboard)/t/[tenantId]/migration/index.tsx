import { type RoutePreloadFuncArgs, useParams } from "@solidjs/router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/solid-query";
import { createSignal, For, Show } from "solid-js";
import { useNavigate } from "~/lib/navigation";
import {
  DataTable,
  EmptyState,
  Field,
  Page,
  PageHeader,
  Panel,
  QueryError,
  formatDate,
} from "~/components/mdm/common";
import { Badge } from "~/components/ui/badge";
import { Button } from "~/components/ui/button";
import { Input } from "~/components/ui/input";
import { toast } from "~/components/toast";
import {
  enterprise,
  enterpriseKeys,
  enterpriseQueries,
  type FleetMigrationSummary,
} from "~/lib/enterprise";
import { preloadPage } from "~/lib/page-data";
import { AccessDenied, useCan } from "~/lib/permissions";
import { queryClient } from "~/lib/query-client";

export const route = {
  preload: ({ params, intent }: RoutePreloadFuncArgs) => {
    if (intent === "initial") return;

    return preloadPage([
      () => queryClient.ensureQueryData(enterpriseQueries.fleetMigrations(params.tenantId)),
    ]);
  },
};

const selectClass =
  "h-9 w-full rounded-lg border border-input bg-transparent px-2.5 text-[13px] text-foreground outline-none transition-colors focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50 dark:bg-input/30";

const textareaClass =
  "min-h-28 w-full rounded-lg border border-input bg-transparent p-2.5 font-mono text-[12px] text-foreground outline-none transition-colors placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50 dark:bg-input/30";

const sources = [
  { value: "jamf", label: "Jamf Pro" },
  { value: "intune", label: "Microsoft Intune" },
  { value: "kandji", label: "Kandji" },
  { value: "other", label: "Another MDM" },
] as const;

type Source = (typeof sources)[number]["value"];

const platforms = [
  { value: "apple", label: "Apple" },
  { value: "win", label: "Windows" },
  { value: "android", label: "Android" },
] as const;

type Platform = (typeof platforms)[number]["value"];

const progress = (migration: FleetMigrationSummary) => {
  const { counts } = migration;
  const done = counts.confirmed;

  return `${done}/${counts.total} confirmed`;
};

export default function MigrationPage() {
  const params = useParams();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const { can } = useCan();
  const writable = () => can("devices.write");

  const migrations = useQuery(() => enterpriseQueries.fleetMigrations(params.tenantId));

  const [name, setName] = createSignal("");
  const [source, setSource] = createSignal<Source>("jamf");
  const [selected, setSelected] = createSignal<Platform[]>(["apple"]);
  const [serials, setSerials] = createSignal("");
  const [stuckAfterDays, setStuckAfterDays] = createSignal(7);

  const togglePlatform = (platform: Platform) =>
    setSelected((current) =>
      current.includes(platform)
        ? current.filter((value) => value !== platform)
        : [...current, platform],
    );

  const create = useMutation(() => ({
    mutationFn: () =>
      enterprise.createFleetMigration(params.tenantId, {
        name: name(),
        sourceMdm: source(),
        platforms: selected(),
        serials: serials()
          .split(/[\s,;]+/)
          .map((value) => value.trim())
          .filter(Boolean),
        stuckAfterDays: stuckAfterDays(),
      }),
    onSuccess: (result) => {
      setName("");
      setSerials("");
      void qc.invalidateQueries({ queryKey: enterpriseKeys.fleetMigrations(params.tenantId) });
      navigate(`/t/${params.tenantId}/migration/${result.id}`);
      toast.success(`Cohort created with ${result.added} device${result.added === 1 ? "" : "s"}`, {
        description:
          result.skipped.length > 0
            ? `${result.skipped.length} serial(s) were skipped; open the cohort to review them.`
            : undefined,
      });
    },
    onError: (error) =>
      toast.error("Could not create the migration", { description: String(error) }),
  }));

  const columns = [
    {
      header: "Cohort",
      cell: (row: FleetMigrationSummary) => (
        <a
          href={`/t/${params.tenantId}/migration/${row.id}`}
          class="font-medium text-foreground hover:underline"
        >
          {row.name}
        </a>
      ),
    },
    {
      header: "Leaving",
      cell: (row: FleetMigrationSummary) => (
        <span class="text-muted-foreground">
          {sources.find((source) => source.value === row.sourceMdm)?.label ?? row.sourceMdm}
        </span>
      ),
    },
    {
      header: "Platforms",
      cell: (row: FleetMigrationSummary) => (
        <div class="flex flex-wrap gap-1">
          <For each={row.platforms}>
            {(platform) => (
              <Badge variant="outline">
                {platforms.find((entry) => entry.value === platform)?.label ?? platform}
              </Badge>
            )}
          </For>
        </div>
      ),
    },
    {
      header: "Progress",
      cell: (row: FleetMigrationSummary) => (
        <div class="flex flex-wrap items-center gap-1.5">
          <span class="text-muted-foreground">{progress(row)}</span>
          <Show when={row.counts.stuck > 0}>
            <Badge variant="destructive">{row.counts.stuck} stuck</Badge>
          </Show>
        </div>
      ),
    },
    {
      header: "Updated",
      cell: (row: FleetMigrationSummary) => (
        <span class="text-muted-foreground">{formatDate(row.updatedAt)}</span>
      ),
    },
  ];

  return (
    <Show when={can("devices.read")} fallback={<AccessDenied />}>
      <Page>
        <PageHeader
          eyebrow="Devices"
          title="Migration"
          description="Track a fleet leaving Jamf, Intune or Kandji: issue the unenrol handoff, watch for the device to re-enrol, and confirm the profile was accepted."
        />

        <QueryError error={migrations.error} onRetry={() => void migrations.refetch()} />

        <Panel
          title="Cohorts"
          description="A cohort is a list of serials with a status each. It never moves a device by itself."
        >
          <DataTable
            rows={migrations.data ? [...migrations.data.migrations] : undefined}
            columns={columns}
            empty={
              <EmptyState
                title="No migrations yet"
                description="Create a cohort from the serials your incumbent MDM lists, or seed one from a group."
              />
            }
          />
        </Panel>

        <Show when={writable()}>
          <Panel
            title="New cohort"
            description="Serials come from the incumbent MDM's device list. Devices Mattrax already manages are skipped: they are not migrating."
          >
            <form
              class="grid gap-4 sm:grid-cols-2"
              onSubmit={(event) => {
                event.preventDefault();
                create.mutate();
              }}
            >
              <Field label="Name">
                <Input
                  value={name()}
                  placeholder="Q1 Jamf exit"
                  onInput={(event) => setName(event.currentTarget.value)}
                />
              </Field>
              <Field label="Leaving">
                <select
                  class={selectClass}
                  value={source()}
                  onChange={(event) => {
                    // SAFETY: the select only renders the source options above.
                    setSource(event.currentTarget.value as Source);
                  }}
                >
                  <For each={sources}>
                    {(entry) => <option value={entry.value}>{entry.label}</option>}
                  </For>
                </select>
              </Field>
              <Field label="Target platforms">
                <div class="flex flex-wrap gap-3 pt-1.5">
                  <For each={platforms}>
                    {(entry) => (
                      <label class="flex items-center gap-1.5 text-[12.5px]">
                        <input
                          type="checkbox"
                          checked={selected().includes(entry.value)}
                          onChange={() => togglePlatform(entry.value)}
                        />
                        {entry.label}
                      </label>
                    )}
                  </For>
                </div>
              </Field>
              <Field
                label="Stuck after (days)"
                hint="A device that has not returned inside this window becomes stuck."
              >
                <Input
                  type="number"
                  min={1}
                  max={90}
                  value={stuckAfterDays()}
                  onInput={(event) => setStuckAfterDays(Number(event.currentTarget.value) || 7)}
                />
              </Field>
              <div class="sm:col-span-2">
                <Field
                  label="Device serials"
                  hint="One per line or comma separated. A serial with no device in Mattrax is recorded against the first target platform."
                >
                  <textarea
                    class={textareaClass}
                    value={serials()}
                    placeholder={"C02XYZ123\nC02ABC456"}
                    onInput={(event) => setSerials(event.currentTarget.value)}
                  />
                </Field>
              </div>
              <div class="sm:col-span-2">
                <Button
                  type="submit"
                  disabled={create.isPending || !name().trim() || selected().length === 0}
                >
                  {create.isPending ? "Creating…" : "Create cohort"}
                </Button>
              </div>
            </form>
          </Panel>
        </Show>
      </Page>
    </Show>
  );
}
