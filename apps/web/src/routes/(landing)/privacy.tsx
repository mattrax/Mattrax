import { Separator } from "~/components/ui/separator";

const LAST_UPDATED = "January 1, 2025";

export default function Page() {
  return (
    <main class="mx-auto max-w-2xl px-8 py-20 w-full">
      <div class="mb-14">
        <p class="text-xs text-stone-400 uppercase tracking-[0.2em] mb-4">Legal</p>
        <h1 class="text-5xl font-light tracking-tight text-stone-900 mb-4">Privacy Policy</h1>
        <p class="text-sm text-stone-400">Last updated {LAST_UPDATED}</p>
      </div>

      <div class="space-y-12">
        <PolicySection title="Information we collect">
          <PolicyParagraph text="**Account information.** When you create an account we collect your email address and, if you choose to provide it, your name. Passwords are hashed using bcrypt before storage — we never store them in plain text." />
          <PolicyParagraph text="**Usage data.** We log the API calls your client makes (method, timestamp, response code) so we can debug issues and monitor reliability." />
          <PolicyParagraph text="**Device metadata.** The managed device agents send OS version and app version on enrollment and update. This lets us ensure compatibility and security." />
        </PolicySection>
        <PolicySection title="How we use your information" withSeparator>
          <PolicyParagraph text="To provide, maintain, and improve Mattrax." />
          <PolicyParagraph text="To send transactional emails — account confirmation, password reset, subscription receipts. We do not send marketing email without your explicit opt-in." />
          <PolicyParagraph text="To detect and prevent abuse, fraud, and security incidents." />
          <PolicyParagraph text="To comply with legal obligations." />
        </PolicySection>
        <PolicySection title="Data storage and security" withSeparator>
          <PolicyParagraph text="Your data is stored encrypted at rest (AES-256). In-transit data is protected by TLS 1.3." />
          <PolicyParagraph text="Access to production systems is restricted to a small number of engineers, requires MFA, and is logged. We conduct periodic access reviews." />
          <PolicyParagraph text="We retain account data for as long as your account is active, plus 90 days after deletion to allow recovery. Anonymised aggregate metrics are retained indefinitely." />
        </PolicySection>
        <PolicySection title="Third parties" withSeparator>
          <PolicyParagraph text="**Cloudflare** — CDN, DNS, and DDoS mitigation. Traffic passes through Cloudflare's network." />
          <PolicyParagraph text="We do not sell your personal data to any third party, ever." />
        </PolicySection>
        <PolicySection title="Your rights" withSeparator>
          <PolicyParagraph text="You may request a copy of the personal data we hold about you, ask us to correct inaccuracies, or ask us to delete your account and associated data. To exercise any of these rights, email us at support@mattrax.io." />
          <PolicyParagraph text="If you are in the EEA, UK, or Switzerland, you have additional rights under GDPR and equivalent legislation, including the right to lodge a complaint with your local supervisory authority." />
        </PolicySection>
        <PolicySection title="Cookies" withSeparator>
          <PolicyParagraph text="The web dashboard uses a single session cookie to keep you logged in. We do not use third-party tracking cookies or analytics SDKs." />
        </PolicySection>
        <PolicySection title="Changes to this policy" withSeparator>
          <PolicyParagraph text="We will post changes to this page and update the date at the top. For material changes we will notify you by email at least 30 days before they take effect." />
        </PolicySection>
        <PolicySection title="Contact" withSeparator>
          <PolicyParagraph text="Questions or requests: hello@mattrax.io. We aim to respond within five business days." />
        </PolicySection>
      </div>
    </main>
  );
}

function PolicySection(props: { title: string; withSeparator?: boolean; children: any }) {
  return (
    <div>
      {props.withSeparator && <Separator class="bg-stone-100 mb-12" />}
      <h2 class="text-lg font-semibold text-stone-900 mb-4">{props.title}</h2>
      <ul class="space-y-3">{props.children}</ul>
    </div>
  );
}

function PolicyParagraph(props: { text: string }) {
  return (
    <li class="text-stone-500 text-sm leading-relaxed">
      {props.text
        .split(/\*\*(.+?)\*\*/)
        .map((part, index) =>
          index % 2 === 1 ? <strong class="font-medium text-stone-700">{part}</strong> : part,
        )}
    </li>
  );
}
