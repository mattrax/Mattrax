import { For } from "solid-js";
import { Eyebrow } from "./primitives";

const signals = [
  { label: "FileVault", value: 96 },
  { label: "BitLocker", value: 94 },
  { label: "Disk free", value: 22 },
  { label: "Battery health", value: 87 },
  { label: "Declarations applied", value: 100 },
];

const auditEvents = [
  {
    time: "09:41:07",
    actor: "a.okafor",
    action: "policy.publish",
    target: "fin-baseline",
    state: "applied",
  },
  {
    time: "09:38:52",
    actor: "j.lin",
    action: "device.command",
    target: "lock",
    state: "applied",
  },
  {
    time: "09:36:10",
    actor: "s.patel",
    action: "enrollment.complete",
    target: "SN 7GQ-2214",
    state: "verified",
  },
  {
    time: "09:31:44",
    actor: "m.reyes",
    action: "policy.exclude",
    target: "contractors",
    state: "recorded",
  },
  {
    time: "09:28:03",
    actor: "a.okafor",
    action: "audit.export",
    target: "csv · 312 events",
    state: "downloaded",
  },
  {
    time: "09:24:19",
    actor: "j.lin",
    action: "webhook.delivery",
    target: "200 OK",
    state: "delivered",
  },
];

export default function Prove() {
  return (
    <section id="prove" class="lx-section" aria-labelledby="prove-title">
      <div class="lx-shell">
        <Eyebrow>Prove</Eyebrow>
        <h2 id="prove-title" class="lx-h2">
          Leave evidence you can export.
        </h2>

        <div class="dark lx-plate lx-reveal-block" data-reveal="pending">
          <div>
            <div class="lx-plate__head">
              <h3>Health ledger</h3>
              <span class="lx-plate__label">Sample tenant · demo data</span>
            </div>

            <For each={signals}>
              {(signal, index) => (
                <div class="lx-signal" style={{ "--v": signal.value, "--i": index() }}>
                  <span class="lx-signal__label">{signal.label}</span>
                  <span class="lx-signal__value">
                    <span data-count={String(signal.value)}>{signal.value}</span>
                    <small>%</small>
                  </span>
                  <span class="lx-signal__bar" aria-hidden="true">
                    <i />
                  </span>
                </div>
              )}
            </For>

            <div class="lx-plate__checkin">
              <span>Last check-in</span>
              <span>4 min ago</span>
            </div>
          </div>

          <div>
            <div class="lx-plate__head">
              <h3>Audit receipt</h3>
              <span class="lx-plate__label">Sample events</span>
            </div>

            <ol class="lx-audit" aria-label="Sample audit events">
              <For each={auditEvents}>
                {(event, index) => (
                  <li style={{ "--i": index() }}>
                    <time>{event.time}</time>
                    <span class="lx-audit__event">
                      <b>{event.actor}</b> {event.action} <code>{event.target}</code>
                    </span>
                    <span class="lx-audit__state">{event.state}</span>
                  </li>
                )}
              </For>
            </ol>
          </div>
        </div>
      </div>
    </section>
  );
}
