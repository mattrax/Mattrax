import type { JSX } from "@solidjs/web";

const LAST_UPDATED = "12th May 2026";

export default function Page() {
  return (
    <main class="mx-auto max-w-2xl px-8 py-20 w-full">
      <div class="mb-14">
        <p class="text-xs text-stone-400 uppercase tracking-[0.2em] mb-4">Legal</p>
        <h1 class="text-5xl font-light tracking-tight text-stone-900 mb-4">Privacy Policy</h1>
        <p class="text-sm text-stone-400">Last updated {LAST_UPDATED}</p>
      </div>

      <div class="space-y-12">
        <PrivacySection title="Overview">
          <PrivacyParagraph text="This Privacy Policy explains how we collect, use, and protect information when you use our service." />
        </PrivacySection>
        <PrivacySection title="Information We Collect" withSeparator>
          <PrivacyParagraph text="Account and billing information" />
          <PrivacyParagraph text="Information you provide directly to us" />
          <PrivacyParagraph text="Technical information such as IP address, browser type, device information, and usage data" />
          <PrivacyParagraph text="API data necessary to provide the service" />
        </PrivacySection>
        <PrivacySection title="How We Use Information" withSeparator>
          <PrivacyParagraph text="Provide and maintain the service" />
          <PrivacyParagraph text="Process payments and manage subscriptions" />
          <PrivacyParagraph text="Improve reliability, security, and performance" />
          <PrivacyParagraph text="Respond to support requests" />
          <PrivacyParagraph text="Prevent abuse and unauthorized access" />
        </PrivacySection>
        <PrivacySection title="Data Storage" withSeparator>
          <PrivacyParagraph text="We store data only for as long as necessary to operate the service and meet legal obligations." />
        </PrivacySection>
        <PrivacySection title="Third-Party Services" withSeparator>
          <PrivacyParagraph text="We may use third-party providers for services such as payment processing, analytics, hosting and infrastructure, and error monitoring." />
          <PrivacyParagraph text="These providers may process data on our behalf." />
        </PrivacySection>
        <PrivacySection title="Security" withSeparator>
          <PrivacyParagraph text="We take reasonable measures to protect your information, but no method of transmission or storage is completely secure." />
        </PrivacySection>
        <PrivacySection title="Your Rights" withSeparator>
          <PrivacyParagraph text="Depending on your location, you may have rights to access your data, request correction or deletion, object to certain processing, and request data export." />
          <PrivacyParagraph text="To make a request, contact us using the information below." />
        </PrivacySection>
        <PrivacySection title="Children's Privacy" withSeparator>
          <PrivacyParagraph text="The service is not intended for children under 13." />
        </PrivacySection>
        <PrivacySection title="Changes to This Policy" withSeparator>
          <PrivacyParagraph text="We may update this Privacy Policy from time to time. Continued use of the service after changes become effective constitutes acceptance of the updated policy." />
        </PrivacySection>
        <PrivacySection title="Contact" withSeparator>
          <PrivacyParagraph text="If you have questions about this Privacy Policy, contact us at hello@mattrax.app." />
        </PrivacySection>
      </div>
    </main>
  );
}

function PrivacySection(props: { title: string; withSeparator?: boolean; children: JSX.Element }) {
  return (
    <div>
      <div
        aria-hidden="true"
        class={props.withSeparator ? "mb-12 h-px w-full bg-stone-100" : "hidden"}
      />
      <h2 class="text-lg font-semibold text-stone-900 mb-4">{props.title}</h2>
      <ul class="space-y-3">{props.children}</ul>
    </div>
  );
}

function PrivacyParagraph(props: { text: string }) {
  return <li class="text-stone-500 text-sm leading-relaxed">{props.text}</li>;
}
