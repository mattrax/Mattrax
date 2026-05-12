import { Separator } from "~/components/ui/separator";

const LAST_UPDATED = "January 1, 2025";

export default function Page() {
  return (
    <main class="mx-auto max-w-2xl px-8 py-20 w-full">
      <div class="mb-14">
        <p class="text-xs text-stone-400 uppercase tracking-[0.2em] mb-4">Legal</p>
        <h1 class="text-5xl font-light tracking-tight text-stone-900 mb-4">Terms of Service</h1>
        <p class="text-sm text-stone-400">Last updated {LAST_UPDATED}</p>
      </div>

      <div class="space-y-12">
        <TermsSection title="Acceptance">
          <TermsParagraph text="By creating an account or using any part of the Mattrax service you agree to these Terms of Service. If you are using Mattrax on behalf of an organisation, you represent that you have authority to bind that organisation to these terms." />
        </TermsSection>
        <TermsSection title="The service" withSeparator>
          <TermsParagraph text='Mattrax provides mobile device management, fleet enrollment, policy configuration, and compliance monitoring (the "Service"). We may update, extend, or remove features at any time. Where a change materially reduces the Service we will give you at least 30 days&apos; notice by email.' />
          <TermsParagraph text="The Service is provided for lawful purposes only. You must not use it to manage devices without proper authorisation, or to distribute malicious software." />
        </TermsSection>
        <TermsSection title="Accounts" withSeparator>
          <TermsParagraph text="You are responsible for keeping your credentials secure and for all activity that occurs under your account. Notify us immediately at hello@mattrax.io if you believe your account has been compromised." />
          <TermsParagraph text="You must be at least 16 years old to create an account. Accounts are non-transferable." />
        </TermsSection>
        <TermsSection title="Your data" withSeparator>
          <TermsParagraph text="You retain full ownership of the data and configurations you create with Mattrax. We claim no intellectual property rights over your content." />
          <TermsParagraph text="You grant us a limited, non-exclusive licence to store, replicate, and transmit your data solely for the purpose of providing the Service." />
        </TermsSection>
        <TermsSection title="Acceptable use" withSeparator>
          <TermsParagraph text="You must not: attempt to gain unauthorised access to the Service or another user's data; use the Service to transmit spam or unsolicited bulk communications; engage in any activity that degrades the performance of the Service for other users; reverse-engineer or extract the source code of the Service." />
          <TermsParagraph text="We reserve the right to suspend or terminate accounts that violate this policy without prior notice." />
        </TermsSection>
        <TermsSection title="Payment and billing" withSeparator>
          <TermsParagraph text="Paid plans are billed in advance on a monthly or annual cycle. Prices are shown exclusive of VAT; applicable taxes will be added at checkout." />
          <TermsParagraph text="Subscriptions renew automatically. You may cancel at any time from your account settings — your access continues until the end of the current billing period. We do not offer prorated refunds for partial periods unless required by law." />
          <TermsParagraph text="If a payment fails we will notify you by email and retry. Access may be suspended after three failed attempts." />
        </TermsSection>
        <TermsSection title="Disclaimers and liability" withSeparator>
          <TermsParagraph text='The Service is provided "as is" without warranty of any kind. We do not warrant that it will be uninterrupted, error-free, or that data will never be lost.' />
          <TermsParagraph text="To the maximum extent permitted by law, our total liability to you for any claim arising out of or related to these terms or the Service is limited to the greater of (a) the fees you paid in the 12 months preceding the claim or (b) £100." />
          <TermsParagraph text="We are not liable for indirect, incidental, consequential, or punitive damages, loss of profits, or loss of data." />
        </TermsSection>
        <TermsSection title="Termination" withSeparator>
          <TermsParagraph text="You may delete your account at any time from account settings. We will delete your data within 90 days of account deletion." />
          <TermsParagraph text="We may suspend or terminate your account for violations of these terms, non-payment, or inactivity exceeding 24 months. Where feasible we will give you advance notice and an opportunity to export your data." />
        </TermsSection>
        <TermsSection title="Governing law" withSeparator>
          <TermsParagraph text="These terms are governed by the laws of England and Wales. Any dispute shall be subject to the exclusive jurisdiction of the courts of England and Wales, except where local mandatory consumer protection law requires otherwise." />
        </TermsSection>
        <TermsSection title="Changes" withSeparator>
          <TermsParagraph text="We may update these terms at any time. For material changes we will notify you by email at least 30 days before they take effect. Continued use after that date constitutes acceptance of the revised terms." />
        </TermsSection>
        <TermsSection title="Contact" withSeparator>
          <TermsParagraph text="Questions: hello@mattrax.io" />
        </TermsSection>
      </div>
    </main>
  );
}

function TermsSection(props: { title: string; withSeparator?: boolean; children: any }) {
  return (
    <div>
      {props.withSeparator && <Separator class="bg-stone-100 mb-12" />}
      <h2 class="text-lg font-semibold text-stone-900 mb-4">{props.title}</h2>
      <ul class="space-y-3">{props.children}</ul>
    </div>
  );
}

function TermsParagraph(props: { text: string }) {
  return <li class="text-stone-500 text-sm leading-relaxed">{props.text}</li>;
}
