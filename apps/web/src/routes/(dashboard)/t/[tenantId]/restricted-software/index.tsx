import { useParams, useSearchParams } from "@solidjs/router";
import { useQuery } from "@tanstack/solid-query";
import { Show, createSignal } from "solid-js";
import {
  DataTable,
  EmptyState,
  LinkButton,
  Page,
  PageHeader,
  Panel,
  QueryError,
  formatDate,
  relativeTime,
} from "~/components/mdm/common";
import { Badge } from "~/components/ui/badge";
import { Button } from "~/components/ui/button";
import { enterpriseQueries } from "~/lib/enterprise";
import type { RestrictedSoftwareRuleInfo, RestrictedSoftwareViolationInfo } from "~/lib/enterprise";
import {
  RESTRICTED_SOFTWARE_ACTION_LABELS,
  RESTRICTED_SOFTWARE_MATCH_LABELS,
  RESTRICTED_SOFTWARE_PLATFORM_LABELS,
  restrictedSoftwareCapability,
} from "@mattrax/enterprise-domain/client";
import { AccessDenied, useCan } from "~/lib/permissions";
import { restrictedSoftwareQueryAccess } from "./query-access";

type View = "rules" | "violations";

const enforcementTone = (state: string) => {
  switch (state) {
    case "enforced":
      return "border-success/30 text-success-foreground";
    case "failed":
      return "border-destructive/30 text-destructive";
    case "pending":
      return "border-warning/30 text-warning-foreground";
    default:
      return "border-border text-muted-foreground";
  }
};

const stateLabel = (state: string) =>
  state === "detection-only"
    ? "Detection only"
    : state === "enforced"
      ? "Enforced"
      : state === "failed"
        ? "Failed"
        : "Pending";

export default function RestrictedSoftwarePage() {
  const params = useParams();
  const [searchParams] = useSearchParams();
  const { can } = useCan();
  const writable = () => can("restricted_software.write");
  const ruleFilter = () => (typeof searchParams.rule === "string" ? searchParams.rule : undefined);
  const [view, setView] = createSignal<View>(ruleFilter() ? "violations" : "rules");
  const [violationFilter, setViolationFilter] = createSignal<"open" | "all">("open");

  const queryAccess = () =>
    restrictedSoftwareQueryAccess({
      read: can("restricted_software.read"),
      write: writable(),
      isNew: false,
      violationsView: view() === "violations",
    });
  const rules = useQuery(() => {
    const options = enterpriseQueries.restrictedSoftware(params.tenantId);

    return { ...options, enabled: options.enabled && queryAccess().rules };
  });
  const violations = useQuery(() => {
    const options = enterpriseQueries.restrictedSoftwareViolations(params.tenantId, {
      status: violationFilter() === "open" ? "open" : undefined,
      ruleId: ruleFilter(),
    });

    return { ...options, enabled: options.enabled && queryAccess().violations };
  });

  const ruleRows = () => [...(rules.data?.rules ?? [])];
  const violationRows = () => [...(violations.data?.violations ?? [])];

  const ruleColumns = [
    {
      header: "Rule",
      cell: (row: RestrictedSoftwareRuleInfo) => (
        <a
          href={`/t/${params.tenantId}/restricted-software/${row.id}`}
          class="font-medium text-foreground hover:underline"
        >
          {row.name}
        </a>
      ),
    },
    {
      header: "Platform",
      cell: (row: RestrictedSoftwareRuleInfo) => (
        <span class="text-muted-foreground">
          {RESTRICTED_SOFTWARE_PLATFORM_LABELS[row.platform]}
        </span>
      ),
    },
    {
      header: "Match",
      cell: (row: RestrictedSoftwareRuleInfo) => (
        <div class="min-w-0">
          <span class="block text-[11.5px] text-muted-foreground">
            {RESTRICTED_SOFTWARE_MATCH_LABELS[row.matchType]}
          </span>
          <span class="block truncate font-mono text-[11.5px] text-foreground">
            {row.matchValue}
          </span>
        </div>
      ),
    },
    {
      header: "Action",
      cell: (row: RestrictedSoftwareRuleInfo) => (
        <div class="flex flex-wrap items-center gap-1.5">
          <span>{RESTRICTED_SOFTWARE_ACTION_LABELS[row.action]}</span>
          <Badge
            variant="outline"
            class={enforcementTone(
              restrictedSoftwareCapability(row.platform, row.action).mode === "detection-only"
                ? "detection-only"
                : "pending",
            )}
          >
            {restrictedSoftwareCapability(row.platform, row.action).mode === "detection-only"
              ? "Detection only"
              : restrictedSoftwareCapability(row.platform, row.action).mode === "policy"
                ? "Policy"
                : "Agent"}
          </Badge>
        </div>
      ),
    },
    {
      header: "Scope",
      cell: (row: RestrictedSoftwareRuleInfo) => (
        <span class="text-muted-foreground">
          {row.assignedDeviceCount} device{row.assignedDeviceCount === 1 ? "" : "s"}
          <Show when={row.groupCount > 0}>
            <span class="text-muted-foreground/60">
              {" "}
              · {row.groupCount} group{row.groupCount === 1 ? "" : "s"}
            </span>
          </Show>
        </span>
      ),
    },
    {
      header: "Open",
      cell: (row: RestrictedSoftwareRuleInfo) => (
        <span
          class={
            row.openViolationCount > 0 ? "font-medium text-destructive" : "text-muted-foreground"
          }
        >
          {row.openViolationCount}
        </span>
      ),
    },
    {
      header: "Updated",
      cell: (row: RestrictedSoftwareRuleInfo) => (
        <span class="text-muted-foreground">{formatDate(row.updatedAt)}</span>
      ),
    },
  ];

  const violationColumns = [
    {
      header: "Rule",
      cell: (row: RestrictedSoftwareViolationInfo) => (
        <a
          href={`/t/${params.tenantId}/restricted-software/${row.ruleId}`}
          class="font-medium text-foreground hover:underline"
        >
          {row.ruleName}
        </a>
      ),
    },
    {
      header: "Device",
      cell: (row: RestrictedSoftwareViolationInfo) => (
        <a
          href={`/t/${params.tenantId}/devices/${row.deviceId}`}
          class="text-foreground hover:underline"
        >
          {row.deviceName}
        </a>
      ),
    },
    {
      header: "Application",
      cell: (row: RestrictedSoftwareViolationInfo) => (
        <div class="min-w-0">
          <span class="block truncate text-foreground">
            {row.applicationName ?? row.matchedBundleId}
          </span>
          <span class="block truncate font-mono text-[11px] text-muted-foreground">
            {row.matchedBundleId}
          </span>
        </div>
      ),
    },
    {
      header: "Enforcement",
      cell: (row: RestrictedSoftwareViolationInfo) => (
        <Badge variant="outline" class={enforcementTone(row.enforcementState)}>
          {stateLabel(row.enforcementState)}
        </Badge>
      ),
    },
    {
      header: "Status",
      cell: (row: RestrictedSoftwareViolationInfo) => (
        <span class="text-muted-foreground">{row.status}</span>
      ),
    },
    {
      header: "Last seen",
      cell: (row: RestrictedSoftwareViolationInfo) => (
        <span class="text-muted-foreground" title={formatDate(row.lastDetectedAt)}>
          {relativeTime(row.lastDetectedAt)}
        </span>
      ),
    },
  ];

  return (
    <Show when={can("restricted_software.read")} fallback={<AccessDenied />}>
      <Page>
        <PageHeader
          eyebrow="Software"
          title="Restricted software"
          description="Deny-list applications, record violations and enforce removal where a platform supports it."
          meta={
            <Show when={rules.data}>
              <span class="tabular-nums">
                {ruleRows().length} rule{ruleRows().length === 1 ? "" : "s"}
              </span>
            </Show>
          }
          actions={
            <Show when={writable()}>
              <LinkButton href={`/t/${params.tenantId}/restricted-software/new`}>
                New rule
              </LinkButton>
            </Show>
          }
        />

        <div class="flex flex-wrap items-center gap-2">
          <Button
            variant={view() === "rules" ? "default" : "outline"}
            size="sm"
            onClick={() => setView("rules")}
          >
            Rules
          </Button>
          <Button
            variant={view() === "violations" ? "default" : "outline"}
            size="sm"
            onClick={() => setView("violations")}
          >
            Violations
            <Show when={(violations.data?.summary.open ?? 0) > 0}>
              <span class="ml-1 rounded-full bg-destructive/10 px-1.5 text-[10px] text-destructive">
                {violations.data?.summary.open}
              </span>
            </Show>
          </Button>
          <Show when={view() === "violations"}>
            <div class="ml-auto flex items-center gap-1.5">
              <Button
                variant={violationFilter() === "open" ? "secondary" : "ghost"}
                size="sm"
                onClick={() => setViolationFilter("open")}
              >
                Open
              </Button>
              <Button
                variant={violationFilter() === "all" ? "secondary" : "ghost"}
                size="sm"
                onClick={() => setViolationFilter("all")}
              >
                All
              </Button>
            </div>
          </Show>
        </div>

        <Show when={view() === "violations" && ruleFilter()}>
          <div class="flex items-center gap-2 text-[11.5px] text-muted-foreground">
            <Badge variant="outline">Filtered to one rule</Badge>
            <a
              href={`/t/${params.tenantId}/restricted-software`}
              class="text-brand-foreground hover:underline"
            >
              Show all violations
            </a>
          </div>
        </Show>

        <Show when={view() === "rules"}>
          <Show
            when={rules.isSuccess}
            fallback={
              <Show
                when={rules.isError}
                fallback={
                  <div class="h-64 animate-pulse rounded-lg border border-border bg-surface" />
                }
              >
                <QueryError error={rules.error} onRetry={() => void rules.refetch()} />
              </Show>
            }
          >
            <DataTable<RestrictedSoftwareRuleInfo>
              rows={ruleRows()}
              columns={ruleColumns}
              caption="Restricted software rules"
              empty={
                <EmptyState
                  title="No restricted software rules"
                  description="Create a rule to deny-list an app, record when it appears and enforce removal where an agent is available."
                  action={
                    <Show when={writable()}>
                      <LinkButton href={`/t/${params.tenantId}/restricted-software/new`}>
                        New rule
                      </LinkButton>
                    </Show>
                  }
                />
              }
            />
          </Show>
        </Show>

        <Show when={view() === "violations"}>
          <Show
            when={violations.isSuccess}
            fallback={
              <Show
                when={violations.isError}
                fallback={
                  <div class="h-64 animate-pulse rounded-lg border border-border bg-surface" />
                }
              >
                <QueryError error={violations.error} onRetry={() => void violations.refetch()} />
              </Show>
            }
          >
            <div class="grid grid-cols-2 gap-3 sm:grid-cols-4">
              <Panel title="Open" description="Violations currently present.">
                <p class="text-2xl font-semibold tabular-nums">
                  {violations.data?.summary.open ?? 0}
                </p>
              </Panel>
              <Panel title="Enforced" description="Agent or policy action recorded.">
                <p class="text-2xl font-semibold tabular-nums">
                  {violations.data?.summary.enforced ?? 0}
                </p>
              </Panel>
              <Panel title="Detection only" description="No enforcement path on this platform.">
                <p class="text-2xl font-semibold tabular-nums">
                  {violations.data?.summary.detectionOnly ?? 0}
                </p>
              </Panel>
              <Panel title="Failed" description="Enforcement reported an error.">
                <p class="text-2xl font-semibold tabular-nums">
                  {violations.data?.summary.failed ?? 0}
                </p>
              </Panel>
            </div>

            <DataTable<RestrictedSoftwareViolationInfo>
              rows={violationRows()}
              columns={violationColumns}
              caption="Restricted software violations"
              empty={
                <EmptyState
                  title="No violations"
                  description="When an installed application matches a rule, it appears here and on the device timeline."
                />
              }
            />
          </Show>
        </Show>

        <p class="text-[11.5px] leading-relaxed text-muted-foreground">
          Android enforces Block installation through the Managed Google Play policy. macOS enforces
          Kill process and Delete app through mattraxd; it cannot prevent an install. Windows is
          detection-only because no Windows agent is deployed for OMA-DM process or application
          control.
        </p>
      </Page>
    </Show>
  );
}
