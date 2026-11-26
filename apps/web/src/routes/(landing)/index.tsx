import Capabilities from "~/components/landing-redesign/capabilities";
import Hero from "~/components/landing-redesign/hero";
import Platforms from "~/components/landing-redesign/platforms";
import Product from "~/components/landing-redesign/product";
import Trust from "~/components/landing-redesign/trust";
import { Closing, Faq, Pricing } from "~/components/landing/convert";
import { installReveals } from "~/lib/landing-motion";

export default function Page() {
  installReveals();

  return (
    <main id="main-content" class="lr-page lx-page" tabindex="-1">
      <Hero />
      <Platforms />
      <Product />
      <Capabilities />
      <Trust />
      <Pricing />
      <Faq />
      <Closing />
    </main>
  );
}
