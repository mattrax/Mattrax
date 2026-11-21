import { For, Show, createSignal } from "solid-js";
import { Badge } from "~/components/ui/badge";
import { installHoldProgress } from "~/lib/landing-motion";
import { Eyebrow, SectionLink } from "./primitives";

const capabilities = [
  {
    title: "Enrollment that fits the fleet",
    body: "One link per platform, CSV pre-registration, per-platform toggles and a device cap.",
  },
  {
    title: "Policy with a trace",
    body: "Include/exclude assignments and priority, resolved per device and explained in plain language.",
  },
  {
    title: "Groups that keep up",
    body: "Manual membership, or dynamic rules over platform, OS, model, serial, tag, staleness and health.",
  },
  {
    title: "Health you can act on",
    body: "FileVault, BitLocker, disk, battery, last-seen and declaration failures in one signal.",
  },
  {
    title: "Remote actions with a brake",
    body: "Sync, lock, wipe, restart, passcode clear, security info and app inventory; step-up for destructive commands.",
  },
  {
    title: "Apps from one catalogue",
    body: "VPP/Apps & Books, MSI and Managed Google Play, with the right installer selected per device.",
  },
  {
    title: "Access that matches the job",
    body: "Owner, admin, member and auditor roles; Entra ID SSO, SCIM 2.0 and directory sync.",
  },
  {
    title: "Automation and evidence",
    body: "Typed REST API, OpenAPI, CLI, scoped tokens, HMAC webhooks and CSV/JSON audit export.",
  },
];

const routineActions = ["Sync", "Lock", "Restart"];

type LogEntry = {
  readonly id: number;
  readonly time: string;
  readonly action: string;
  readonly status: string;
};

function clockTime(): string {
  return new Date().toLocaleTimeString("en-GB", {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  });
}

export function Capabilities() {
  return (
    <section id="capabilities" class="lx-section" aria-labelledby="capabilities-title">
      <div class="lx-shell">
        <Eyebrow>Capabilities</Eyebrow>
        <h2 id="capabilities-title" class="lx-h2">
          The unglamorous parts, done properly.
        </h2>
        <p class="lx-lead">No single feature wins an MDM evaluation. The join between them does.</p>

        <ol class="lx-caps">
          <For each={capabilities}>
            {(capability, index) => (
              <li class="lx-cap">
                <span class="lx-cap__n">{String(index() + 1).padStart(2, "0")}</span>
                <div>
                  <h3>{capability.title}</h3>
                  <p>{capability.body}</p>
                </div>
              </li>
            )}
          </For>
        </ol>

        <SectionLink class="lx-caps__link" href="/docs/manage/devices">
          Read the product docs
        </SectionLink>

        <RemoteActionDemo />
      </div>
    </section>
  );
}

function RemoteActionDemo() {
  const [confirming, setConfirming] = createSignal(false);
  const [log, setLog] = createSignal<LogEntry[]>([], { ownedWrite: true });
  let wipeButton: HTMLButtonElement | undefined;
  let ring: SVGCircleElement | undefined;
  let lastCommit = 0;
  let nextId = 0;

  const pushLog = (action: string, status: string) => {
    nextId += 1;
    setLog((previous) =>
      [{ id: nextId, time: clockTime(), action, status }, ...previous].slice(0, 4),
    );
  };

  installHoldProgress({
    button: () => wipeButton,
    ring: () => ring,
    durationMs: 700,
    onCommit: () => {
      lastCommit = performance.now();
      pushLog("wipe", "queued · step-up verified");
    },
  });

  const requestConfirm = () => {
    if (performance.now() - lastCommit < 600) return;

    setConfirming(true);
  };

  const cancelConfirm = () => {
    setConfirming(false);
    wipeButton?.focus();
  };

  const commitWipe = () => {
    lastCommit = performance.now();
    pushLog("wipe", "queued · step-up verified");
    setConfirming(false);
    wipeButton?.focus();
  };

  return (
    <div class="lx-demo">
      <div class="lx-demo__head">
        <p class="lx-demo__title">
          Remote actions
          <span class="lx-note">Demo data · nothing is sent to a device</span>
        </p>
        <Badge variant="outline" class="lx-demo__badge">
          Sample device
        </Badge>
      </div>

      <div class="lx-demo__body">
        <div class="lx-demo__static">
          <p class="lx-demo__hint">
            Demo data · nothing is sent to a device. Routine actions queue immediately; wiping needs
            a deliberate step-up.
          </p>
          <ul class="lx-demo__static-list">
            <li>
              <b>Sync, Lock, Restart</b> — queued on click.
            </li>
            <li>
              <b>Wipe</b> — step-up required: press and hold, or confirm in two steps.
            </li>
          </ul>
        </div>

        <div class="lx-demo__interactive">
          <p class="lx-demo__hint">
            A sample Windows laptop. Routine actions queue immediately; wiping needs a deliberate
            step-up.
          </p>

          <div class="lx-actions">
            <For each={routineActions}>
              {(action) => (
                <button
                  type="button"
                  class="lx-action"
                  onClick={() => pushLog(action.toLowerCase(), "queued")}
                >
                  {action}
                </button>
              )}
            </For>

            <button
              type="button"
              ref={(element) => {
                wipeButton = element;
              }}
              class="lx-action lx-action--danger"
              aria-describedby="lx-demo-wipe-help"
              onClick={requestConfirm}
            >
              <svg class="lx-ring" viewBox="0 0 24 24" aria-hidden="true">
                <circle class="lx-ring__track" cx="12" cy="12" r="9" />
                <circle
                  ref={(element) => {
                    ring = element;
                  }}
                  class="lx-ring__fill"
                  cx="12"
                  cy="12"
                  r="9"
                />
              </svg>
              Wipe
            </button>
          </div>

          <p id="lx-demo-wipe-help" class="lx-demo__hint">
            Hold Wipe for 0.7 seconds, or press Enter (or click) to confirm in two steps. Escape
            cancels a hold. This is a sample device.
          </p>

          <Show when={confirming()}>
            <div class="lx-confirm">
              <p>Wipe the sample device “Finance Laptop”? This demo records a log line only.</p>
              <button
                type="button"
                class="lx-action lx-action--danger"
                ref={(element) => {
                  queueMicrotask(() => element.focus());
                }}
                onClick={commitWipe}
                onKeyDown={(event) => {
                  if (event.key === "Escape") cancelConfirm();
                }}
              >
                Confirm wipe
              </button>
              <button
                type="button"
                class="lx-action"
                onClick={cancelConfirm}
                onKeyDown={(event) => {
                  if (event.key === "Escape") cancelConfirm();
                }}
              >
                Cancel
              </button>
            </div>
          </Show>

          <ol class="lx-demo__log" aria-live="polite" aria-label="Sample action log">
            <Show
              when={log().length > 0}
              fallback={<li class="lx-demo__empty">No actions yet in this session.</li>}
            >
              <For each={log()}>
                {(entry) => (
                  <li>
                    {entry.time} · {entry.action} · {entry.status}
                  </li>
                )}
              </For>
            </Show>
          </ol>
        </div>
      </div>
    </div>
  );
}
