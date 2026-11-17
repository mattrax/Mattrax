import type { JSX } from "@solidjs/web";
import { For, Show } from "solid-js";
import { Badge } from "~/components/ui/badge";
import { Button } from "~/components/ui/button";
import { Card } from "~/components/ui/card";

const platforms = [
  {
    name: "Apple",
    tag: "macOS · iOS · iPadOS",
    icon: AppleIcon,
    body: "Profile enrollment, ABM/ADE, Apps & Books, APNs, SCEP and DDM declarations.",
    points: ["Zero-touch assignment", "FileVault escrow", "Installed-app inventory"],
    href: "/docs/platforms/apple/",
  },
  {
    name: "Windows",
    tag: "Windows 10 · 11",
    icon: WindowsIcon,
    body: "WSTEP enrollment, SyncML policy, Entra federation and Autopilot profiles.",
    points: ["OMA-URI policy", "Autopilot join types", "Autopilot import"],
    href: "/docs/platforms/windows/",
  },
  {
    name: "Android",
    tag: "Android Enterprise",
    icon: AndroidIcon,
    body: "AMAPI signup, one-time enrollment tokens, Pub/Sub events and policy delivery.",
    points: ["Work or fully managed", "Policy merge", "Remote commands"],
    href: "/docs/platforms/android/",
  },
];

const features = [
  {
    icon: LayersIcon,
    title: "Enrollment that fits the fleet",
    body: "One link for Apple profiles, tenant-scoped Windows discovery and Android QR or token enrollment. Pre-register serials so names and groups are ready before the device arrives.",
  },
  {
    icon: ShieldIcon,
    title: "Policies with real precedence",
    body: "Manual and dynamic groups, include/exclude assignments and a resolution trace that tells you exactly which policy won and why.",
  },
  {
    icon: ChartIcon,
    title: "Inventory you can act on",
    body: "DDM status items, FileVault state, disk pressure, battery condition and installed applications roll into a device health signal.",
  },
  {
    icon: BoltIcon,
    title: "Remote actions",
    body: "Sync, lock, wipe, restart, clear a passcode, collect security info or refresh app inventory — with step-up confirmation for destructive actions.",
  },
  {
    icon: LockIcon,
    title: "Tenant-grade security",
    body: "Owner, admin, member and auditor roles, scoped API tokens, authenticator apps, passkeys, SSO, SCIM and an audit trail for every mutation.",
  },
  {
    icon: TerminalIcon,
    title: "An automation surface",
    body: "A typed REST API with OpenAPI and Scalar, scoped tokens and HMAC-signed webhooks.",
  },
];

const migrations = ["Jamf", "Microsoft Intune", "Kandji", "Mosyle", "Addigy"];

const faqs = [
  {
    q: "Do devices have to re-enroll?",
    a: "Yes. MDM identity is bound to the previous vendor. Apple devices normally move through Apple Business Manager; Windows devices use Autopilot or a fresh enrollment; Android devices need a factory reset. The migration guides cover coexistence and ring-based cutover.",
  },
  {
    q: "Does Mattrax replace Intune compliance?",
    a: "No. Mattrax derives device health from enrollment, declaration, disk, FileVault and battery signals. It is not a compliance policy engine and does not integrate with Conditional Access. Keep Intune or another signal if you depend on that.",
  },
  {
    q: "Is Android production ready?",
    a: "Android Enterprise delivery is implemented behind deployment credentials, but signup, Pub/Sub, enrollment, policy convergence and commands have not been validated against real devices in this repository. Treat it as preview.",
  },
];

const sectionHeadline =
  "mt-3 text-[2.25rem] leading-[1.06] font-[560] tracking-[-0.04em] text-foreground sm:text-[2.75rem]";

const sectionIntro = "mt-4 max-w-md text-[13px] leading-6 text-muted-foreground";

// Arrows that live inside a shared `Button` (rendered with `group/button`) slide
// a hair on hover so the action reads as directional. The movement lives in
// `.arrow-nudge` so touch pointers and reduced motion never see it.
const arrowNudge = "arrow-nudge size-3.5";

export default function Page() {
  return (
    <main id="main-content" tabindex="-1">
      <Hero />
      <Platforms />
      <FeatureGrid />
      <Developer />
      <Migration />
      <Enterprise />
      <Pricing />
      <Faq />
      <FinalCta />
    </main>
  );
}

function Hero() {
  return (
    <section class="relative isolate overflow-hidden">
      <div
        aria-hidden="true"
        class="hairline-grid pointer-events-none absolute inset-x-0 top-0 -z-10 h-[520px] opacity-55 [mask-image:radial-gradient(ellipse_65%_55%_at_50%_0%,black,transparent)]"
      />

      <div class="mx-auto grid w-full max-w-[1200px] items-center gap-12 px-6 pb-16 pt-14 sm:px-8 lg:grid-cols-[1.02fr_0.98fr] lg:gap-12 lg:pb-24 lg:pt-20">
        <div class="max-w-[36rem]">
          <Badge
            variant="outline"
            dot="success"
            class="h-6 rounded-full bg-card/70 px-2.5 text-[11px] backdrop-blur"
          >
            Apple, Windows and Android in one control plane
          </Badge>

          <h1 class="mt-6 text-[2.75rem] font-[560] leading-[1.02] tracking-[-0.04em] text-foreground sm:text-[3.25rem] lg:text-[2.9rem] xl:text-[3.6rem]">
            Device management
            <br />
            <span class="text-muted-foreground">without the legacy.</span>
          </h1>

          <p class="mt-6 max-w-[34rem] text-[15px] leading-[1.65] text-muted-foreground">
            Mattrax gives you enrollment, policy, inventory and remote actions for every platform —
            with a clean API, a real audit trail and a deployment model that fits how you work.
          </p>

          <div class="mt-8 flex flex-wrap items-center gap-2.5">
            <Button as="a" href="/register" size="lg" class="h-10 px-5">
              Start free
              <ArrowIcon class={arrowNudge} />
            </Button>
            <Button
              as="a"
              href="/docs/"
              target="_self"
              variant="outline"
              size="lg"
              class="h-10 px-5"
            >
              Read the docs
            </Button>
          </div>

          <div class="mt-8 flex flex-wrap items-center gap-x-2.5 gap-y-1.5 text-[11.5px] text-muted-foreground">
            <For each={["APNs", "ABM", "VPP", "Entra ID", "Autopilot", "Android Enterprise"]}>
              {(label, index) => (
                <span class="inline-flex items-center gap-2.5">
                  <Show when={index() > 0}>
                    <span aria-hidden="true" class="hidden text-subtle-foreground/60 sm:inline">
                      ·
                    </span>
                  </Show>
                  {label}
                </span>
              )}
            </For>
          </div>
        </div>

        <FleetPreview />
      </div>
    </section>
  );
}

function FleetPreview() {
  const devices = [
    { name: "Reception Mac", detail: "macOS 15.2 · Mac14,2", state: "Healthy", tone: "ok" },
    { name: "Finance Laptop", detail: "Windows 11 · 23H2", state: "Synced", tone: "ok" },
    { name: "Field Tablet", detail: "iPadOS 18.1 · iPad13,4", state: "Attention", tone: "warn" },
    {
      name: "Warehouse Handheld",
      detail: "Android 14 · Fully managed",
      state: "Enrolled",
      tone: "ok",
    },
  ];

  return (
    <div class="relative mx-auto w-full max-w-[540px] motion-safe:animate-[mt-rise-in_520ms_var(--ease-glide)_both] motion-safe:[animation-delay:90ms] lg:max-w-none">
      <Card class="overflow-hidden bg-card shadow-panel">
        <div class="flex h-9 items-center justify-between border-b border-border px-3.5">
          <div class="flex items-center gap-1.5" aria-hidden="true">
            <span class="size-1.5 rounded-full bg-border-strong" />
            <span class="size-1.5 rounded-full bg-border-strong" />
            <span class="size-1.5 rounded-full bg-border-strong" />
          </div>
          <Badge variant="subtle" dot="success">
            All systems operational
          </Badge>
        </div>

        <div class="p-4 sm:p-5">
          <div class="flex items-start justify-between gap-3">
            <div>
              <p class="label-caps">Fleet overview</p>
              <p
                data-numeric
                class="mt-1.5 text-[22px] font-[560] leading-none tracking-[-0.03em] text-foreground"
              >
                1,284 devices
              </p>
            </div>
            <Badge variant="outline">Live</Badge>
          </div>

          <div class="mt-5 grid grid-cols-3 divide-x divide-border rounded-lg border border-border bg-background/40">
            <PreviewStat value="96.4%" label="Healthy" />
            <PreviewStat value="3" label="Platforms" />
            <PreviewStat value="12" label="Policies" />
          </div>

          <div class="mt-4 divide-y divide-border overflow-hidden rounded-lg border border-border">
            <For each={devices}>
              {(device) => (
                <div class="flex items-center gap-2.5 px-3 py-2">
                  <span class="flex size-6 shrink-0 items-center justify-center rounded-md border border-border bg-surface text-subtle-foreground">
                    <DeviceGlyph detail={device.detail} />
                  </span>
                  <div class="min-w-0 flex-1">
                    <p class="truncate text-[12px] font-[520] text-foreground">{device.name}</p>
                    <p class="truncate text-[10.5px] text-muted-foreground">{device.detail}</p>
                  </div>
                  <Badge variant={device.tone === "warn" ? "warning" : "success"}>
                    {device.state}
                  </Badge>
                </div>
              )}
            </For>
          </div>

          <div class="mt-3 flex items-center justify-between gap-3 rounded-lg border border-border px-3 py-2">
            <div class="flex items-center gap-1.5 text-[11px] text-muted-foreground">
              <SyncIcon />
              Policy sync
            </div>
            <div class="flex items-center gap-2">
              <span class="hidden text-[10.5px] text-muted-foreground sm:inline" data-numeric>
                1,278 delivered
              </span>
              <Badge variant="success">100%</Badge>
            </div>
          </div>
        </div>
      </Card>
    </div>
  );
}

function PreviewStat(props: { value: string; label: string }) {
  return (
    <div class="px-3 py-2.5">
      <p
        data-numeric
        class="text-[15px] font-[560] leading-none tracking-[-0.02em] text-foreground"
      >
        {props.value}
      </p>
      <p class="label-caps mt-1.5">{props.label}</p>
    </div>
  );
}

function DeviceGlyph(props: { detail: string }) {
  if (props.detail.startsWith("Windows")) return <WindowsIcon class="size-3" />;

  if (props.detail.startsWith("Android")) return <AndroidIcon class="size-3" />;

  return <AppleIcon class="size-3" />;
}

function Platforms() {
  return (
    <section id="platforms" class="scroll-mt-20 border-y border-border bg-card">
      <div class="mx-auto w-full max-w-[1200px] px-6 py-20 sm:px-8 sm:py-20">
        <div class="flex flex-col justify-between gap-6 lg:flex-row lg:items-end">
          <div class="max-w-xl">
            <SectionLabel>Platforms</SectionLabel>
            <h2 class={sectionHeadline}>
              One control plane.
              <br />
              <span class="text-muted-foreground">Every operating system.</span>
            </h2>
          </div>
          <p class={`${sectionIntro} lg:mb-1`}>
            Native protocols, not a lowest-common-denominator agent. Each platform keeps its own
            enrollment, policy and inventory model — with one API and one audit trail.
          </p>
        </div>

        <div class="mt-10 grid gap-px border-y border-border bg-border sm:grid-cols-2 lg:grid-cols-3">
          <For each={platforms}>
            {(platform) => (
              <a
                href={platform.href}
                class="group flex flex-col bg-card p-6 outline-none transition-[background-color,box-shadow] duration-[var(--duration-hover)] ease-swift hover:bg-hover/70 focus-visible:ring-2 focus-visible:ring-ring/50 focus-visible:ring-inset sm:p-7"
              >
                <div class="flex items-start justify-between">
                  <span class="flex size-8 items-center justify-center rounded-md border border-border bg-background text-foreground transition-colors duration-[var(--duration-hover)] ease-swift group-hover:border-border-strong">
                    <platform.icon class="size-4" />
                  </span>
                  <ArrowIcon class="card-arrow size-3.5 text-subtle-foreground" />
                </div>
                <h3 class="mt-5 text-[15px] font-[540] tracking-[-0.015em] text-foreground">
                  {platform.name}
                </h3>
                <p class="mt-0.5 text-[11.5px] text-muted-foreground">{platform.tag}</p>
                <p class="mt-3 text-[12.5px] leading-6 text-muted-foreground">{platform.body}</p>
                <ul class="mt-5 space-y-1.5 border-t border-border pt-4">
                  <For each={platform.points}>
                    {(point) => (
                      <li class="flex items-center gap-2 text-[11.5px] text-muted-foreground">
                        <CheckIcon />
                        {point}
                      </li>
                    )}
                  </For>
                </ul>
              </a>
            )}
          </For>
        </div>
      </div>
    </section>
  );
}

function FeatureGrid() {
  return (
    <section
      id="product"
      class="scroll-mt-20 mx-auto w-full max-w-[1200px] px-6 py-20 sm:px-8 sm:py-20"
    >
      <div class="max-w-2xl">
        <SectionLabel>Product</SectionLabel>
        <h2 class={sectionHeadline}>The work behind the dashboard.</h2>
        <p class="mt-4 max-w-xl text-[13px] leading-6 text-muted-foreground">
          Enrollment, policy resolution, inventory, security and automation are designed together,
          so a change in one place is visible everywhere it matters.
        </p>
      </div>

      <div class="mt-10 grid gap-px border-y border-border bg-border sm:grid-cols-2 lg:grid-cols-3">
        <For each={features}>
          {(feature) => (
            <div class="group bg-background p-6 transition-colors duration-[var(--duration-hover)] ease-swift hover:bg-hover/50 sm:p-7">
              <span class="flex size-7 items-center justify-center rounded-md border border-border bg-card text-muted-foreground transition-colors duration-[var(--duration-hover)] ease-swift group-hover:border-border-strong group-hover:text-foreground">
                <feature.icon class="size-3.5" />
              </span>
              <h3 class="mt-4 text-[13.5px] font-[540] tracking-[-0.012em] text-foreground">
                {feature.title}
              </h3>
              <p class="mt-2 text-[12.5px] leading-6 text-muted-foreground">{feature.body}</p>
            </div>
          )}
        </For>
      </div>
    </section>
  );
}

function Developer() {
  return (
    <section id="developers" class="scroll-mt-20 border-y border-border bg-surface">
      <div class="mx-auto grid w-full max-w-[1200px] gap-12 px-6 py-20 sm:px-8 lg:grid-cols-[0.92fr_1.08fr] lg:items-center sm:py-20">
        <div class="min-w-0">
          <SectionLabel>For builders</SectionLabel>
          <h2 class={sectionHeadline}>An API, not an afterthought.</h2>
          <p class="mt-4 max-w-lg text-[13px] leading-6 text-muted-foreground">
            Everything the dashboard does is available over a typed REST API. Build a provisioning
            pipeline, sync inventory into your SIEM, or embed the protocol gateway in your own
            product.
          </p>

          <div class="mt-7 space-y-4">
            <DeveloperPoint
              title="Typed REST + OpenAPI"
              body="Generated from the same Effect contract that serves the dashboard."
            />
            <DeveloperPoint
              title="HMAC-signed webhooks"
              body="Device, policy, enrollment and compliance events with stable delivery ids."
            />
            <DeveloperPoint
              title="Whitelabel management contract"
              body="Implement one TypeScript interface and own the product around it."
            />
          </div>

          <div class="mt-7 flex flex-wrap gap-2.5">
            <Button as="a" href="/docs/api/" target="_self" class="h-9 px-4">
              Explore the API
              <ArrowIcon class={arrowNudge} />
            </Button>
          </div>
        </div>

        <div class="relative min-w-0">
          <Card class="overflow-hidden bg-card shadow-panel">
            <div class="flex h-9 items-center justify-between border-b border-border px-4">
              <div class="flex items-center gap-1.5" aria-hidden="true">
                <span class="size-1.5 rounded-full bg-border-strong" />
                <span class="size-1.5 rounded-full bg-border-strong" />
                <span class="size-1.5 rounded-full bg-border-strong" />
              </div>
              <span class="label-caps">TypeScript</span>
            </div>
            <pre class="max-w-full overflow-x-auto whitespace-pre-wrap break-words p-4 font-mono text-[11.5px] leading-6 text-muted-foreground/90 sm:p-5">
              <code>
                <span class="text-subtle-foreground">
                  {"// Implement one contract, own the product."}
                </span>
                {"\n"}
                <span class="text-subtle-foreground">{"import"}</span>
                {" { ManagementBackendHttp } "}
                <span class="text-subtle-foreground">{"from"}</span>
                {' "'}
                <span class="text-foreground">@mattrax/management-backend-http</span>
                {'";\n\n'}
                <span class="text-subtle-foreground">{"const"}</span>
                {" gateway = "}
                <span class="text-foreground">ManagementBackendHttp</span>
                {"({\n  baseUrl: "}
                <span class="text-foreground">"https://api.acme.dev"</span>
                {",\n  secret: process.env."}
                <span class="text-foreground">MATTRAX_WEBHOOK_SECRET</span>
                {"!,\n});\n\n"}
                <span class="text-subtle-foreground">{"// Apple, Windows, SCEP and DDM"}</span>
                {"\n"}
                <span class="text-subtle-foreground">{"// are handled by the gateway."}</span>
              </code>
            </pre>
            <div class="flex items-center gap-1.5 border-t border-border px-4 py-2.5 text-[11px] text-muted-foreground">
              <span class="size-1.5 rounded-full bg-success" aria-hidden="true" />
              <span data-numeric>POST /webhook/apple/checkin · 200 · 12ms</span>
            </div>
          </Card>
        </div>
      </div>
    </section>
  );
}

function DeveloperPoint(props: { title: string; body: string }) {
  return (
    <div class="flex gap-3">
      <span class="mt-0.5 flex size-4.5 shrink-0 items-center justify-center rounded-[5px] border border-border bg-card text-muted-foreground">
        <CheckIcon class="size-2.5" />
      </span>
      <div>
        <p class="text-[12.5px] font-[520] text-foreground">{props.title}</p>
        <p class="mt-0.5 text-[11.5px] leading-5 text-muted-foreground">{props.body}</p>
      </div>
    </div>
  );
}

function Migration() {
  return (
    <section id="migration" class="scroll-mt-20 border-b border-border bg-background">
      <div class="mx-auto w-full max-w-[1200px] px-6 py-20 sm:px-8 sm:py-20">
        <div class="grid gap-12 lg:grid-cols-[0.92fr_1.08fr] lg:items-start">
          <div>
            <SectionLabel>Migration</SectionLabel>
            <h2 class={sectionHeadline}>
              Moving from
              <br />
              <span class="text-muted-foreground">another MDM?</span>
            </h2>
            <p class="mt-4 max-w-md text-[13px] leading-6 text-muted-foreground">
              A migration is a re-enrollment project. We give you the primitives — CSV
              pre-registration, ABM reassignment, Autopilot import, profile re-upload and a
              coexistence plan — instead of pretending a vendor export is a drop-in.
            </p>

            <div class="mt-6 flex flex-wrap gap-1.5">
              <For each={migrations}>
                {(vendor) => (
                  <span class="rounded-md border border-border bg-card px-2.5 py-1 text-[11.5px] font-[500] text-muted-foreground">
                    {vendor}
                  </span>
                )}
              </For>
            </div>

            <a
              href="/docs/migration/"
              target="_self"
              class="group mt-7 inline-flex items-center gap-1.5 text-[12.5px] font-[520] text-foreground transition-colors duration-[var(--duration-hover)] ease-swift hover:text-muted-foreground"
            >
              Read the migration guide
              <ArrowIcon class="arrow-nudge size-3" />
            </a>
          </div>

          <div class="border-t border-border">
            <MigrationStep
              number="01"
              title="Prepare"
              body="Export inventory, profiles and VPP tokens. Import serials as pre-registrations."
            />
            <MigrationStep
              number="02"
              title="Rebuild"
              body="Recreate groups, policies and app entries. Validate on a pilot ring."
            />
            <MigrationStep
              number="03"
              title="Cut over"
              body="Move ABM serials in batches, re-enroll, verify escrow and decommission."
            />
          </div>
        </div>
      </div>
    </section>
  );
}

function MigrationStep(props: { number: string; title: string; body: string }) {
  return (
    <div class="grid grid-cols-[2.5rem_1fr] gap-4 border-b border-border py-5 sm:grid-cols-[3rem_1fr] sm:gap-6">
      <span class="label-caps tabular-nums">{props.number}</span>
      <div>
        <p class="text-[13px] font-[540] text-foreground">{props.title}</p>
        <p class="mt-1 text-[12px] leading-6 text-muted-foreground">{props.body}</p>
      </div>
    </div>
  );
}

function Enterprise() {
  const rows = [
    "Owner, admin, member and auditor roles",
    "SSO, SCIM and Entra directory sync",
    "Audit search, CSV/JSON export and webhooks",
    "Scheduled tenant backups and export/import",
    "Scoped API tokens with optional tenant binding",
  ];

  return (
    <section id="enterprise" class="scroll-mt-20 border-y border-border bg-card">
      <div class="mx-auto w-full max-w-[1200px] px-6 py-20 sm:px-8 sm:py-20">
        <div class="grid gap-12 lg:grid-cols-[0.92fr_1.08fr] lg:items-start">
          <div>
            <SectionLabel>Enterprise</SectionLabel>
            <h2 class={sectionHeadline}>
              Built for teams
              <br />
              <span class="text-muted-foreground">that answer audits.</span>
            </h2>
            <p class="mt-4 max-w-md text-[13px] leading-6 text-muted-foreground">
              Multi-tenant from the database up, with the controls security teams ask for: step-up
              confirmation, scoped automation, immutable audit events and a backup you can actually
              download.
            </p>
            <div class="mt-7 flex flex-wrap gap-2.5">
              <Button as="a" href="/register" class="h-9 px-4">
                Start free
              </Button>
              <Button as="a" href="mailto:hello@mattrax.app" variant="outline" class="h-9 px-4">
                Talk to us
              </Button>
            </div>
          </div>

          <Card class="overflow-hidden bg-background shadow-card">
            <For each={rows}>
              {(row, index) => (
                <div
                  class={`flex items-center justify-between gap-6 px-5 py-3.5 ${
                    index() > 0 ? "border-t border-border" : ""
                  }`}
                >
                  <span class="text-[12.5px] text-muted-foreground">{row}</span>
                  <span class="flex size-4.5 shrink-0 items-center justify-center rounded-full bg-hover text-muted-foreground">
                    <CheckIcon class="size-2.5" />
                  </span>
                </div>
              )}
            </For>
          </Card>
        </div>
      </div>
    </section>
  );
}

function Pricing() {
  return (
    <section id="pricing" class="scroll-mt-20 border-b border-border bg-surface">
      <div class="mx-auto w-full max-w-[1200px] px-6 py-20 sm:px-8 sm:py-20">
        <div class="max-w-2xl">
          <SectionLabel>Pricing</SectionLabel>
          <h2 class={sectionHeadline}>Start small. Keep the exit.</h2>
          <p class="mt-4 text-[13px] leading-6 text-muted-foreground">
            Cloud is free during alpha. Every plan includes the dashboard, API and MDM endpoints for
            Apple, Windows and Android.
          </p>
        </div>

        <div class="mt-10 grid max-w-[860px] gap-4 sm:grid-cols-2">
          <PriceCard
            name="Cloud"
            price="Free"
            suffix="during alpha"
            body="The hosted product for small teams and pilots."
            cta="Create an account"
            href="/register"
            features={[
              "Unlimited devices during alpha",
              "Apple, Windows and Android",
              "REST API and webhooks",
              "Community support",
            ]}
          />
          <PriceCard
            name="Enterprise"
            price="Custom"
            body="Procurement, security review and support."
            cta="Contact us"
            href="mailto:hello@mattrax.app"
            features={["Security review support", "Migration planning", "Priority support"]}
            secondary
          />
        </div>
      </div>
    </section>
  );
}

function PriceCard(props: {
  name: string;
  price: string;
  suffix?: string;
  body: string;
  cta: string;
  href: string;
  features: string[];
  secondary?: boolean;
}) {
  return (
    <Card class="bg-card p-6 shadow-card sm:p-7">
      <div class="flex items-center justify-between">
        <p class="text-[13px] font-[540] text-foreground">{props.name}</p>
      </div>
      <div class="mt-5 flex items-baseline gap-1.5">
        <span class="text-[28px] font-[560] leading-none tracking-[-0.035em] text-foreground">
          {props.price}
        </span>
        {props.suffix && <span class="text-[11.5px] text-muted-foreground">{props.suffix}</span>}
      </div>
      <p class="mt-3 text-[12px] leading-5 text-muted-foreground">{props.body}</p>
      <Button
        as="a"
        href={props.href}
        variant={props.secondary ? "outline" : "default"}
        class="mt-6 w-full"
      >
        {props.cta}
      </Button>
      <ul class="mt-6 space-y-2.5 border-t border-border pt-5">
        <For each={props.features}>
          {(feature) => (
            <li class="flex items-center gap-2 text-[12px] text-muted-foreground">
              <CheckIcon />
              {feature}
            </li>
          )}
        </For>
      </ul>
    </Card>
  );
}

function Faq() {
  return (
    <section
      id="faq"
      class="scroll-mt-20 mx-auto w-full max-w-[1200px] px-6 py-20 sm:px-8 sm:py-20"
    >
      <div class="grid gap-12 lg:grid-cols-[0.8fr_1.2fr]">
        <div>
          <SectionLabel>Questions</SectionLabel>
          <h2 class={sectionHeadline}>
            The honest
            <br />
            <span class="text-muted-foreground">answers.</span>
          </h2>
          <p class="mt-4 max-w-sm text-[12.5px] leading-6 text-muted-foreground">
            If something is preview or not implemented, the docs say so. The same applies here.
          </p>
        </div>
        <div class="divide-y divide-border border-y border-border">
          <For each={faqs}>
            {(faq) => (
              <details class="group py-5">
                <summary class="flex cursor-pointer list-none items-center justify-between gap-6 text-[13px] font-[520] text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/40">
                  {faq.q}
                  <span class="text-muted-foreground transition-colors duration-[var(--duration-hover)] ease-swift group-hover:text-foreground">
                    <ChevronDownIcon class="disclosure-chevron size-3.5" />
                  </span>
                </summary>
                <p class="mt-3 max-w-2xl text-[12.5px] leading-6 text-muted-foreground">{faq.a}</p>
              </details>
            )}
          </For>
        </div>
      </div>
    </section>
  );
}

function FinalCta() {
  return (
    <section class="px-6 pb-20 sm:px-8">
      <div class="relative mx-auto max-w-[1200px] overflow-hidden rounded-xl border border-border bg-card px-6 py-14 text-center shadow-card sm:px-16 sm:py-16">
        <div class="relative">
          <SectionLabel>Get started</SectionLabel>
          <h2 class="mx-auto mt-3 max-w-2xl text-[2.25rem] font-[560] leading-[1.06] tracking-[-0.04em] text-foreground sm:text-[2.75rem]">
            Your fleet, finally in one place.
          </h2>
          <p class="mx-auto mt-4 max-w-lg text-[12.5px] leading-6 text-muted-foreground">
            Create a tenant, enroll a device and deploy a policy in under five minutes. Free during
            alpha.
          </p>
          <div class="mt-7 flex flex-wrap justify-center gap-2.5">
            <Button as="a" href="/register" class="h-9 px-4">
              Start free
              <ArrowIcon class={arrowNudge} />
            </Button>
            <Button
              as="a"
              href="/docs/getting-started/quick-start"
              target="_self"
              variant="outline"
              class="h-9 px-4"
            >
              Quick start
            </Button>
          </div>
        </div>
      </div>
    </section>
  );
}

function SectionLabel(props: { children: JSX.Element }) {
  return <p class="label-caps">{props.children}</p>;
}

function ArrowIcon(props: { class?: string }) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      width="14"
      height="14"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      stroke-width="1.8"
      stroke-linecap="round"
      stroke-linejoin="round"
      class={props.class ?? "size-3.5"}
      aria-hidden="true"
    >
      <path d="M5 12h14" />
      <path d="m12 5 7 7-7 7" />
    </svg>
  );
}

function CheckIcon(props: { class?: string }) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      width="12"
      height="12"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      stroke-width="2.5"
      stroke-linecap="round"
      stroke-linejoin="round"
      class={`${props.class ?? "text-subtle-foreground"} shrink-0`}
      aria-hidden="true"
    >
      <polyline points="20 6 9 17 4 12" />
    </svg>
  );
}

function ChevronDownIcon(props: { class?: string }) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      width="15"
      height="15"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      stroke-width="1.5"
      stroke-linecap="round"
      stroke-linejoin="round"
      class={props.class}
      aria-hidden="true"
    >
      <path d="m6 9 6 6 6-6" />
    </svg>
  );
}

function AppleIcon(props: { class?: string }) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 24 24"
      fill="currentColor"
      class={props.class ?? "size-4"}
      aria-hidden="true"
    >
      <path d="M16.7 12.9c0-2.3 1.9-3.4 2-3.5-1.1-1.6-2.8-1.8-3.4-1.8-1.4-.1-2.8.8-3.5.8-.7 0-1.8-.8-3-.8-1.5 0-3 .9-3.8 2.3-1.6 2.8-.4 7 1.2 9.3.8 1.1 1.7 2.3 2.9 2.3 1.2 0 1.6-.8 3.1-.8 1.4 0 1.8.8 3 .7 1.2 0 2-1.1 2.8-2.2.9-1.3 1.3-2.6 1.3-2.7-.1 0-2.6-1-2.6-3.6Z" />
      <path d="M14.4 5.7c.6-.8 1.1-1.9 1-3-.9 0-2 .6-2.7 1.4-.6.7-1.2 1.8-1 2.9 1 .1 2-.5 2.7-1.3Z" />
    </svg>
  );
}

function WindowsIcon(props: { class?: string }) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 24 24"
      fill="currentColor"
      class={props.class ?? "size-4"}
      aria-hidden="true"
    >
      <path d="M3 5.5 10.4 4.4v7.1H3V5.5Zm8.7-1.2L21 3v8.5h-9.3V4.3ZM3 12.8h7.4v7.1L3 18.8v-6Zm8.7 0H21V21l-9.3-1.3v-6.9Z" />
    </svg>
  );
}

function AndroidIcon(props: { class?: string }) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 24 24"
      fill="currentColor"
      class={props.class ?? "size-4"}
      aria-hidden="true"
    >
      <path d="M7.2 9.4c0-.5.4-.9.9-.9h7.8c.5 0 .9.4.9.9v5.2c0 .5-.4.9-.9.9H8.1a.9.9 0 0 1-.9-.9V9.4Z" />
      <path d="M8.2 8.1 7 6.1a.5.5 0 0 1 .2-.7.5.5 0 0 1 .7.2l1.2 2h5.8l1.2-2a.5.5 0 0 1 .7-.2.5.5 0 0 1 .2.7L15.8 8H8.2Z" />
      <circle cx="9.5" cy="10.2" r=".6" class="text-card" fill="currentColor" />
      <circle cx="14.5" cy="10.2" r=".6" class="text-card" fill="currentColor" />
      <path d="M8 17.1v2.4a1 1 0 0 1-2 0v-2.4h2Zm10 0v2.4a1 1 0 0 1-2 0v-2.4h2Z" />
    </svg>
  );
}

function LayersIcon(props: { class?: string }) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      stroke-width="1.6"
      stroke-linecap="round"
      stroke-linejoin="round"
      class={props.class ?? "size-4"}
      aria-hidden="true"
    >
      <path d="m12 3 9 5-9 5-9-5 9-5Z" />
      <path d="m3 12 9 5 9-5" />
      <path d="m3 16 9 5 9-5" />
    </svg>
  );
}

function ShieldIcon(props: { class?: string }) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      stroke-width="1.6"
      stroke-linecap="round"
      stroke-linejoin="round"
      class={props.class ?? "size-4"}
      aria-hidden="true"
    >
      <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10Z" />
      <path d="m9 12 2 2 4-4" />
    </svg>
  );
}

function ChartIcon(props: { class?: string }) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      stroke-width="1.6"
      stroke-linecap="round"
      stroke-linejoin="round"
      class={props.class ?? "size-4"}
      aria-hidden="true"
    >
      <path d="M3 3v18h18" />
      <path d="m7 15 4-4 3 3 5-7" />
    </svg>
  );
}

function BoltIcon(props: { class?: string }) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      stroke-width="1.6"
      stroke-linecap="round"
      stroke-linejoin="round"
      class={props.class ?? "size-4"}
      aria-hidden="true"
    >
      <path d="m13 2-9 12h7l-1 8 9-12h-7l1-8Z" />
    </svg>
  );
}

function LockIcon(props: { class?: string }) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      stroke-width="1.6"
      stroke-linecap="round"
      stroke-linejoin="round"
      class={props.class ?? "size-4"}
      aria-hidden="true"
    >
      <rect width="16" height="11" x="4" y="11" rx="2" />
      <path d="M8 11V7a4 4 0 0 1 8 0v4" />
    </svg>
  );
}

function TerminalIcon(props: { class?: string }) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      stroke-width="1.6"
      stroke-linecap="round"
      stroke-linejoin="round"
      class={props.class ?? "size-4"}
      aria-hidden="true"
    >
      <path d="m4 17 6-6-6-6" />
      <path d="M12 19h8" />
    </svg>
  );
}

function SyncIcon() {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      width="12"
      height="12"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      stroke-width="1.8"
      stroke-linecap="round"
      stroke-linejoin="round"
      aria-hidden="true"
    >
      <path d="M21 2v6h-6" />
      <path d="M3 12a9 9 0 0 1 15-6.7L21 8" />
      <path d="M3 22v-6h6" />
      <path d="M21 12a9 9 0 0 1-15 6.7L3 16" />
    </svg>
  );
}
