import { For } from "solid-js";
import { Eyebrow, SectionLink } from "./section-primitives";

const platforms = [
  {
    name: "Apple",
    tag: "macOS · iOS · iPadOS",
    body: "Native Apple device management: signed enrollment profiles, APNs, ABM/ADE assignment, Apps & Books and DDM declarations, with legacy profiles where DDM\u00a0stops.",
    href: "/docs/platforms/apple/",
  },
  {
    name: "Windows",
    tag: "Windows 10 · 11",
    body: "Native Windows device management: WSTEP enrollment, SyncML OMA-URI policy, Autopilot profiles and Entra ID. Devices poll; there is no push channel.",
    href: "/docs/platforms/windows/",
  },
  {
    name: "Android",
    tag: "Android Enterprise · Preview",
    body: "Android Enterprise management through AMAPI: signup, QR or token enrollment, policy delivery and commands.",
    href: "/docs/platforms/android/",
  },
];

export default function Platforms() {
  return (
    <section id="platforms" class="lx-section lx-platforms" aria-labelledby="platforms-title">
      <div class="lx-shell">
        <div class="lx-platforms__head">
          <div>
            <Eyebrow>Platforms</Eyebrow>
            <h2 id="platforms-title" class="lx-h2">
              Native on each platform. Specific about the limits.
            </h2>
          </div>
          <p class="lx-lead lx-platforms__lead">
            No lowest-common-denominator agent. Each platform keeps its own enrollment, policy and
            inventory model, behind one API and one audit trail.
          </p>
        </div>

        <div class="lx-cards3">
          <For each={platforms}>
            {(platform) => (
              <a href={platform.href} target="_self" class="lx-platform">
                <h3>{platform.name}</h3>
                <span class="lx-platform__tag">{platform.tag}</span>
                <p class="lx-platform__body">{platform.body}</p>
                <span class="lx-platform__link">
                  Platform docs
                  <span aria-hidden="true">→</span>
                </span>
              </a>
            )}
          </For>
        </div>

        <p class="lx-platforms__preview">
          <b>Preview note.</b> Android is implemented and fixture-tested, but has not been validated
          against real managed devices in this repository. Pilot before production.
        </p>

        <SectionLink class="lx-platforms__link" href="/docs/getting-started/#platform-support">
          See the full platform support table
        </SectionLink>
      </div>
    </section>
  );
}
