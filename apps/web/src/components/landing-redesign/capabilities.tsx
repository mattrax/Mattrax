import { Check, CircleCheck, TriangleAlert } from "@mattrax/ui";
import { For, Show } from "solid-js";
import { BookOpen } from "~/components/ui/icons";
import { LandingEyebrow, LandingLink } from "./primitives";

const capabilities = [
  {
    number: "01",
    title: "Enrollment that fits the fleet",
    body: "One link per platform, CSV pre-registration, per-platform toggles and a device cap.",
    visual: "enroll",
  },
  {
    number: "02",
    title: "Policy with a trace",
    body: "Include/exclude assignments and priority, resolved per device and explained in plain language.",
    visual: "policy",
  },
  {
    number: "03",
    title: "Groups that keep up",
    body: "Manual membership, or dynamic rules over platform, OS, model, serial, tag, staleness and health.",
    visual: "groups",
  },
  {
    number: "04",
    title: "Health you can act on",
    body: "FileVault, BitLocker, disk, battery, last-seen and declaration failures in one signal.",
    visual: "health",
  },
  {
    number: "05",
    title: "Remote actions with a brake",
    body: "Sync, lock, wipe, restart, passcode clear, security info and app inventory; step-up for destructive commands.",
    visual: "actions",
  },
  {
    number: "06",
    title: "Automation and evidence",
    body: "Typed REST API, OpenAPI, CLI, scoped tokens, HMAC webhooks and CSV/JSON audit export.",
    visual: "audit",
  },
];

const healthSignals = [
  { label: "FileVault", value: 96 },
  { label: "BitLocker", value: 94 },
  { label: "Disk free", value: 22 },
  { label: "Battery health", value: 87 },
];

export function Capabilities() {
  return (
    <section
      id="capabilities"
      class="lr-section lr-capabilities"
      aria-labelledby="capabilities-title"
    >
      <div class="lr-shell">
        <div class="lr-section__head lr-reveal" data-reveal="pending">
          <div>
            <LandingEyebrow>Capabilities</LandingEyebrow>
            <h2 id="capabilities-title">The unglamorous parts, done properly.</h2>
          </div>
          <p>
            No single feature wins an MDM evaluation. The join between enrollment, policy, health
            and evidence does.
          </p>
        </div>

        <div class="lr-cap-grid lr-reveal" data-reveal="pending">
          <For each={capabilities}>
            {(capability, index) => (
              <article
                class={`lr-cap-card lr-cap-card--${capability.visual} lr-stagger`}
                style={`--i:${index()}`}
              >
                <div class="lr-cap-card__copy">
                  <span class="lr-cap-card__number">{capability.number}</span>
                  <h3>{capability.title}</h3>
                  <p>{capability.body}</p>
                </div>
                <CapabilityVisual kind={capability.visual} />
              </article>
            )}
          </For>
        </div>

        <div class="lr-section__link lr-reveal" data-reveal="pending">
          <LandingLink href="/docs/manage/devices">Read the product docs</LandingLink>
        </div>
      </div>
    </section>
  );
}

function CapabilityVisual(props: { kind: string }) {
  return (
    <div class={`lr-cap-visual lr-cap-visual--${props.kind}`} aria-hidden="true">
      <ShowVisual kind={props.kind} />
    </div>
  );
}

function ShowVisual(props: { kind: string }) {
  return (
    <>
      <Show when={props.kind === "enroll"}>
        <div class="lr-mini-enroll">
          <span>Mac</span>
          <i />
          <span>Win</span>
          <i />
          <span>And</span>
          <div>
            <CircleCheck />
            <b>128 devices enrolled</b>
          </div>
        </div>
      </Show>
      <Show when={props.kind === "policy"}>
        <div class="lr-mini-policy">
          <span>
            All devices <small>priority 20</small>
          </span>
          <span>
            Finance <small>priority 30</small>
          </span>
          <span class="is-winner">
            <Check /> Finance baseline <small>priority 40</small>
          </span>
        </div>
      </Show>
      <Show when={props.kind === "groups"}>
        <div class="lr-mini-groups">
          <span>
            <i />
            Platform is macOS
          </span>
          <span>
            <i />
            Disk free &gt; 20 GB
          </span>
          <span>
            <i />
            Last seen &lt; 24 hours
          </span>
          <b>Dynamic group · 42 devices</b>
        </div>
      </Show>
      <Show when={props.kind === "health"}>
        <div class="lr-mini-health">
          <For each={healthSignals}>
            {(signal) => (
              <div>
                <span>{signal.label}</span>
                <i>
                  <b style={`--value:${signal.value}%`} />
                </i>
                <strong>{signal.value}%</strong>
              </div>
            )}
          </For>
        </div>
      </Show>
      <Show when={props.kind === "actions"}>
        <div class="lr-mini-actions">
          <span>
            <CircleCheck /> Sync queued
          </span>
          <span>
            <CircleCheck /> Restart queued
          </span>
          <span class="is-danger">
            <TriangleAlert /> Wipe needs step-up
          </span>
        </div>
      </Show>
      <Show when={props.kind === "audit"}>
        <div class="lr-mini-audit">
          <div>
            <BookOpen />
            <span>audit.export</span>
            <small>312 events</small>
          </div>
          <code>GET /v1/audit/events</code>
          <span>
            <CircleCheck /> HMAC webhook delivered
          </span>
        </div>
      </Show>
    </>
  );
}
