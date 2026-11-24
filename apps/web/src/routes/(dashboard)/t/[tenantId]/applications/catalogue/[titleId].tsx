import { useParams } from "@solidjs/router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/solid-query";
import { createMemo, createSignal, For, Show } from "solid-js";
import { toast } from "~/components/toast";
import {
  EmptyState,
  ErrorText,
  LinkButton,
  Page,
  PageHeader,
  PageSkeleton,
  Panel,
  QueryError,
} from "~/components/mdm/common";
import { Badge } from "~/components/ui/badge";
import { Button } from "~/components/ui/button";
import { Input } from "~/components/ui/input";
import { ArrowUpRight, CheckCircle2, CircleAlert, Info, Package } from "~/components/ui/icons";
import { formatCatalogueVerifiedAt } from "~/lib/catalogue-date";
import { enterprise, enterpriseKeys, enterpriseQueries } from "~/lib/enterprise";
import type { CatalogueDeployment, CatalogueTitleResponse } from "~/lib/enterprise";
import { optimisticUpdate } from "~/lib/optimistic";
import { AccessDenied, ReadOnlyNotice, useCan } from "~/lib/permissions";
import { routes } from "~/lib/routes";

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

const KIND_LABELS = {
  "apple-app-store": "Apple App Store",
  "apple-pkg": "Vendor PKG",
  "apple-upload": "Upload a signed package",
  "windows-msi": "MSI over OMA-DM",
  "windows-store": "Microsoft Store",
  "windows-msix": "MSIX package",
  "windows-exe": "Vendor EXE",
  "android-play": "Managed Google Play",
  "vendor-download": "Vendor download",
};

const label = (labels: Readonly<Record<string, string>>, value: string) => labels[value] ?? value;

/** Keep the no-hash warning visible next to every direct vendor URL. */
const vendorUrlCaveat = (kind: string) =>
  kind === "windows-msi"
    ? "Vendor URL: Mattrax does not hash-verify these bytes. The vendor controls the MSI and version; deploy a verified MSI from your own packaging process if hash pinning is required."
    : "Vendor URL: Mattrax does not hash-verify these bytes. The vendor controls the package and version; upload a signed package instead if your organisation requires hash pinning.";

type Availability =
  | { status: "ready"; label: string }
  | { status: "needs-product-code"; label: string }
  | { status: "needs-upload"; label: string }
  | { status: "unsupported"; label: string; reason: string };

/**
 * Mirrors `catalogueMethodAvailability` in @mattrax/software.
 *
 * The dashboard imports only the API types, not the catalogue data, so this
 * small switch keeps the vendor catalogue out of the browser bundle. The
 * server re-validates every selection; this copy only decides what to show.
 */
const availability = (method: CatalogueDeployment): Availability => {
  switch (method.kind) {
    case "apple-app-store":
      return { status: "ready", label: "App Store install" };
    case "apple-pkg":
      return { status: "ready", label: "Vendor PKG install" };
    case "apple-upload":
      return { status: "needs-upload", label: "Requires a signed package upload" };
    case "windows-msi":
      return method.requiresProductCode
        ? { status: "needs-product-code", label: "MSI over OMA-DM" }
        : { status: "ready", label: "MSI over OMA-DM" };
    case "android-play":
      return { status: "ready", label: "Managed Google Play" };
    case "windows-store":
      return {
        status: "unsupported",
        label: "Microsoft Store",
        reason:
          "Windows Store delivery is not wired into the Windows management backend yet (issue 568).",
      };
    case "windows-msix":
      return {
        status: "unsupported",
        label: "MSIX package",
        reason: "MSIX delivery is not wired into the Windows management backend yet (issue 568).",
      };
    case "windows-exe":
      return {
        status: "unsupported",
        label: "Vendor EXE",
        reason: "EXE and Win32 installers need the mattraxd app path (issue 568).",
      };
    default:
      return {
        status: "unsupported",
        label: "Vendor download",
        reason:
          "This download needs packaging into a signed PKG or MSI before Mattrax can deploy it.",
      };
  }
};

const statusBadge = (value: Availability) => {
  switch (value.status) {
    case "ready":
      return <Badge variant="outline">Ready</Badge>;
    case "needs-product-code":
      return <Badge variant="secondary">ProductCode needed</Badge>;
    case "needs-upload":
      return <Badge variant="secondary">Upload needed</Badge>;
    default:
      return <Badge variant="outline">Not yet supported</Badge>;
  }
};

const methodReference = (method: CatalogueDeployment) =>
  method.storeId
    ? "App Store id " + method.storeId
    : method.microsoftStoreId
      ? "Store id " + method.microsoftStoreId
      : method.packageName
        ? method.packageName
        : method.bundleId
          ? method.bundleId
          : method.url
            ? "Vendor download"
            : "No public reference";

export default function SoftwareCatalogueTitlePage() {
  const params = useParams();
  const qc = useQueryClient();
  const { can } = useCan();
  const detail = useQuery(() =>
    enterpriseQueries.softwareCatalogueTitle(params.tenantId, params.titleId),
  );

  const [selected, setSelected] = createSignal<ReadonlyArray<string>>([]);
  const [productCodes, setProductCodes] = createSignal<Record<string, string>>({});
  const [versions, setVersions] = createSignal<Record<string, string>>({});

  const title = () => detail.data?.title;

  const additions = () => detail.data?.additions ?? [];
  const addedMethods = createMemo(() => new Set(additions().map((row) => row.methodId)));

  const toggle = (methodId: string) => {
    setSelected((current) =>
      current.includes(methodId) ? current.filter((id) => id !== methodId) : [...current, methodId],
    );
  };

  const selectable = (method: CatalogueDeployment) => availability(method).status !== "unsupported";

  const canSubmit = () => {
    if (selected().length === 0) return false;

    return selected().every((methodId) => {
      const method = title()?.deployments.find((deployment) => deployment.id === methodId);

      if (!method) return false;
      if (availability(method).status !== "needs-product-code") return true;

      return (productCodes()[methodId] ?? "").trim().length > 0;
    });
  };

  const add = useMutation(() => ({
    onMutate: async () => {
      const chosen = selected();
      const currentTitle = title();
      const methods = currentTitle?.deployments ?? [];
      const restore = await optimisticUpdate<CatalogueTitleResponse>(
        qc,
        enterpriseKeys.softwareCatalogueTitle(params.tenantId, params.titleId),
        (current) => ({
          ...current,
          additions: [
            ...current.additions.filter((addition) => !chosen.includes(addition.methodId)),
            ...chosen.map((methodId) => {
              const method = methods.find((candidate) => candidate.id === methodId);

              return {
                titleId: current.title.id,
                methodId,
                applicationId: "pending:" + methodId,
                name: current.title.name,
                platform: method?.platform ?? ("apple" as const),
                source:
                  method?.kind === "apple-app-store" || method?.kind === "android-play"
                    ? ("store" as const)
                    : method?.kind === "apple-upload"
                      ? ("upload" as const)
                      : ("manifest" as const),
                createdAt: new Date().toISOString(),
                pending: true,
              };
            }),
          ],
        }),
      );

      return { restore };
    },
    onError: (_error, _variables, context) => {
      context?.restore();
    },
    mutationFn: () =>
      enterprise.addSoftwareCatalogueTitle(params.tenantId, params.titleId, {
        methods: selected().map((methodId) => ({
          methodId,
          productCode: productCodes()[methodId]?.trim() || null,
          version: versions()[methodId]?.trim() || null,
        })),
      }),
    onSuccess: (result) => {
      const created = result.applications.filter((application) => application.created).length;
      const existing = result.applications.length - created;

      toast.success(created > 0 ? "Added to applications" : "Already in applications", {
        description:
          created > 0
            ? "Created " +
              created +
              " application" +
              (created === 1 ? "" : "s") +
              "." +
              (existing > 0 ? " " + existing + " method(s) were already present." : "")
            : "Every selected method was already in this tenant.",
      });

      setSelected([]);
      setProductCodes({});
      setVersions({});
      void qc.invalidateQueries({
        queryKey: enterpriseKeys.softwareCataloguePrefix(params.tenantId),
      });
      void qc.invalidateQueries({
        queryKey: enterpriseKeys.applications(params.tenantId),
      });
      void qc.invalidateQueries({
        queryKey: enterpriseKeys.entitySearchPrefix(params.tenantId, "application"),
      });
    },
  }));

  return (
    <Show when={can("applications.read")} fallback={<AccessDenied />}>
      <Show when={detail.error}>
        <Page>
          <PageHeader
            eyebrow="Catalogue"
            title="Catalogue title"
            description="The catalogue entry could not be loaded."
            actions={
              <LinkButton
                href={routes.tenant(params.tenantId).softwareCatalogue()}
                variant="outline"
              >
                Back to catalogue
              </LinkButton>
            }
          />
          <QueryError error={detail.error} onRetry={() => void detail.refetch()} />
        </Page>
      </Show>
      <Show when={!detail.error}>
        <Show when={!detail.isPending} fallback={<PageSkeleton />}>
          <Show
            when={title()}
            fallback={
              <Page>
                <EmptyState
                  icon={(props) => <Package {...props} />}
                  title="Catalogue title not found"
                  description="The title may have been removed from the catalogue."
                  action={
                    <LinkButton href={routes.tenant(params.tenantId).softwareCatalogue()}>
                      Back to the catalogue
                    </LinkButton>
                  }
                />
              </Page>
            }
          >
            {(current) => (
              <Page>
                <PageHeader
                  eyebrow={"Catalogue · " + label(CATEGORY_LABELS, current().category)}
                  title={current().name}
                  description={current().description}
                  meta={
                    <>
                      <span>{current().vendor}</span>
                      <span class="text-muted-foreground/40" aria-hidden="true">
                        ·
                      </span>
                      <a
                        class="inline-flex items-center gap-1 hover:text-foreground hover:underline"
                        href={current().website}
                        target="_blank"
                        rel="noreferrer"
                      >
                        Vendor site
                        <ArrowUpRight class="size-3" aria-hidden="true" />
                      </a>
                      <Show when={detail.data?.verifiedAt}>
                        <span class="text-muted-foreground/40" aria-hidden="true">
                          ·
                        </span>
                        <span>Catalogue checked {formatCatalogueVerifiedAt(detail.data?.verifiedAt)}</span>
                      </Show>
                    </>
                  }
                  actions={
                    <div class="flex flex-wrap items-center gap-2">
                      <LinkButton
                        href={routes.tenant(params.tenantId).softwareCatalogue()}
                        variant="outline"
                      >
                        Back to catalogue
                      </LinkButton>
                      <Show when={can("applications.write")}>
                        <LinkButton href={routes.tenant(params.tenantId).applications()}>
                          My applications
                        </LinkButton>
                      </Show>
                    </div>
                  }
                />

                <div class="grid gap-5 lg:grid-cols-[minmax(0,1fr)_340px] lg:items-start">
                  <div class="space-y-5">
                    <Panel title="Supported platforms">
                      <div class="flex flex-wrap gap-1.5">
                        <For each={current().platforms}>
                          {(platform) => (
                            <Badge variant="outline">{label(PLATFORM_LABELS, platform)}</Badge>
                          )}
                        </For>
                      </div>
                    </Panel>

                    <Panel
                      title="Deployment methods"
                      description="Each method becomes a separate tenant application, because an application row targets one MDM platform."
                      flush
                    >
                      <ul class="divide-y divide-border">
                        <For each={current().deployments}>
                          {(method) => {
                            const state = availability(method);
                            const isAdded = () => addedMethods().has(method.id);

                            return (
                              <li class="space-y-2 px-4 py-3.5">
                                <div class="flex flex-wrap items-start justify-between gap-2">
                                  <div class="min-w-0">
                                    <p class="text-[13px] font-[560] text-foreground">
                                      {label(PLATFORM_LABELS, method.target)}
                                      <span
                                        class="mx-1.5 text-muted-foreground/50"
                                        aria-hidden="true"
                                      >
                                        ·
                                      </span>
                                      {label(KIND_LABELS, method.kind)}
                                    </p>
                                    <p class="mt-0.5 font-mono text-[10.5px] text-muted-foreground">
                                      {methodReference(method)}
                                    </p>
                                  </div>
                                  <div class="flex shrink-0 items-center gap-1.5">
                                    <Show when={isAdded()}>
                                      <Badge variant="secondary">Added</Badge>
                                    </Show>
                                    {statusBadge(state)}
                                  </div>
                                </div>
                                <Show when={method.note}>
                                  <p class="max-w-3xl text-[12px] leading-5 text-muted-foreground">
                                    {method.note}
                                  </p>
                                </Show>
                                <Show
                                  when={
                                    method.kind === "apple-pkg" || method.kind === "windows-msi"
                                  }
                                >
                                  <p class="max-w-3xl rounded-md border border-warning/25 bg-warning/[0.06] px-2.5 py-1.5 text-[11.5px] leading-5 text-warning-foreground">
                                    {vendorUrlCaveat(method.kind)}
                                  </p>
                                </Show>
                                <Show when={method.url}>
                                  <a
                                    class="inline-flex items-center gap-1 text-[11.5px] font-medium text-muted-foreground underline underline-offset-2 hover:text-foreground"
                                    href={method.url}
                                    target="_blank"
                                    rel="noreferrer"
                                  >
                                    Open vendor download
                                    <ArrowUpRight class="size-3" aria-hidden="true" />
                                  </a>
                                </Show>
                              </li>
                            );
                          }}
                        </For>
                      </ul>
                    </Panel>

                    <Show when={current().notes}>
                      <Panel title="Notes and limits">
                        <div class="flex gap-2.5">
                          <Info
                            class="mt-0.5 size-4 shrink-0 text-muted-foreground"
                            aria-hidden="true"
                          />
                          <p class="text-[12.5px] leading-5 text-muted-foreground">
                            {current().notes}
                          </p>
                        </div>
                      </Panel>
                    </Show>
                  </div>

                  <div class="space-y-4 lg:sticky lg:top-4">
                    <Panel
                      title="Add to this tenant"
                      description="Choose the platforms you want to manage."
                    >
                      <Show when={can("applications.write")} fallback={<ReadOnlyNotice />}>
                        <Show
                          when={current().deployments.some((method) => selectable(method))}
                          fallback={
                            <div class="flex gap-2.5 rounded-lg border border-border bg-surface px-3 py-2.5">
                              <CircleAlert
                                class="mt-0.5 size-4 shrink-0 text-muted-foreground"
                                aria-hidden="true"
                              />
                              <p class="text-[12px] leading-5 text-muted-foreground">
                                No method for this title can be deployed by Mattrax yet. The vendor
                                links and identifiers are recorded for when the delivery path lands
                                (issue 568 and issue 589).
                              </p>
                            </div>
                          }
                        >
                          <ul class="space-y-2.5">
                            <For each={current().deployments}>
                              {(method) => {
                                const state = availability(method);
                                const isAdded = () => addedMethods().has(method.id);
                                const canSelect = () => selectable(method) && !isAdded();
                                const checked = () => selected().includes(method.id);

                                return (
                                  <li class="rounded-lg border border-border transition-colors has-[:checked]:border-brand/40 has-[:checked]:bg-brand/[0.04]">
                                    <label
                                      class={
                                        "flex cursor-pointer items-start gap-2.5 px-3 py-2.5" +
                                        (canSelect() ? "" : " opacity-60")
                                      }
                                    >
                                      <input
                                        type="checkbox"
                                        class="mt-0.5 size-4 shrink-0 rounded border-input accent-brand"
                                        checked={checked()}
                                        disabled={!canSelect()}
                                        onChange={() => toggle(method.id)}
                                      />
                                      <span class="min-w-0 flex-1">
                                        <span class="block text-[12.5px] font-medium text-foreground">
                                          {label(PLATFORM_LABELS, method.target)} ·{" "}
                                          {label(KIND_LABELS, method.kind)}
                                          {isAdded() ? " · already added" : ""}
                                        </span>
                                        <span class="mt-0.5 block text-[11.5px] text-muted-foreground">
                                          {state.status === "unsupported"
                                            ? state.reason
                                            : state.label}
                                        </span>
                                      </span>
                                    </label>
                                    <Show when={state.status === "needs-product-code" && checked()}>
                                      <div class="space-y-2 px-3 pb-3 pl-10">
                                        <div>
                                          <label
                                            for={"product-code-" + method.id}
                                            class="mb-1 block text-[11px] font-medium text-muted-foreground"
                                          >
                                            MSI ProductCode
                                          </label>
                                          <Input
                                            id={"product-code-" + method.id}
                                            value={productCodes()[method.id] ?? ""}
                                            placeholder="{00000000-0000-0000-0000-000000000000}"
                                            onInput={(event) =>
                                              setProductCodes((current) => ({
                                                ...current,
                                                [method.id]: event.currentTarget.value,
                                              }))
                                            }
                                          />
                                        </div>
                                        <div>
                                          <label
                                            for={"installer-version-" + method.id}
                                            class="mb-1 block text-[11px] font-medium text-muted-foreground"
                                          >
                                            Installer version
                                          </label>
                                          <Input
                                            id={"installer-version-" + method.id}
                                            value={versions()[method.id] ?? ""}
                                            placeholder="1.0.0"
                                            onInput={(event) =>
                                              setVersions((current) => ({
                                                ...current,
                                                [method.id]: event.currentTarget.value,
                                              }))
                                            }
                                          />
                                        </div>
                                        <p class="text-[11px] leading-4 text-muted-foreground">
                                          {vendorUrlCaveat(method.kind)}
                                        </p>
                                      </div>
                                    </Show>
                                  </li>
                                );
                              }}
                            </For>
                          </ul>

                          <Show when={add.error}>
                            <div class="mt-3">
                              <ErrorText error={add.error} />
                            </div>
                          </Show>

                          <Button
                            class="mt-4 w-full"
                            disabled={!canSubmit() || add.isPending}
                            onClick={() => add.mutate()}
                          >
                            {add.isPending ? "Adding…" : "Add selected methods"}
                          </Button>
                          <p class="mt-2 text-[11px] leading-4 text-muted-foreground">
                            This creates catalogue entries only. Assign them to groups or devices,
                            or install them, from My applications.
                          </p>
                        </Show>
                      </Show>
                    </Panel>

                    <Show when={additions().length > 0}>
                      <Panel title="Already in this tenant">
                        <ul class="space-y-2">
                          <For each={additions()}>
                            {(addition) => (
                              <li class="flex items-center justify-between gap-2">
                                <Show
                                  when={!addition.pending}
                                  fallback={
                                    <span class="inline-flex min-w-0 items-center gap-1.5 text-[12.5px] font-medium text-muted-foreground">
                                      <span class="size-1.5 shrink-0 animate-pulse rounded-full bg-brand" />
                                      <span class="truncate">{addition.name} · adding…</span>
                                    </span>
                                  }
                                >
                                  <a
                                    class="inline-flex min-w-0 items-center gap-1.5 text-[12.5px] font-medium hover:underline"
                                    href={routes
                                      .tenant(params.tenantId)
                                      .application(addition.applicationId)}
                                  >
                                    <CheckCircle2
                                      class="size-3.5 shrink-0 text-success"
                                      aria-hidden="true"
                                    />
                                    <span class="truncate">{addition.name}</span>
                                  </a>
                                </Show>
                                <Badge variant="outline" class="shrink-0">
                                  {label(MDM_LABELS, addition.platform)}
                                </Badge>
                              </li>
                            )}
                          </For>
                        </ul>
                      </Panel>
                    </Show>
                  </div>
                </div>
              </Page>
            )}
          </Show>
        </Show>
      </Show>
    </Show>
  );
}