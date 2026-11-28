import type { JSX } from "@solidjs/web";
import { createSignal, createUniqueId, Show } from "solid-js";
import {
  Badge,
  HoverCard,
  HoverCardContent,
  HoverCardTrigger,
  SegmentedProgress,
} from "@mattrax/ui";
import type { BadgeProps } from "@mattrax/ui";
import { formatDate, formatDeviceDate, relativeTime } from "~/components/mdm/common";
import {
  Laptop,
  MonitorSmartphone,
  ShieldCheck,
  Smartphone,
  UsersRound,
} from "~/components/ui/app-icons";
import { healthLabel } from "~/lib/device-health";
import type { DeviceRow, GroupRow, PolicyRow, TenantAccount } from "~/lib/enterprise";
import {
  isPolicyEnabled,
  policyDeliveryPresentation,
  policyRowDeliveryPresentation,
  policyScopePresentation,
  policyStatePresentation,
} from "~/lib/policy-delivery";
import { initials } from "~/lib/names";
import { cn } from "~/lib/utils";

/**
 * The data a preview needs. List rows already carry every field, so a card
 * never fetches: hovering a row shows the row, just with more room to breathe.
 */
export type EntityPreview =
  | { readonly kind: "device"; readonly device: DeviceRow }
  | { readonly kind: "policy"; readonly policy: PolicyRow }
  | { readonly kind: "group"; readonly group: GroupRow }
  | { readonly kind: "user"; readonly account: TenantAccount };

type BadgeVariant = NonNullable<BadgeProps["variant"]>;

const platformLabels = new Map([
  ["apple", "Apple"],
  ["win", "Windows"],
  ["android", "Android"],
]);

const deviceIcon = (proto: string) => {
  if (proto === "apple") return <Laptop />;

  if (proto === "win") return <MonitorSmartphone />;

  if (proto === "android") return <Smartphone />;

  return <Laptop />;
};

type BadgeTone = { variant: BadgeVariant; dot: BadgeProps["dot"] };

const statusBadges = new Map<string, BadgeTone>([
  ["enrolled", { variant: "success", dot: "success" }],
  ["enrolling", { variant: "brand", dot: "info" }],
  ["unenrolling", { variant: "warning", dot: "warning" }],
  ["unenrolled", { variant: "outline", dot: "neutral" }],
]);

const healthBadges = new Map<string, BadgeTone>([
  ["healthy", { variant: "success", dot: "success" }],
  ["attention", { variant: "warning", dot: "warning" }],
  ["missing", { variant: "info", dot: "info" }],
  ["critical", { variant: "destructive", dot: "destructive" }],
  ["unknown", { variant: "outline", dot: "neutral" }],
]);

/** A policy without a delivery snapshot has never been deployed. */
const neverDeployed: NonNullable<PolicyRow["delivery"]> = {
  state: "never-deployed",
  version: null,
  scopedDevices: 0,
  trackedDevices: 0,
  legacyDevices: 0,
  overriddenDevices: 0,
  deliveredDevices: 0,
  failedDevices: 0,
  pendingDevices: 0,
};

const deliveryBadges = new Map<string, BadgeVariant>([
  ["success", "success"],
  ["warning", "warning"],
  ["destructive", "destructive"],
  ["outline", "outline"],
  ["subtle", "subtle"],
]);

const shortDate = (value: string | null | undefined, fallback = "Unknown") => {
  if (!value) return fallback;
  const date = new Date(value);

  if (Number.isNaN(date.getTime())) return value;

  return date.toLocaleDateString(undefined, {
    day: "numeric",
    month: "short",
    year: "numeric",
  });
};

const osLabel = (device: DeviceRow) => {
  const version = device.osVersion?.trim();
  const build = device.osBuild?.trim();

  if (!version) return "Not reported";

  if (!build) return version;

  return `${version} (${build})`;
};

const plural = (count: number, singular: string, pluralForm: string) =>
  `${count.toLocaleString()} ${count === 1 ? singular : pluralForm}`;

/** One label/value line inside the card's fact list. */
function Fact(props: { label: string; title?: string; mono?: boolean; children: JSX.Element }) {
  return (
    <div class="flex items-baseline gap-3">
      <dt class="label-caps w-17 shrink-0">{props.label}</dt>
      <dd
        class={cn(
          "min-w-0 flex-1 truncate text-xs leading-5 text-foreground/90",
          props.mono && "font-mono text-xs",
        )}
        title={props.title}
      >
        {props.children}
      </dd>
    </div>
  );
}

function Header(props: {
  icon: JSX.Element;
  title: string;
  subtitle?: string;
  badge?: JSX.Element;
}) {
  return (
    <div class="flex items-start gap-3 px-3.5 pt-3.5 pb-2.5">
      <span
        aria-hidden="true"
        class="flex size-9 shrink-0 items-center justify-center rounded-lg border border-border bg-surface text-muted-foreground [&_svg]:size-4.5"
      >
        {props.icon}
      </span>
      <div class="min-w-0 flex-1 pt-0.5">
        <p
          class="truncate text-sm leading-4 font-semibold tracking-tight text-foreground"
          title={props.title}
        >
          {props.title}
        </p>
        <Show when={props.subtitle}>
          {(subtitle) => (
            <p
              class="mt-1 truncate text-xs leading-4 text-muted-foreground"
              title={subtitle()}
            >
              {subtitle()}
            </p>
          )}
        </Show>
      </div>
      <Show when={props.badge}>{props.badge}</Show>
    </div>
  );
}

function Facts(props: { children: JSX.Element }) {
  return <dl class="grid gap-1 px-3.5 pb-3">{props.children}</dl>;
}

function Footer(props: { children: JSX.Element; class?: string }) {
  return (
    <div
      class={cn(
        "flex min-h-9 items-center gap-2 border-t border-border bg-surface px-3.5 py-2",
        props.class,
      )}
    >
      {props.children}
    </div>
  );
}

function DeviceCard(props: { device: DeviceRow }) {
  const device = () => props.device;
  const status = () => statusBadges.get(device().status) ?? statusBadges.get("unenrolled")!;

  const health = () =>
    healthBadges.get(device().health?.level ?? "unknown") ?? healthBadges.get("unknown")!;

  const reasons = () => (device().health?.reasons ?? []).map((reason) => reason.label);

  return (
    <>
      <Header
        icon={deviceIcon(device().proto)}
        title={device().name}
        subtitle={`${platformLabels.get(device().proto) ?? device().proto}${
          device().model ? ` · ${device().model}` : ""
        }`}
        badge={
          <span class="capitalize">
            <Badge variant={status().variant} dot={status().dot}>
              {device().status}
            </Badge>
          </span>
        }
      />
      <Facts>
        <Fact label="OS">{osLabel(device())}</Fact>
        <Fact label="Serial" mono>
          {device().serial?.trim() || "Unknown"}
        </Fact>
        <Fact label="Last seen" title={formatDeviceDate(device().lastSeenAt)}>
          {relativeTime(device().lastSeenAt)}
        </Fact>
        <Fact label="Enrolled" title={formatDate(device().enrolledAt)}>
          {shortDate(device().enrolledAt)}
        </Fact>
      </Facts>
      <Footer>
        <Badge variant={health().variant} dot={health().dot}>
          {healthLabel(device().health?.level)}
        </Badge>
        <span class="min-w-0 flex-1 truncate text-xs text-muted-foreground">
          {reasons().length > 0 ? reasons().join(" · ") : "All checks passing"}
        </span>
      </Footer>
    </>
  );
}

function DeliveryBar(props: { delivery: NonNullable<PolicyRow["delivery"]> | undefined }) {
  const tracked = () => props.delivery?.trackedDevices ?? 0;

  const segments = () => {
    const delivery = props.delivery;

    if (!delivery || tracked() === 0) return [];

    const done = (delivery.deliveredDevices / tracked()) * 100;
    const failed = (delivery.failedDevices / tracked()) * 100;
    const pending = Math.max(0, 100 - done - failed);

    return [
      { label: "Delivered", width: done, class: "bg-success" },
      { label: "Pending", width: pending, class: "bg-warning/30" },
      { label: "Failed", width: failed, class: "bg-destructive" },
    ].filter((segment) => segment.width > 0);
  };

  return (
    <Show when={segments().length > 0}>
      <SegmentedProgress
        label="Policy delivery"
        class="h-1.5"
        segments={segments().map((segment) => ({
          label: segment.label,
          value: segment.width,
          class: segment.class,
        }))}
      />
    </Show>
  );
}

function PolicyCard(props: { policy: PolicyRow }) {
  const policy = () => props.policy;
  const delivery = () => policy().delivery;
  const enabled = () => isPolicyEnabled(policy());

  const presentation = () =>
    policyRowDeliveryPresentation({
      ...policy(),
      delivery: delivery() ?? neverDeployed,
    }) ?? policyDeliveryPresentation(neverDeployed);

  const scope = () =>
    policyScopePresentation({
      deviceCount: policy().scopedDeviceCount,
      userCount: policy().scopedUserCount,
    });

  const configurationCount = () =>
    policy().configurationCount ?? Object.keys(policy().configurations ?? {}).length;

  return (
    <>
      <Header
        icon={<ShieldCheck />}
        title={policy().name}
        subtitle={policy().notes?.trim() || "No description"}
        badge={
          <Badge
            variant={deliveryBadges.get(presentation().tone) ?? "outline"}
            dot={presentation().dot}
          >
            {presentation().label}
          </Badge>
        }
      />
      <Facts>
        <Fact label="Configs">
          {plural(configurationCount(), "configuration", "configurations")}
        </Fact>
        <Fact label="Scope">
          {`${plural(policy().scopedDeviceCount ?? 0, "device", "devices")} · ${plural(
            policy().scopedUserCount ?? 0,
            "user",
            "users",
          )}`}
        </Fact>
        <Fact label="Priority">{policy().priority}</Fact>
        <Fact label="Updated" title={formatDate(policy().updatedAt)}>
          {relativeTime(policy().updatedAt)}
        </Fact>
      </Facts>
      <Footer class="gap-3">
        <Show
          when={enabled()}
          fallback={
            <span class="min-w-0 text-xs leading-relaxed text-muted-foreground">
              {policyStatePresentation(policy()).description}
            </span>
          }
        >
          <DeliveryBar delivery={delivery()} />
          <span
            class="min-w-0 shrink-0 text-xs text-muted-foreground"
            title={scope().devices.description}
          >
            {delivery() && delivery()!.trackedDevices > 0
              ? `${delivery()!.deliveredDevices}/${delivery()!.trackedDevices} delivered`
              : scope().devices.label}
          </span>
        </Show>
      </Footer>
    </>
  );
}

function GroupCard(props: { group: GroupRow }) {
  const group = () => props.group;
  const dynamic = () => group().kind === "dynamic";

  return (
    <>
      <Header
        icon={<UsersRound />}
        title={group().name}
        subtitle={group().notes?.trim() || (dynamic() ? "Dynamic membership" : "Manual membership")}
        badge={
          <Badge variant={dynamic() ? "brand" : "outline"} dot={dynamic() ? "info" : "neutral"}>
            {dynamic() ? "Dynamic" : "Manual"}
          </Badge>
        }
      />
      <Facts>
        <Fact label="Devices">{plural(group().devicesCount ?? 0, "device", "devices")}</Fact>
        <Fact label="Policies">{plural(group().policiesCount ?? 0, "policy", "policies")}</Fact>
        <Fact label="Created" title={formatDate(group().createdAt)}>
          {shortDate(group().createdAt)}
        </Fact>
        <Fact label="Updated" title={formatDate(group().updatedAt)}>
          {relativeTime(group().updatedAt)}
        </Fact>
      </Facts>
      <Footer>
        <span class="min-w-0 flex-1 truncate text-xs text-muted-foreground">
          {dynamic()
            ? group().lastEvaluatedAt
              ? `Rules last evaluated ${relativeTime(group().lastEvaluatedAt)}`
              : "Rules have not been evaluated yet"
            : "Devices are added to this group by hand"}
        </span>
      </Footer>
    </>
  );
}

function UserCard(props: { account: TenantAccount }) {
  const account = () => props.account;
  const role = () => account().roleName ?? account().role;

  return (
    <>
      <Header
        icon={<span class="text-xs font-semibold">{initials(account().name)}</span>}
        title={account().name}
        subtitle={account().email}
      />
      <Facts>
        <Fact label="Role">{role()}</Fact>
        <Fact label="Access">
          {account().roleKind === "custom" ? "Custom role" : "Built-in role"}
        </Fact>
        <Fact label="Joined" title={formatDate(account().createdAt)}>
          {shortDate(account().createdAt)}
        </Fact>
      </Facts>
    </>
  );
}

/**
 * A link (or, for people, a plain block of text) that previews its entity on
 * hover or focus. The preview is supplemental: everything in it is reachable
 * by following the link, so the card never traps focus or blocks the click.
 */
export default function EntityHoverCard(props: {
  preview: EntityPreview;
  /** Omit for a preview on content that has no destination of its own. */
  href?: string;
  class?: string;
  children: JSX.Element;
}) {
  // The hover-card primitive only wires `aria-describedby` for the tooltip
  // preset, so the relation is declared here: the card is plain text, and a
  // description is exactly what assistive technology should get. It is only
  // attached while the card is mounted, because a closed card would leave the
  // trigger pointing at an element that no longer exists.
  const id = createUniqueId();
  const [open, setOpen] = createSignal(false);

  const content = () => {
    const preview = props.preview;

    switch (preview.kind) {
      case "device":
        return <DeviceCard device={preview.device} />;
      case "policy":
        return <PolicyCard policy={preview.policy} />;
      case "group":
        return <GroupCard group={preview.group} />;
      case "user":
        return <UserCard account={preview.account} />;
    }
  };

  return (
    <HoverCard onOpenChange={setOpen}>
      <HoverCardTrigger
        as={props.href ? "a" : "span"}
        href={props.href}
        id={id}
        aria-describedby={open() ? `${id}-content` : undefined}
        tabindex={props.href ? undefined : -1}
      >
        <span class={props.class}>{props.children}</span>
      </HoverCardTrigger>
      <HoverCardContent id={`${id}-content`} role="tooltip" align="start">
        {content()}
      </HoverCardContent>
    </HoverCard>
  );
}
