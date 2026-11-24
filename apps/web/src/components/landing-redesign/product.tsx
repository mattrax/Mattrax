import { Check, CircleCheck } from "@mattrax/ui";
import { For, Show, createSignal } from "solid-js";
import { Activity, BookOpen } from "~/components/ui/icons";
import { LandingEyebrow, LandingLink } from "./primitives";

type TraceView = "assignments" | "resolution" | "audit";

const steps = [
  {
    number: "01",
    label: "Enroll",
    title: "Give every device an identity.",
    body: "Apple profile links, Windows discovery or Android QR and token. Pre-register serials so names, groups and owners exist before the device does.",
  },
  {
    number: "02",
    label: "Enforce",
    title: "Make the policy decision visible.",
    body: "Manual and dynamic groups, include/exclude assignments and priority. The resolution trace names the policy that won for each configuration.",
  },
  {
    number: "03",
    label: "Prove",
    title: "Leave evidence you can export.",
    body: "Every mutation writes an audit event. Search it, export it, stream it to a webhook, or read it over the typed REST API.",
  },
];

const candidates = [
  { name: "All devices", detail: "Default assignment · priority 20", state: "Matched" },
  { name: "Finance", detail: "Dynamic group · priority 30", state: "Matched" },
  { name: "Contractors", detail: "Excluded from this assignment", state: "Excluded" },
  { name: "Finance baseline", detail: "Direct assignment · priority 40", state: "Winner" },
];

const auditEvents = [
  { time: "09:41:07", actor: "a.okafor", action: "policy.publish", target: "fin-baseline" },
  { time: "09:38:52", actor: "j.lin", action: "device.command", target: "lock" },
  { time: "09:36:10", actor: "s.patel", action: "enrollment.complete", target: "SN 7GQ-2214" },
  { time: "09:31:44", actor: "m.reyes", action: "policy.exclude", target: "contractors" },
];

const views: ReadonlyArray<{ id: TraceView; label: string }> = [
  { id: "assignments", label: "Assignments" },
  { id: "resolution", label: "Resolution" },
  { id: "audit", label: "Audit trail" },
];

export function Product() {
  const [view, setView] = createSignal<TraceView>("resolution");

  return (
    <section id="product" class="lr-section lr-product" aria-labelledby="product-title">
      <div class="lr-shell">
        <div class="lr-section__head lr-reveal" data-reveal="pending">
          <div>
            <LandingEyebrow>How it works</LandingEyebrow>
            <h2 id="product-title">A device record you can read.</h2>
          </div>
          <p>
            One record carries the whole story. Each step leaves evidence for the next, so a green
            tick is the start of an answer — not the answer itself.
          </p>
        </div>

        <div class="lr-steps lr-reveal" data-reveal="pending">
          <For each={steps}>
            {(step, index) => (
              <article class="lr-step lr-stagger" style={`--i:${index()}`}>
                <div class="lr-step__number">{step.number}</div>
                <p class="lr-step__label">{step.label}</p>
                <h3>{step.title}</h3>
                <p class="lr-step__body">{step.body}</p>
              </article>
            )}
          </For>
        </div>

        <div class="lr-trace lr-reveal" data-reveal="pending">
          <div class="lr-trace__bar">
            <div class="lr-trace__identity">
              <span class="lr-trace__device" aria-hidden="true">
                Win
              </span>
              <div>
                <strong>Finance Laptop</strong>
                <small>Windows 11 · 23H2 · SN 7GQ-2214</small>
              </div>
            </div>
            <div class="lr-trace__views" role="group" aria-label="Policy trace view">
              <For each={views}>
                {(item) => (
                  <button
                    type="button"
                    aria-pressed={view() === item.id ? "true" : "false"}
                    onClick={() => setView(item.id)}
                  >
                    {item.label}
                  </button>
                )}
              </For>
            </div>
          </div>

          <div class="lr-trace__body" aria-live="polite">
            <Show when={view() === "assignments"}>
              <div class="lr-trace__content">
                <div class="lr-trace__content-head">
                  <div>
                    <p class="lr-trace__eyebrow">Policy candidates</p>
                    <h3>Four assignments touched this device.</h3>
                  </div>
                  <span class="lr-trace__count">4 candidates</span>
                </div>
                <div class="lr-candidates">
                  <For each={candidates}>
                    {(candidate) => (
                      <div class="lr-candidate">
                        <span
                          class={`lr-candidate__mark ${candidate.state === "Winner" ? "is-winner" : ""}`}
                          aria-hidden="true"
                        >
                          {candidate.state === "Winner" ? (
                            <Check />
                          ) : candidate.state === "Excluded" ? (
                            "—"
                          ) : (
                            <CircleCheck />
                          )}
                        </span>
                        <div>
                          <strong>{candidate.name}</strong>
                          <small>{candidate.detail}</small>
                        </div>
                        <span class="lr-candidate__state">{candidate.state}</span>
                      </div>
                    )}
                  </For>
                </div>
              </div>
            </Show>

            <Show when={view() === "resolution"}>
              <div class="lr-trace__content">
                <div class="lr-trace__content-head">
                  <div>
                    <p class="lr-trace__eyebrow">Resolution trace</p>
                    <h3>One winner, with the reason attached.</h3>
                  </div>
                  <span class="lr-trace__count">4 → 1</span>
                </div>
                <div class="lr-resolution">
                  <div class="lr-resolution__path" aria-hidden="true">
                    <span>All devices</span>
                    <i />
                    <span>Finance</span>
                    <i />
                    <span class="is-winner">Finance baseline</span>
                  </div>
                  <div class="lr-resolution__winner">
                    <span class="lr-resolution__check" aria-hidden="true">
                      <Check />
                    </span>
                    <div>
                      <p>Winning policy</p>
                      <h4>Finance baseline</h4>
                      <span>Direct assignment · group Finance · priority 40</span>
                    </div>
                    <span class="lr-resolution__badge">Applied</span>
                  </div>
                  <p class="lr-resolution__why">
                    Priority 40 beats the default 20, and the Finance dynamic group matches this
                    device. Contractors are excluded before priority is considered.
                  </p>
                </div>
              </div>
            </Show>

            <Show when={view() === "audit"}>
              <div class="lr-trace__content">
                <div class="lr-trace__content-head">
                  <div>
                    <p class="lr-trace__eyebrow">Audit trail</p>
                    <h3>Every change leaves a receipt.</h3>
                  </div>
                  <span class="lr-trace__count">Sample events</span>
                </div>
                <ol class="lr-audit-list">
                  <For each={auditEvents}>
                    {(event) => (
                      <li>
                        <Activity aria-hidden="true" />
                        <time>{event.time}</time>
                        <p>
                          <strong>{event.actor}</strong> {event.action} <code>{event.target}</code>
                        </p>
                        <span>
                          <CircleCheck aria-hidden="true" />
                          Recorded
                        </span>
                      </li>
                    )}
                  </For>
                </ol>
              </div>
            </Show>
          </div>

          <div class="lr-trace__foot">
            <span>
              <BookOpen aria-hidden="true" />
              Sample data · nothing is sent to a device
            </span>
            <LandingLink href="/docs/getting-started/concepts">See the core concepts</LandingLink>
          </div>
        </div>
      </div>
    </section>
  );
}
