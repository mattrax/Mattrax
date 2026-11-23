import { useParams } from "@solidjs/router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/solid-query";
import { createSignal, For, Show } from "solid-js";
import {
  APPROVAL_ACTIONS,
  APPROVAL_ACTION_LABELS,
  APPROVAL_MAX_REQUIRED,
  APPROVAL_SCOPE_TYPES,
  BUILT_IN_ROLE_LABELS,
  PERMISSION_GROUPS,
  approvalActionSupportsScope,
} from "@mattrax/enterprise-domain/client";
import type {
  ApprovalAction,
  ApprovalPolicy,
  ApprovalRequestInfo,
} from "@mattrax/enterprise-domain/client";
import { Badge } from "~/components/ui/badge";
import { Button } from "~/components/ui/button";
import { ConfirmDialog } from "~/components/ui/confirm-dialog";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "~/components/ui/dialog";
import { Input } from "~/components/ui/input";
import { toast } from "~/components/toast";
import {
  ErrorText,
  Page,
  PageHeader,
  Panel,
  QueryError,
  relativeTime,
} from "~/components/mdm/common";
import { enterprise, enterpriseKeys, enterpriseQueries } from "~/lib/enterprise";
import { useTenantPermissions } from "~/lib/permissions";
import { approvalRetryFor, clearApprovalRetry } from "~/lib/approval-retry";
import { cn } from "~/lib/utils";

const selectClass =
  "h-9 w-full rounded-lg border border-input bg-surface px-2.5 text-[12.5px] text-foreground outline-none transition-colors focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50 disabled:opacity-50";

const labelClass = "text-[11px] font-[560] uppercase tracking-[0.02em] text-muted-foreground";

const permissionOptions = PERMISSION_GROUPS.flatMap((group) =>
  group.permissions.map((permission) => ({
    value: permission.id,
    label: permission.label,
    group: group.label,
  })),
);

const roleOptions = Object.entries(BUILT_IN_ROLE_LABELS).map(([value, label]) => ({
  value,
  label,
}));

const actionLabel = (action: ApprovalAction) => APPROVAL_ACTION_LABELS[action] ?? action;

const statusTone = (status: ApprovalRequestInfo["status"]) => {
  switch (status) {
    case "approved":
      return "success" as const;
    case "pending":
      return "warning" as const;
    case "rejected":
    case "cancelled":
      return "destructive" as const;
    default:
      return "outline" as const;
  }
};

const statusLabel = (status: ApprovalRequestInfo["status"]) =>
  status[0].toUpperCase() + status.slice(1);

const summaryValue = (value: unknown): string => {
  if (value == null) return "—";
  if (Array.isArray(value)) return value.length === 0 ? "—" : value.map(String).join(", ");
  if (typeof value === "object") return JSON.stringify(value);
  return String(value);
};

const summaryEntries = (summary: ApprovalRequestInfo["payloadSummary"]) =>
  typeof summary === "object" && summary !== null && !Array.isArray(summary)
    ? Object.entries(summary)
    : [["value", summary] as const];

const policyScopeLabel = (policy: ApprovalPolicy) =>
  policy.scopeType === "tenant"
    ? "Whole tenant"
    : (policy.scopeType === "group" ? "Group " : "Device ") + (policy.scopeId ?? "");

const policyApproverLabel = (policy: ApprovalPolicy) =>
  policy.approverRole
    ? "Built-in " + policy.approverRole + " or above"
    : (policy.approverPermission ?? "No approver configured");

function RequestCard(props: {
  request: ApprovalRequestInfo;
  onDecide: (request: ApprovalRequestInfo, decision: "approve" | "reject") => void;
  onCancel: (request: ApprovalRequestInfo) => void;
  /** A live retry closure exists for this session's original call. */
  canRetry: boolean;
  onRetry: (request: ApprovalRequestInfo) => void;
  canBreakGlass: boolean;
  onBreakGlass: (request: ApprovalRequestInfo) => void;
}) {
  const pending = () => props.request.status === "pending";

  return (
    <div class="rounded-lg border border-border bg-card px-4 py-3">
      <div class="flex flex-wrap items-start justify-between gap-2">
        <div class="min-w-0">
          <div class="flex flex-wrap items-center gap-2">
            <span class="text-[13px] font-[560] text-foreground">{props.request.actionLabel}</span>
            <Badge
              variant={statusTone(props.request.status)}
              dot={pending() ? "warning" : undefined}
            >
              {statusLabel(props.request.status)}
            </Badge>
            <Show when={props.request.breakGlass}>
              <Badge variant="destructive">Break-glass</Badge>
            </Show>
          </div>
          <p class="mt-1 text-[12px] text-muted-foreground">
            {props.request.requesterName ?? "An administrator"}
            <Show when={props.request.requesterEmail}> ({props.request.requesterEmail})</Show>{" "}
            requested this {relativeTime(props.request.createdAt)}.{" "}
            {props.request.approvalsReceived} of {props.request.approvalsRequired} approvals.
          </p>
        </div>
        <div class="text-right text-[11.5px] text-muted-foreground">
          <div>Expires {relativeTime(props.request.expiresAt)}</div>
          <div class="font-mono text-[10.5px]">{props.request.id}</div>
        </div>
      </div>

      <Show when={summaryEntries(props.request.payloadSummary).length > 0}>
        <dl class="mt-3 grid grid-cols-2 gap-x-4 gap-y-1 text-[12px] sm:grid-cols-3">
          <For each={summaryEntries(props.request.payloadSummary)}>
            {([key, value]) => (
              <>
                <dt class="truncate text-muted-foreground">{key}</dt>
                <dd class="truncate text-foreground">{summaryValue(value)}</dd>
              </>
            )}
          </For>
        </dl>
      </Show>

      <Show when={props.request.decisions.length > 0}>
        <ul class="mt-3 space-y-1 border-t border-border pt-2">
          <For each={props.request.decisions}>
            {(decision) => (
              <li class="text-[12px] text-muted-foreground">
                <span class={decision.decision === "reject" ? "text-destructive" : "text-success"}>
                  {decision.decision === "reject" ? "Rejected" : "Approved"}
                </span>{" "}
                by {decision.approverName ?? decision.approverEmail ?? "an administrator"}{" "}
                {relativeTime(decision.createdAt)}
                <Show when={decision.note}>
                  {" — "}
                  <span class="text-foreground">{decision.note}</span>
                </Show>
              </li>
            )}
          </For>
        </ul>
      </Show>

      <Show when={pending() && (props.request.canApprove || props.request.canCancel)}>
        <div class="mt-3 flex flex-wrap gap-2">
          <Show when={props.request.canApprove}>
            <Button size="sm" onClick={() => props.onDecide(props.request, "approve")}>
              Approve
            </Button>
            <Button
              size="sm"
              variant="outline"
              onClick={() => props.onDecide(props.request, "reject")}
            >
              Reject
            </Button>
          </Show>
          <Show when={props.request.canCancel}>
            <Button size="sm" variant="ghost" onClick={() => props.onCancel(props.request)}>
              Cancel request
            </Button>
          </Show>
        </div>
      </Show>

      <Show when={props.canRetry}>
        <div class="mt-3 flex flex-wrap gap-2 border-t border-border pt-3">
          <Button size="sm" onClick={() => props.onRetry(props.request)}>
            Retry with this approval
          </Button>
          <span class="self-center text-[11.5px] text-muted-foreground">
            Replays the action you started in this browser.
          </span>
        </div>
      </Show>

      <Show when={props.canBreakGlass}>
        <div class="mt-3 flex flex-wrap gap-2 border-t border-border pt-3">
          <Button size="sm" variant="outline" onClick={() => props.onBreakGlass(props.request)}>
            Break-glass and run
          </Button>
          <span class="self-center text-[11.5px] text-muted-foreground">
            Owner override; the reason is audited.
          </span>
        </div>
      </Show>
    </div>
  );
}

export default function ApprovalsSettingsPage() {
  const params = useParams();
  const qc = useQueryClient();
  const { can, tenant } = useTenantPermissions();
  const tenantId = () => params.tenantId;
  const canManage = () => can("approvals.write");
  const canReadQueue = () => can("approvals.read");

  /** Built-in owner authority, never a custom-role delegation. */
  const isOwner = () => {
    const current = tenant();

    return (
      current !== undefined &&
      current.roleId == null &&
      (current.role ?? "")
        .split(",")
        .map((role) => role.trim())
        .includes("owner")
    );
  };

  const [tab, setTab] = createSignal<"pending" | "decided" | "mine">(
    can("approvals.read") ? "pending" : "mine",
  );
  const [policyOpen, setPolicyOpen] = createSignal(false);
  const [editing, setEditing] = createSignal<ApprovalPolicy | null>(null);
  const [formAction, setFormAction] = createSignal<ApprovalAction>("device.wipe");
  const [formScopeType, setFormScopeType] = createSignal<"tenant" | "group" | "device">("tenant");
  const [formScopeId, setFormScopeId] = createSignal("");
  const [formApproverKind, setFormApproverKind] = createSignal<"permission" | "role">("role");
  const [formApproverValue, setFormApproverValue] = createSignal("admin");
  const [formRequired, setFormRequired] = createSignal(1);
  const [deleting, setDeleting] = createSignal<ApprovalPolicy | null>(null);

  const [deciding, setDeciding] = createSignal<{
    request: ApprovalRequestInfo;
    decision: "approve" | "reject";
  } | null>(null);
  const [note, setNote] = createSignal("");
  const [cancelling, setCancelling] = createSignal<ApprovalRequestInfo | null>(null);
  const [breakingGlass, setBreakingGlass] = createSignal<ApprovalRequestInfo | null>(null);
  const [breakGlassReason, setBreakGlassReason] = createSignal("");

  const policiesQuery = useQuery(() => ({
    ...enterpriseQueries.approvalPolicies(tenantId()),
    enabled: canReadQueue(),
  }));
  const pendingQuery = useQuery(() => ({
    ...enterpriseQueries.approvalRequests(tenantId(), { status: "pending" }),
    enabled: canReadQueue(),
  }));
  const decidedQuery = useQuery(() => ({
    ...enterpriseQueries.approvalRequests(tenantId(), { status: "decided" }),
    enabled: canReadQueue(),
  }));
  const mineQuery = useQuery(() =>
    enterpriseQueries.approvalRequests(tenantId(), { status: "all", mine: "true" }),
  );

  const retry = useMutation(() => ({
    mutationFn: async (input: { request: ApprovalRequestInfo; breakGlassReason?: string }) => {
      const pendingRetry = approvalRetryFor(input.request.id);

      if (!pendingRetry)
        throw new Error(
          "Re-run the original action in this browser first, then retry it from here.",
        );

      return pendingRetry.retry(
        input.breakGlassReason
          ? { breakGlassReason: input.breakGlassReason }
          : { approvalId: input.request.id },
      );
    },
    onSuccess: async (_result, input) => {
      toast.success("Action replayed with approval");
      clearApprovalRetry(input.request.id);
      setBreakingGlass(null);
      setBreakGlassReason("");
      await invalidate();
    },
  }));

  const activeQuery = () => {
    if (!canReadQueue()) return mineQuery;

    switch (tab()) {
      case "decided":
        return decidedQuery;
      case "mine":
        return mineQuery;
      default:
        return pendingQuery;
    }
  };

  const invalidate = async () => {
    await Promise.all([
      qc.invalidateQueries({
        queryKey: enterpriseKeys.approvalRequests(tenantId(), { status: "pending" }),
      }),
      qc.invalidateQueries({
        queryKey: enterpriseKeys.approvalRequests(tenantId(), { status: "decided" }),
      }),
      qc.invalidateQueries({
        queryKey: enterpriseKeys.approvalRequests(tenantId(), { status: "all", mine: "true" }),
      }),
    ]);
  };

  const resetForm = (policy?: ApprovalPolicy) => {
    setEditing(policy ?? null);
    setFormAction(policy?.action ?? "device.wipe");
    setFormScopeType(policy?.scopeType ?? "tenant");
    setFormScopeId(policy?.scopeId ?? "");
    setFormApproverKind(policy?.approverRole ? "role" : "permission");
    setFormApproverValue(policy?.approverRole ?? policy?.approverPermission ?? "admin");
    setFormRequired(policy?.approvalsRequired ?? 1);
  };

  const openCreate = () => {
    resetForm();
    setPolicyOpen(true);
  };

  const openEdit = (policy: ApprovalPolicy) => {
    resetForm(policy);
    setPolicyOpen(true);
  };

  const savePolicy = useMutation(() => ({
    mutationFn: async () => {
      const shared = {
        scopeType: formScopeType(),
        scopeId: formScopeType() === "tenant" ? null : formScopeId().trim(),
        approverPermission: formApproverKind() === "permission" ? formApproverValue() : null,
        approverRole: formApproverKind() === "role" ? formApproverValue() : null,
        approvalsRequired: formRequired(),
      };
      const current = editing();

      if (current) await enterprise.patchApprovalPolicy(tenantId(), current.id, shared);
      else await enterprise.createApprovalPolicy(tenantId(), { action: formAction(), ...shared });
    },
    onSuccess: async () => {
      toast.success(editing() ? "Approval policy updated" : "Approval policy created");
      setPolicyOpen(false);
      await qc.invalidateQueries({ queryKey: enterpriseKeys.approvalPolicies(tenantId()) });
    },
  }));

  const removePolicy = useMutation(() => ({
    mutationFn: (policy: ApprovalPolicy) => enterprise.deleteApprovalPolicy(tenantId(), policy.id),
    onSuccess: async () => {
      toast.success("Approval policy removed");
      setDeleting(null);
      await qc.invalidateQueries({ queryKey: enterpriseKeys.approvalPolicies(tenantId()) });
    },
  }));

  const decide = useMutation(() => ({
    mutationFn: (input: {
      request: ApprovalRequestInfo;
      decision: "approve" | "reject";
      note: string;
    }) =>
      input.decision === "approve"
        ? enterprise.approveApprovalRequest(tenantId(), input.request.id, input.note)
        : enterprise.rejectApprovalRequest(tenantId(), input.request.id, input.note),
    onSuccess: async (_result, input) => {
      toast.success(input.decision === "approve" ? "Request approved" : "Request rejected");
      setDeciding(null);
      setNote("");
      await invalidate();
    },
  }));

  const cancel = useMutation(() => ({
    mutationFn: (request: ApprovalRequestInfo) =>
      enterprise.cancelApprovalRequest(tenantId(), request.id),
    onSuccess: async () => {
      toast.success("Approval request cancelled");
      setCancelling(null);
      await invalidate();
    },
  }));

  const scopedAction = () => approvalActionSupportsScope(formAction());
  const queueTabs = () =>
    canReadQueue()
      ? ([
          ["pending", "Pending"],
          ["decided", "Decided"],
          ["mine", "Mine"],
        ] as const)
      : ([["mine", "Mine"]] as const);
  const approverValues = () =>
    formApproverKind() === "role"
      ? roleOptions
      : permissionOptions.map((item) => ({ value: item.value, label: item.label }));

  return (
    <Page>
      <PageHeader
        eyebrow="Security"
        title="Approvals"
        description="Require a second administrator before destructive actions run. Policies are optional; when none matches an action it behaves exactly as before."
        actions={
          <Show when={canManage()}>
            <Button size="sm" onClick={openCreate}>
              New policy
            </Button>
          </Show>
        }
      />

      <div class="grid gap-4 lg:grid-cols-[minmax(0,1.55fr)_minmax(0,1fr)]">
        <Panel
          title="Approval queue"
          description="Pending requests need another administrator. Approving does not run the action; the requester retries with the request id."
        >
          <div class="mb-3 flex gap-1 rounded-lg bg-hover p-1">
            <For each={queueTabs()}>
              {([value, label]) => (
                <button
                  type="button"
                  class={cn(
                    "flex-1 rounded-md px-3 py-1.5 text-[12.5px] font-[520] transition-colors",
                    tab() === value
                      ? "bg-card text-foreground shadow-sm"
                      : "text-muted-foreground hover:text-foreground",
                  )}
                  onClick={() => setTab(value)}
                >
                  {label}
                  <Show when={value === "pending" && (pendingQuery.data?.requests.length ?? 0) > 0}>
                    <span class="ml-1.5 rounded-full bg-warning/15 px-1.5 text-[10.5px] text-warning">
                      {pendingQuery.data?.requests.length}
                    </span>
                  </Show>
                </button>
              )}
            </For>
          </div>

          <QueryError error={activeQuery().error} onRetry={() => void activeQuery().refetch()} />
          <ErrorText error={retry.error} />
          <Show
            when={(activeQuery().data?.requests.length ?? 0) > 0}
            fallback={
              <p class="py-6 text-center text-[12.5px] text-muted-foreground">
                {tab() === "pending"
                  ? "No approvals are waiting."
                  : tab() === "mine"
                    ? "You have not requested any approvals."
                    : "No decisions yet."}
              </p>
            }
          >
            <div class="space-y-3">
              <For each={activeQuery().data?.requests ?? []}>
                {(request) => (
                  <RequestCard
                    request={request}
                    onDecide={(selected, decision) => {
                      setDeciding({ request: selected, decision });
                      setNote("");
                    }}
                    onCancel={(selected) => setCancelling(selected)}
                    canRetry={
                      request.status === "approved" &&
                      request.consumedAt == null &&
                      request.requestedByMe &&
                      approvalRetryFor(request.id) !== undefined
                    }
                    onRetry={(selected) => retry.mutate({ request: selected })}
                    canBreakGlass={
                      request.status === "pending" &&
                      request.requestedByMe &&
                      isOwner() &&
                      approvalRetryFor(request.id) !== undefined
                    }
                    onBreakGlass={(selected) => {
                      setBreakingGlass(selected);
                      setBreakGlassReason("");
                    }}
                  />
                )}
              </For>
            </div>
          </Show>
        </Panel>

        <div class="space-y-4">
          <Show when={canReadQueue()}>
            <Panel
              title="Policies"
              description="The most specific scope wins: device, then group, then tenant."
            >
              <QueryError
                error={policiesQuery.error}
                onRetry={() => void policiesQuery.refetch()}
              />
              <Show
                when={(policiesQuery.data?.policies.length ?? 0) > 0}
                fallback={
                  <p class="py-4 text-[12.5px] text-muted-foreground">
                    No policies. Destructive actions keep their existing step-up checks only.
                  </p>
                }
              >
                <ul class="divide-y divide-border">
                  <For each={policiesQuery.data?.policies ?? []}>
                    {(policy) => (
                      <li class="flex items-start justify-between gap-3 py-2.5 first:pt-0 last:pb-0">
                        <div class="min-w-0">
                          <div class="text-[12.5px] font-[540] text-foreground">
                            {actionLabel(policy.action)}
                          </div>
                          <div class="text-[11.5px] text-muted-foreground">
                            {policyScopeLabel(policy)} · {policyApproverLabel(policy)} ·{" "}
                            {policy.approvalsRequired} approval
                            {policy.approvalsRequired === 1 ? "" : "s"}
                          </div>
                        </div>
                        <Show when={canManage()}>
                          <div class="flex shrink-0 gap-1">
                            <Button size="sm" variant="ghost" onClick={() => openEdit(policy)}>
                              Edit
                            </Button>
                            <Button
                              size="sm"
                              variant="ghost"
                              class="text-destructive"
                              onClick={() => setDeleting(policy)}
                            >
                              Delete
                            </Button>
                          </div>
                        </Show>
                      </li>
                    )}
                  </For>
                </ul>
              </Show>
            </Panel>
          </Show>

          <Panel
            title="Your requests"
            description="Requests you started, including ones already decided."
          >
            <Show
              when={(mineQuery.data?.requests.length ?? 0) > 0}
              fallback={
                <p class="py-3 text-[12.5px] text-muted-foreground">
                  Nothing requested yet. A gated action creates a request automatically.
                </p>
              }
            >
              <ul class="space-y-2">
                <For each={mineQuery.data?.requests ?? []}>
                  {(request) => (
                    <li class="flex items-center justify-between gap-2 text-[12px]">
                      <span class="min-w-0 truncate">
                        {request.actionLabel}{" "}
                        <span class="text-muted-foreground">{relativeTime(request.createdAt)}</span>
                        <span class="ml-1.5 font-mono text-[10.5px] text-muted-foreground">
                          {request.id}
                        </span>
                      </span>
                      <Badge variant={statusTone(request.status)}>
                        {statusLabel(request.status)}
                      </Badge>
                    </li>
                  )}
                </For>
              </ul>
            </Show>
          </Panel>
        </div>
      </div>

      <Dialog open={policyOpen()} onOpenChange={setPolicyOpen}>
        <DialogContent class="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>{editing() ? "Edit approval policy" : "New approval policy"}</DialogTitle>
            <DialogDescription>
              Choose the action, who may approve it, and how many distinct approvers are needed.
              Requesters can never approve their own request.
            </DialogDescription>
          </DialogHeader>

          <div class="space-y-3">
            <label class="block space-y-1">
              <span class={labelClass}>Action</span>
              <select
                class={selectClass}
                value={formAction()}
                disabled={editing() !== null}
                onChange={(event) => {
                  const next = event.currentTarget.value as ApprovalAction;
                  setFormAction(next);
                  if (!approvalActionSupportsScope(next)) {
                    setFormScopeType("tenant");
                    setFormScopeId("");
                  }
                }}
              >
                <For each={APPROVAL_ACTIONS}>
                  {(action) => <option value={action}>{actionLabel(action)}</option>}
                </For>
              </select>
            </label>

            <div class="grid grid-cols-2 gap-3">
              <label class="block space-y-1">
                <span class={labelClass}>Scope</span>
                <select
                  class={selectClass}
                  value={formScopeType()}
                  disabled={!scopedAction()}
                  onChange={(event) =>
                    setFormScopeType(event.currentTarget.value as "tenant" | "group" | "device")
                  }
                >
                  <For each={APPROVAL_SCOPE_TYPES}>
                    {(scope) => (
                      <option value={scope}>{scope[0].toUpperCase() + scope.slice(1)}</option>
                    )}
                  </For>
                </select>
              </label>
              <label class="block space-y-1">
                <span class={labelClass}>Approvals required</span>
                <Input
                  type="number"
                  min={1}
                  max={APPROVAL_MAX_REQUIRED}
                  value={formRequired()}
                  onInput={(event) =>
                    setFormRequired(
                      Math.min(
                        APPROVAL_MAX_REQUIRED,
                        Math.max(1, Math.trunc(Number(event.currentTarget.value) || 1)),
                      ),
                    )
                  }
                />
              </label>
            </div>

            <Show when={scopedAction() && formScopeType() !== "tenant"}>
              <label class="block space-y-1">
                <span class={labelClass}>
                  {formScopeType() === "group" ? "Group id" : "Device id"}
                </span>
                <Input
                  value={formScopeId()}
                  placeholder={formScopeType() === "group" ? "group id" : "device id"}
                  onInput={(event) => setFormScopeId(event.currentTarget.value)}
                />
              </label>
            </Show>

            <div class="grid grid-cols-2 gap-3">
              <label class="block space-y-1">
                <span class={labelClass}>Approver must hold</span>
                <select
                  class={selectClass}
                  value={formApproverKind()}
                  onChange={(event) => {
                    const kind = event.currentTarget.value as "permission" | "role";
                    setFormApproverKind(kind);
                    setFormApproverValue(kind === "role" ? "admin" : "devices.command");
                  }}
                >
                  <option value="role">Built-in role</option>
                  <option value="permission">Permission</option>
                </select>
              </label>
              <label class="block space-y-1">
                <span class={labelClass}>
                  {formApproverKind() === "role" ? "Role" : "Permission"}
                </span>
                <select
                  class={selectClass}
                  value={formApproverValue()}
                  onChange={(event) => setFormApproverValue(event.currentTarget.value)}
                >
                  <For each={approverValues()}>
                    {(option) => <option value={option.value}>{option.label}</option>}
                  </For>
                </select>
              </label>
            </div>

            <p class="text-[11.5px] leading-5 text-muted-foreground">
              Approvers also need <span class="font-mono">approvals.write</span>. API tokens can
              request approval but can never approve. Account-wide tokens can only be created by
              platform administrators, so tenant members always create a token this policy can
              govern. Requests expire after 24 hours.
            </p>

            <ErrorText error={savePolicy.error} />
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setPolicyOpen(false)}>
              Cancel
            </Button>
            <Button
              disabled={
                savePolicy.isPending ||
                (scopedAction() && formScopeType() !== "tenant" && !formScopeId().trim())
              }
              onClick={() => savePolicy.mutate()}
            >
              {editing() ? "Save policy" : "Create policy"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog
        open={deciding() !== null}
        onOpenChange={(open) => {
          if (!open) setDeciding(null);
        }}
      >
        <DialogContent class="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>
              {deciding()?.decision === "approve" ? "Approve request" : "Reject request"}
            </DialogTitle>
            <DialogDescription>
              {deciding()?.request.actionLabel} requested by{" "}
              {deciding()?.request.requesterEmail ?? "an administrator"}.
            </DialogDescription>
          </DialogHeader>
          <label class="block space-y-1">
            <span class={labelClass}>
              Note {deciding()?.decision === "reject" ? "(required)" : "(optional)"}
            </span>
            <Input
              value={note()}
              onInput={(event) => setNote(event.currentTarget.value)}
              placeholder={
                deciding()?.decision === "approve"
                  ? "Why you are approving"
                  : "Why this should not run"
              }
            />
          </label>
          <ErrorText error={decide.error} />
          <DialogFooter>
            <Button variant="outline" onClick={() => setDeciding(null)}>
              Cancel
            </Button>
            <Button
              variant={deciding()?.decision === "reject" ? "destructive" : "default"}
              disabled={
                decide.isPending ||
                (deciding()?.decision === "reject" && note().trim().length === 0)
              }
              onClick={() => {
                const current = deciding();
                if (!current) return;
                decide.mutate({
                  request: current.request,
                  decision: current.decision,
                  note: note(),
                });
              }}
            >
              {deciding()?.decision === "approve" ? "Approve" : "Reject"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <ConfirmDialog
        open={deleting() !== null}
        onOpenChange={(open) => {
          if (!open) setDeleting(null);
        }}
        title="Delete approval policy?"
        description={
          "This action will no longer require a second administrator. Pending requests already created keep their rules."
        }
        confirmLabel="Delete policy"
        destructive
        pending={removePolicy.isPending}
        error={removePolicy.error}
        onConfirm={() => {
          const policy = deleting();
          if (policy) removePolicy.mutate(policy);
        }}
      />

      <Dialog
        open={breakingGlass() !== null}
        onOpenChange={(open) => {
          if (!open) setBreakingGlass(null);
        }}
      >
        <DialogContent class="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Break-glass and run?</DialogTitle>
            <DialogDescription>
              {breakingGlass()?.actionLabel} will run without the second administrator. The reason
              is recorded as a prominent audit event.
            </DialogDescription>
          </DialogHeader>
          <label class="block space-y-1">
            <span class={labelClass}>Reason (required)</span>
            <Input
              value={breakGlassReason()}
              onInput={(event) => setBreakGlassReason(event.currentTarget.value)}
              placeholder="Why the second administrator is unavailable"
            />
          </label>
          <ErrorText error={retry.error} />
          <DialogFooter>
            <Button variant="outline" onClick={() => setBreakingGlass(null)}>
              Cancel
            </Button>
            <Button
              variant="destructive"
              disabled={retry.isPending || breakGlassReason().trim().length === 0}
              onClick={() => {
                const request = breakingGlass();
                if (request) retry.mutate({ request, breakGlassReason: breakGlassReason().trim() });
              }}
            >
              Break-glass and run
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <ConfirmDialog
        open={cancelling() !== null}
        onOpenChange={(open) => {
          if (!open) setCancelling(null);
        }}
        title="Cancel approval request?"
        description="The request becomes unusable. You can start a new one by retrying the action."
        confirmLabel="Cancel request"
        destructive
        pending={cancel.isPending}
        error={cancel.error}
        onConfirm={() => {
          const request = cancelling();
          if (request) cancel.mutate(request);
        }}
      />
    </Page>
  );
}
