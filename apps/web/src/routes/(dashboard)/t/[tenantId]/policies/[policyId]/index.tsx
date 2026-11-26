import { Checkbox } from "@mattrax/ui";
import { useParams } from "@solidjs/router";
import { useNavigate } from "~/lib/navigation";
import { useMutation, useQuery, useQueryClient } from "@tanstack/solid-query";
import {
  APPLE_LOCK_SCREEN_MESSAGE_MAX_LENGTH,
  PolicyRow,
  certificateRenewalDueAt,
} from "@mattrax/enterprise-domain/client";
import { Match, Option, Schema } from "effect";
import { createEffect, createSignal, createUniqueId, For, Show } from "solid-js";
import {
  ErrorText,
  Field,
  formatDate,
  Page,
  PageBreadcrumbs,
  PageHeader,
  Panel,
  QueryError,
  relativeTime,
  SkeletonRows,
} from "~/components/mdm/common";
import MobileconfigPreview from "~/components/mdm/mobileconfig-preview";
import PolicyProgressBar from "~/components/mdm/policy-progress";
import PolicyViewTabs from "~/components/mdm/policy-view-tabs";
import { ScopeTagAssignmentEditor } from "~/components/scope-tags/scope-tag-select";
import { Badge } from "~/components/ui/badge";
import { Button } from "~/components/ui/button";
import ConfirmDialog from "~/components/ui/confirm-dialog";
import { Input } from "~/components/ui/input";
import PasswordInput from "~/components/ui/password-input";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "~/components/ui/dialog";
import {
  Activity,
  ChevronDown,
  CircleAlert,
  Plus,
  ShieldCheck,
  SlidersHorizontal,
  Wifi,
} from "~/components/ui/icons";
import StaleWriteBanner from "~/components/stale-write-banner";
import { toast } from "~/components/toast";
import { enterprise, enterpriseKeys } from "~/lib/enterprise";
import { errorMessage, raisedFailure } from "~/lib/errors";
import {
  optimisticallyPatchItem,
  optimisticallyRemoveRows,
  optimisticallyUpdateList,
} from "~/lib/optimistic";
import {
  isPolicyEnabled,
  policyDeploymentSegments,
  policyDeliveryStatePresentation,
  policyStatePresentation,
} from "~/lib/policy-delivery";
import {
  policyOsRangeLabel,
  policyScopeChannelLabel,
  policyScopeCounts,
  policyScopeCountsLabel,
  policyScopePlatformLabel,
  policyScopeReasonLabel,
  policyScopeStatusLabel,
  policyScopeStatusTone,
  policyScopeWarnings,
} from "~/lib/policy-scope";
import type { PolicyScopeCounts } from "~/lib/policy-scope";
import { ReadOnlyNotice, useCan } from "~/lib/permissions";
import { createStaleWriteGuard } from "~/lib/stale-write";
import { handleStaleWriteWithToast } from "~/lib/stale-write-toast";
import { useUnsavedChanges } from "~/lib/unsaved-changes";
import { parsePolicyDraft } from "~/lib/policy-designer/build";
import type { PolicyConfiguration, PolicyConfigurations } from "~/lib/policy-designer/build";
import {
  applePasscodeConfiguration,
  appleWifiConfiguration,
  windowsWifiConfiguration,
} from "~/lib/policy-designer/presets";
import type { WifiSecurity } from "~/lib/policy-designer/presets";
import { preloadPage } from "~/lib/page-data";
import { queryClient } from "~/lib/query-client";
import { enterpriseQueries } from "~/lib/enterprise";

const decodePolicyRow = Schema.decodeUnknownOption(PolicyRow);

const decodeJsonObject = Schema.decodeUnknownOption(Schema.JsonObject);

const isString = Schema.is(Schema.String);

const WifiSecuritySchema = Schema.Literals(["wpa2", "wpa3", "open"]);

const decodeWifiSecurity = Schema.decodeUnknownOption(WifiSecuritySchema);

const platformLabel = (platform: string) =>
  Match.value(platform).pipe(
    Match.when("apple", () => "Apple"),
    Match.when("windows", () => "Windows"),
    Match.orElse(() => "Android"),
  );

const platformForKind = (kind: string) =>
  kind.startsWith("mttx.windows")
    ? "windows"
    : kind.startsWith("mttx.android")
      ? "android"
      : "apple";

const isRecord = (value: Schema.Json | undefined): value is Schema.JsonObject =>
  value !== null && value !== undefined && typeof value === "object" && !Array.isArray(value);

/** Friendly description for a stored configuration, without raw JSON. */
const describe = (kind: string, data: Schema.Json | undefined) => {
  const record: Schema.JsonObject = isRecord(data) ? data : {};
  const draft = parsePolicyDraft(record.draft);

  if (draft) {
    const target = platformForKind(kind);
    const selections = draft.platforms[target] ?? [];

    return {
      title: draft.name || kindLabel(kind),
      subtitle: `${kindLabel(kind)} · ${selections.length} collection${
        selections.length === 1 ? "" : "s"
      }`,
      collections: selections.map((selection) => ({ label: selection.name, platform: target })),
      platforms: [target],
    };
  }

  if (Array.isArray(record.nodes)) {
    return {
      title: isString(record.ssid) ? `Wi-Fi: ${record.ssid}` : kindLabel(kind),
      subtitle: `${record.nodes.length} OMA-URI node${record.nodes.length === 1 ? "" : "s"}`,
      collections: record.nodes
        .filter(isRecord)
        .slice(0, 8)
        .map((node) => ({ label: String(node.omaUri ?? "Node"), platform: "windows" })),
      platforms: ["windows"],
    };
  }

  if (isRecord(record.policy)) {
    const keys = Object.keys(record.policy);

    return {
      title: kindLabel(kind),
      subtitle: `${keys.length} Android setting${keys.length === 1 ? "" : "s"}`,
      collections: keys.slice(0, 8).map((key) => ({ label: key, platform: "android" })),
      platforms: ["android"],
    };
  }

  if (isString(record.content)) {
    const signed =
      record.signed === true ||
      (!record.content.startsWith("PD94bWw") && !record.content.startsWith("PHBsaXN0"));

    const security = Match.value(record.security).pipe(
      Match.when("wpa3", () => "WPA3 Personal"),
      Match.when("wpa2", () => "WPA2 Personal"),
      Match.when("open", () => "Open network"),
      Match.orElse(() => undefined),
    );

    return {
      title: isString(record.ssid)
        ? `Wi-Fi: ${record.ssid}`
        : String(record.fileName ?? kindLabel(kind)),
      subtitle: signed
        ? "Signed profile · deployed exactly as uploaded"
        : security
          ? `${security} · custom profile`
          : "Custom profile",
      collections: [],
      platforms: ["apple"],
      signed,
    };
  }

  if (isString(record.pem))
    return {
      title: kindLabel(kind),
      subtitle: "Trusted root certificate attached to this policy",
      collections: [],
      platforms: [platformForKind(kind)],
    };

  if (isString(record.materialSha256)) {
    const renewal = isString(record.notAfter)
      ? certificateRenewalDueAt(record.notAfter, {
          validityDays: typeof record.validityDays === "number" ? record.validityDays : null,
          renewalThresholdPercent:
            typeof record.renewalThresholdPercent === "number"
              ? record.renewalThresholdPercent
              : null,
        })
      : null;

    return {
      title: kindLabel(kind),
      subtitle: [
        isString(record.subject) ? record.subject : "Certificate identity",
        isString(record.notAfter)
          ? `expires ${new Date(record.notAfter).toLocaleDateString()}`
          : null,
        renewal ? `renewal due ${renewal.toLocaleDateString()}` : null,
        isString(record.template) ? `template ${record.template}` : null,
      ]
        .filter(Boolean)
        .join(" · "),
      collections: [],
      platforms: [platformForKind(kind)],
    };
  }

  if (isRecord(record.incoming))
    return {
      title: kindLabel(kind),
      subtitle: [
        isString(record.visibleName) ? record.visibleName : "Mail account",
        isRecord(record.smime) ? "S/MIME configured" : "S/MIME off",
      ].join(" · "),
      collections: [],
      platforms: ["apple"],
    };

  if (kind === "mttx.windows.laps")
    return {
      title: "Windows LAPS",
      subtitle:
        (isString(record.backupDirectory) ? String(record.backupDirectory) : "no backup") +
        (record.passwordAgeDays !== undefined
          ? ` · ${String(record.passwordAgeDays)} day password`
          : ""),
      collections: [
        {
          label: isString(record.accountName)
            ? String(record.accountName)
            : "Built-in administrator",
          platform: "windows",
        },
      ],
      platforms: ["windows"],
    };

  if (kind === "mttx.apple.lockScreenMessage")
    return {
      title: "Lock screen message",
      subtitle: isString(record.message)
        ? record.message.slice(0, 80) + (record.message.length > 80 ? "…" : "")
        : "No message",
      collections:
        record.includeAssetTag === true ? [{ label: "Includes asset tag", platform: "apple" }] : [],
      platforms: ["apple"],
    };

  return {
    title: kindLabel(kind),
    subtitle: Object.keys(record).length
      ? `${Object.keys(record).length} field${Object.keys(record).length === 1 ? "" : "s"}`
      : "No settings",
    collections: [],
    platforms: [],
  };
};

const textareaClass =
  "min-h-28 w-full rounded-lg border border-input bg-transparent px-2.5 py-2 text-sm text-foreground outline-none transition-colors placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 dark:bg-input/30";

const kindLabel = (kind: string) => {
  if (kind === "mttx.apple.device") return "Device restrictions";

  if (kind.startsWith("mttx.apple.certificate") || kind.startsWith("mttx.windows.certificate"))
    return "Trusted root certificate";

  if (kind.startsWith("mttx.android.certificate")) return "Android trusted root";

  if (kind.startsWith("mttx.apple.pkcs") || kind.startsWith("mttx.windows.pkcs"))
    return "PKCS certificate";

  if (kind.startsWith("mttx.apple.pfx") || kind.startsWith("mttx.windows.pfx"))
    return "Imported PFX certificate";

  if (kind.startsWith("mttx.apple.mail")) return "Mail account (S/MIME)";

  if (kind === "mttx.apple.lockScreenMessage") return "Lock screen message";

  if (kind === "mttx.apple.custom.wifi" || kind === "mttx.windows.custom.wifi") return "Wi-Fi";

  if (kind === "mttx.apple.custom.passcode") return "Passcode";

  if (kind === "mttx.apple.custom.designer") return "Apple configuration";

  if (kind.startsWith("mttx.apple.custom")) return "Custom profile";

  if (kind.startsWith("mttx.apple.application")) return "Application";

  if (kind.startsWith("mttx.apple.declaration")) return "Declaration";

  if (kind === "mttx.windows.laps") return "Windows LAPS";

  if (kind === "mttx.windows.custom.designer") return "Windows configuration";

  if (kind.startsWith("mttx.windows.custom")) return "Windows configuration";

  if (kind === "mttx.android.policy.designer") return "Android policy";

  if (kind.startsWith("mttx.android.policy")) return "Android policy";

  return kind;
};

export const route = {
  preload: ({
    params,
    intent,
  }: {
    params: { tenantId?: string; policyId?: string };
    intent: string;
  }) => {
    const tenantId = params.tenantId;
    const policyId = params.policyId;

    if (intent === "initial" || !tenantId || !policyId) return;

    return preloadPage([
      () => queryClient.ensureQueryData(enterpriseQueries.item(tenantId, "policy", policyId)),
      () =>
        queryClient.ensureQueryData({
          queryKey: [...enterpriseKeys.item(tenantId, "policy", policyId), "deployments"],
          queryFn: () => enterprise.listPolicyDeployments(tenantId, policyId),
        }),
    ]);
  },
};

/** Read secondary query data only after success so pending async values never throw during render. */
function settledQueryData<T>(query: {
  readonly isSuccess: boolean;
  readonly data: T | undefined;
}): T | undefined {
  return query.isSuccess ? query.data : undefined;
}

export default function PolicyDetailPage() {
  const params = useParams();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const { can } = useCan();
  const writable = () => can("policies.write");

  const policy = useQuery(() => ({
    queryKey: enterpriseKeys.item(params.tenantId, "policy", params.policyId),
    queryFn: () => enterprise.get(params.tenantId, "policy", params.policyId),
  }));

  const row = () => Option.getOrUndefined(decodePolicyRow(settledQueryData(policy)));
  const guard = createStaleWriteGuard(() => row()?.updatedAt);
  /** Bumped by "Reload latest" to reseed the metadata form. */
  const [reseed, setReseed] = createSignal(0);
  const [name, setName] = createSignal("");
  const [notes, setNotes] = createSignal("");
  const [priority, setPriority] = createSignal("0");
  const [deleteOpen, setDeleteOpen] = createSignal(false);
  const [enabledOpen, setEnabledOpen] = createSignal(false);
  // Snapshot the requested state when the dialog opens so optimistic updates
  // and a pending request cannot flip the wording underneath the user.
  const [enabledTarget, setEnabledTarget] = createSignal(false);
  const [confirm, setConfirm] = createSignal("");
  const [addOpen, setAddOpen] = createSignal(false);
  const [seeded, setSeeded] = createSignal(false);
  const [lockScreenMessage, setLockScreenMessage] = createSignal("");
  const [lockScreenIncludeAssetTag, setLockScreenIncludeAssetTag] = createSignal(false);
  createEffect(
    () => `${row()?.id ?? ""}:${reseed()}`,
    () => {
      const policy = row();

      if (policy) {
        setName(policy.name);
        setNotes(policy.notes ?? "");
        setPriority(String(policy.priority ?? 0));
        setSeeded(true);
      }
    },
  );

  const dirty = () =>
    seeded() &&
    Boolean(row()) &&
    writable() &&
    (name() !== row()!.name ||
      notes() !== (row()!.notes ?? "") ||
      priority() !== String(row()!.priority ?? 0));

  const unsaved = useUnsavedChanges(dirty, {
    title: "Discard policy metadata changes?",
    description: "The name, notes or conflict priority on this policy have not been saved.",
  });

  const invalidate = async () => {
    await Promise.all([
      qc.invalidateQueries({
        queryKey: enterpriseKeys.item(params.tenantId, "policy", params.policyId),
      }),
      qc.invalidateQueries({ queryKey: enterpriseKeys.list(params.tenantId, "policy") }),
      qc.invalidateQueries({
        queryKey: enterpriseKeys.policyScope(params.tenantId, params.policyId),
      }),
      qc.invalidateQueries({
        queryKey: enterpriseKeys.policyDeployment(params.tenantId, params.policyId, "latest", 1, 0),
      }),
    ]);
  };

  /** Patch the policy's header and its row in the list in one snapshot. */
  const patchPolicy = async (patch: Partial<PolicyRow>) => {
    const restores = await Promise.all([
      optimisticallyPatchItem(qc, params.tenantId!, "policy", params.policyId!, patch),
      optimisticallyUpdateList(qc, params.tenantId!, "policy", (rows) =>
        rows.map((row) => (row.id === params.policyId ? { ...row, ...patch } : row)),
      ),
    ]);

    return () => restores.forEach((restore) => restore());
  };

  const reloadLatest = async () => {
    await policy.refetch();
    setReseed((value) => value + 1);
    guard.acceptLatest();
  };

  const save = useMutation(() => ({
    meta: { inlineError: true },
    mutationFn: () =>
      enterprise.patchPolicy(params.tenantId, params.policyId, {
        name: name(),
        notes: notes() || null,
        priority: Number(priority()) || 0,
        expectedUpdatedAt: guard.expectedUpdatedAt(),
      }),
    onMutate: async () => {
      const restore = await patchPolicy({
        name: name(),
        notes: notes() || null,
        priority: Number(priority()) || 0,
      });

      return { restore };
    },
    onSuccess: () => {
      guard.markSaved();
      toast.success("Policy saved");
      void invalidate();
    },
    onError: (error, _payload, context) => {
      context?.restore();

      if (handleStaleWriteWithToast(error, { reload: invalidate })) {
        // Keep the metadata draft; the banner offers reload or overwrite.
        guard.markConflict();

        return;
      }

      toast.error("Could not save the policy", {
        description: errorMessage(raisedFailure(error), "Try again in a moment."),
      });
    },
  }));

  const enabled = () => isPolicyEnabled(row() ?? {});

  /**
   * Enabling and disabling both re-deliver: waking Apple devices and syncing
   * Android withdraws the settings when disabled and restores them when
   * enabled. Windows converges on its next check-in, where the desired-state
   * diff emits a Delete for every OMA-URI that disappeared.
   */
  const setEnabled = useMutation(() => ({
    mutationFn: (next: boolean) =>
      enterprise.patchPolicy(params.tenantId, params.policyId, {
        enabled: next,
        expectedUpdatedAt: row()?.updatedAt,
      }),
    onMutate: async (next) => {
      const restore = await patchPolicy({ enabled: next });

      return { restore };
    },
    onSuccess: (_result, next) => {
      setEnabledOpen(false);
      toast.success(next ? "Policy enabled" : "Policy disabled", {
        description: next
          ? "Its settings are being delivered to scoped devices again."
          : "Its settings are being withdrawn from scoped devices. The configuration and assignments are kept.",
      });
      void invalidate();
    },
    onError: (error, _next, context) => {
      context?.restore();

      if (handleStaleWriteWithToast(error, { reload: invalidate })) return;

      toast.error("Could not change the policy state", {
        description: errorMessage(raisedFailure(error), "Try again in a moment."),
      });
    },
  }));

  const addConfigurations = useMutation(() => ({
    mutationFn: (configurations: PolicyConfigurations) =>
      enterprise.patchPolicy(params.tenantId, params.policyId, {
        configurations,
        expectedUpdatedAt: row()?.updatedAt,
      }),
    onMutate: async (configurations) => {
      const restore = await patchPolicy({ configurations });

      // The library dialog closes on submit; the configuration badges update
      // from the optimistic value.
      setAddOpen(false);

      return { restore };
    },
    onSuccess: () => void invalidate(),
    onError: (error, _payload, context) => {
      context?.restore();
      handleStaleWriteWithToast(error, { reload: invalidate });
    },
  }));

  const dup = useMutation(() => ({
    mutationFn: () => enterprise.duplicatePolicy(params.tenantId, params.policyId),
    onSuccess: ({ id }) => {
      navigate(`/t/${params.tenantId}/policies/${id}`);
      void qc.invalidateQueries({ queryKey: enterpriseKeys.list(params.tenantId, "policy") });
    },
  }));

  const del = useMutation(() => ({
    mutationFn: () =>
      enterprise.deletePolicies(params.tenantId, params.policyId ? [params.policyId] : []),
    onMutate: async () => {
      const restore = await optimisticallyRemoveRows(
        qc,
        params.tenantId!,
        "policy",
        params.policyId ? [params.policyId] : [],
      );

      navigate(`/t/${params.tenantId}/policies`);

      return { restore };
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: enterpriseKeys.list(params.tenantId, "policy") });
    },
    onError: (error, _payload, context) => {
      context?.restore();
      toast.error("Could not delete the policy", {
        description: errorMessage(raisedFailure(error), "Try again in a moment."),
      });
    },
  }));

  /**
   * Whether Android delivery can actually reach this policy's devices. The
   * banner is informational only, so it waits for the tenant's Android status
   * instead of claiming delivery is broken on a connected tenant.
   */
  const android = useQuery(() => enterpriseQueries.android(params.tenantId));

  const androidDeliveryUnavailable = () =>
    configurations().some(([kind]) => kind.startsWith("mttx.android.policy")) &&
    (!settledQueryData(android)?.configured || !settledQueryData(android)?.available);

  const deployments = useQuery(() => ({
    queryKey: [...enterpriseKeys.item(params.tenantId, "policy", params.policyId), "deployments"],
    queryFn: () => enterprise.listPolicyDeployments(params.tenantId, params.policyId),
  }));

  // One row is enough for the compact counts; the Deployment tab loads the
  // device page under its own key.
  const deploymentSummary = useQuery(() =>
    enterpriseQueries.policyDeployment(params.tenantId, params.policyId, "latest", { limit: 1 }),
  );

  const deploymentApplicable = () => {
    const counts = settledQueryData(deploymentSummary)?.counts;

    return counts ? counts.delivered + counts.pending + counts.failed : 0;
  };

  const rollback = useMutation(() => ({
    mutationFn: (deploymentId: string) =>
      enterprise.rollbackPolicy(params.tenantId, params.policyId, deploymentId),
    onSuccess: () => {
      void Promise.all([
        invalidate(),
        qc.invalidateQueries({
          queryKey: [
            ...enterpriseKeys.item(params.tenantId, "policy", params.policyId),
            "deployments",
          ],
        }),
      ]);
    },
  }));

  const sync = useMutation(() => ({
    mutationFn: () => enterprise.syncPolicies(params.tenantId, [params.policyId!]),
    onSuccess: () => toast.success("Policy sync requested"),
    onError: (error) =>
      toast.error("Could not request a policy sync", {
        description: errorMessage(raisedFailure(error), "Try again in a moment."),
      }),
  }));

  const LOCK_SCREEN_KIND = "mttx.apple.lockScreenMessage";

  const configurations = () =>
    Object.entries(Option.getOrUndefined(decodeJsonObject(row()?.configurations)) ?? {});

  /** The lock screen default has its own editor, so it is not a generic card. */
  const visibleConfigurations = () =>
    configurations().filter(([kind]) => kind !== LOCK_SCREEN_KIND);

  const lockScreenConfiguration = () => {
    const data = configurations().find(([kind]) => kind === LOCK_SCREEN_KIND)?.[1];

    return isRecord(data) ? data : undefined;
  };

  createEffect(
    () => `${row()?.id ?? ""}:${reseed()}`,
    () => {
      const configuration = lockScreenConfiguration();

      setLockScreenMessage(isString(configuration?.message) ? String(configuration.message) : "");
      setLockScreenIncludeAssetTag(configuration?.includeAssetTag === true);
    },
  );

  const lockScreenDirty = () => {
    const configuration = lockScreenConfiguration();
    const storedMessage = isString(configuration?.message)
      ? String(configuration.message).trim()
      : "";

    return (
      lockScreenMessage().trim() !== storedMessage ||
      lockScreenIncludeAssetTag() !== (configuration?.includeAssetTag === true)
    );
  };

  const saveLockScreen = useMutation(() => ({
    mutationFn: (value: { message: string; includeAssetTag: boolean }) =>
      enterprise.patchPolicy(params.tenantId, params.policyId, {
        configurations: {
          [LOCK_SCREEN_KIND]: {
            message: value.message,
            includeAssetTag: value.includeAssetTag,
          },
        },
        expectedUpdatedAt: row()?.updatedAt,
      }),
    onSuccess: () => {
      toast.success("Lock screen default saved", {
        description: "Scoped supervised iPhone and iPad devices apply it on their next check-in.",
      });
      void invalidate();
    },
    onError: (error) => {
      if (handleStaleWriteWithToast(error, { reload: invalidate })) return;

      toast.error("Could not save the lock screen default", {
        description: errorMessage(raisedFailure(error), "Try again in a moment."),
      });
    },
  }));

  const removeLockScreen = useMutation(() => ({
    mutationFn: () =>
      enterprise.patchPolicy(params.tenantId, params.policyId, {
        configurations: { [LOCK_SCREEN_KIND]: null },
        expectedUpdatedAt: row()?.updatedAt,
      }),
    onSuccess: () => {
      toast.success("Lock screen default removed", {
        description:
          "Devices without a per-device override remove the lock screen profile on their next check-in.",
      });
      setLockScreenMessage("");
      setLockScreenIncludeAssetTag(false);
      void invalidate();
    },
    onError: (error) => {
      if (handleStaleWriteWithToast(error, { reload: invalidate })) return;

      toast.error("Could not remove the lock screen default", {
        description: errorMessage(raisedFailure(error), "Try again in a moment."),
      });
    },
  }));

  const scope = useQuery(() => enterpriseQueries.policyScope(params.tenantId, params.policyId));

  const scopeCounts = (): PolicyScopeCounts | undefined => {
    const data = settledQueryData(scope);

    return data ? policyScopeCounts(data.devices) : undefined;
  };

  const scopeWarnings = () => {
    const data = settledQueryData(scope);

    return data ? policyScopeWarnings(data) : [];
  };

  const [scopeLimit, setScopeLimit] = createSignal(50);

  return (
    <Page>
      {unsaved.prompt}
      <QueryError error={policy.error} onRetry={() => void policy.refetch()} />
      <Show when={guard.conflict()}>
        <StaleWriteBanner
          reloading={policy.isFetching}
          onReload={() => void reloadLatest()}
          onKeepMine={() => guard.acceptLatest()}
        />
      </Show>

      <PageBreadcrumbs resourceName={row()?.name} section="Overview" />
      <PageHeader
        title={row()?.name ?? "Policy"}
        description="Configure what this policy deploys to its device scope."
        meta={
          <Show when={row()}>
            <Show when={!enabled()}>
              <Badge variant={policyStatePresentation(row()!).tone} dot="warning">
                Disabled
              </Badge>
            </Show>
            <Badge variant="outline">
              <SlidersHorizontal class="size-3" />
              {configurations().length} configuration{configurations().length === 1 ? "" : "s"}
            </Badge>
            <Badge variant="outline">
              Priority <span class="tabular-nums text-foreground">{row()?.priority ?? 0}</span>
            </Badge>
            <span class="text-xs">Updated {relativeTime(row()?.updatedAt)}</span>
          </Show>
        }
        actions={
          <Show when={writable()}>
            <>
              <Button
                as="a"
                variant="outline"
                href={`/t/${params.tenantId}/policies/import?policy=${params.policyId}`}
              >
                Import
              </Button>
              <Button variant="outline" onClick={() => sync.mutate()} disabled={sync.isPending}>
                {sync.isPending ? "Syncing…" : "Sync"}
              </Button>
              <Button variant="outline" onClick={() => dup.mutate()} disabled={dup.isPending}>
                Duplicate
              </Button>
              <Button variant="destructive" onClick={() => setDeleteOpen(true)}>
                Delete
              </Button>
            </>
          </Show>
        }
      />

      <PolicyViewTabs
        base={`/t/${params.tenantId}/policies/${params.policyId}`}
        active="overview"
      />

      <ErrorText error={sync.error} />
      <ErrorText error={dup.error} />

      <div
        class="grid gap-5 lg:grid-cols-(--policy-grid)"
        style={{ "--policy-grid": "360px minmax(0,1fr)" }}
      >
        <Panel title="Details" description="Metadata saved with this policy.">
          <form
            class="space-y-4"
            onSubmit={(event) => {
              event.preventDefault();
              save.mutate();
            }}
          >
            <Field label="Name">
              <Input
                disabled={!writable()}
                value={name()}
                onInput={(e) => setName(e.currentTarget.value)}
              />
            </Field>
            <Field label="Notes">
              <textarea
                disabled={!writable()}
                class={textareaClass}
                value={notes()}
                onInput={(e) => setNotes(e.currentTarget.value)}
                placeholder="What does this policy do?"
              />
            </Field>
            <Field label="Conflict priority">
              <Input
                type="number"
                min="0"
                step="1"
                disabled={!writable()}
                value={priority()}
                onInput={(e) => {
                  const next = e.currentTarget.value;

                  if (next === "" || /^\d+$/.test(next)) setPriority(next);
                }}
              />
              <p class="mt-1 text-xs leading-relaxed text-muted-foreground">
                Higher numbers win when included policies provide the same configuration kind.
                Direct device assignments beat group assignments first; ties fall back to the most
                recently updated policy, then the smallest id.
              </p>
            </Field>
            <Show when={row()}>
              <div class="flex items-start justify-between gap-3 rounded-lg border border-border bg-muted/15 p-3">
                <div class="min-w-0">
                  <p class="flex items-center gap-2 text-xs font-medium text-foreground">
                    <Badge
                      variant={policyStatePresentation(row()!).tone}
                      dot={enabled() ? "success" : "warning"}
                    >
                      {enabled() ? "Enabled" : "Disabled"}
                    </Badge>
                  </p>
                  <p class="mt-1.5 text-xs leading-relaxed text-muted-foreground">
                    {enabled()
                      ? "Disabling withdraws this policy's settings from its scoped devices. The configuration and assignments are kept, and enabling it deploys them again."
                      : "This policy is disabled, so its settings are withdrawn from devices. The configuration and assignments are kept; enabling it deploys them again."}
                  </p>
                </div>
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  disabled={!writable()}
                  onClick={() => {
                    setEnabledTarget(!enabled());
                    setEnabledOpen(true);
                  }}
                >
                  {enabled() ? "Disable" : "Enable"}
                </Button>
              </div>
            </Show>
            <ErrorText error={save.error} />
            <Show
              when={writable()}
              fallback={
                <ReadOnlyNotice class="mt-1">
                  Your role can view this policy but not edit it.
                </ReadOnlyNotice>
              }
            >
              <Button type="submit" disabled={save.isPending}>
                {save.isPending ? "Saving…" : "Save changes"}
              </Button>
            </Show>
          </form>
        </Panel>

        <Panel
          title="Scope tags"
          description="Limit which delegated administrators can see and change this policy."
        >
          <ScopeTagAssignmentEditor
            tenantId={params.tenantId!}
            resourceType="policy"
            resourceIds={[params.policyId!]}
          />
        </Panel>

        <Panel
          title="Lock screen default"
          description="A return message and optional asset tag for supervised iPhone and iPad devices in this policy's scope. A per-device override on the device page wins."
        >
          <div class="space-y-3">
            <p class="text-xs leading-relaxed text-muted-foreground">
              Mattrax installs Apple's shared-device lock screen profile on the device's next
              check-in and removes it when no message remains. Devices without an asset tag cannot
              include one, and unenrolled or BYOD devices do not accept the profile.
            </p>
            <Field label="Message">
              <textarea
                class={textareaClass}
                value={lockScreenMessage()}
                disabled={!writable()}
                maxlength={APPLE_LOCK_SCREEN_MESSAGE_MAX_LENGTH}
                placeholder={"If found, return to the IT desk\nAsset tag:"}
                onInput={(event) => setLockScreenMessage(event.currentTarget.value)}
              />
            </Field>
            <label class="flex items-start gap-2 text-xs text-muted-foreground">
              <Checkbox
                checked={lockScreenIncludeAssetTag()}
                disabled={!writable()}
                onCheckedChange={(checked) => setLockScreenIncludeAssetTag(checked === true)}
              />
              <span>
                Include each device's asset tag
                <span class="mt-0.5 block text-xs">
                  Adds the asset tag as Apple's AssetTagInformation under the message.
                </span>
              </span>
            </label>
            <Show when={lockScreenMessage().trim().length > APPLE_LOCK_SCREEN_MESSAGE_MAX_LENGTH}>
              <p class="text-xs text-destructive">
                The message must be at most {APPLE_LOCK_SCREEN_MESSAGE_MAX_LENGTH} characters.
              </p>
            </Show>
            <div class="flex flex-wrap items-center gap-2">
              <Show when={writable()}>
                <Button
                  size="sm"
                  disabled={
                    !lockScreenDirty() ||
                    !lockScreenMessage().trim() ||
                    lockScreenMessage().trim().length > APPLE_LOCK_SCREEN_MESSAGE_MAX_LENGTH ||
                    saveLockScreen.isPending
                  }
                  onClick={() =>
                    saveLockScreen.mutate({
                      message: lockScreenMessage().trim(),
                      includeAssetTag: lockScreenIncludeAssetTag(),
                    })
                  }
                >
                  {saveLockScreen.isPending ? "Saving…" : "Save default"}
                </Button>
                <Show when={lockScreenConfiguration()}>
                  <Button
                    size="sm"
                    variant="outline"
                    disabled={removeLockScreen.isPending}
                    onClick={() => removeLockScreen.mutate()}
                  >
                    {removeLockScreen.isPending ? "Removing…" : "Remove default"}
                  </Button>
                </Show>
              </Show>
              <Show when={lockScreenDirty()}>
                <span class="text-xs text-muted-foreground">Unsaved changes</span>
              </Show>
            </div>
          </div>
        </Panel>

        <Panel
          title="Configurations"
          description="Payloads delivered to devices in this policy's scope."
          actions={
            <div class="flex flex-wrap items-center gap-2">
              <Badge variant="secondary">
                {visibleConfigurations().length}
              </Badge>
              <Button
                as="a"
                size="sm"
                variant="outline"
                href={`/t/${params.tenantId}/policies/${params.policyId}/editor`}
              >
                Policy editor
              </Button>
              <Show when={writable()}>
                <Button size="sm" onClick={() => setAddOpen(true)}>
                  <Plus class="mr-1 size-3.5" /> Add
                </Button>
              </Show>
            </div>
          }
        >
          <Show
            when={visibleConfigurations().length > 0}
            fallback={
              <div class="flex flex-col items-start gap-3 rounded-lg border border-dashed border-border bg-muted/20 px-4 py-6">
                <p class="text-xs leading-relaxed text-muted-foreground">
                  Nothing else is delivered yet. Add a Wi-Fi network or passcode rule, or open the
                  policy editor for the full catalogue.
                </p>
                <div class="flex gap-2">
                  <Show when={writable()}>
                    <Button size="sm" onClick={() => setAddOpen(true)}>
                      <Plus class="mr-1 size-3.5" /> Add configuration
                    </Button>
                  </Show>
                  <Button
                    as="a"
                    size="sm"
                    variant="outline"
                    href={`/t/${params.tenantId}/policies/${params.policyId}/editor`}
                  >
                    Policy editor
                  </Button>
                </div>
              </div>
            }
          >
            <div class="space-y-2">
              <Show when={androidDeliveryUnavailable()}>
                <div class="flex items-start gap-2 rounded-lg border border-warning/25 bg-warning/[0.07] px-3 py-2.5 text-xs leading-relaxed text-warning-foreground">
                  <CircleAlert class="mt-0.5 size-3.5 shrink-0" />
                  <span>
                    Android delivery is not available for this tenant. This policy is saved, but no
                    Android device will receive it until Android Enterprise is connected in{" "}
                    <a class="underline" href={`/t/${params.tenantId}/settings/management`}>
                      Settings → Management
                    </a>
                    .
                  </span>
                </div>
              </Show>
              <For each={visibleConfigurations()}>
                {([kind, data]) => (
                  <ConfigurationCard
                    kind={kind}
                    data={data}
                    tenantId={params.tenantId!}
                    policyId={params.policyId!}
                  />
                )}
              </For>
            </div>
          </Show>
          <ErrorText error={addConfigurations.error} />
        </Panel>

        <Panel
          class="lg:col-span-2"
          title="Scope"
          description="Where this policy actually applies, and why it loses anywhere it does not."
          actions={
            <Show when={settledQueryData(scope)}>
              {(data) => (
                <span class="flex flex-wrap items-center justify-end gap-1.5">
                  <For each={data().platforms}>
                    {(platform) => (
                      <Badge variant="outline">
                        {policyScopePlatformLabel(platform)}
                      </Badge>
                    )}
                  </For>
                  <Show when={policyOsRangeLabel(data())}>
                    {(range) => (
                      <Badge variant="secondary">
                        {range()}
                      </Badge>
                    )}
                  </Show>
                  <Badge variant="outline">
                    {policyScopeChannelLabel(data().channels)}
                  </Badge>
                </span>
              )}
            </Show>
          }
        >
          <Show
            when={settledQueryData(scope)}
            fallback={
              <Show when={scope.isError} fallback={<SkeletonRows rows={3} />}>
                <QueryError error={scope.error} onRetry={() => void scope.refetch()} />
              </Show>
            }
          >
            {(data) => (
              <div class="space-y-4">
                <div class="flex flex-wrap items-center gap-x-4 gap-y-2">
                  <p class="text-xs text-muted-foreground">
                    {policyScopeCountsLabel(scopeCounts()!)}
                  </p>
                  <Show when={data().channels.includes("user")}>
                    <p class="text-xs text-muted-foreground">
                      User-scoped settings are resolved on a user channel where the platform has one
                      (Apple), so a device can appear once per linked user. Windows delivers its
                      per-user OMA-URI settings on the device channel.
                    </p>
                  </Show>
                </div>

                <Show when={scopeWarnings().length > 0}>
                  <div class="space-y-2">
                    <For each={scopeWarnings()}>
                      {(warning) => (
                        <div class="flex items-start gap-2 rounded-lg border border-warning/25 bg-warning/[0.07] px-3 py-2.5 text-xs leading-relaxed text-warning-foreground">
                          <CircleAlert class="mt-0.5 size-3.5 shrink-0" />
                          <span>
                            <a
                              class="font-medium underline-offset-2 hover:underline"
                              href={`/t/${params.tenantId}/devices/${warning.deviceId}`}
                            >
                              {warning.deviceName}
                            </a>{" "}
                            {warning.message}
                          </span>
                        </div>
                      )}
                    </For>
                  </div>
                </Show>

                <Show
                  when={data().devices.length > 0}
                  fallback={
                    <p class="rounded-lg border border-dashed border-border bg-muted/20 px-4 py-5 text-xs text-muted-foreground">
                      {visibleConfigurations().length === 0 && !lockScreenConfiguration()
                        ? "This policy has no settings yet. Add a configuration to see where it applies."
                        : "No device is assigned this policy yet. Assign it to a device, a group, or a directory user to see where it applies."}
                    </p>
                  }
                >
                  <div class="divide-y divide-border overflow-hidden rounded-lg border border-border">
                    <For each={data().devices.slice(0, scopeLimit())}>
                      {(entry) => (
                        <div class="space-y-1.5 bg-muted/10 px-3 py-2.5 text-xs">
                          <div class="flex flex-wrap items-center justify-between gap-2">
                            <a
                              class="min-w-0 truncate font-medium text-foreground hover:underline"
                              href={`/t/${params.tenantId}/devices/${entry.deviceId}`}
                            >
                              {entry.deviceName}
                            </a>
                            <span class="flex shrink-0 flex-wrap items-center gap-1.5">
                              <Badge variant={policyScopeStatusTone(entry)}>
                                {policyScopeStatusLabel(entry)}
                              </Badge>
                              <Badge variant="outline">
                                {policyScopePlatformLabel(entry.platform)}
                                <Show when={entry.deviceOs}> · {entry.deviceOs}</Show>
                              </Badge>
                              <Badge variant="outline">
                                {entry.channel === "user"
                                  ? `User: ${entry.userName ?? "linked user"}`
                                  : "Device channel"}
                              </Badge>
                              <Show when={entry.kinds.length > 0}>
                                <Badge variant="subtle">
                                  {entry.kinds.length} setting
                                  {entry.kinds.length === 1 ? "" : "s"}
                                </Badge>
                              </Show>
                            </span>
                          </div>
                          <p class="text-xs leading-relaxed text-muted-foreground">
                            {policyScopeReasonLabel(entry)}
                          </p>
                          <Show when={entry.losses.length > 0}>
                            <ul class="space-y-0.5 text-xs text-muted-foreground">
                              <For each={entry.losses.slice(0, 6)}>
                                {(loss) => (
                                  <li>
                                    <span class="font-mono text-xs">{loss.kind}</span>
                                    <Show when={loss.winnerPolicyName}>
                                      {" "}
                                      → {loss.winnerPolicyName}
                                    </Show>
                                  </li>
                                )}
                              </For>
                            </ul>
                          </Show>
                        </div>
                      )}
                    </For>
                  </div>
                  <Show when={data().truncated}>
                    <p class="text-xs text-muted-foreground">
                      Showing a capped list of {data().devices.length} entries for{" "}
                      {data().deviceCount} devices in scope.
                    </p>
                  </Show>
                  <Show when={!data().truncated && data().devices.length > scopeLimit()}>
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => setScopeLimit((current) => current + 100)}
                    >
                      Show more devices ({data().devices.length - scopeLimit()} remaining)
                    </Button>
                  </Show>
                </Show>
              </div>
            )}
          </Show>
        </Panel>

        <Panel
          class="lg:col-span-2"
          title="Deployment"
          description="Per-device progress for the latest saved version."
          actions={
            <Show when={settledQueryData(deploymentSummary)}>
              {(summary) => (
                <Button
                  as="a"
                  size="sm"
                  variant="outline"
                  href={`/t/${params.tenantId}/policies/${params.policyId}/deployment?version=${summary().version}`}
                >
                  Per-device progress
                </Button>
              )}
            </Show>
          }
        >
          <Show when={!deployments.isPending} fallback={<SkeletonRows rows={2} />}>
            <Show
              when={(settledQueryData(deployments)?.deployments.length ?? 0) > 0}
              fallback={
                <p class="rounded-lg border border-dashed border-border bg-muted/20 px-4 py-5 text-xs text-muted-foreground">
                  No deployments yet. Every save creates a version and starts tracking each device
                  in scope.
                </p>
              }
            >
              <Show
                when={settledQueryData(deploymentSummary)}
                fallback={
                  <Show when={deploymentSummary.isError} fallback={<SkeletonRows rows={2} />}>
                    <QueryError
                      error={deploymentSummary.error}
                      onRetry={() => void deploymentSummary.refetch()}
                    />
                  </Show>
                }
              >
                {(summary) => {
                  const presentation = () => policyDeliveryStatePresentation(summary().state);

                  const segments = () => policyDeploymentSegments(summary().counts);

                  return (
                    <div class="space-y-3">
                      <div class="flex flex-wrap items-center justify-between gap-2">
                        <p class="flex items-center gap-2 text-xs font-medium text-foreground">
                          <Badge variant={presentation().tone} dot={presentation().dot}>
                            {presentation().label}
                          </Badge>
                          <span class="tabular-nums text-muted-foreground">
                            Version {summary().version}
                          </span>
                        </p>
                        <p class="text-xs text-muted-foreground">
                          {summary().counts.scoped} device
                          {summary().counts.scoped === 1 ? "" : "s"} in scope
                        </p>
                      </div>

                      <PolicyProgressBar segments={segments()} />

                      <div class="flex flex-wrap gap-x-4 gap-y-1.5 text-xs text-muted-foreground">
                        <For each={segments().filter((segment) => segment.value > 0)}>
                          {(segment) => (
                            <span class="inline-flex items-center gap-1.5">
                              <span
                                class={`size-1.5 rounded-full ${segment.class}`}
                                aria-hidden="true"
                              />
                              <span class="tabular-nums text-foreground">{segment.value}</span>
                              {segment.label.toLowerCase()}
                            </span>
                          )}
                        </For>
                      </div>

                      <p class="text-xs leading-relaxed text-muted-foreground">
                        {summary().counts.scoped === 0
                          ? "This policy's assignments match no devices right now."
                          : deploymentApplicable() > 0
                            ? `${summary().counts.delivered} of ${deploymentApplicable()} tracked devices report this version. Apple devices converge on their next check-in; Windows and Android apply it on their own schedule.`
                            : "No device in scope has a declarable configuration from this policy yet."}
                        <Show when={summary().counts.untracked > 0}>
                          {" "}
                          {summary().counts.untracked} device
                          {summary().counts.untracked === 1 ? " is" : "s are"} untracked because
                          Windows, Android or a legacy Apple profile does not report declaration
                          status.
                        </Show>
                        <Show when={summary().counts.notInScope > 0}>
                          {" "}
                          {summary().counts.notInScope} device
                          {summary().counts.notInScope === 1 ? " has" : "s have"} left the policy's
                          scope but still reports its declarations.
                        </Show>
                      </p>
                    </div>
                  );
                }}
              </Show>
            </Show>
          </Show>
        </Panel>

        <Panel
          class="lg:col-span-2"
          title="Deployment history"
          description="Every save produces a versioned deployment that can be restored."
          actions={
            <Badge variant="outline">
              <Activity class="size-3" />
              {settledQueryData(deployments)?.deployments.length ?? 0} version
              {(settledQueryData(deployments)?.deployments.length ?? 0) === 1 ? "" : "s"}
            </Badge>
          }
        >
          <Show
            when={(settledQueryData(deployments)?.deployments.length ?? 0) > 0}
            fallback={
              <p class="rounded-lg border border-dashed border-border bg-muted/20 px-4 py-5 text-xs text-muted-foreground">
                No deployments yet.
              </p>
            }
          >
            <div class="divide-y divide-border/60 overflow-hidden rounded-lg border border-border">
              <For each={settledQueryData(deployments)?.deployments ?? []}>
                {(deployment) => (
                  <div class="flex flex-wrap items-center justify-between gap-3 bg-muted/10 px-3 py-2.5 text-xs">
                    <span class="flex min-w-0 items-center gap-2">
                      <a
                        class="rounded-xs outline-none hover:opacity-80 focus-visible:ring-3 focus-visible:ring-ring/30"
                        href={`/t/${params.tenantId}/policies/${params.policyId}/deployment?version=${deployment.version}`}
                      >
                        <Badge variant="secondary">
                          Version {deployment.version}
                        </Badge>
                      </a>
                      <span class="truncate text-muted-foreground">
                        {formatDate(deployment.createdAt)}
                      </span>
                    </span>
                    <Show when={writable()}>
                      <Button
                        size="sm"
                        variant="outline"
                        disabled={rollback.isPending}
                        onClick={() => rollback.mutate(deployment.id)}
                      >
                        Restore
                      </Button>
                    </Show>
                  </div>
                )}
              </For>
            </div>
          </Show>
          <ErrorText error={deployments.error || rollback.error} />
        </Panel>
      </div>

      <AddConfigurationDialog
        open={addOpen()}
        onOpenChange={setAddOpen}
        saving={addConfigurations.isPending}
        existing={configurations()}
        onAdd={(configurations) => addConfigurations.mutate(configurations)}
      />

      <ConfirmDialog
        open={enabledOpen()}
        onOpenChange={setEnabledOpen}
        title={`${enabledTarget() ? "Enable" : "Disable"} ${row()?.name ?? "policy"}?`}
        description={
          enabledTarget()
            ? "Its saved configuration is delivered to every scoped device again. Apple devices are woken immediately, Android is synced, and Windows applies it on its next check-in."
            : "Its settings are withdrawn from every scoped device on the next delivery. The configuration and assignments are kept, so you can enable it again later."
        }
        confirmLabel={enabledTarget() ? "Enable policy" : "Disable policy"}
        pending={setEnabled.isPending}
        onConfirm={() => setEnabled.mutate(enabledTarget())}
      />

      <Dialog
        open={deleteOpen()}
        onOpenChange={(open) => {
          if (!open) setConfirm("");
          setDeleteOpen(open);
        }}
      >
        <DialogContent class="max-w-md">
          <DialogHeader>
            <DialogTitle>Delete {row()?.name ?? "policy"}?</DialogTitle>
          </DialogHeader>
          <p class="text-sm text-muted-foreground">
            Type <span class="font-mono font-medium">{row()?.name}</span> to confirm.
          </p>
          <Input value={confirm()} onInput={(e) => setConfirm(e.currentTarget.value)} />
          <ErrorText error={del.error} />
          <DialogFooter>
            <Button variant="outline" onClick={() => setDeleteOpen(false)}>
              Cancel
            </Button>
            <Button
              variant="destructive"
              disabled={confirm() !== row()?.name || del.isPending}
              onClick={() => del.mutate()}
            >
              Delete policy
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </Page>
  );
}

function ConfigurationCard(props: {
  kind: string;
  data: Schema.Json;
  tenantId: string;
  policyId: string;
}) {
  const [opened, setOpened] = createSignal(false);
  const info = () => describe(props.kind, props.data);

  const content = () => {
    const record = isRecord(props.data) ? props.data : undefined;

    return isString(record?.content) ? record.content : undefined;
  };

  return (
    <details
      class="group overflow-hidden rounded-lg border border-border bg-muted/15"
      onToggle={(event) => setOpened(event.currentTarget.open)}
    >
      <summary class="flex cursor-pointer list-none items-center justify-between gap-3 px-3 py-2.5 text-xs transition-colors duration-140 ease-swift hover:bg-muted/40">
        <span class="flex min-w-0 items-center gap-2.5">
          <span class="flex size-6 shrink-0 items-center justify-center rounded-md border border-border bg-surface text-muted-foreground">
            <Show
              when={props.kind.includes("wifi")}
              fallback={
                <Show
                  when={props.kind.includes("passcode")}
                  fallback={<SlidersHorizontal class="size-3.5" />}
                >
                  <ShieldCheck class="size-3.5" />
                </Show>
              }
            >
              <Wifi class="size-3.5" />
            </Show>
          </span>
          <span class="min-w-0">
            <span class="block truncate font-medium text-foreground">{info().title}</span>
            <span class="mt-0.5 block truncate text-xs text-muted-foreground">
              {info().subtitle}
            </span>
          </span>
        </span>
        <span class="flex shrink-0 items-center gap-1.5">
          <For each={info().platforms}>
            {(platform) => (
              <Badge variant="outline">
                {platformLabel(platform)}
              </Badge>
            )}
          </For>
          <span class="disclosure-chevron">
            <ChevronDown class="size-3.5 shrink-0" />
          </span>
        </span>
      </summary>
      <div class="space-y-3 border-t border-border bg-background/40 p-3">
        <Show when={info().collections.length > 0}>
          <div class="flex flex-wrap gap-1.5">
            <For each={info().collections.slice(0, 24)}>
              {(collection) => (
                <span class="inline-flex items-center gap-1.5 rounded-md border border-border bg-surface px-2 py-1 text-xs text-foreground/85">
                  {collection.label}
                </span>
              )}
            </For>
            <Show when={info().collections.length > 24}>
              <span class="px-1 py-1 text-xs text-muted-foreground">
                +{info().collections.length - 24} more
              </span>
            </Show>
          </div>
        </Show>
        <Show when={opened() && content()}>
          {(value) => <MobileconfigPreview content={value()} />}
        </Show>
        <Show
          when={
            props.kind.includes("designer") ||
            (props.kind.startsWith("mttx.apple.declaration.") &&
              isRecord(props.data) &&
              props.data.designer === true)
          }
        >
          <div class="flex flex-wrap items-center gap-2">
            <Button
              as="a"
              size="sm"
              variant="outline"
              href={`/t/${props.tenantId}/policies/${props.policyId}/design`}
            >
              Edit in designer
            </Button>
            <Button
              as="a"
              size="sm"
              variant="ghost"
              href={`/t/${props.tenantId}/policies/${props.policyId}/editor`}
            >
              Open policy editor
            </Button>
          </div>
        </Show>
      </div>
    </details>
  );
}

function AddConfigurationDialog(props: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  saving: boolean;
  existing: Array<[string, PolicyConfiguration | undefined]>;
  onAdd: (configurations: PolicyConfigurations) => void;
}) {
  const [preset, setPreset] = createSignal<"wifi" | "passcode" | "laps">("wifi");
  const [lapsBackupDirectory, setLapsBackupDirectory] = createSignal<
    "entra-id" | "active-directory" | "disabled"
  >("entra-id");
  const [lapsAgeDays, setLapsAgeDays] = createSignal(30);
  const [lapsLength, setLapsLength] = createSignal(20);
  const [lapsComplexity, setLapsComplexity] = createSignal(4);
  const [ssid, setSsid] = createSignal("");
  const [security, setSecurity] = createSignal<WifiSecurity>("wpa2");
  const [password, setPassword] = createSignal("");
  const [autoJoin, setAutoJoin] = createSignal(true);
  const [hidden, setHidden] = createSignal(false);
  const [apple, setApple] = createSignal(true);
  const [windows, setWindows] = createSignal(true);
  const [minimumLength, setMinimumLength] = createSignal(8);
  const [requireAlphanumeric, setRequireAlphanumeric] = createSignal(false);
  const [allowSimple, setAllowSimple] = createSignal(true);
  const [error, setError] = createSignal<string | null>(null);
  const errorId = createUniqueId();
  let ssidInput: HTMLInputElement | undefined;
  let passwordInput: HTMLInputElement | undefined;

  const ssidInvalid = () => preset() === "wifi" && error() === "Enter the network name (SSID).";
  const passwordInvalid = () => preset() === "wifi" && error() === "Enter the Wi-Fi password.";

  const fail = (message: string, field?: "ssid" | "password") => {
    setError(message);

    if (field === "ssid") ssidInput?.focus();
    if (field === "password") passwordInput?.focus();
  };

  const reset = () => {
    setSsid("");
    setPassword("");
    setSecurity("wpa2");
    setAutoJoin(true);
    setHidden(false);
    setApple(true);
    setWindows(true);
    setMinimumLength(8);
    setRequireAlphanumeric(false);
    setAllowSimple(true);
    setLapsBackupDirectory("entra-id");
    setLapsAgeDays(30);
    setLapsLength(20);
    setLapsComplexity(4);
    setError(null);
  };

  const choosePreset = (next: "wifi" | "passcode" | "laps") => {
    setPreset(next);
    setError(null);
  };

  const submit = () => {
    setError(null);
    const next: PolicyConfigurations = Object.fromEntries(props.existing);

    if (preset() === "wifi") {
      if (!ssid().trim()) return fail("Enter the network name (SSID).", "ssid");

      if (security() !== "open" && !password())
        return fail("Enter the Wi-Fi password.", "password");

      if (!apple() && !windows()) return fail("Choose at least one platform.");

      const value = {
        ssid: ssid().trim(),
        security: security(),
        password: password(),
        autoJoin: autoJoin(),
        hidden: hidden(),
      };

      if (apple()) {
        const config = appleWifiConfiguration(value);
        next[config.kind] = config.data;
      }

      if (windows()) {
        const config = windowsWifiConfiguration(value);
        next[config.kind] = config.data;
      }
    } else if (preset() === "laps") {
      if (lapsAgeDays() < 1 || lapsAgeDays() > 365)
        return fail("The password age must be between 1 and 365 days.");

      if (lapsBackupDirectory() === "entra-id" && lapsAgeDays() < 7)
        return fail("Entra-backed Windows LAPS requires a password age of at least 7 days.");

      if (lapsLength() < 8 || lapsLength() > 64)
        return fail("The password length must be between 8 and 64 characters.");

      next["mttx.windows.laps"] = {
        backupDirectory: lapsBackupDirectory(),
        passwordAgeDays: lapsAgeDays(),
        passwordLength: lapsLength(),
        passwordComplexity: lapsComplexity(),
        postAuthenticationActions: 3,
        postAuthenticationResetDelayHours: 24,
      };
    } else {
      const config = applePasscodeConfiguration({
        minimumLength: minimumLength(),
        requireAlphanumeric: requireAlphanumeric(),
        allowSimple: allowSimple(),
      });

      next[config.kind] = config.data;
    }

    props.onAdd(next);
  };

  return (
    <Dialog
      open={props.open}
      onOpenChange={(open) => {
        props.onOpenChange(open);

        if (!open) reset();
      }}
    >
      <DialogContent class="max-w-lg">
        <DialogHeader>
          <DialogTitle>Add a configuration</DialogTitle>
          <DialogDescription class="mt-1">
            Start with the basics. The policy editor exposes every platform setting if you need
            more.
          </DialogDescription>
        </DialogHeader>

        <div class="mt-4 grid grid-cols-2 gap-2">
          <Button
            type="button"
            onClick={() => choosePreset("wifi")}
            variant={preset() === "wifi" ? "secondary" : "outline"}
            class="h-auto"
          >
            <Wifi class="size-4" />
            <span class="mt-2 block text-xs font-medium text-foreground">Wi-Fi network</span>
            <span class="mt-0.5 block text-xs leading-relaxed text-muted-foreground">
              SSID, security and password for Apple and Windows.
            </span>
          </Button>
          <Button
            type="button"
            onClick={() => choosePreset("passcode")}
            variant={preset() === "passcode" ? "secondary" : "outline"}
            class="h-auto"
          >
            <ShieldCheck class="size-4" />
            <span class="mt-2 block text-xs font-medium text-foreground">Passcode</span>
            <span class="mt-0.5 block text-xs leading-relaxed text-muted-foreground">
              Minimum length and complexity for Apple devices.
            </span>
          </Button>
          <Button
            type="button"
            onClick={() => choosePreset("laps")}
            variant={preset() === "laps" ? "secondary" : "outline"}
            class="h-auto"
          >
            <ShieldCheck class="size-4" />
            <span class="mt-2 block text-xs font-medium text-foreground">Windows LAPS</span>
            <span class="mt-0.5 block text-xs leading-relaxed text-muted-foreground">
              Managed local administrator password and backup directory.
            </span>
          </Button>
        </div>

        <Show when={preset() === "wifi"}>
          <div class="mt-4 space-y-3">
            <Field label="Network name (SSID)">
              <Input
                ref={ssidInput}
                value={ssid()}
                aria-invalid={ssidInvalid() ? "true" : undefined}
                aria-describedby={ssidInvalid() ? errorId : undefined}
                onInput={(event) => {
                  setSsid(event.currentTarget.value);

                  if (ssidInvalid() && event.currentTarget.value.trim()) setError(null);
                }}
                placeholder="Staff Wi-Fi"
              />
            </Field>
            <div class="grid gap-3 sm:grid-cols-2">
              <Field label="Security">
                <select
                  class="h-8 w-full rounded-md border border-input bg-background px-2 text-xs text-foreground"
                  value={security()}
                  onChange={(event) => {
                    const value = Option.getOrUndefined(
                      decodeWifiSecurity(event.currentTarget.value),
                    );

                    if (value !== undefined) setSecurity(value);
                  }}
                >
                  <option value="wpa2">WPA2 Personal</option>
                  <option value="wpa3">WPA3 Personal</option>
                  <option value="open">Open network</option>
                </select>
              </Field>
              <Show when={security() !== "open"}>
                <Field label="Password">
                  <PasswordInput
                    ref={passwordInput}
                    value={password()}
                    aria-invalid={passwordInvalid() ? "true" : undefined}
                    aria-describedby={passwordInvalid() ? errorId : undefined}
                    onInput={(event) => {
                      setPassword(event.currentTarget.value);

                      if (passwordInvalid() && event.currentTarget.value) setError(null);
                    }}
                  />
                </Field>
              </Show>
            </div>
            <div class="flex flex-wrap gap-4 text-xs text-muted-foreground">
              <label class="flex items-center gap-2">
                <Checkbox
 checked={autoJoin()}
 onCheckedChange={(checked) => setAutoJoin(checked === true)}
/>
                Join automatically
              </label>
              <label class="flex items-center gap-2">
                <Checkbox
 checked={hidden()}
 onCheckedChange={(checked) => setHidden(checked === true)}
/>
                Hidden network
              </label>
            </div>
            <div class="flex flex-wrap gap-4 text-xs text-muted-foreground">
              <label class="flex items-center gap-2">
                <Checkbox
 checked={apple()}
 onCheckedChange={(checked) => setApple(checked === true)}
/>
                Apple
              </label>
              <label class="flex items-center gap-2">
                <Checkbox
 checked={windows()}
 onCheckedChange={(checked) => setWindows(checked === true)}
/>
                Windows
              </label>
            </div>
          </div>
        </Show>

        <Show when={preset() === "passcode"}>
          <div class="mt-4 space-y-3">
            <Field label="Minimum length">
              <Input
                type="number"
                min="4"
                max="32"
                value={minimumLength()}
                onInput={(event) => setMinimumLength(Number(event.currentTarget.value) || 0)}
              />
            </Field>
            <div class="flex flex-col gap-2 text-xs text-muted-foreground">
              <label class="flex items-center gap-2">
                <Checkbox
 checked={requireAlphanumeric()}
 onCheckedChange={(checked) => setRequireAlphanumeric(checked === true)}
/>
                Require letters and numbers
              </label>
              <label class="flex items-center gap-2">
                <Checkbox
 checked={allowSimple()}
 onCheckedChange={(checked) => setAllowSimple(checked === true)}
/>
                Allow simple passcodes (e.g. 1111)
              </label>
            </div>
            <p class="text-xs leading-relaxed text-muted-foreground">
              Apple devices only. Windows Hello and Android use their own policy models.
            </p>
          </div>
        </Show>

        <Show when={preset() === "laps"}>
          <div class="mt-4 space-y-3">
            <Field label="Backup directory">
              <select
                class="h-8 w-full rounded-md border border-input bg-background px-2 text-xs text-foreground"
                value={lapsBackupDirectory()}
                onChange={(event) => {
                  const value = event.currentTarget.value;

                  if (value === "entra-id" || value === "active-directory" || value === "disabled")
                    setLapsBackupDirectory(value);
                }}
              >
                <option value="entra-id">Microsoft Entra ID (retrievable in Mattrax)</option>
                <option value="active-directory">Active Directory (not retrievable here)</option>
                <option value="disabled">Do not back up</option>
              </select>
            </Field>
            <div class="grid gap-3 sm:grid-cols-2">
              <Field label="Password age (days)">
                <Input
                  type="number"
                  min="1"
                  max="365"
                  value={lapsAgeDays()}
                  onInput={(event) => setLapsAgeDays(Number(event.currentTarget.value) || 0)}
                />
              </Field>
              <Field label="Password length">
                <Input
                  type="number"
                  min="8"
                  max="64"
                  value={lapsLength()}
                  onInput={(event) => setLapsLength(Number(event.currentTarget.value) || 0)}
                />
              </Field>
            </div>
            <Field label="Complexity">
              <select
                class="h-8 w-full rounded-md border border-input bg-background px-2 text-xs text-foreground"
                value={String(lapsComplexity())}
                onChange={(event) => setLapsComplexity(Number(event.currentTarget.value) || 4)}
              >
                <option value="1">Upper case</option>
                <option value="2">Upper and lower case</option>
                <option value="3">Upper, lower and numbers</option>
                <option value="4">Upper, lower, numbers and symbols</option>
                <option value="5">Improved readability</option>
              </select>
            </Field>
            <p class="text-xs leading-relaxed text-muted-foreground">
              Requires Windows 11 22H2+/Server 2025. Only an Entra ID backup can be read by Mattrax;
              rotation works with Active Directory, but a disabled backup cannot rotate because the
              password would be stored nowhere. Passphrase complexity is Windows 11 24H2+ only and
              is not offered on this baseline.
            </p>
          </div>
        </Show>

        <p
          id={errorId}
          role="alert"
          aria-live="polite"
          class={error() ? "mt-3 text-xs text-destructive" : "sr-only"}
        >
          {error()}
        </p>

        <DialogFooter class="mt-5 flex-row justify-end">
          <Button variant="outline" onClick={() => props.onOpenChange(false)}>
            Cancel
          </Button>
          <Button onClick={submit} disabled={props.saving}>
            {props.saving ? "Adding…" : "Add configuration"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
