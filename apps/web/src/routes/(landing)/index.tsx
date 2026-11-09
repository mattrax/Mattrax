import type { JSX } from "@solidjs/web";
import { Button } from "~/components/ui/button";
import { Separator } from "~/components/ui/separator";

export default function Page() {
  return (
    <>
      <section class="pt-24 pb-18 px-8">
        <div class="mx-auto max-w-3xl text-center">
          <p class="text-xs text-stone-400 uppercase tracking-[0.2em] mb-7">
            Mobile device management, reimagined
          </p>
          <h1 class="text-6xl md:text-7xl font-light tracking-tight text-stone-900 leading-[1.02] mb-7">
            Manage every device
            <br />
            from <em class="italic">one</em> place.
          </h1>
          <p class="text-lg text-stone-500 leading-relaxed mb-10 max-w-xl mx-auto">
            Mattrax gives you visibility and control over your Apple and Windows fleet. Enroll,
            configure, and secure devices at scale — hosted, self-hosted, or white-labelled.
          </p>
          <div class="flex flex-wrap justify-center gap-3 mb-12">
            <a href="/register">
              <Button size="lg" class="px-10 h-12 rounded-full">
                Get started free
              </Button>
            </a>
            <a href="/designer">
              <Button
                variant="outline"
                size="lg"
                class="border-stone-300 text-stone-600 hover:bg-stone-100 rounded-full px-10 h-12"
              >
                Design a policy →
              </Button>
            </a>
          </div>
        </div>
      </section>

      <Separator class="bg-stone-200" />

      <section id="designer" class="py-16 px-8">
        <div class="mx-auto max-w-7xl rounded-3xl border bg-white p-8 md:p-10">
          <div class="grid gap-8 lg:grid-cols-[1.1fr_0.9fr] lg:items-center">
            <div>
              <p class="text-xs text-stone-400 uppercase tracking-[0.2em] mb-4">
                Try it without an account
              </p>
              <h2 class="text-4xl font-light tracking-tight text-stone-900 leading-tight">
                Design your first policy
                <br />
                <em class="italic">before</em> you sign up.
              </h2>
              <p class="mt-4 max-w-xl text-stone-500 leading-relaxed">
                Browse Apple, Windows and Android settings, search the same catalogue our dashboard
                uses, and export a ready-to-use profile or SyncML artifact. Sign in only when you
                want to save and deploy it.
              </p>
              <div class="mt-6 flex flex-wrap gap-3">
                <a href="/designer">
                  <Button size="lg" class="rounded-full px-8">
                    Open the policy designer →
                  </Button>
                </a>
                <a href="/docs/quick-start">
                  <Button variant="outline" size="lg" class="rounded-full px-8">
                    See deployment guide
                  </Button>
                </a>
              </div>
            </div>
            <div class="rounded-2xl border bg-stone-50 p-5">
              <div class="flex items-center justify-between text-xs uppercase tracking-wide text-stone-400">
                <span>Available settings</span>
                <span>Updated from vendor sources</span>
              </div>
              <div class="mt-4 grid grid-cols-3 gap-3 text-center">
                <div class="rounded-xl border bg-white p-4">
                  <p class="text-2xl font-semibold text-stone-900">4.3k</p>
                  <p class="mt-1 text-xs text-stone-500">Apple</p>
                </div>
                <div class="rounded-xl border bg-white p-4">
                  <p class="text-2xl font-semibold text-stone-900">15k</p>
                  <p class="mt-1 text-xs text-stone-500">Windows</p>
                </div>
                <div class="rounded-xl border bg-white p-4">
                  <p class="text-2xl font-semibold text-stone-900">340</p>
                  <p class="mt-1 text-xs text-stone-500">Android</p>
                </div>
              </div>
              <ul class="mt-4 space-y-2 text-sm text-stone-600">
                <li>Search by name, key, OMA-URI or payload type.</li>
                <li>Type-aware forms with defaults and descriptions.</li>
                <li>Export mobileconfig, DDM JSON, SyncML or Android policy.</li>
                <li>Sign in to save and deploy it to a Mattrax workspace.</li>
              </ul>
            </div>
          </div>
        </div>
      </section>

      <section id="product" class="py-20 px-8">
        <div class="mx-auto max-w-7xl">
          <div class="mb-14">
            <p class="text-xs text-stone-400 uppercase tracking-[0.2em] mb-4">Product</p>
            <h2 class="text-4xl font-light text-stone-900 tracking-tight max-w-lg leading-snug">
              Everything you need for modern MDM.
            </h2>
          </div>
          <div class="grid md:grid-cols-2 lg:grid-cols-3 gap-5">
            <CapabilityCard
              icon={
                <svg
                  xmlns="http://www.w3.org/2000/svg"
                  width="22"
                  height="22"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  stroke-width="1.5"
                  stroke-linecap="round"
                  stroke-linejoin="round"
                >
                  <rect width="20" height="8" x="2" y="2" rx="2" ry="2" />
                  <rect width="20" height="8" x="2" y="14" rx="2" ry="2" />
                  <line x1="6" x2="6.01" y1="6" y2="6" />
                  <line x1="6" x2="6.01" y1="18" y2="18" />
                </svg>
              }
              title="Apple & Windows"
              desc="Manage macOS, iOS, Windows and iPadOS from one dashboard. Android management is in development."
            />
            <CapabilityCard
              icon={
                <svg
                  xmlns="http://www.w3.org/2000/svg"
                  width="22"
                  height="22"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  stroke-width="1.5"
                  stroke-linecap="round"
                  stroke-linejoin="round"
                >
                  <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10" />
                </svg>
              }
              title="Profile Enrollment"
              desc="Send a single enrollment link. Devices install the management profile and start checking in immediately."
            />
            <CapabilityCard
              icon={
                <svg
                  xmlns="http://www.w3.org/2000/svg"
                  width="22"
                  height="22"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  stroke-width="1.5"
                  stroke-linecap="round"
                  stroke-linejoin="round"
                >
                  <path d="M21 2v6h-6" />
                  <path d="M3 12a9 9 0 0 1 15-6.7L21 8" />
                  <path d="M3 22v-6h6" />
                  <path d="M21 12a9 9 0 0 1-15 6.7L3 16" />
                </svg>
              }
              title="Push-Driven Sync"
              desc="APNs wakes Apple devices as soon as a policy changes, with polling as a reliable fallback."
            />
            <CapabilityCard
              icon={
                <svg
                  xmlns="http://www.w3.org/2000/svg"
                  width="22"
                  height="22"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  stroke-width="1.5"
                  stroke-linecap="round"
                  stroke-linejoin="round"
                >
                  <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10" />
                  <path d="m9 12 2 2 4-4" />
                </svg>
              }
              title="Policy Enforcement"
              desc="Deploy restrictions, certificates, and custom mobileconfig profiles to groups of devices."
            />
            <CapabilityCard
              icon={
                <svg
                  xmlns="http://www.w3.org/2000/svg"
                  width="22"
                  height="22"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  stroke-width="1.5"
                  stroke-linecap="round"
                  stroke-linejoin="round"
                >
                  <circle cx="12" cy="12" r="10" />
                  <path d="M12 16v-4" />
                  <path d="M12 8h.01" />
                </svg>
              }
              title="App Management"
              desc="Upload installers today; remote app deployment is on the roadmap."
              soon
            />
            <CapabilityCard
              icon={
                <svg
                  xmlns="http://www.w3.org/2000/svg"
                  width="22"
                  height="22"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  stroke-width="1.5"
                  stroke-linecap="round"
                  stroke-linejoin="round"
                >
                  <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" />
                  <circle cx="9" cy="7" r="4" />
                  <path d="M23 21v-2a4 4 0 0 0-3-3.87" />
                  <path d="M16 3.13a4 4 0 0 1 0 7.75" />
                </svg>
              }
              title="Team & Roles"
              desc="Invite administrators and scope access per tenant, with API tokens for automation."
            />
          </div>
        </div>
      </section>

      <section class="py-20 px-8 bg-stone-900">
        <div class="mx-auto max-w-7xl">
          <p class="text-xs text-stone-600 uppercase tracking-[0.2em] mb-12">Scale</p>
          <div class="grid md:grid-cols-3 gap-12">
            <ScaleStat
              value="2"
              unit="platforms"
              description="Apple and Windows today; Android in development"
            />
            <ScaleStat
              value="CSR"
              unit="APNs setup"
              description="generate a signing request and upload the certificate"
            />
            <ScaleStat
              value="< 5m"
              unit="to first device"
              description="create a tenant, enroll, and deploy a policy"
            />
          </div>
        </div>
      </section>

      <section id="enterprise" class="py-20 px-8">
        <div class="mx-auto max-w-7xl grid md:grid-cols-2 gap-20 items-start">
          <div>
            <p class="text-xs text-stone-400 uppercase tracking-[0.2em] mb-6">Enterprise</p>
            <h2 class="text-4xl font-light tracking-tight mb-6 leading-snug">
              Built for organizations
              <br />
              that take security seriously
            </h2>
            <p class="text-stone-500 text-sm leading-relaxed mb-8">
              Start on the free tier and grow into SSO, SCIM, audit logs, data residency, and a
              dedicated SLA — same product, same native feel throughout.
            </p>
            <div class="flex gap-3">
              <a href="/register">
                <Button
                  size="lg"
                  class="bg-stone-900 hover:bg-stone-800 text-stone-50 rounded-full px-8"
                >
                  Start free
                </Button>
              </a>
              <a href="mailto:hello@mattrax.app">
                <Button
                  variant="outline"
                  size="lg"
                  class="border-stone-300 text-stone-600 hover:bg-stone-100 rounded-full px-8"
                >
                  Talk to sales
                </Button>
              </a>
            </div>
          </div>
          <div>
            <EnterpriseFeatureRow label="Multi-tenant workspaces" />
            <EnterpriseFeatureRow label="Role-based access control" withSeparator />
            <EnterpriseFeatureRow label="API tokens for automation" withSeparator />
            <EnterpriseFeatureRow label="Self-hosted and whitelabel deployment" withSeparator />
            <EnterpriseFeatureRow label="Open management webhook contract" withSeparator />
            <EnterpriseFeatureRow label="Bring-your-own APNs certificate" withSeparator />
            <EnterpriseFeatureRow label="SSO and SCIM (coming soon)" withSeparator />
            <EnterpriseFeatureRow label="Dedicated SLA & priority support" withSeparator />
          </div>
        </div>
      </section>

      <Separator class="bg-stone-200" />

      <section id="pricing" class="py-20 px-8">
        <div class="mx-auto max-w-7xl">
          <div class="mb-14">
            <p class="text-xs text-stone-400 uppercase tracking-[0.2em] mb-4">Pricing</p>
            <h2 class="text-4xl font-light text-stone-900 tracking-tight leading-snug">
              Simple, predictable pricing.
            </h2>
          </div>
          <div class="grid md:grid-cols-3 gap-5 items-start">
            <div class="rounded-2xl border border-stone-200 bg-white p-8 shadow-sm">
              <p class="text-sm font-medium text-stone-900 mb-1">Free</p>
              <div class="flex items-baseline gap-1 mb-1">
                <span class="text-4xl font-light text-stone-900">$0</span>
                <span class="text-stone-400 text-sm">/ mo</span>
              </div>
              <p class="text-xs text-stone-400 mb-8">For small teams getting started.</p>
              <a href="/register">
                <Button
                  variant="outline"
                  class="w-full rounded-full border-stone-300 text-stone-600 hover:bg-stone-100 mb-8"
                >
                  Get started
                </Button>
              </a>
              <ul class="space-y-3 text-sm text-stone-500">
                <PricingFeatureItem
                  text="Unlimited devices during alpha"
                  iconClass="text-stone-400"
                />
                <PricingFeatureItem text="Core policies" iconClass="text-stone-400" />
                <PricingFeatureItem text="Email support" iconClass="text-stone-400" />
              </ul>
            </div>

            <div class="rounded-2xl border border-stone-900 bg-stone-900 p-8 shadow-sm">
              <div class="flex items-center justify-between mb-1">
                <p class="text-sm font-medium text-stone-50">Pro</p>
                <span class="text-[10px] px-2 py-0.5 rounded-full bg-stone-700 text-stone-300 font-medium">
                  Most popular
                </span>
              </div>
              <div class="flex items-baseline gap-1 mb-1">
                <span class="text-4xl font-light text-stone-50">Alpha</span>
              </div>
              <p class="text-xs text-stone-500 mb-8">
                Advanced management for growing fleets. Billing is not enabled during alpha.
              </p>
              <a href="/register">
                <Button class="w-full rounded-full bg-stone-50 text-stone-900 hover:bg-white mb-8">
                  Get started
                </Button>
              </a>
              <ul class="space-y-3 text-sm text-stone-400">
                <PricingFeatureItem text="Unlimited devices" iconClass="text-stone-500" />
                <PricingFeatureItem text="Advanced policies" iconClass="text-stone-500" />
                <PricingFeatureItem text="App management" iconClass="text-stone-500" />
                <PricingFeatureItem text="Priority support" iconClass="text-stone-500" />
              </ul>
            </div>

            <div class="rounded-2xl border border-stone-200 bg-white p-8 shadow-sm">
              <p class="text-sm font-medium text-stone-900 mb-1">Enterprise</p>
              <div class="flex items-baseline gap-1 mb-1">
                <span class="text-4xl font-light text-stone-900">Custom</span>
              </div>
              <p class="text-xs text-stone-400 mb-8">
                For large organizations with advanced requirements.
              </p>
              <a href="mailto:hello@mattrax.app">
                <Button
                  variant="outline"
                  class="w-full rounded-full border-stone-300 text-stone-600 hover:bg-stone-100 mb-8"
                >
                  Contact sales
                </Button>
              </a>
              <ul class="space-y-3 text-sm text-stone-500">
                <PricingFeatureItem text="SSO & SCIM" iconClass="text-stone-400" />
                <PricingFeatureItem text="Audit logs" iconClass="text-stone-400" />
                <PricingFeatureItem text="Data residency" iconClass="text-stone-400" />
                <PricingFeatureItem text="Dedicated support & SLA" iconClass="text-stone-400" />
              </ul>
            </div>
          </div>
        </div>
      </section>

      <Separator class="bg-stone-200" />

      <section class="py-28 px-8">
        <div class="mx-auto max-w-xl text-center">
          <h2 class="text-5xl font-light tracking-tight mb-5 leading-tight">
            Ready to manage
            <br />
            <span class="italic">your fleet?</span>
          </h2>
          <p class="text-stone-500 mb-10">
            Start enrolling devices in under five minutes. Free during alpha.
          </p>
          <div class="flex flex-col sm:flex-row justify-center gap-4">
            <a href="/register">
              <Button
                size="lg"
                class="bg-stone-900 hover:bg-stone-800 text-stone-50 rounded-full px-10 h-12 text-base"
              >
                Get started free
              </Button>
            </a>
            <a href="/dashboard">
              <Button
                variant="outline"
                size="lg"
                class="border-stone-300 text-stone-600 hover:bg-stone-100 rounded-full px-10 h-12 text-base"
              >
                Open Dashboard
              </Button>
            </a>
          </div>
        </div>
      </section>
    </>
  );
}

function CapabilityCard(props: { icon: JSX.Element; title: string; desc: string; soon?: boolean }) {
  return (
    <div
      class={`rounded-2xl border p-7 ${props.soon ? "border-dashed border-stone-200 bg-transparent" : "border-stone-200 bg-white shadow-sm"}`}
    >
      <div class="text-stone-400 mb-4">{props.icon}</div>
      <div class="flex items-center gap-2 mb-2">
        <h3 class="text-base font-semibold text-stone-900">{props.title}</h3>
        {props.soon && (
          <span class="text-[10px] px-2 py-0.5 rounded-full bg-stone-100 text-stone-400 border border-stone-200">
            Soon
          </span>
        )}
      </div>
      <p class="text-stone-500 text-sm leading-relaxed">{props.desc}</p>
    </div>
  );
}

function ScaleStat(props: { value: string; unit: string; description: string }) {
  return (
    <div>
      <div class="text-5xl font-light text-stone-100 mb-2">{props.value}</div>
      <div class="text-stone-400 font-medium mb-2 text-sm">{props.unit}</div>
      <div class="text-xs text-stone-600 leading-relaxed">{props.description}</div>
    </div>
  );
}

function EnterpriseFeatureRow(props: { label: string; withSeparator?: boolean }) {
  return (
    <div>
      {props.withSeparator && <Separator class="bg-stone-100" />}
      <div class="flex items-center justify-between py-3.5">
        <span class="text-stone-600 text-sm">{props.label}</span>
        <svg
          xmlns="http://www.w3.org/2000/svg"
          width="13"
          height="13"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          stroke-width="2"
          stroke-linecap="round"
          stroke-linejoin="round"
          class="text-stone-300 shrink-0"
        >
          <polyline points="20 6 9 17 4 12" />
        </svg>
      </div>
    </div>
  );
}

function PricingFeatureItem(props: { text: string; iconClass: string }) {
  return (
    <li class="flex items-center gap-2.5">
      <svg
        xmlns="http://www.w3.org/2000/svg"
        width="13"
        height="13"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        stroke-width="2.5"
        stroke-linecap="round"
        stroke-linejoin="round"
        class={`${props.iconClass} shrink-0`}
      >
        <polyline points="20 6 9 17 4 12" />
      </svg>
      {props.text}
    </li>
  );
}
