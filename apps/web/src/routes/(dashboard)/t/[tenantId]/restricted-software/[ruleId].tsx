import { useParams } from "@solidjs/router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/solid-query";
import { For, Show, createEffect, createMemo, createSignal } from "solid-js";
import { Page, PageHeader, Panel, QueryError, formatDate } from "~/components/mdm/common";
import { Badge } from "~/components/ui/badge";
import { Button } from "~/components/ui/button";
import { Input, Label, Textarea } from "~/components/ui/input";
import { toast } from "~/components/toast";
import { enterprise, enterpriseKeys, enterpriseQueries } from "~/lib/enterprise";
import type { RestrictedSoftwareAssignmentInfo, RestrictedSoftwareDetail } from "~/lib/enterprise";
import {
  CreateRestrictedSoftwareRequest,
  PatchRestrictedSoftwareRequest,
  RESTRICTED_SOFTWARE_ACTION_LABELS,
  RESTRICTED_SOFTWARE_ACTIONS,
  RESTRICTED_SOFTWARE_MATCH_LABELS,
  RESTRICTED_SOFTWARE_MATCH_TYPES_BY_PLATFORM,
  RESTRICTED_SOFTWARE_PLATFORM_LABELS,
  RESTRICTED_SOFTWARE_PLATFORMS,
  RESTRICTED_SOFTWARE_LIMITS,
  restrictedSoftwareCapability,
  restrictedSoftwareProblem,
} from "@mattrax/enterprise-domain/client";
import { useNavigate } from "~/lib/navigation";
import { AccessDenied, useCan } from "~/lib/permissions";
import { restrictedSoftwareQueryAccess } from "./query-access";

type Draft = {
  name: string;
  platform: string;
  matchType: string;
  matchValue: string;
  action: string;
  message: string;
  notificationEmails: string;
  enabled: boolean;
};

const emptyDraft = (): Draft => ({
  name: "",
  platform: "apple",
  matchType: "bundle-id",
  matchValue: "",
  action: "kill-process",
  message: "",
  notificationEmails: "",
  enabled: true,
});

const draftFrom = (detail: RestrictedSoftwareDetail): Draft => ({
  name: detail.rule.name,
  platform: detail.rule.platform,
  matchType: detail.rule.matchType,
  matchValue: detail.rule.matchValue,
  action: detail.rule.action,
  message: detail.rule.message ?? "",
  notificationEmails: detail.rule.notificationEmails.join(", "),
  enabled: detail.rule.enabled,
});

const selectClass =
  "h-9 w-full rounded-md border border-border bg-surface px-3 text-[12.5px] text-foreground outline-none focus-visible:ring-2 focus-visible:ring-ring";

/**
 * The editor creates queries and effects as soon as it mounts. A reader without
 * `restricted_software.read` must be refused before any of that runs, otherwise
 * a disabled (pending) query read replaces the access-denied page with a
 * loading state.
 */
/** Read query data only after success so a pending query cannot suspend the page. */
function settledQueryData<T>(query: {
  readonly isSuccess: boolean;
  readonly data: T | undefined;
}): T | undefined {
  return query.isSuccess ? query.data : undefined;
}

export default function RestrictedSoftwareEditorPage() {
  const { can } = useCan();

  return (
    <Show when={can("restricted_software.read")} fallback={<AccessDenied />}>
      <RestrictedSoftwareEditor />
    </Show>
  );
}

function RestrictedSoftwareEditor() {
  const params = useParams();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const { can } = useCan();
  const writable = () => can("restricted_software.write");
  const isNew = () => params.ruleId === "new";

  const queryAccess = () =>
    restrictedSoftwareQueryAccess({
      read: can("restricted_software.read"),
      write: writable(),
      isNew: isNew(),
      violationsView: false,
    });
  const detail = useQuery(() => {
    const options = enterpriseQueries.restrictedSoftwareRule(
      params.tenantId,
      isNew() ? "" : params.ruleId,
    );

    return {
      ...options,
      enabled: options.enabled && queryAccess().detail && Boolean(params.ruleId),
    };
  });
  const targets = useQuery(() => {
    const options = enterpriseQueries.restrictedSoftwareTargets(params.tenantId);

    return { ...options, enabled: options.enabled && queryAccess().targets };
  });

  const [draft, setDraft] = createSignal<Draft>(emptyDraft());
  const [assignments, setAssignments] = createSignal<RestrictedSoftwareAssignmentInfo[]>([]);
  const [savedAssignments, setSavedAssignments] = createSignal<RestrictedSoftwareAssignmentInfo[]>(
    [],
  );
  const [targetType, setTargetType] = createSignal<"device" | "group">("device");
  const [targetId, setTargetId] = createSignal("");
  const [targetMode, setTargetMode] = createSignal<"include" | "exclude">("include");

  createEffect(
    () => settledQueryData(detail),
    (data) => {
      if (!data) return;

      setDraft(draftFrom(data));
      setAssignments([...data.assignments]);
      setSavedAssignments([...data.assignments]);
    },
  );

  const capability = createMemo(() =>
    restrictedSoftwareCapability(
      draft().platform as (typeof RESTRICTED_SOFTWARE_PLATFORMS)[number],
      draft().action as (typeof RESTRICTED_SOFTWARE_ACTIONS)[number],
    ),
  );

  const matchTypes = createMemo(
    () =>
      RESTRICTED_SOFTWARE_MATCH_TYPES_BY_PLATFORM[
        draft().platform as (typeof RESTRICTED_SOFTWARE_PLATFORMS)[number]
      ] ?? [],
  );

  const targetOptions = createMemo(() => {
    const data = settledQueryData(targets);

    if (!data) return [];

    return targetType() === "device" ? data.devices : data.groups;
  });

  const validation = createMemo(() =>
    restrictedSoftwareProblem({
      name: draft().name,
      platform: draft().platform,
      matchType: draft().matchType,
      matchValue: draft().matchValue,
      action: draft().action,
      message: draft().message,
      notificationEmails: draft()
        .notificationEmails.split(/[\s,;]+/)
        .map((email) => email.trim())
        .filter(Boolean),
    }),
  );

  const update = (field: keyof Draft, value: string | boolean) =>
    setDraft((current) => ({ ...current, [field]: value }));

  const changePlatform = (platform: string) => {
    const allowed =
      RESTRICTED_SOFTWARE_MATCH_TYPES_BY_PLATFORM[
        platform as (typeof RESTRICTED_SOFTWARE_PLATFORMS)[number]
      ];

    setDraft((current) => ({
      ...current,
      platform,
      matchType: allowed?.includes(current.matchType as never)
        ? current.matchType
        : (allowed?.[0] ?? "bundle-id"),
    }));
  };

  const payload = () => ({
    name: draft().name.trim(),
    platform: draft().platform as CreateRestrictedSoftwareRequest["platform"],
    matchType: draft().matchType as CreateRestrictedSoftwareRequest["matchType"],
    matchValue: draft().matchValue.trim(),
    action: draft().action as CreateRestrictedSoftwareRequest["action"],
    message: draft().message.trim() || null,
    notificationEmails: draft()
      .notificationEmails.split(/[\s,;]+/)
      .map((email) => email.trim())
      .filter(Boolean),
    enabled: draft().enabled,
  });

  const save = useMutation(() => ({
    mutationFn: async () => {
      const body = payload();

      if (isNew()) {
        const created = await enterprise.createRestrictedSoftware(params.tenantId, body);
        return created.id;
      }

      const current = settledQueryData(detail);

      if (!current) throw new Error("The rule could not be loaded.");

      await enterprise.patchRestrictedSoftware(params.tenantId, current.rule.id, {
        ...body,
        expectedUpdatedAt: current.rule.updatedAt,
      } satisfies PatchRestrictedSoftwareRequest);

      return current.rule.id;
    },
    onSuccess: (id) => {
      navigate(`/t/${params.tenantId}/restricted-software/${id}`);
      void qc.invalidateQueries({ queryKey: enterpriseKeys.restrictedSoftware(params.tenantId) });
      void qc.invalidateQueries({
        queryKey: enterpriseKeys.restrictedSoftwareRule(params.tenantId, id),
      });
      void qc.invalidateQueries({
        queryKey: enterpriseKeys.restrictedSoftwareViolations(params.tenantId),
      });
      toast.success(isNew() ? "Rule created" : "Rule saved", {
        description: "Scope is applied on each device's next check-in.",
      });
    },
    onError: (error) => {
      toast.error("Could not save the rule", { description: String(error) });
    },
  }));

  const saveAssignments = useMutation(() => ({
    mutationFn: async () => {
      if (isNew()) return;

      const previous = savedAssignments();
      const next = assignments();
      const key = (assignment: { targetType: string; targetId: string }) =>
        `${assignment.targetType}:${assignment.targetId}`;

      await enterprise.patchRestrictedSoftwareAssignments(params.tenantId, params.ruleId, {
        assign: next.map((assignment) => ({
          targetType: assignment.targetType,
          targetId: assignment.targetId,
          mode: assignment.mode,
        })),
        unassign: previous
          .filter((assignment) => !next.some((row) => key(row) === key(assignment)))
          .map((assignment) => ({
            targetType: assignment.targetType,
            targetId: assignment.targetId,
          })),
      });
    },
    onSuccess: () => {
      setSavedAssignments([...assignments()]);
      void qc.invalidateQueries({
        queryKey: enterpriseKeys.restrictedSoftwareRule(params.tenantId, params.ruleId),
      });
      void qc.invalidateQueries({ queryKey: enterpriseKeys.restrictedSoftware(params.tenantId) });
      toast.success("Scope saved");
    },
    onError: (error) => {
      toast.error("Could not save scope", { description: String(error) });
    },
  }));

  const remove = useMutation(() => ({
    mutationFn: () => enterprise.deleteRestrictedSoftware(params.tenantId, params.ruleId),
    onSuccess: () => {
      navigate(`/t/${params.tenantId}/restricted-software`);
      void qc.invalidateQueries({ queryKey: enterpriseKeys.restrictedSoftware(params.tenantId) });
      void qc.invalidateQueries({
        queryKey: enterpriseKeys.restrictedSoftwareViolations(params.tenantId),
      });
      toast.success("Rule deleted");
    },
    onError: (error) => {
      toast.error("Could not delete the rule", { description: String(error) });
    },
  }));

  const addTarget = () => {
    const id = targetId();

    if (!id) return;

    setAssignments((current) => {
      if (current.some((row) => row.targetType === targetType() && row.targetId === id))
        return current.map((row) =>
          row.targetType === targetType() && row.targetId === id
            ? { ...row, mode: targetMode() }
            : row,
        );

      const option = targetOptions().find((row) => row.id === id);

      return [
        ...current,
        {
          targetType: targetType(),
          targetId: id,
          mode: targetMode(),
          name: option?.name ?? id,
        },
      ];
    });
    setTargetId("");
  };

  return (
    <Show when={can("restricted_software.read")} fallback={<AccessDenied />}>
      <Page>
        <PageHeader
          eyebrow="Restricted software"
          title={isNew() ? "New rule" : draft().name || "Restricted software rule"}
          description="Detect an application in the inventory and act on it where the platform supports enforcement."
          meta={
            <Show when={!isNew() && settledQueryData(detail)}>
              <span>{formatDate(settledQueryData(detail)!.rule.updatedAt)}</span>
            </Show>
          }
          actions={
            <Show when={!isNew() && writable()}>
              <Button
                variant="outline"
                size="sm"
                disabled={remove.isPending}
                onClick={() => {
                  if (window.confirm("Delete this rule and its violation history?"))
                    remove.mutate();
                }}
              >
                Delete rule
              </Button>
            </Show>
          }
        />

        <Show
          when={!detail.isError}
          fallback={<QueryError error={detail.error} onRetry={() => void detail.refetch()} />}
        >
          <Panel
            title="Rule"
            description="The identifier is matched against the installed-application inventory on every report."
          >
            <div class="grid gap-4 sm:grid-cols-2">
              <div class="sm:col-span-2">
                <Label for="rs-name">Name</Label>
                <Input
                  id="rs-name"
                  value={draft().name}
                  disabled={!writable()}
                  onInput={(event) => update("name", event.currentTarget.value)}
                  placeholder="Block example suite"
                />
              </div>

              <div>
                <Label for="rs-platform">Platform</Label>
                <select
                  id="rs-platform"
                  class={selectClass}
                  value={draft().platform}
                  disabled={!writable()}
                  onChange={(event) => changePlatform(event.currentTarget.value)}
                >
                  <For each={RESTRICTED_SOFTWARE_PLATFORMS}>
                    {(platform) => (
                      <option value={platform}>
                        {RESTRICTED_SOFTWARE_PLATFORM_LABELS[platform]}
                      </option>
                    )}
                  </For>
                </select>
              </div>

              <div>
                <Label for="rs-match-type">Identifier</Label>
                <select
                  id="rs-match-type"
                  class={selectClass}
                  value={draft().matchType}
                  disabled={!writable()}
                  onChange={(event) => update("matchType", event.currentTarget.value)}
                >
                  <For each={matchTypes()}>
                    {(matchType) => (
                      <option value={matchType}>
                        {RESTRICTED_SOFTWARE_MATCH_LABELS[matchType]}
                      </option>
                    )}
                  </For>
                </select>
              </div>

              <div class="sm:col-span-2">
                <Label for="rs-match-value">
                  {RESTRICTED_SOFTWARE_MATCH_LABELS[
                    draft().matchType as keyof typeof RESTRICTED_SOFTWARE_MATCH_LABELS
                  ] ?? "Value"}
                </Label>
                <Input
                  id="rs-match-value"
                  class="font-mono"
                  value={draft().matchValue}
                  disabled={!writable()}
                  onInput={(event) => update("matchValue", event.currentTarget.value)}
                  placeholder={
                    draft().platform === "android"
                      ? "com.example.app"
                      : draft().platform === "win"
                        ? "{12345678-1234-1234-1234-123456789ABC}"
                        : "com.example.App"
                  }
                />
              </div>

              <div>
                <Label for="rs-action">Action</Label>
                <select
                  id="rs-action"
                  class={selectClass}
                  value={draft().action}
                  disabled={!writable()}
                  onChange={(event) => update("action", event.currentTarget.value)}
                >
                  <For each={RESTRICTED_SOFTWARE_ACTIONS}>
                    {(action) => (
                      <option value={action}>{RESTRICTED_SOFTWARE_ACTION_LABELS[action]}</option>
                    )}
                  </For>
                </select>
              </div>

              <div class="flex items-end">
                <label class="flex items-center gap-2 text-[12.5px] text-foreground">
                  <input
                    type="checkbox"
                    checked={draft().enabled}
                    disabled={!writable()}
                    onChange={(event) => update("enabled", event.currentTarget.checked)}
                  />
                  Rule enabled
                </label>
              </div>

              <div class="sm:col-span-2">
                <Label for="rs-message">Operator note (optional)</Label>
                <Textarea
                  id="rs-message"
                  rows={3}
                  value={draft().message}
                  disabled={!writable()}
                  onInput={(event) => update("message", event.currentTarget.value)}
                  placeholder="Why this rule exists. The macOS agent does not display it on the device."
                />
              </div>

              <div class="sm:col-span-2">
                <Label for="rs-email">Email recipients (optional)</Label>
                <Input
                  id="rs-email"
                  value={draft().notificationEmails}
                  disabled={!writable()}
                  onInput={(event) => update("notificationEmails", event.currentTarget.value)}
                  placeholder="security@example.com, it@example.com"
                />
                <p class="mt-1 text-[11px] text-muted-foreground">
                  Up to {RESTRICTED_SOFTWARE_LIMITS.maxNotificationEmails} addresses. The
                  <code class="font-mono"> restricted_software.violation </code>
                  webhook is sent regardless.
                </p>
              </div>
            </div>

            <div class="mt-4 rounded-md border border-border bg-surface-muted/50 p-3">
              <div class="flex flex-wrap items-center gap-2">
                <Badge
                  variant="outline"
                  class={
                    capability().mode === "detection-only"
                      ? "border-warning/30 text-warning-foreground"
                      : capability().mode === "policy"
                        ? "border-success/30 text-success-foreground"
                        : "border-brand/30 text-brand-foreground"
                  }
                >
                  {capability().label}
                </Badge>
                <span class="text-[11.5px] text-muted-foreground">
                  {
                    RESTRICTED_SOFTWARE_PLATFORM_LABELS[
                      draft().platform as keyof typeof RESTRICTED_SOFTWARE_PLATFORM_LABELS
                    ]
                  }{" "}
                  ·{" "}
                  {
                    RESTRICTED_SOFTWARE_ACTION_LABELS[
                      draft().action as keyof typeof RESTRICTED_SOFTWARE_ACTION_LABELS
                    ]
                  }
                </span>
              </div>
              <p class="mt-2 text-[12px] leading-relaxed text-muted-foreground">
                {capability().detail}
              </p>
              <Show when={draft().platform === "apple"}>
                <p class="mt-1 text-[11.5px] leading-relaxed text-muted-foreground">
                  Apple rules also match inventory on iPhone and iPad. Those devices have no
                  mattraxd agent, so the match is recorded as detection-only there.
                </p>
              </Show>
            </div>

            <Show when={validation()}>
              {(problem) => <p class="mt-3 text-[12px] text-destructive">{problem()}</p>}
            </Show>

            <Show when={writable()}>
              <div class="mt-4 flex justify-end">
                <Button
                  disabled={Boolean(validation()) || save.isPending || detail.isLoading}
                  onClick={() => save.mutate()}
                >
                  {isNew() ? "Create rule" : "Save changes"}
                </Button>
              </div>
            </Show>
          </Panel>

          <Show when={!isNew()}>
            <Panel
              title="Scope"
              description="Assign devices or groups. An exclude vetoes a group include; a direct device include wins."
              actions={
                <Show when={writable()}>
                  <Button
                    variant="outline"
                    size="sm"
                    disabled={saveAssignments.isPending}
                    onClick={() => saveAssignments.mutate()}
                  >
                    Save scope
                  </Button>
                </Show>
              }
            >
              <Show
                when={assignments().length > 0}
                fallback={
                  <p class="text-[12.5px] text-muted-foreground">
                    Not scoped yet. Add at least one device or group for the rule to apply.
                  </p>
                }
              >
                <ul class="divide-y divide-border">
                  <For each={assignments()}>
                    {(assignment) => (
                      <li class="flex flex-wrap items-center justify-between gap-2 py-2 text-[12.5px]">
                        <span class="flex min-w-0 items-center gap-2">
                          <Badge variant="outline">
                            {assignment.targetType === "device" ? "Device" : "Group"}
                          </Badge>
                          <span class="truncate text-foreground">{assignment.name}</span>
                        </span>
                        <span class="flex items-center gap-2">
                          <span class="text-[11px] uppercase tracking-wide text-muted-foreground">
                            {assignment.mode}
                          </span>
                          <Show when={writable()}>
                            <Button
                              variant="ghost"
                              size="sm"
                              onClick={() =>
                                setAssignments((current) =>
                                  current.filter(
                                    (row) =>
                                      !(
                                        row.targetType === assignment.targetType &&
                                        row.targetId === assignment.targetId
                                      ),
                                  ),
                                )
                              }
                            >
                              Remove
                            </Button>
                          </Show>
                        </span>
                      </li>
                    )}
                  </For>
                </ul>
              </Show>

              <Show when={writable()}>
                <div class="mt-4 grid gap-2 sm:grid-cols-[130px_1fr_120px_auto]">
                  <select
                    class={selectClass}
                    value={targetType()}
                    onChange={(event) => {
                      setTargetType(event.currentTarget.value as "device" | "group");
                      setTargetId("");
                    }}
                  >
                    <option value="device">Device</option>
                    <option value="group">Group</option>
                  </select>
                  <select
                    class={selectClass}
                    value={targetId()}
                    onChange={(event) => setTargetId(event.currentTarget.value)}
                  >
                    <option value="">Select a {targetType()}…</option>
                    <For each={targetOptions()}>
                      {(option) => <option value={option.id}>{option.name}</option>}
                    </For>
                  </select>
                  <select
                    class={selectClass}
                    value={targetMode()}
                    onChange={(event) =>
                      setTargetMode(event.currentTarget.value as "include" | "exclude")
                    }
                  >
                    <option value="include">Include</option>
                    <option value="exclude">Exclude</option>
                  </select>
                  <Button variant="outline" onClick={addTarget} disabled={!targetId()}>
                    Add
                  </Button>
                </div>
              </Show>
            </Panel>

            <Show when={(settledQueryData(detail)?.rule.openViolationCount ?? 0) > 0}>
              <Panel
                title="Violations"
                description="Open violations are listed on the fleet view and the device timeline."
              >
                <p class="text-[12.5px] text-muted-foreground">
                  {settledQueryData(detail)?.rule.openViolationCount} open violation
                  {settledQueryData(detail)?.rule.openViolationCount === 1 ? "" : "s"}.
                </p>
                <a
                  href={`/t/${params.tenantId}/restricted-software?rule=${params.ruleId}`}
                  class="mt-2 inline-block text-[12px] text-brand-foreground hover:underline"
                >
                  Open the violations view
                </a>
              </Panel>
            </Show>
          </Show>
        </Show>
      </Page>
    </Show>
  );
}
