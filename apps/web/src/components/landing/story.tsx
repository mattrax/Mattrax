import { For, Show } from "solid-js";
import { installStorySteps } from "~/lib/landing-motion";
import { Eyebrow, SectionLink } from "./section-primitives";

const steps = [
  {
    label: "01 · Enroll",
    title: "Give the device an identity.",
    body: "Apple profile links, a tenant-scoped Windows discovery URL, or an Android QR and token. Pre-register serials by CSV so names, groups and owners exist before the device does.",
    micro: "Apple profile · Windows discovery · Android QR/token · CSV pre-registration",
  },
  {
    label: "02 · Enforce",
    title: "Make the policy decision visible.",
    body: "Manual and dynamic groups. Include and exclude assignments. Priority when rules overlap. The resolution trace names the policy that won for each configuration — and the assignment that put it there.",
    micro: "Manual + dynamic groups · Include/exclude · Priority · Per-device trace",
  },
  {
    label: "03 · Prove",
    title: "Leave evidence you can export.",
    body: "Every mutation writes an audit event. Health rolls up FileVault, BitLocker, disk, battery and declaration state. Search it, export it, stream it to a webhook, or read it over the API.",
    micro: "Audit log · CSV/JSON export · HMAC webhooks · Typed REST API",
  },
];

type PolicyState = "out" | "won";

type PolicyCandidate = {
  readonly name: string;
  readonly meta: string;
  readonly state: PolicyState;
};

const policies: readonly PolicyCandidate[] = [
  { name: "All devices", meta: "Default assignment · priority 20", state: "out" },
  { name: "Finance", meta: "Dynamic group · priority 30", state: "out" },
  { name: "Contractors", meta: "Excluded from this assignment", state: "out" },
  {
    name: "Finance baseline",
    meta: "Direct assignment · group Finance · priority 40",
    state: "won",
  },
];

export default function Story() {
  installStorySteps();

  return (
    <section id="product" class="lx-story" data-step="0" aria-labelledby="story-title">
      <div class="lx-story__track">
        <div class="lx-story__pin">
          <div class="lx-shell lx-story__inner">
            <div>
              <div class="lx-story__intro">
                <Eyebrow>How it works</Eyebrow>
                <h2 id="story-title" class="lx-h2">
                  Enroll. Enforce. Prove.
                </h2>
                <p class="lx-lead">
                  One device record carries the whole story. Each step leaves evidence for the next.
                </p>
                <SectionLink class="lx-story__link" href="/docs/getting-started/concepts">
                  See the core concepts
                </SectionLink>
              </div>

              <div class="lx-spine">
                <p class="label-caps">Device record · sample</p>
                <p class="lx-spine__name">Finance Laptop</p>
                <p class="lx-spine__meta">Windows 11 · 23H2 · SN 7GQ-2214</p>
                <ol class="lx-spine__evidence">
                  <li>
                    <b>Identity</b>
                    <span>WSTEP · 09:41</span>
                  </li>
                  <li>
                    <b>Policy</b>
                    <span>4 candidates → 1 winner</span>
                  </li>
                  <li>
                    <b>Audit</b>
                    <span>3 events · exported</span>
                  </li>
                </ol>
              </div>
            </div>

            <div class="lx-steps">
              <For each={steps}>
                {(step, index) => (
                  <article class="lx-step" data-panel={String(index())}>
                    <p class="lx-step__label">{step.label}</p>
                    <h3>{step.title}</h3>
                    <p class="lx-step__body">{step.body}</p>

                    <Show when={index() === 1}>
                      <div class="lx-story__resolution">
                        <div class="lx-story__resolution-head">
                          <span>Sample resolution</span>
                          <span>4 candidates → 1 winner</span>
                        </div>

                        <For each={policies}>
                          {(policy, policyIndex) => (
                            <div
                              class="lx-policy"
                              data-state={policy.state}
                              style={{ "--i": policyIndex() }}
                            >
                              <p class="lx-policy__name">{policy.name}</p>
                              <p class="lx-policy__meta">{policy.meta}</p>
                              <Show when={policy.state === "won"}>
                                <p class="lx-policy__why">
                                  <span>
                                    Priority 40 beats the default 20, and the Finance group matches
                                    this device.
                                  </span>
                                </p>
                              </Show>
                            </div>
                          )}
                        </For>
                      </div>
                    </Show>

                    <p class="lx-step__micro">{step.micro}</p>
                  </article>
                )}
              </For>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
