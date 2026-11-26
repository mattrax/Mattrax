import { ArrowRight, Check, CircleCheck } from "@mattrax/ui";
import { For, Show, createSignal } from "solid-js";
import { Button } from "~/components/ui/button";
import { LandingEyebrow, LandingLink } from "./primitives";

const proofPoints = [
  "Passkeys and optional TOTP. No password fallback to phish.",
  "Step-up for device commands, token changes, backup downloads and tenant deletion.",
  "Owner, admin, member and auditor roles, enforced server-side.",
  "Audit search, CSV/JSON export, HMAC-signed webhooks and 30-day delivery history.",
  "Scheduled tenant backups with pin, download and in-place restore.",
  "AGPL-3.0 source. Self-host one Node container with MySQL 8.4, or run our cloud.",
];

type Deployment = "cloud" | "self";

export default function Trust() {
  const [deployment, setDeployment] = createSignal<Deployment>("cloud");

  return (
    <section id="security" class="lr-trust" aria-labelledby="security-title">
      <div class="lr-shell">
        <div class="lr-trust__grid">
          <div class="lr-trust__copy lr-reveal" data-reveal="pending">
            <LandingEyebrow>Trust and deployment</LandingEyebrow>
            <h2 id="security-title">Security you can inspect.</h2>
            <p>
              We don't claim certifications we don't hold. Security review starts with what is
              implemented, what is tested, and where the limits are.
            </p>
            <Button
              as="a"
              href="mailto:hello@mattrax.app?subject=Mattrax%20security%20review"
              variant="outline"
              size="lg"
            >
              Talk to us about your review
              <ArrowRight aria-hidden="true" />
            </Button>
          </div>

          <ul class="lr-trust__list lr-reveal" data-reveal="pending">
            <For each={proofPoints}>
              {(point, index) => (
                <li class="lr-stagger" style={{ "--i": index() }}>
                  <span aria-hidden="true">
                    <Check />
                  </span>
                  {point}
                </li>
              )}
            </For>
          </ul>
        </div>

        <div class="lr-deploy lr-reveal" data-reveal="pending">
          <div class="lr-deploy__head">
            <div>
              <p class="lr-deploy__eyebrow">Deployment</p>
              <h3>Your cloud or ours. Same product.</h3>
            </div>
            <div class="lr-deploy__switch" role="group" aria-label="Deployment model">
              <Button
                type="button"
                variant="ghost"
                size="sm"
                aria-pressed={deployment() === "cloud" ? "true" : "false"}
                onClick={() => setDeployment("cloud")}
              >
                Cloud
              </Button>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                aria-pressed={deployment() === "self" ? "true" : "false"}
                onClick={() => setDeployment("self")}
              >
                Self-host
              </Button>
            </div>
          </div>

          <div class="lr-deploy__panel" aria-live="polite">
            <Show when={deployment() === "cloud"}>
              <div class="lr-trace__content">
                <span class="lr-deploy__icon" aria-hidden="true">
                  <CircleCheck />
                </span>
                <div>
                  <h4>Cloud on Cloudflare Workers</h4>
                  <p>
                    Hosted MDM for pilots and small teams. Free during alpha, with the dashboard,
                    REST API, MDM endpoints and webhooks included.
                  </p>
                </div>
                <LandingLink href="/docs/getting-started/alpha">What alpha means</LandingLink>
              </div>
            </Show>
            <Show when={deployment() === "self"}>
              <div class="lr-trace__content">
                <span class="lr-deploy__icon" aria-hidden="true">
                  <CircleCheck />
                </span>
                <div>
                  <h4>Self-host on one Node container</h4>
                  <p>
                    MySQL 8.4 and an HTTPS reverse proxy, with object storage on a local volume.
                    Cloud and self-hosted expose the same product.
                  </p>
                </div>
                <LandingLink href="/docs/operations/self-hosting">Self-hosting guide</LandingLink>
              </div>
            </Show>
          </div>
        </div>
      </div>
    </section>
  );
}
