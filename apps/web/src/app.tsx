import { Head, Link, Meta, Title } from "@solidjs/meta";
import { createRouter, useLocation } from "@solidjs/router";
import { fileRoutes } from "@solidjs/router/fs";
import { getRequestEvent, isServer } from "@solidjs/web";
import { Errored, Loading, onSettled } from "solid-js";
import { pageRoutes } from "virtual:file-routes";
import { PageErrorFallback } from "~/components/error-boundary";
import { GlobalErrorBanner } from "~/components/global-error-banner";
import { installTheme } from "~/lib/theme";
import {
  SITE_DEFAULT_ORIGIN,
  SITE_DESCRIPTION,
  SITE_SOCIAL_IMAGE,
  SITE_TITLE,
  SITE_TOUCH_ICON,
} from "~/lib/site";
import "./app.css";

const Router = createRouter({ routes: fileRoutes(pageRoutes) });

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
        <Head>
          <Title>{SITE_TITLE}</Title>
          <Meta name="description" content={SITE_DESCRIPTION} />
          <Meta property="og:title" content={SITE_TITLE} />
          <Meta property="og:description" content={SITE_DESCRIPTION} />
          <Meta property="og:type" content="website" />
          <Meta property="og:image" content={`${origin}${SITE_SOCIAL_IMAGE}`} />
          <Meta name="twitter:card" content="summary_large_image" />
          <RouteUrl origin={origin} />
          <Link rel="apple-touch-icon" sizes="180x180" href={SITE_TOUCH_ICON} />
          <Errored
            fallback={(error, reset) => (
              <PageErrorFallback boundary="app" error={error()} reset={reset} />
            )}
          >
            <Loading fallback={<BootSplash />}>{props.children}</Loading>
          </Errored>
          <GlobalErrorBanner />
        </Head>
      )}
    </Router>
  );
}
