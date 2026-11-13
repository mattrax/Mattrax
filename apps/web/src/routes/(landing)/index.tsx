import type { JSX } from "@solidjs/web";
import { For } from "solid-js";
import { Button } from "~/components/ui/button";

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

export default function Page() {
  return (
    <>
      <Hero />
      <Platforms />
      <FeatureGrid />
      <Developer />
      <Migration />
      <Enterprise />
      <Pricing />
      <Faq />
      <FinalCta />
    </>
  );
}

function Hero() {
  return (
    <section class="relative isolate overflow-hidden">
      <div class="pointer-events-none absolute inset-0 -z-10 bg-[linear-gradient(to_right,rgba(255,255,255,0.035)_1px,transparent_1px),linear-gradient(to_bottom,rgba(255,255,255,0.035)_1px,transparent_1px)] bg-[size:56px_56px] [mask-image:radial-gradient(ellipse_65%_55%_at_50%_0%,black,transparent)]" />

      <div class="mx-auto grid max-w-7xl items-center gap-16 px-6 pb-20 pt-16 sm:px-8 xl:grid-cols-[1.02fr_0.98fr] xl:gap-12 lg:pb-28 lg:pt-24">
        <div class="max-w-2xl">
          <div class="inline-flex items-center gap-2 rounded-md border border-white/[0.07] bg-card px-3 py-1 text-xs font-medium text-muted-foreground backdrop-blur">
            <span class="relative flex size-1.5">
              <span class="absolute inline-flex size-full animate-ping rounded-full bg-success opacity-60" />
              <span class="relative inline-flex size-1.5 rounded-full bg-success" />
            </span>
            Apple, Windows and Android in one control plane
          </div>

          <h1 class="mt-7 text-[2.7rem] font-[540] leading-[0.98] tracking-[-0.045em] text-foreground sm:text-5xl lg:text-[3.4rem] xl:text-[3.6rem]">
            Device management
            <br />
            <span class="text-muted-foreground/80 xl:whitespace-nowrap">without the legacy.</span>
          </h1>

          <p class="mt-7 max-w-xl text-base leading-7 text-muted-foreground sm:text-lg">
            Mattrax gives you enrollment, policy, inventory and remote actions for every platform —
            with a clean API, a real audit trail and a deployment model that fits how you work.
          </p>

          <div class="mt-9 flex flex-wrap items-center gap-3">
            <a href="/register">
              <Button
                size="lg"
                class="h-10 rounded-md bg-foreground px-6 text-background hover:bg-foreground/90"
              >
                Start free
                <ArrowIcon />
              </Button>
            </a>
            <a href="/docs/" target="_self">
              <Button
                variant="outline"
                size="lg"
                class="h-10 rounded-md border-white/[0.12] bg-transparent px-6 text-foreground/80 hover:bg-white/[0.04] hover:text-foreground"
              >
                Read the docs
              </Button>
            </a>
          </div>

          <div class="mt-8 flex flex-wrap items-center gap-x-3 gap-y-2 text-[11px] font-medium tracking-normal text-muted-foreground/80">
            <span>APNs</span>
            <Dot />
            <span>ABM</span>
            <Dot />
            <span>VPP</span>
            <Dot />
            <span>Entra ID</span>
            <Dot />
            <span>Autopilot</span>
            <Dot />
            <span>Android Enterprise</span>
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
    <div class="relative mx-auto w-full max-w-[560px] lg:max-w-none">
      <div />
      <div class="rounded-lg border border-white/[0.07] bg-card p-2 shadow-[0_30px_80px_-30px_rgba(28,25,23,0.35)] backdrop-blur">
        <div class="overflow-hidden rounded-md border border-white/[0.07] bg-card">
          <div class="flex items-center justify-between border-b border-white/[0.07] px-5 py-4">
            <div class="flex items-center gap-2">
              <span class="size-2 rounded-full bg-white/[0.07]" />
              <span class="size-2 rounded-full bg-white/[0.07]" />
              <span class="size-2 rounded-full bg-white/[0.07]" />
            </div>
            <div class="flex items-center gap-2 text-[11px] font-medium text-muted-foreground/80">
              <span class="size-1.5 rounded-full bg-success" />
              All systems operational
            </div>
          </div>

          <div class="p-5">
            <div class="flex items-start justify-between">
              <div>
                <p class="text-[11px] font-medium tracking-normal text-muted-foreground/80">
                  Fleet overview
                </p>
                <p class="mt-1 text-2xl font-medium tracking-tight text-foreground">
                  1,284 devices
                </p>
              </div>
              <span class="rounded-md border border-white/[0.07] bg-white/[0.02] px-2.5 py-1 text-[10px] font-medium text-muted-foreground">
                Live
              </span>
            </div>

            <div class="mt-5 grid grid-cols-3 gap-2.5">
              <PreviewStat value="96.4%" label="Healthy" />
              <PreviewStat value="3" label="Platforms" />
              <PreviewStat value="12" label="Policies" />
            </div>

            <div class="mt-5 space-y-2">
              <For each={devices}>
                {(device) => (
                  <div class="flex items-center gap-3 rounded-lg border border-white/[0.07] bg-white/[0.02] px-3 py-2.5">
                    <span class="flex size-7 shrink-0 items-center justify-center rounded-lg border border-white/[0.07] bg-card text-muted-foreground">
                      <DeviceGlyph detail={device.detail} />
                    </span>
                    <div class="min-w-0 flex-1">
                      <p class="truncate text-xs font-medium text-foreground/90">{device.name}</p>
                      <p class="truncate text-[10px] text-muted-foreground/80">{device.detail}</p>
                    </div>
                    <span
                      class={`shrink-0 rounded-md px-2 py-0.5 text-[10px] font-medium ${
                        device.tone === "warn"
                          ? "bg-warning/10 text-warning-foreground"
                          : "bg-success/10 text-success-foreground"
                      }`}
                    >
                      {device.state}
                    </span>
                  </div>
                )}
              </For>
            </div>

            <div class="mt-4 flex items-center justify-between rounded-lg border border-white/[0.07] px-3 py-2.5">
              <div class="flex items-center gap-2 text-[11px] text-muted-foreground">
                <SyncIcon />
                Policy sync
              </div>
              <div class="flex items-center gap-2">
                <span class="text-[10px] text-muted-foreground/80">1,278 delivered</span>
                <span class="rounded-md bg-card px-2 py-0.5 text-[10px] font-medium text-foreground">
                  100%
                </span>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

function PreviewStat(props: { value: string; label: string }) {
  return (
    <div class="rounded-lg border border-white/[0.07] bg-card p-3">
      <p class="text-lg font-medium tracking-tight text-foreground">{props.value}</p>
      <p class="mt-0.5 text-[10px] text-muted-foreground/80">{props.label}</p>
    </div>
  );
}

function DeviceGlyph(props: { detail: string }) {
  if (props.detail.startsWith("Windows")) return <WindowsIcon class="size-3.5" />;
  if (props.detail.startsWith("Android")) return <AndroidIcon class="size-3.5" />;
  return <AppleIcon class="size-3.5" />;
}

function Platforms() {
  return (
    <section id="platforms" class="border-y border-white/[0.07] bg-card">
      <div class="mx-auto max-w-7xl px-6 py-20 sm:px-8 lg:py-24">
        <div class="flex flex-col justify-between gap-6 md:flex-row md:items-end">
          <div class="max-w-2xl">
            <SectionLabel>Platforms</SectionLabel>
            <h2 class="mt-4 text-[2rem] font-[540] tracking-[-0.035em] text-foreground sm:text-[2.5rem]">
              One control plane.
              <br />
              <span class="text-muted-foreground/80">Every operating system.</span>
            </h2>
          </div>
          <p class="max-w-md text-sm leading-6 text-muted-foreground">
            Native protocols, not a lowest-common-denominator agent. Each platform keeps its own
            enrollment, policy and inventory model — with one API and one audit trail.
          </p>
        </div>

        <div class="mt-12 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          <For each={platforms}>
            {(platform) => (
              <a
                href={platform.href}
                class="group relative overflow-hidden rounded-lg border border-white/[0.07] bg-white/[0.015] p-7 transition hover:border-white/[0.12] hover:bg-white/[0.03]"
              >
                <div class="flex items-start justify-between">
                  <span class="flex size-11 items-center justify-center rounded-lg border border-white/[0.07] bg-card text-foreground/80">
                    <platform.icon class="size-5" />
                  </span>
                  <ArrowIcon class="size-4 -translate-x-1 text-muted-foreground/60 opacity-0 transition group-hover:translate-x-0 group-hover:opacity-100" />
                </div>
                <h3 class="mt-6 text-xl font-medium tracking-tight text-foreground">
                  {platform.name}
                </h3>
                <p class="mt-1 text-[11px] font-medium tracking-normal text-muted-foreground/80">
                  {platform.tag}
                </p>
                <p class="mt-4 text-sm leading-6 text-muted-foreground">{platform.body}</p>
                <ul class="mt-6 space-y-2 border-t border-white/[0.07] pt-5">
                  <For each={platform.points}>
                    {(point) => (
                      <li class="flex items-center gap-2 text-xs text-muted-foreground">
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
    <section id="product" class="mx-auto max-w-7xl px-6 py-20 sm:px-8 lg:py-28">
      <div class="max-w-2xl">
        <SectionLabel>Product</SectionLabel>
        <h2 class="mt-4 text-[2rem] font-[540] tracking-[-0.035em] text-foreground sm:text-[2.5rem]">
          The work behind the dashboard.
        </h2>
        <p class="mt-5 text-sm leading-6 text-muted-foreground sm:text-base">
          Enrollment, policy resolution, inventory, security and automation are designed together,
          so a change in one place is visible everywhere it matters.
        </p>
      </div>

      <div class="mt-12 grid gap-px overflow-hidden rounded-lg border border-white/[0.07] bg-white/[0.07] sm:grid-cols-2 lg:grid-cols-3">
        <For each={features}>
          {(feature) => (
            <div class="group bg-white/[0.02] p-7 transition hover:bg-card">
              <span class="flex size-9 items-center justify-center rounded-lg border border-white/[0.07] bg-card text-muted-foreground">
                <feature.icon class="size-4" />
              </span>
              <h3 class="mt-5 text-base font-medium tracking-tight text-foreground">
                {feature.title}
              </h3>
              <p class="mt-2 text-sm leading-6 text-muted-foreground">{feature.body}</p>
            </div>
          )}
        </For>
      </div>
    </section>
  );
}

function Developer() {
  return (
    <section id="developers" class="relative overflow-hidden bg-white/[0.02]">
      <div class="mx-auto grid min-w-0 max-w-7xl gap-14 px-6 py-20 sm:px-8 lg:grid-cols-[0.9fr_1.1fr] lg:items-center lg:py-28">
        <div class="min-w-0">
          <p class="text-[11px] font-medium tracking-normal text-muted-foreground">For builders</p>
          <h2 class="mt-4 text-[2rem] font-[540] tracking-[-0.035em] text-foreground sm:text-[2.5rem]">
            An API, not an afterthought.
          </h2>
          <p class="mt-5 max-w-lg text-sm leading-6 text-muted-foreground/80 sm:text-base">
            Everything the dashboard does is available over a typed REST API. Build a provisioning
            pipeline, sync inventory into your SIEM, or embed the protocol gateway in your own
            product.
          </p>

          <div class="mt-8 space-y-4">
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

          <div class="mt-8 flex flex-wrap gap-3">
            <a href="/docs/api/" target="_self">
              <Button class="rounded-md bg-foreground px-6 text-background hover:bg-foreground/90">
                Explore the API
                <ArrowIcon />
              </Button>
            </a>
          </div>
        </div>

        <div class="relative min-w-0">
          <div class="absolute -inset-4 rounded-lg bg-white/[0.03] blur-2xl" />
          <div class="relative overflow-hidden rounded-lg border border-white/[0.08] bg-card shadow-2xl">
            <div class="flex items-center justify-between border-b border-white/[0.08] px-5 py-3">
              <div class="flex items-center gap-2">
                <span class="size-2 rounded-full bg-white/[0.08]" />
                <span class="size-2 rounded-full bg-white/[0.08]" />
                <span class="size-2 rounded-full bg-white/[0.08]" />
              </div>
              <span class="text-[10px] font-medium tracking-normal text-muted-foreground">
                TypeScript
              </span>
            </div>
            <pre class="max-w-full overflow-x-auto p-5 text-[12.5px] leading-6 text-muted-foreground/60 sm:p-6">
              <code>
                <span class="text-muted-foreground">
                  {"// Implement one contract, own the product."}
                </span>
                {"\n"}
                <span class="text-muted-foreground">{"import"}</span>
                {" { ManagementBackendHttp } "}
                <span class="text-muted-foreground">{"from"}</span>
                {' "'}
                <span class="text-foreground/80">@mattrax/management-backend-http</span>
                {'";\n\n'}
                <span class="text-muted-foreground">{"const"}</span>
                {" gateway = "}
                <span class="text-foreground/80">ManagementBackendHttp</span>
                {"({\n  baseUrl: "}
                <span class="text-success">"https://api.acme.dev"</span>
                {",\n  secret: process.env."}
                <span class="text-foreground/80">MATTRAX_WEBHOOK_SECRET</span>
                {"!,\n});\n\n"}
                <span class="text-muted-foreground">{"// Apple, Windows, SCEP and DDM"}</span>
                {"\n"}
                <span class="text-muted-foreground">{"// are handled by the gateway."}</span>
              </code>
            </pre>
            <div class="border-t border-white/[0.08] px-5 py-3 text-[11px] text-muted-foreground">
              <span class="text-success">●</span> POST /webhook/apple/checkin · 200 · 12ms
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}

function DeveloperPoint(props: { title: string; body: string }) {
  return (
    <div class="flex gap-3">
      <span class="mt-0.5 flex size-5 shrink-0 items-center justify-center rounded-md border border-white/[0.1] text-muted-foreground/80">
        <CheckIcon class="size-3" />
      </span>
      <div>
        <p class="text-sm font-medium text-foreground/80">{props.title}</p>
        <p class="mt-0.5 text-xs leading-5 text-muted-foreground">{props.body}</p>
      </div>
    </div>
  );
}

function Migration() {
  return (
    <section id="migration" class="border-b border-white/[0.07] bg-card">
      <div class="mx-auto max-w-7xl px-6 py-20 sm:px-8 lg:py-28">
        <div class="grid gap-12 lg:grid-cols-[0.9fr_1.1fr] lg:items-start">
          <div>
            <SectionLabel>Migration</SectionLabel>
            <h2 class="mt-4 text-[2rem] font-[540] tracking-[-0.035em] text-foreground sm:text-[2.5rem]">
              Moving from
              <br />
              <span class="text-muted-foreground/80">another MDM?</span>
            </h2>
            <p class="mt-5 max-w-md text-sm leading-6 text-muted-foreground sm:text-base">
              A migration is a re-enrollment project. We give you the primitives — CSV
              pre-registration, ABM reassignment, Autopilot import, profile re-upload and a
              coexistence plan — instead of pretending a vendor export is a drop-in.
            </p>

            <div class="mt-7 flex flex-wrap gap-2">
              <For each={migrations}>
                {(vendor) => (
                  <span class="rounded-md border border-white/[0.07] bg-white/[0.02] px-3 py-1.5 text-xs font-medium text-muted-foreground">
                    {vendor}
                  </span>
                )}
              </For>
            </div>

            <a
              href="/docs/migration/"
              target="_self"
              class="mt-8 inline-flex items-center gap-2 text-sm font-medium text-foreground hover:text-muted-foreground"
            >
              Read the migration guide
              <ArrowIcon />
            </a>
          </div>

          <div class="grid gap-3 sm:grid-cols-3">
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
    <div class="rounded-lg border border-white/[0.07] bg-white/[0.015] p-5">
      <p class="text-[10px] font-medium tracking-[0.18em] text-muted-foreground/80">
        {props.number}
      </p>
      <p class="mt-6 text-sm font-medium text-foreground">{props.title}</p>
      <p class="mt-2 text-xs leading-5 text-muted-foreground">{props.body}</p>
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
    <section id="enterprise" class="mx-auto max-w-7xl px-6 py-20 sm:px-8 lg:py-28">
      <div class="grid gap-14 lg:grid-cols-[0.9fr_1.1fr] lg:items-start">
        <div>
          <SectionLabel>Enterprise</SectionLabel>
          <h2 class="mt-4 text-[2rem] font-[540] tracking-[-0.035em] text-foreground sm:text-[2.5rem]">
            Built for teams
            <br />
            <span class="text-muted-foreground/80">that answer audits.</span>
          </h2>
          <p class="mt-5 max-w-md text-sm leading-6 text-muted-foreground sm:text-base">
            Multi-tenant from the database up, with the controls security teams ask for: step-up
            confirmation, scoped automation, immutable audit events and a backup you can actually
            download.
          </p>
          <div class="mt-8 flex flex-wrap gap-3">
            <a href="/register">
              <Button class="rounded-md bg-foreground px-6 text-background hover:bg-foreground/90">
                Start free
              </Button>
            </a>
            <a href="mailto:hello@mattrax.app">
              <Button
                variant="outline"
                class="rounded-md border-white/[0.12] bg-transparent px-6 text-foreground/80 hover:bg-white/[0.04] hover:text-foreground"
              >
                Talk to us
              </Button>
            </a>
          </div>
        </div>

        <div class="overflow-hidden rounded-lg border border-white/[0.07] bg-card">
          <For each={rows}>
            {(row, index) => (
              <div
                class={`flex items-center justify-between gap-6 px-6 py-4 ${
                  index() > 0 ? "border-t border-white/[0.07]" : ""
                }`}
              >
                <span class="text-sm text-muted-foreground">{row}</span>
                <span class="flex size-5 shrink-0 items-center justify-center rounded-full bg-white/[0.05] text-muted-foreground">
                  <CheckIcon class="size-3" />
                </span>
              </div>
            )}
          </For>
        </div>
      </div>
    </section>
  );
}

function Pricing() {
  return (
    <section id="pricing" class="border-y border-white/[0.07] bg-card">
      <div class="mx-auto max-w-7xl px-6 py-20 sm:px-8 lg:py-28">
        <div class="max-w-2xl">
          <SectionLabel>Pricing</SectionLabel>
          <h2 class="mt-4 text-[2rem] font-[540] tracking-[-0.035em] text-foreground sm:text-[2.5rem]">
            Start small. Keep the exit.
          </h2>
          <p class="mt-5 text-sm leading-6 text-muted-foreground sm:text-base">
            Cloud is free during alpha. Every plan includes the dashboard, API and MDM endpoints for
            Apple, Windows and Android.
          </p>
        </div>

        <div class="mt-12 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
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
  highlighted?: boolean;
}) {
  return (
    <div
      class={`flex flex-col rounded-lg border p-7 ${
        props.highlighted
          ? "border-white/[0.16] bg-white/[0.045] text-foreground"
          : "border-white/[0.07] bg-white/[0.015]"
      }`}
    >
      <div class="flex items-center justify-between">
        <p
          class={`text-sm font-medium ${props.highlighted ? "text-foreground" : "text-foreground"}`}
        >
          {props.name}
        </p>
        {props.highlighted && (
          <span class="rounded-md bg-white/[0.06] px-2 py-0.5 text-[10px] font-medium text-muted-foreground/60">
            Recommended
          </span>
        )}
      </div>
      <div class="mt-5 flex items-baseline gap-1.5">
        <span
          class={`text-3xl font-[540] tracking-tight ${
            props.highlighted ? "text-foreground" : "text-foreground"
          }`}
        >
          {props.price}
        </span>
        {props.suffix && (
          <span
            class={`text-xs ${props.highlighted ? "text-muted-foreground" : "text-muted-foreground/80"}`}
          >
            {props.suffix}
          </span>
        )}
      </div>
      <p
        class={`mt-3 text-xs leading-5 ${props.highlighted ? "text-muted-foreground/80" : "text-muted-foreground"}`}
      >
        {props.body}
      </p>
      <a href={props.href} class="mt-6">
        <Button class="w-full rounded-md bg-foreground text-background hover:bg-foreground/90">
          {props.cta}
        </Button>
      </a>
      <ul class="mt-7 space-y-3 border-t pt-6">
        <For each={props.features}>
          {(feature) => (
            <li
              class={`flex items-center gap-2 text-xs ${
                props.highlighted ? "text-muted-foreground/80" : "text-muted-foreground"
              }`}
            >
              <CheckIcon
                class={props.highlighted ? "text-muted-foreground" : "text-muted-foreground/80"}
              />
              {feature}
            </li>
          )}
        </For>
      </ul>
    </div>
  );
}

function Faq() {
  return (
    <section id="faq" class="mx-auto max-w-7xl px-6 py-20 sm:px-8 lg:py-28">
      <div class="grid gap-12 lg:grid-cols-[0.8fr_1.2fr]">
        <div>
          <SectionLabel>Questions</SectionLabel>
          <h2 class="mt-4 text-[2rem] font-[540] tracking-[-0.035em] text-foreground sm:text-[2.5rem]">
            The honest
            <br />
            <span class="text-muted-foreground/80">answers.</span>
          </h2>
          <p class="mt-5 max-w-sm text-sm leading-6 text-muted-foreground">
            If something is preview or not implemented, the docs say so. The same applies here.
          </p>
        </div>
        <div class="divide-y divide-white/[0.07] border-y border-white/[0.07]">
          <For each={faqs}>
            {(faq) => (
              <details class="group py-5">
                <summary class="flex cursor-pointer list-none items-center justify-between gap-6 text-sm font-medium text-foreground/90">
                  {faq.q}
                  <span class="text-muted-foreground/60 transition group-open:rotate-45">
                    <PlusIcon />
                  </span>
                </summary>
                <p class="mt-3 max-w-2xl text-sm leading-6 text-muted-foreground">{faq.a}</p>
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
      <div class="relative mx-auto max-w-7xl overflow-hidden rounded-lg border border-white/[0.07] bg-white/[0.02] px-8 py-16 text-center sm:px-16 sm:py-20">
        <div class="relative">
          <p class="text-[11px] font-medium tracking-normal text-muted-foreground">Get started</p>
          <h2 class="mx-auto mt-4 max-w-2xl text-[2rem] font-[540] tracking-[-0.035em] text-foreground sm:text-[2.5rem]">
            Your fleet, finally in one place.
          </h2>
          <p class="mx-auto mt-4 max-w-lg text-sm leading-6 text-muted-foreground/80">
            Create a tenant, enroll a device and deploy a policy in under five minutes. Free during
            alpha.
          </p>
          <div class="mt-8 flex flex-wrap justify-center gap-3">
            <a href="/register">
              <Button class="h-10 rounded-md bg-foreground px-6 text-background hover:bg-foreground/90">
                Start free
                <ArrowIcon />
              </Button>
            </a>
            <a href="/docs/getting-started/quick-start" target="_self">
              <Button
                variant="outline"
                class="h-10 rounded-md border-white/[0.1] bg-transparent px-6 text-muted-foreground/70 hover:bg-white/[0.04] hover:text-foreground"
              >
                Quick start
              </Button>
            </a>
          </div>
        </div>
      </div>
    </section>
  );
}

function SectionLabel(props: { children: JSX.Element }) {
  return (
    <p class="text-[11px] font-medium tracking-normal text-muted-foreground/80">{props.children}</p>
  );
}

function Dot() {
  return <span class="size-0.5 rounded-full bg-muted-foreground/50" />;
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
      stroke-width="2"
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
      class={`${props.class ?? "text-muted-foreground/80"} shrink-0`}
      aria-hidden="true"
    >
      <polyline points="20 6 9 17 4 12" />
    </svg>
  );
}

function PlusIcon() {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      width="16"
      height="16"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      stroke-width="1.5"
      stroke-linecap="round"
      aria-hidden="true"
    >
      <path d="M12 5v14" />
      <path d="M5 12h14" />
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
      <circle cx="9.5" cy="10.2" r=".6" fill="#fff" />
      <circle cx="14.5" cy="10.2" r=".6" fill="#fff" />
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
