import { useParams, useSearchParams } from "@solidjs/router";
import type { JSX } from "@solidjs/web";
import { createContext, useContext } from "solid-js";
import EntityHoverCard from "~/components/entity-hover-card";
import * as queryBuilder from "~/components/dashboard/query-builder";
import Markdown from "~/components/dashboard/markdown";
import * as handover from "~/components/mdm/device-handover-dialog";
import EntityActions from "~/components/mdm/entity-actions";
import * as common from "~/components/mdm/common";
import * as table from "~/components/mdm/entity-table";
import * as scopeTagSelect from "~/components/scope-tags/scope-tag-select";
import OsComplianceTag from "~/components/os-compliance-badge";
import * as softwareUpdate from "~/components/software-update-badge";
import { toast } from "~/components/toast";
import * as dialog from "@mattrax/ui";
import * as sheet from "@mattrax/ui";
import * as tooltip from "@mattrax/ui";
import { enterprise, enterpriseQueries } from "~/lib/enterprise";
import { useNavigate } from "~/lib/navigation";
import { preloadPage } from "~/lib/page-data";
import { ReadOnlyNotice, useCan } from "~/lib/permissions";
import { queryClient } from "~/lib/query-client";
import { useUnsavedChanges } from "~/lib/unsaved-changes";

/**
 * Dependencies of the device pages that tests replace with fakes. The context
 * default is the real module graph, so production callers do not pass a value.
 * Keeping the seam here (instead of intercepting module imports) lets a test
 * mount a page with ordinary Solid context.
 */
export type DevicePageDeps = {
  readonly router: {
    readonly useParams: typeof useParams;
    readonly useSearchParams: typeof useSearchParams;
    readonly useNavigate: typeof useNavigate;
  };
  readonly preloadPage: typeof preloadPage;
  readonly queryClient: typeof queryClient;
  readonly permissions: {
    readonly useCan: typeof useCan;
    readonly ReadOnlyNotice: typeof ReadOnlyNotice;
  };
  readonly unsavedChanges: {
    readonly useUnsavedChanges: typeof useUnsavedChanges;
  };
  readonly toast: typeof toast;
  readonly common: Pick<
    typeof common,
    | "Page"
    | "PageBreadcrumbs"
    | "PageHeader"
    | "PageSkeleton"
    | "SkeletonRows"
    | "Field"
    | "ErrorText"
    | "QueryError"
    | "LinkButton"
    | "PlatformBadge"
    | "PlatformMark"
    | "PresenceDot"
    | "DevicePresenceBadge"
    | "devicePresence"
    | "formatDeviceDate"
    | "formatDate"
    | "relativeTime"
    | "usePresenceNow"
  >;
  readonly table: Pick<typeof table, "MdmTable">;
  readonly hoverCard: typeof EntityHoverCard;
  readonly entityActions: typeof EntityActions;
  readonly queryBuilder: Pick<typeof queryBuilder, "DeviceQueryBuilder">;
  readonly scopeTags: Pick<typeof scopeTagSelect, "ScopeTagAssignmentEditor">;
  readonly handover: Pick<typeof handover, "DeviceHandoverDialog" | "deviceHandoverSecretSummary">;
  readonly markdown: typeof Markdown;
  readonly softwareUpdate: Pick<typeof softwareUpdate, "SoftwareUpdateTag">;
  readonly osCompliance: typeof OsComplianceTag;
  readonly dialog: Pick<
    typeof dialog,
    | "Dialog"
    | "DialogContent"
    | "DialogDescription"
    | "DialogFooter"
    | "DialogHeader"
    | "DialogTitle"
  >;
  readonly sheet: Pick<
    typeof sheet,
    "Sheet" | "SheetContent" | "SheetDescription" | "SheetFooter" | "SheetHeader" | "SheetTitle"
  >;
  readonly tooltip: Pick<typeof tooltip, "Tooltip" | "TooltipTrigger" | "TooltipContent">;
  readonly enterprise: typeof enterprise;
  readonly enterpriseQueries: typeof enterpriseQueries;
};

const productionDeps: DevicePageDeps = {
  router: { useParams, useSearchParams, useNavigate },
  preloadPage,
  queryClient,
  permissions: { useCan, ReadOnlyNotice },
  unsavedChanges: { useUnsavedChanges },
  toast,
  common,
  table: { MdmTable: table.MdmTable },
  hoverCard: EntityHoverCard,
  entityActions: EntityActions,
  queryBuilder: { DeviceQueryBuilder: queryBuilder.DeviceQueryBuilder },
  scopeTags: { ScopeTagAssignmentEditor: scopeTagSelect.ScopeTagAssignmentEditor },
  handover: {
    DeviceHandoverDialog: handover.DeviceHandoverDialog,
    deviceHandoverSecretSummary: handover.deviceHandoverSecretSummary,
  },
  markdown: Markdown,
  softwareUpdate: { SoftwareUpdateTag: softwareUpdate.SoftwareUpdateTag },
  osCompliance: OsComplianceTag,
  dialog: {
    Dialog: dialog.Dialog,
    DialogContent: dialog.DialogContent,
    DialogDescription: dialog.DialogDescription,
    DialogFooter: dialog.DialogFooter,
    DialogHeader: dialog.DialogHeader,
    DialogTitle: dialog.DialogTitle,
  },
  sheet: {
    Sheet: sheet.Sheet,
    SheetContent: sheet.SheetContent,
    SheetDescription: sheet.SheetDescription,
    SheetFooter: sheet.SheetFooter,
    SheetHeader: sheet.SheetHeader,
    SheetTitle: sheet.SheetTitle,
  },
  tooltip: {
    Tooltip: tooltip.Tooltip,
    TooltipTrigger: tooltip.TooltipTrigger,
    TooltipContent: tooltip.TooltipContent,
  },
  enterprise,
  enterpriseQueries,
};

const DevicePageDepsContext = createContext<DevicePageDeps>(productionDeps);

/** Test wrapper: supply a (partial) fake dependency graph to the device pages. */
export function DevicePageDepsProvider(props: {
  readonly value: DevicePageDeps;
  readonly children: JSX.Element;
}) {
  return <DevicePageDepsContext value={props.value}>{props.children}</DevicePageDepsContext>;
}

export const useDevicePageDeps = () => useContext(DevicePageDepsContext);
