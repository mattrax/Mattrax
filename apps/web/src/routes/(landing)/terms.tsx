import type { JSX } from "@solidjs/web";

const LAST_UPDATED = "12th May 2026";

export default function Page() {
  return (
    <main class="mx-auto max-w-2xl px-8 py-20 w-full">
      <div class="mb-14">
        <p class="text-xs text-stone-400 uppercase tracking-[0.2em] mb-4">Legal</p>
        <h1 class="text-5xl font-light tracking-tight text-stone-900 mb-4">Terms of Service</h1>
        <p class="text-sm text-stone-400">Last updated {LAST_UPDATED}</p>
      </div>

      <div class="space-y-12">
        <TermsSection title="Overview">
          <TermsParagraph text="These Terms of Service govern your access to and use of our service. By using the service, you agree to these Terms." />
        </TermsSection>
        <TermsSection title="Use of the Service" withSeparator>
          <TermsParagraph text="You may use the service only in compliance with applicable laws and these Terms." />
          <TermsParagraph text="You must not misuse or interfere with the service." />
          <TermsParagraph text="You must not attempt unauthorized access to systems or data." />
          <TermsParagraph text="You are responsible for activity conducted through your account or API credentials." />
        </TermsSection>
        <TermsSection title="Accounts and Billing" withSeparator>
          <TermsParagraph text="Paid features may require a subscription or one-time payment. Billing is handled through third-party payment providers." />
        </TermsSection>
        <TermsSection title="Acceptable Use" withSeparator>
          <TermsParagraph text="You agree not to use the service to violate laws or regulations." />
          <TermsParagraph text="You agree not to transmit malware or malicious code." />
          <TermsParagraph text="You agree not to abuse, disrupt, or overload the service." />
          <TermsParagraph text="You agree not to infringe intellectual property rights." />
          <TermsParagraph text="You agree not to access data or systems without authorization." />
        </TermsSection>
        <TermsSection title="Intellectual Property" withSeparator>
          <TermsParagraph text="The service, including software, branding, and content, is owned by us or our licensors and is protected by applicable intellectual property laws." />
        </TermsSection>
        <TermsSection title="Third-Party Services" withSeparator>
          <TermsParagraph text="The service may integrate with or rely on third-party services. We are not responsible for third-party products, services, or content." />
        </TermsSection>
        <TermsSection title="Disclaimer" withSeparator>
          <TermsParagraph text="The service is provided as is and as available without warranties of any kind, whether express or implied." />
        </TermsSection>
        <TermsSection title="Limitation of Liability" withSeparator>
          <TermsParagraph text="To the maximum extent permitted by law, we are not liable for any indirect, incidental, special, consequential, or punitive damages, including loss of data, profits, or business opportunities." />
        </TermsSection>
        <TermsSection title="Termination" withSeparator>
          <TermsParagraph text="We may suspend or terminate access to the service at any time, including for violations of these Terms." />
        </TermsSection>
        <TermsSection title="Changes to These Terms" withSeparator>
          <TermsParagraph text="We may update these Terms from time to time. Continued use of the service after changes become effective constitutes acceptance of the updated Terms." />
        </TermsSection>
        <TermsSection title="Governing Law" withSeparator>
          <TermsParagraph text="These Terms are governed by the laws applicable in your jurisdiction, without regard to conflict of law principles." />
        </TermsSection>
        <TermsSection title="Contact" withSeparator>
          <TermsParagraph text="If you have questions about these Terms, contact us at hello@mattrax.app." />
        </TermsSection>
      </div>
    </main>
  );
}

function TermsSection(props: { title: string; withSeparator?: boolean; children: JSX.Element }) {
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

function TermsParagraph(props: { text: string }) {
  return <li class="text-stone-500 text-sm leading-relaxed">{props.text}</li>;
}
