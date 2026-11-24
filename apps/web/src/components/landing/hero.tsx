import { ArrowRight } from "@mattrax/ui";
import { For, Show } from "solid-js";
import { Button } from "~/components/ui/button";
import { authClient } from "~/lib/auth";
import { installHeroProgress } from "~/lib/landing-motion";
import { publicPrimaryCta } from "~/lib/public-auth-cta";
import { Eyebrow, NoJsStartFree } from "./primitives";

type Platform = "apple" | "windows" | "android";

type SampleDevice = {
  readonly name: string;
  readonly detail: string;
  readonly state: string;
  readonly tone: "ok" | "warn";
  readonly platform: Platform;
};

const devices: readonly SampleDevice[] = [
  {
    name: "Reception Mac",
    detail: "macOS 15.2 · Mac14,2",
    state: "Healthy",
    tone: "ok",
    platform: "apple",
  },
  {
    name: "Finance Laptop",
    detail: "Windows 11 · 23H2",
    state: "Healthy",
    tone: "ok",
    platform: "windows",
  },
  {
    name: "Field Tablet",
    detail: "iPadOS 18.1 · iPad13,4",
    state: "Attention",
    tone: "warn",
    platform: "apple",
  },
  {
    name: "Warehouse Handheld",
    detail: "Android 14 · Fully managed",
    state: "Enrolled",
    tone: "ok",
    platform: "android",
  },
];

const platformGlyphs: Record<Platform, string> = {
  apple: "Mac",
  windows: "Win",
  android: "And",
};

const stateClasses = {
  ok: "lx-state lx-state--ok",
  warn: "lx-state lx-state--warn",
} as const;

const proofPoints = [
  "APNs",
  "ABM/ADE",
  "Apps & Books",
  "DDM",
  "Autopilot",
  "Entra ID",
  "Android Enterprise",
];

export function Hero() {
  installHeroProgress();
  const session = authClient.useSession();
  const signedIn = () => Boolean(session().data?.user);
  const cta = () => publicPrimaryCta(session().isPending, signedIn());

  return (
    <section class="lx-hero" aria-labelledby="hero-title">
      <div class="lx-shell">
        <div class="lx-hero__track">
          <div class="lx-hero__pin">
            <div class="lx-hero__copy">
              <Eyebrow>MDM for Apple, Windows and Android</Eyebrow>

              <h1 id="hero-title">
                Device management
                <br />
                <span class="lx-muted">without the {"black\u00a0box."}</span>
              </h1>

              <p class="lx-hero__sub">
                Run every Apple, Windows and Android device from one control plane. See why a policy
                applied, what changed on a device, and who changed it — on our cloud or yours.
              </p>

              <div class="lx-hero__actions">
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
                    <Button as="a" href={action().href} size="lg" class="h-10 px-5">
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
                  class="h-10 px-5"
                >
                  Talk to us
                </Button>
                <a href="/docs/" target="_self" class="lx-link">
                  Read the docs
                </a>
              </div>

              <p class="lx-hero__note">
                Free during alpha. Apple, Windows and Android included.{" "}
                <a
                  href="/docs/getting-started/alpha"
                  target="_self"
                  class="underline underline-offset-2"
                >
                  What alpha means
                </a>
                .
              </p>

              <p class="lx-proof">
                <For each={proofPoints}>
                  {(point) => <span class="lx-proof__item">{point}</span>}
                </For>
              </p>
            </div>

            <div
              class="lx-hero__surface"
              role="img"
              aria-label="Mattrax fleet overview showing a mixed Apple, Windows and Android estate, device health badges and policy sync status across the fleet."
            >
              <div class="lx-console">
                <div class="lx-console__bar">
                  <div class="lx-console__dots" aria-hidden="true">
                    <span />
                    <span />
                    <span />
                  </div>
                  <span class="label-caps">Sample data</span>
                </div>

                <div class="lx-console__body">
                  <div class="lx-console__head">
                    <div>
                      <p class="label-caps">Fleet overview</p>
                      <p class="lx-console__title">Sample devices</p>
                    </div>
                    <span class="lx-state">Preview</span>
                  </div>

                  <div class="lx-devices">
                    <For each={devices}>
                      {(device) => (
                        <div class="lx-device">
                          <span class="lx-device__glyph">{platformGlyphs[device.platform]}</span>
                          <div>
                            <p class="lx-device__name">{device.name}</p>
                            <p class="lx-device__meta">{device.detail}</p>
                          </div>
                          <span class={stateClasses[device.tone]}>{device.state}</span>
                        </div>
                      )}
                    </For>
                  </div>

                  <div class="lx-console__foot">
                    <span>Policy sync</span>
                    <span class="lx-state lx-state--ok">Up to date</span>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
