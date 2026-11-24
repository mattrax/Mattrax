import { ArrowRight, CircleCheck } from "@mattrax/ui";
import { For } from "solid-js";
import { LandingEyebrow } from "./primitives";

const platforms = [
  {
    name: "Apple",
    glyph: "A",
    tag: "macOS · iOS · iPadOS",
    body: "Signed enrollment profiles, APNs, ABM/ADE assignment, Apps & Books and DDM declarations — with legacy profiles where DDM stops.",
    href: "/docs/platforms/apple/",
    meta: "Native protocols",
  },
  {
    name: "Windows",
    glyph: "W",
    tag: "Windows 10 · 11",
    body: "WSTEP enrollment, SyncML OMA-URI policy, Autopilot profiles and Entra ID. Devices poll; there is no push channel.",
    href: "/docs/platforms/windows/",
    meta: "Native protocols",
  },
  {
    name: "Android",
    glyph: "A",
    tag: "Android Enterprise · Preview",
    body: "Android Enterprise management through AMAPI: signup, QR or token enrollment, policy delivery and commands.",
    href: "/docs/platforms/android/",
    meta: "Pilot before production",
  },
];

export function Platforms() {
  return (
    <section id="platforms" class="lr-section lr-platforms" aria-labelledby="platforms-title">
      <div class="lr-shell">
        <div class="lr-section__head lr-reveal" data-reveal="pending">
          <div>
            <LandingEyebrow>One control plane</LandingEyebrow>
            <h2 id="platforms-title">Native on every platform.</h2>
          </div>
          <p>
            No lowest-common-denominator agent. Each platform keeps its own enrollment, policy and
            inventory model, behind one API and one audit trail.
          </p>
        </div>

        <div class="lr-platform-grid lr-reveal" data-reveal="pending">
          <For each={platforms}>
            {(platform, index) => (
              <a
                href={platform.href}
                target="_self"
                class="lr-platform-card lr-stagger"
                style={`--i:${index()}`}
              >
                <div class="lr-platform-card__top">
                  <span class="lr-platform-card__glyph" aria-hidden="true">
                    {platform.glyph}
                  </span>
                  <span class="lr-platform-card__meta">{platform.meta}</span>
                </div>
                <h3>{platform.name}</h3>
                <p class="lr-platform-card__tag">{platform.tag}</p>
                <p class="lr-platform-card__body">{platform.body}</p>
                <span class="lr-platform-card__link">
                  Platform docs
                  <ArrowRight aria-hidden="true" />
                </span>
              </a>
            )}
          </For>
        </div>

        <div class="lr-preview-note lr-reveal" data-reveal="pending">
          <CircleCheck aria-hidden="true" />
          <p>
            <strong>Preview note.</strong> Android is implemented and fixture-tested, but has not
            been validated against real managed devices in this repository. Pilot before production.
          </p>
        </div>
      </div>
    </section>
  );
}
