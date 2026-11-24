import { ArrowRight, CircleCheck, TriangleAlert } from "@mattrax/ui";
import { For, Show, createSignal } from "solid-js";
import { BrandLogo } from "~/components/brand-logo";
import { Button } from "~/components/ui/button";
import { authClient } from "~/lib/auth";
import { publicPrimaryCta } from "~/lib/public-auth-cta";
import { LandingEyebrow, LandingLink } from "./primitives";
import { NoJsStartFree } from "../landing/primitives";

type Platform = "apple" | "windows" | "android";
type DeviceStatus = "Healthy" | "Attention" | "Stale";
type DeviceFilter = "all" | "healthy" | "attention";

type SampleDevice = {
  readonly id: string;
  readonly name: string;
  readonly detail: string;
  readonly owner: string;
  readonly status: DeviceStatus;
  readonly lastSeen: string;
  readonly platform: Platform;
};

const devices: readonly SampleDevice[] = [
  {
    id: "reception-mac",
    name: "Reception Mac",
    detail: "macOS 15.2",
    owner: "Facilities",
    status: "Healthy",
    lastSeen: "2 min ago",
    platform: "apple",
  },
  {
    id: "finance-laptop",
    name: "Finance Laptop",
    detail: "Windows 11 · 23H2",
    owner: "Finance",
    status: "Healthy",
    lastSeen: "4 min ago",
    platform: "windows",
  },
  {
    id: "field-tablet",
    name: "Field Tablet",
    detail: "iPadOS 18.1",
    owner: "Operations",
    status: "Attention",
    lastSeen: "18 min ago",
    platform: "apple",
  },
  {
    id: "warehouse-handheld",
    name: "Warehouse Handheld",
    detail: "Android 14",
    owner: "Logistics",
    status: "Healthy",
    lastSeen: "6 min ago",
    platform: "android",
  },
  {
    id: "design-studio",
    name: "Design Studio",
    detail: "macOS 15.1",
    owner: "Design",
    status: "Healthy",
    lastSeen: "8 min ago",
    platform: "apple",
  },
  {
    id: "sales-laptop",
    name: "Sales Laptop",
    detail: "Windows 11 · 24H2",
    owner: "Sales",
    status: "Stale",
    lastSeen: "3 hr ago",
    platform: "windows",
  },
];

const platformGlyphs: Record<Platform, string> = {
  apple: "Mac",
  windows: "Win",
  android: "And",
};

const proofPoints = ["APNs", "ABM / ADE", "DDM", "Autopilot", "Entra ID", "Android Enterprise"];

const filters: ReadonlyArray<{ id: DeviceFilter; label: string }> = [
  { id: "all", label: "All devices" },
  { id: "healthy", label: "Healthy" },
  { id: "attention", label: "Needs attention" },
];

function filterCount(filter: DeviceFilter): number {
  if (filter === "healthy") return devices.filter((device) => device.status === "Healthy").length;
  if (filter === "attention") {
    return devices.filter((device) => device.status !== "Healthy").length;
  }

  return devices.length;
}

export function Hero() {
  const session = authClient.useSession();
  const signedIn = () => Boolean(session().data?.user);
  const cta = () => publicPrimaryCta(session().isPending, signedIn());
  const [filter, setFilter] = createSignal<DeviceFilter>("all");
  const visibleDevices = () =>
    filter() === "all"
      ? devices
      : devices.filter((device) =>
          filter() === "healthy" ? device.status === "Healthy" : device.status !== "Healthy",
        );

  return (
    <section class="lr-hero" aria-labelledby="hero-title">
      <div class="lr-hero__glow" aria-hidden="true" />
      <div class="lr-shell lr-hero__copy">
        <div class="lr-hero__eyebrow" style="--order:0">
          <LandingEyebrow>MDM, without the black box</LandingEyebrow>
        </div>

        <h1 id="hero-title" class="lr-hero__title" style="--order:1">
          <span class="lr-hero__title-muted">Every device.</span>
          <span>One clear story.</span>
        </h1>

        <p class="lr-hero__lead" style="--order:2">
          Run Apple, Windows and Android from one control plane. See which policy won, what changed,
          and who changed it — on our cloud or yours.
        </p>

        <div class="lr-hero__actions" style="--order:3">
          <Show
            when={cta()}
            fallback={
              <div
                data-js-pending
                class="lr-cta-skeleton animate-pulse rounded-full bg-secondary"
                aria-hidden="true"
              />
            }
          >
            {(action) => (
              <Button
                as="a"
                href={action().href}
                size="lg"
                class="lr-button lr-button--primary h-auto min-h-12 rounded-full px-6"
              >
                {action().label}
                <ArrowRight class="lr-button__arrow" aria-hidden="true" />
              </Button>
            )}
          </Show>
          <NoJsStartFree class="lr-button lr-button--primary h-auto min-h-12 rounded-full px-6" />
          <Button
            as="a"
            href="mailto:hello@mattrax.app?subject=Mattrax%20for%20our%20fleet"
            variant="outline"
            size="lg"
            class="lr-button lr-button--secondary h-auto min-h-12 rounded-full px-6"
          >
            Talk to us
          </Button>
          <LandingLink href="/docs/">Read the docs</LandingLink>
        </div>

        <p class="lr-hero__note" style="--order:4">
          Free during alpha. Apple, Windows and Android included.{" "}
          <a href="/docs/getting-started/alpha" target="_self">
            What alpha means
          </a>
          .
        </p>

        <ul class="lr-proof" aria-label="Supported device management protocols" style="--order:5">
          <For each={proofPoints}>
            {(point) => (
              <li>
                <CircleCheck aria-hidden="true" />
                {point}
              </li>
            )}
          </For>
        </ul>
      </div>

      <div class="lr-shell lr-hero__stage-wrap">
        <div class="lr-stage">
          <div class="lr-stage__bar">
            <div class="lr-stage__dots" aria-hidden="true">
              <span />
              <span />
              <span />
            </div>
            <div class="lr-stage__address">
              <span class="lr-stage__lock" aria-hidden="true" />
              app.mattrax.com / overview
            </div>
            <span class="lr-stage__demo">Demo data</span>
          </div>

          <div class="lr-console">
            <aside class="lr-console__sidebar" aria-hidden="true">
              <div class="lr-console__brand">
                <BrandLogo class="h-3" />
              </div>
              <div class="lr-console__workspace">
                <span>MA</span>
                <div>
                  <b>Mattrax Alpha</b>
                  <small>Sample workspace</small>
                </div>
              </div>
              <div class="lr-console__nav">
                <span class="is-active">
                  <i class="lr-nav-glyph lr-nav-glyph--grid" />
                  Overview
                </span>
                <span>
                  <i class="lr-nav-glyph lr-nav-glyph--device" />
                  Devices
                </span>
                <span>
                  <i class="lr-nav-glyph lr-nav-glyph--policy" />
                  Policies
                </span>
                <span>
                  <i class="lr-nav-glyph lr-nav-glyph--audit" />
                  Audit log
                </span>
              </div>
              <div class="lr-console__sidebar-foot">
                <span class="lr-console__avatar">AO</span>
                <div>
                  <b>Alex Okafor</b>
                  <small>Administrator</small>
                </div>
              </div>
            </aside>

            <div class="lr-console__main">
              <div class="lr-console__heading">
                <div>
                  <p class="lr-console__kicker">Workspace overview</p>
                  <h2 id="fleet-preview-title">Fleet overview</h2>
                  <p>Every device, its current state, and the evidence behind it.</p>
                </div>
                <div class="lr-sync">
                  <span aria-hidden="true" />
                  Synced just now
                </div>
              </div>

              <div class="lr-stats" aria-label="Sample fleet summary">
                <div class="lr-stat">
                  <span>Total devices</span>
                  <strong>128</strong>
                  <small>
                    <b>+12</b> this month
                  </small>
                </div>
                <div class="lr-stat">
                  <span>Healthy</span>
                  <strong>96%</strong>
                  <small>123 of 128 devices</small>
                </div>
                <div class="lr-stat">
                  <span>Needs attention</span>
                  <strong>5</strong>
                  <small>2 stale · 3 warnings</small>
                </div>
              </div>

              <div class="lr-console__grid">
                <div class="lr-fleet">
                  <div class="lr-fleet__head">
                    <div>
                      <h3>Devices</h3>
                      <p>Sample devices across your estate</p>
                    </div>
                    <div class="lr-filters" role="group" aria-label="Filter sample devices">
                      <For each={filters}>
                        {(item) => (
                          <button
                            type="button"
                            aria-pressed={filter() === item.id ? "true" : "false"}
                            onClick={() => setFilter(item.id)}
                          >
                            {item.label}
                            <span>{filterCount(item.id)}</span>
                          </button>
                        )}
                      </For>
                    </div>
                  </div>

                  <div class="lr-device-table" aria-live="polite">
                    <div class="lr-device-table__header" aria-hidden="true">
                      <span>Device</span>
                      <span>Owner</span>
                      <span>Status</span>
                      <span>Last seen</span>
                    </div>
                    <For
                      each={visibleDevices()}
                      fallback={<p class="lr-device-empty">No devices in this view.</p>}
                    >
                      {(device, index) => (
                        <div class="lr-device-row" style={`--i:${index()}`}>
                          <div class="lr-device__identity">
                            <span
                              class={`lr-device__platform lr-device__platform--${device.platform}`}
                            >
                              {platformGlyphs[device.platform]}
                            </span>
                            <div>
                              <strong>{device.name}</strong>
                              <small>{device.detail}</small>
                            </div>
                          </div>
                          <span class="lr-device__owner">{device.owner}</span>
                          <span class={`lr-status lr-status--${device.status.toLowerCase()}`}>
                            {device.status === "Healthy" ? (
                              <CircleCheck aria-hidden="true" />
                            ) : (
                              <TriangleAlert aria-hidden="true" />
                            )}
                            {device.status}
                          </span>
                          <span class="lr-device__seen">{device.lastSeen}</span>
                        </div>
                      )}
                    </For>
                  </div>
                </div>

                <aside class="lr-fleet__rail" aria-label="Sample policy sync summary">
                  <div class="lr-rail__head">
                    <h3>Policy sync</h3>
                    <span>Live sample</span>
                  </div>
                  <div class="lr-health-ring" aria-hidden="true">
                    <div>
                      <strong>96%</strong>
                      <span>in sync</span>
                    </div>
                  </div>
                  <div class="lr-rail__legend">
                    <span>
                      <i class="is-ok" /> 123 in sync
                    </span>
                    <span>
                      <i class="is-warn" /> 5 pending
                    </span>
                  </div>
                  <div class="lr-rail__rule" />
                  <p class="lr-rail__label">Latest policy</p>
                  <div class="lr-rail__policy">
                    <span class="lr-rail__policy-icon" aria-hidden="true">
                      <CircleCheck />
                    </span>
                    <div>
                      <strong>Finance baseline</strong>
                      <small>Applied to 42 devices</small>
                    </div>
                  </div>
                  <div class="lr-rail__event">
                    <span>09:41</span>
                    <p>
                      <b>a.okafor</b> published <code>fin-baseline</code>
                    </p>
                  </div>
                  <div class="lr-rail__event">
                    <span>09:38</span>
                    <p>
                      <b>j.lin</b> queued <code>lock</code>
                    </p>
                  </div>
                </aside>
              </div>

              <div class="lr-console__foot">
                <span>
                  <CircleCheck aria-hidden="true" />
                  All systems operational
                </span>
                <span>Last audit export · 09:28</span>
              </div>
            </div>
          </div>
        </div>
        <p class="lr-stage__caption">
          An interactive product preview, built from the same device, policy and audit concepts as
          the app.
        </p>
      </div>
    </section>
  );
}
