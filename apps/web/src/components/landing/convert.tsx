import { ArrowRight, Check, ChevronDown } from "@mattrax/ui";
import { For, Show } from "solid-js";
import { Button } from "@mattrax/ui";
import { authClient } from "~/lib/auth";
import { publicPrimaryCta } from "~/lib/public-auth-cta";
import { faqStructuredData } from "~/lib/site";
import { Eyebrow, NoJsStartFree } from "./section-primitives";

type PricePlan = {
  readonly name: string;
  readonly price: string;
  readonly suffix?: string;
  readonly body: string;
  readonly features: readonly string[];
  readonly cta: string;
  readonly href: string;
  readonly secondary?: boolean;
};

const plans: readonly PricePlan[] = [
  {
    name: "Cloud",
    price: "Free",
    suffix: "during alpha",
    body: "Hosted MDM for pilots and small teams.",
    features: [
      "Free plan for pilots",
      "Apple, Windows and Android",
      "Dashboard, REST API and webhooks",
      "Community support",
    ],
    cta: "Start free",
    href: "/register",
  },
  {
    name: "Enterprise",
    price: "Custom",
    body: "For procurement, security review and larger fleets.",
    features: [
      "Security review support",
      "Migration planning",
      "Priority support",
      "Self-hosted licensing",
    ],
    cta: "Contact us",
    href: "mailto:hello@mattrax.app?subject=Mattrax%20Enterprise",
    secondary: true,
  },
];

export function Pricing() {
  const session = authClient.useSession();
  const signedIn = () => Boolean(session().data?.user);
  const action = (plan: PricePlan) =>
    plan.href === "/register"
      ? publicPrimaryCta(session().isPending, signedIn())
      : { label: plan.cta, href: plan.href };

  return (
    <section id="pricing" class="lx-section" aria-labelledby="pricing-title">
      <div class="lx-shell">
        <Eyebrow>Pricing</Eyebrow>
        <h2 id="pricing-title" class="lx-h2">
          Free during alpha. Custom when procurement arrives.
        </h2>
        <p class="lx-lead">
          Cloud includes the dashboard, REST API, MDM endpoints and webhooks for Apple, Windows and
          Android.
        </p>

        <div class="lx-price-grid">
          <For each={plans}>
            {(plan) => (
              <div class="lx-price">
                <p class="lx-price__name">{plan.name}</p>
                <p class="lx-price__amount">
                  <strong>{plan.price}</strong>
                  <Show when={plan.suffix}>
                    <span>{plan.suffix}</span>
                  </Show>
                </p>
                <p class="lx-price__body">{plan.body}</p>

                <ul>
                  <For each={plan.features}>
                    {(feature) => (
                      <li>
                        <Check class="size-3" aria-hidden="true" />
                        {feature}
                      </li>
                    )}
                  </For>
                </ul>

                <div class="lx-button-slot">
                  <Show
                    when={action(plan)}
                    fallback={
                      <div
                        data-js-pending
                        class="h-9 w-full animate-pulse rounded-lg bg-hover"
                        aria-hidden="true"
                      />
                    }
                  >
                    {(value) => (
                      <Button
                        as="a"
                        href={value().href}
                        variant={plan.secondary ? "outline" : "default"}
                        class="w-full"
                      >
                        {value().label}
                      </Button>
                    )}
                  </Show>
                  <Show when={plan.href === "/register"}>
                    <NoJsStartFree class="w-full" />
                  </Show>
                </div>
              </div>
            )}
          </For>
        </div>

        <p class="lx-price__micro">
          Self-hosted deployments are licensed per enrolled device. Migration guides live in the{" "}
          <a href="/docs/migration/" target="_self">
            docs
          </a>
          .
        </p>

        <p class="lx-price__micro">
          Alpha means best-effort support, nightly backups with up to a day of potential loss, and
          APIs that can still change. Read{" "}
          <a href="/docs/getting-started/alpha" target="_self">
            what alpha means
          </a>{" "}
          before you rely on it for production.
        </p>
      </div>
    </section>
  );
}

type FaqItem = {
  readonly question: string;
  readonly answer: string;
  readonly link?: { readonly href: string; readonly label: string };
};

export const FAQ_ITEMS: readonly FaqItem[] = [
  {
    question: "Do devices have to re-enroll to move from Jamf, Intune, Kandji, Mosyle or Addigy?",
    answer:
      "Yes. MDM identity is bound to the previous vendor, so devices enroll again: Apple through ABM reassignment, Windows through Autopilot or a fresh enrollment, Android after a factory reset. It is a re-enrollment project, not a data import. The migration guides cover what can be preserved, coexistence and a ring-based cutover.",
    link: { href: "/docs/migration/", label: "Migration guides" },
  },
  {
    question: "Does Mattrax replace Intune compliance or Conditional Access?",
    answer:
      "No. Mattrax derives device health from enrollment state, declaration failures, disk pressure, FileVault and battery condition. It is not a compliance policy engine and does not integrate with Conditional Access. If access depends on Intune compliance, keep Intune for that decision.",
  },
  {
    question: "Is Android ready for production?",
    answer:
      "Not yet. Android Enterprise is implemented, but signup, Pub/Sub, enrollment, policy convergence and commands have not been validated against real managed devices in this repository. Treat it as preview and pilot before production.",
    link: { href: "/docs/platforms/android/", label: "Android platform docs" },
  },
  {
    question: "Can we self-host it?",
    answer:
      "Yes. One Node container, MySQL 8.4 and an HTTPS reverse proxy. Object storage is a local volume, so back up the database and that volume. Cloud and self-hosted run the same product; the source is AGPL-3.0.",
    link: { href: "/docs/operations/self-hosting", label: "Self-hosting guide" },
  },
  {
    question: "How does SSO and user provisioning work?",
    answer:
      "Entra ID OIDC for single sign-on, with SCIM 2.0 and Entra directory sync for users and groups. SAML is not implemented. Passkeys are the primary credential; a tenant can require MFA for every role, including read-only.",
  },
  {
    question: "How do we know what is actually validated?",
    answer:
      "The production readiness page separates implemented and hardened from fixture-tested and not yet validated on real hardware. It is a status page, not a sales page.",
    link: {
      href: "/docs/reference/production-readiness",
      label: "Production readiness",
    },
  },
];

const faqJson = JSON.stringify(faqStructuredData(FAQ_ITEMS)).replaceAll("<", String.raw`\u003c`);

export function Faq() {
  return (
    <section id="faq" class="lx-section lx-faq" aria-labelledby="faq-title">
      <div class="lx-shell">
        <div class="lx-faq__grid">
          <div>
            <Eyebrow>Questions</Eyebrow>
            <h2 id="faq-title" class="lx-h2">
              The honest answers.
            </h2>
            <p class="lx-lead">
              If something is preview or not implemented, the docs say so. The same applies here.
              Migration detail lives in the docs, not on this page.
            </p>
          </div>

          <div class="lx-faq__list">
            <For each={FAQ_ITEMS}>
              {(item) => (
                <details>
                  <summary>
                    {item.question}
                    <span class="disclosure-chevron"><ChevronDown class="size-3.5" aria-hidden="true" /></span>
                  </summary>
                  <div class="lx-faq__answer">
                    <p>{item.answer}</p>
                    <Show when={item.link}>
                      {(link) => (
                        <p>
                          <a href={link().href} target="_self">
                            {link().label}
                          </a>
                        </p>
                      )}
                    </Show>
                  </div>
                </details>
              )}
            </For>
          </div>
        </div>

        <script type="application/ld+json">{faqJson}</script>
      </div>
    </section>
  );
}

export function Closing() {
  const session = authClient.useSession();
  const signedIn = () => Boolean(session().data?.user);
  const cta = () => publicPrimaryCta(session().isPending, signedIn());

  return (
    <section class="lx-closing" aria-labelledby="closing-title">
      <div class="lx-shell">
        <div class="lx-closing__panel">
          <Eyebrow>Get started</Eyebrow>
          <h2 id="closing-title" class="lx-h2">
            A fleet you can explain.
          </h2>
          <p class="lx-closing__lead">
            Create a tenant, enroll one device and deploy a baseline policy. Free during alpha,
            cloud or self-hosted. Bring the compliance, migration and security questions — we'll
            answer them directly.
          </p>

          <div class="lx-closing__actions">
            <Show
              when={cta()}
              fallback={
                <div
                  data-js-pending
                  class="h-10 w-32 animate-pulse rounded-lg bg-secondary"
                  aria-hidden="true"
                />
              }
            >
              {(action) => (
                <Button as="a" href={action().href} size="lg" class="h-10">
                  {action().label}
                  <ArrowRight class="size-3.5" />
                </Button>
              )}
            </Show>
            <NoJsStartFree />
            <Button
              as="a"
              href="mailto:hello@mattrax.app?subject=Mattrax%20for%20our%20fleet"
              variant="outline"
              size="lg"
              class="h-10"
            >
              Talk to us
            </Button>
            <a href="/docs/" target="_self" class="lx-link">
              Read the docs
            </a>
          </div>

          <p class="lx-closing__note">
            <a href="/docs/migration/" target="_self">
              Migration guides
            </a>{" "}
            ·{" "}
            <a href="/docs/reference/production-readiness" target="_self">
              Production readiness
            </a>
          </p>
        </div>
      </div>
    </section>
  );
}
