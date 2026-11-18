import { Capabilities } from "~/components/landing/capabilities";
import { Closing, Faq, Pricing } from "~/components/landing/convert";
import { Hero } from "~/components/landing/hero";
import { Manifesto } from "~/components/landing/manifesto";
import { Platforms } from "~/components/landing/platforms";
import { Prove } from "~/components/landing/prove";
import { Story } from "~/components/landing/story";
import { Trust } from "~/components/landing/trust";
import { installReveals } from "~/lib/landing-motion";
import "../../landing.css";

export default function Page() {
  installReveals();

  return (
    <main id="main-content" class="lx-page" tabindex="-1">
      <Hero />
      <Manifesto />
      <Story />
      <Prove />
      <Platforms />
      <Capabilities />
      <Trust />
      <Pricing />
      <Faq />
      <Closing />
    </main>
  );
}
