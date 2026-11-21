import { Head, Link, Meta, Title } from "@solidjs/meta";
import {
  createRouter,
  intentPreload,
  pendingLinks,
  tapPreload,
  useLocation,
  viewportPreload,
} from "@solidjs/router";
import { fileRoutes } from "@solidjs/router/fs";
import { getRequestEvent, isServer } from "@solidjs/web";
import { createEffect, Errored, Loading, onSettled, Show } from "solid-js";
import type { ParentProps } from "solid-js";
import { pageRoutes } from "virtual:file-routes";
import { PageErrorFallback } from "~/components/error-boundary";
import { GlobalErrorBanner } from "~/components/global-error-banner";
import { NewVersionNotice } from "~/components/new-version-notice";
import { installSkewProtection } from "~/lib/skew-protection";
import { installTheme } from "~/lib/theme";
import { capturePostHogPageview } from "~/lib/posthog";
import {
  LANDING_DESCRIPTION,
  LANDING_OG_DESCRIPTION,
  LANDING_OG_TITLE,
  LANDING_TITLE,
  SITE_DEFAULT_ORIGIN,
  SITE_DESCRIPTION,
  SITE_SOCIAL_IMAGE,
  SITE_TITLE,
  SITE_TOUCH_ICON,
} from "~/lib/site";
import "./app.css";

// Install before the router is created: recovering from a stale chunk strips
// the one-shot reload marker from `window.location`, and the router must see the
// clean URL for its initial match. Listeners are inert on the server.
if (!isServer) installSkewProtection();

const Router = createRouter({
  routes: fileRoutes(pageRoutes),
  // Mark the target of an in-flight navigation so the shell can show it.
  links: pendingLinks,
  // Warm route code and data before the click: hover/focus/touch for intent,
  // pointerdown for touch, and code for links that scroll into view.
  preloadLinks: [
    intentPreload({ delay: 25 }),
    tapPreload(),
    viewportPreload({ all: true, data: false }),
  ],
});

/** Public origin for absolute social URLs; localhost and self-hosted deployments keep their own host. */
function siteOrigin() {
  if (isServer) {
    const request = getRequestEvent()?.request;

    if (request) return new URL(request.url).origin;
  }

  return typeof window === "undefined" ? SITE_DEFAULT_ORIGIN : window.location.origin;
}

function BootSplash() {
  return (
    <div class="flex min-h-screen items-center justify-center bg-background text-foreground">
      <div class="flex items-center gap-2.5">
        <span class="flex size-7 animate-pulse items-center justify-center rounded-[7px] bg-primary text-[13px] font-bold text-primary-foreground">
          M
        </span>
        <span class="text-[13px] font-medium text-muted-foreground">Loading Mattrax…</span>
      </div>
    </div>
  );
}

/** Canonical and social URL for the current route, on the host serving it. */
function RouteUrl(props: { origin: string }) {
  const location = useLocation();
  const url = () => `${props.origin}${location.pathname}`;

  return (
    <>
      <Link rel="canonical" href={url()} />
      <Meta property="og:url" content={url()} />
    </>
  );
}

export default function App() {
  const origin = siteOrigin();

  // Browser tests (and the first user interaction) need a deterministic signal
  // that hydration completed; SSR markup alone does not attach event handlers.
  onSettled(() => {
    if (typeof document !== "undefined") {
      // Re-assert script capability: the Document's fallback timer removes it
      // after ten seconds so a broken bundle can still explain itself, and a
      // slow-but-successful hydration must not leave the notice on screen.
      document.documentElement.classList.add("js");
      document.documentElement.dataset.hydrated = "true";
      // Public routes never install a per-account theme; the device preference
      // (or `system`) is the right scope for them. The dashboard re-installs
      // with the signed-in user id once the session resolves.
      installTheme();
    }
  });

  return (
    <Router>
      {(props) => (
        <HeadTags origin={origin}>
          <Errored
            fallback={(error, reset) => (
              <PageErrorFallback boundary="app" error={error()} reset={reset} />
            )}
          >
            <Loading fallback={<BootSplash />}>{props.children}</Loading>
          </Errored>
          <GlobalErrorBanner />
          <NewVersionNotice />
        </HeadTags>
      )}
    </Router>
  );
}

/**
 * Document metadata, resolved per route.
 *
 * The landing page is the one page that sells the product, so it carries its
 * own search title and description; every other page keeps the brand defaults.
 * This lives inside the router so client-side navigation updates it too.
 */
function HeadTags(props: ParentProps<{ origin: string }>) {
  const location = useLocation();
  const landing = () => location.pathname === "/";

  // The browser analytics client captures a pageview for every SPA navigation,
  // including the first render. Search strings are intentionally omitted.
  createEffect(
    () => location.pathname,
    (pathname) => capturePostHogPageview(pathname),
  );

  return (
    <Head>
      <Title>{landing() ? LANDING_TITLE : SITE_TITLE}</Title>
      <Show
        when={landing()}
        fallback={
          <>
            <Meta name="description" content={SITE_DESCRIPTION} />
            <Meta property="og:title" content={SITE_TITLE} />
            <Meta property="og:description" content={SITE_DESCRIPTION} />
          </>
        }
      >
        <Meta name="description" content={LANDING_DESCRIPTION} />
        <Meta property="og:title" content={LANDING_OG_TITLE} />
        <Meta property="og:description" content={LANDING_OG_DESCRIPTION} />
      </Show>
      <Meta property="og:type" content="website" />
      <Meta property="og:image" content={`${props.origin}${SITE_SOCIAL_IMAGE}`} />
      <Meta name="twitter:card" content="summary_large_image" />
      <RouteUrl origin={props.origin} />
      <Link rel="apple-touch-icon" sizes="180x180" href={SITE_TOUCH_ICON} />
      {props.children}
    </Head>
  );
}
