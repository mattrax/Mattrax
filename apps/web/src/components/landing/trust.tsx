import { Check } from "@mattrax/ui";
import { For, createSignal } from "solid-js";
import { Button } from "@mattrax/ui";
import { Eyebrow, SectionLink } from "./section-primitives";

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
  return (
    <section id="security" class="lx-section lx-trust" aria-labelledby="security-title">
      <div class="lx-shell">
        <div class="lx-trust__grid">
          <div>
            <Eyebrow>Trust and deployment</Eyebrow>
            <h2 id="security-title" class="lx-h2">
              No badge you can't verify.
            </h2>
            <p class="lx-lead">
              We don't claim certifications we don't hold. Security review starts with what is
              implemented, what is tested, and where the limits are.
            </p>
            <p class="lx-trust__body">
              Passkeys are the primary credential, with optional authenticator-app MFA. Sensitive
              actions need a fresh step-up. Tenant data is isolated, roles are enforced server-side,
              and API tokens are scoped and can be bound to one tenant. Every mutation is audited.
            </p>

            <div class="lx-trust__actions">
              <Button
                as="a"
                href="mailto:hello@mattrax.app?subject=Mattrax%20security%20review"
                variant="outline"
                size="lg"
              >
                Talk to us about your review
              </Button>
              <SectionLink href="/docs/reference/production-readiness">
                Read the production readiness page
              </SectionLink>
            </div>
          </div>

          <ul class="lx-proof-list">
            <For each={proofPoints}>
              {(point) => (
                <li>
                  <Check class="size-3" aria-hidden="true" />
                  {point}
                </li>
              )}
            </For>
          </ul>
        </div>

        <DeploymentSwitch />
      </div>
    </section>
  );
}

function DeploymentSwitch() {
  const [mode, setMode] = createSignal<Deployment>("cloud");

  return (
    <div class="lx-deploy">
      <div class="lx-deploy__head">
        <div>
          <p class="label-caps">Deployment</p>
          <h3 id="deployment-title" class="lx-h3">
            Your cloud or ours. Same product.
          </h3>
        </div>

        <div class="lx-seg" role="group" aria-label="Deployment model">
          <Button
            type="button"
            variant="ghost"
            size="sm"
            aria-pressed={mode() === "cloud" ? "true" : "false"}
            onClick={() => setMode("cloud")}
          >
            Cloud
          </Button>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            aria-pressed={mode() === "self" ? "true" : "false"}
            onClick={() => setMode("self")}
          >
            Self-host
          </Button>
        </div>
      </div>

      <div class="lx-deploy__panels">
        <div class="lx-deploy__panel" data-on={mode() === "cloud" ? "" : undefined}>
          <p class="lx-deploy__panel-title">Cloud</p>
          <p class="lx-deploy__panel-body">Cloud runs on Cloudflare Workers.</p>
          <p class="lx-deploy__note">
            Free during alpha.{" "}
            <a href="/docs/getting-started/alpha" target="_self">
              What alpha means
            </a>
            .
          </p>
        </div>

        <div class="lx-deploy__panel" data-on={mode() === "self" ? "" : undefined}>
          <p class="lx-deploy__panel-title">Self-host</p>
          <p class="lx-deploy__panel-body">
            Self-hosted runs as one Node container against MySQL, with object storage on a local
            volume.
          </p>
          <p class="lx-deploy__note">Self-hosted deployments are licensed per enrolled device.</p>
        </div>
      </div>

      <p class="lx-deploy__panel-body">
        Both expose the same dashboard, REST API and MDM endpoints.
      </p>
    </div>
  );
}
