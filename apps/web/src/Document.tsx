import { HydrationScript, getRequestEvent, isServer } from "@solidjs/web";
import type { JSX } from "@solidjs/web";
import { DEPLOYMENT_ID, DEPLOYMENT_META_NAME } from "~/lib/deployment";
import { requiresJavaScript } from "~/lib/public-routes";
import { getPreloadedSession } from "~/lib/session-store";
import { getPostHogConfig } from "~/lib/posthog-config-store";
import { getSupportConfig } from "~/lib/support-config-store";
import { SITE_DEFAULT_ORIGIN, organizationStructuredData } from "~/lib/site";
import { THEME_COLOURS, themeBootstrapScript } from "~/lib/theme";

/** The HTML shell for the app, rendered once on the server. */
export default function Document(props: { children?: JSX.Element }) {
  // Hand the server's preloaded session to the browser before hydration. Without
  // it the first client render starts signed out while the server rendered the
  // signed-in shell, which makes Solid detach and duplicate the layout.
  const request = isServer ? getRequestEvent()!.request : undefined;
  const url = request ? new URL(request.url) : undefined;

  // The document is server-rendered; the `window` branch keeps it coherent if a
  // client ever renders it (and mirrors `siteOrigin()` in `app.tsx`).
  const pathname =
    url?.pathname ?? (typeof window === "undefined" ? undefined : window.location.pathname);

  const origin =
    url?.origin ?? (typeof window === "undefined" ? SITE_DEFAULT_ORIGIN : window.location.origin);

  // Without a request there is nothing to classify; show the notice, which is
  // the safe answer for a client that cannot hydrate.
  const needsJavaScript = pathname === undefined || requiresJavaScript(pathname);
  const preloaded = request ? getPreloadedSession(request) : undefined;
  const serialized = preloaded === undefined ? undefined : JSON.stringify(preloaded);

  // On the client the config is the value the server already injected into
  // this head. Reading it back (rather than leaving it undefined) keeps the
  // rendered node list identical on both sides; omitting these scripts during
  // hydration walks past a missing sibling and aborts the whole document.
  const posthog = request
    ? getPostHogConfig(request)
    : typeof window === "undefined"
      ? undefined
      : window.__MATTRAX_POSTHOG__;

  const serializedPostHog = posthog === undefined ? undefined : JSON.stringify(posthog);

  const support = request
    ? getSupportConfig(request)
    : typeof window === "undefined"
      ? undefined
      : window.__MATTRAX_SUPPORT__;

  const serializedSupport = support === undefined ? undefined : JSON.stringify(support);

  return (
    <html lang="en">
      <head>
        <meta charset="utf-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        {/* Read by the client's skew protection to tell which build rendered
            this tab; `GET /version` reports the build serving new requests. */}
        <meta name={DEPLOYMENT_META_NAME} content={DEPLOYMENT_ID} />
        {/* Lets operators verify browser analytics without reading Worker secrets. */}
        <meta name="mattrax-analytics" content={posthog === undefined ? "disabled" : "enabled"} />
        <link rel="icon" href="/favicon.ico" />
        {/* Preload the exact font the stylesheet uses so first paint has the
            final metrics; a late font swap shifts the hero and the manifesto. */}
        <link
          rel="preload"
          href="/fonts/geist-latin-wght-normal.woff2"
          as="font"
          type="font/woff2"
          crossorigin=""
        />
        <link rel="ard" href="/.well-known/ard.json" />
        {/* Replaced by the theme bootstrap below before the first paint. */}
        <meta name="theme-color" content={THEME_COLOURS.light} />
        {/* The landing page is the only page that represents the whole
            organisation; docs pages carry their own BreadcrumbList. */}
        {pathname === "/" && (
          <script type="application/ld+json">
            {JSON.stringify(organizationStructuredData(origin)).replaceAll("<", String.raw`\u003c`)}
          </script>
        )}
        {/* The dashboard's no-JavaScript notice is an ordinary element, not a
            `<noscript>`: browsers parse `<noscript>` children as text while
            scripting is enabled, so Solid's hydration walker sees a missing
            child and abandons hydration on every route. Marking the document in
            the head lets CSS hide the notice before first paint when scripting
            is available. The timer brings it back if the client bundle never
            finishes hydrating, so a broken bundle still explains itself rather
            than leaving an empty shell. */}
        <script>
          {`document.documentElement.classList.add("js");setTimeout(function(){if(!document.documentElement.dataset.hydrated)document.documentElement.classList.remove("js")},10000);`}
        </script>
        <style>{`.js .no-js-notice{display:none!important}`}</style>
        {/* Resolve system/light/dark before the browser paints: the preference
            lives in localStorage, so this is the only flash-free point. It runs
            ahead of the hydration bundle and of the stylesheet-independent
            no-JavaScript notice below. */}
        <script>{themeBootstrapScript(preloaded?.subjectId)}</script>
        {/* Must run before the async client entry injected into this head. */}
        <HydrationScript />
        {serializedPostHog !== undefined && (
          <script>{`window.__MATTRAX_POSTHOG__=${serializedPostHog.replaceAll("<", String.raw`\u003c`)};`}</script>
        )}
        {serializedSupport !== undefined && (
          <script>{`window.__MATTRAX_SUPPORT__=${serializedSupport.replaceAll("<", String.raw`\u003c`)};`}</script>
        )}
      </head>

      <body>
        {/* The dashboard fetches devices, policies and enrollment data in the
            browser, so without JavaScript it has nothing to show. The notice is
            only emitted for those routes: the landing page, legal pages, 404
            page and docs are server-rendered and deliberately readable without
            it. Inline styles keep it presentable even if a stylesheet fails;
            `light-dark()` tracks the OS while the script above tracks the
            stored preference. */}
        {needsJavaScript && (
          <div
            id="no-js-notice"
            class="no-js-notice"
            style={{
              position: "fixed",
              inset: "0",
              "z-index": "100",
              display: "flex",
              "align-items": "center",
              "justify-content": "center",
              overflow: "auto",
              padding: "2rem 1.5rem",
              "background-color": "light-dark(#f6f6f3,#10100f)",
              color: "light-dark(#202020,#fafafa)",
              "color-scheme": "light dark",
              "font-family":
                "ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif",
              "line-height": "1.6",
            }}
          >
            <div style={{ width: "100%", "max-width": "26rem" }}>
              <picture>
                <source
                  srcset="/assets/brand/mattrax.png"
                  media="(prefers-color-scheme: light)"
                  width="208"
                  height="32"
                />
                <img
                  src="/assets/brand/mattrax-white-208.png"
                  alt="Mattrax"
                  width="208"
                  height="32"
                  decoding="async"
                  style={{ height: "1rem", width: "auto" }}
                />
              </picture>
              <h1
                style={{
                  margin: "2.5rem 0 0",
                  "font-size": "1.375rem",
                  "font-weight": "600",
                  "letter-spacing": "-0.02em",
                }}
              >
                Mattrax needs JavaScript
              </h1>
              <p
                style={{
                  margin: "0.75rem 0 0",
                  color: "light-dark(#646464,#b4b4b4)",
                  "font-size": "0.875rem",
                }}
              >
                The dashboard loads your devices, policies and enrollment data in the browser.
                Enable JavaScript for this site, then reload the page.
              </p>
              <ul
                style={{
                  margin: "1.5rem 0 0",
                  padding: "0 0 0 1rem",
                  color: "light-dark(#646464,#b4b4b4)",
                  "font-size": "0.8125rem",
                }}
              >
                <li style={{ "margin-bottom": "0.375rem" }}>
                  Chrome: Settings → Privacy and security → Site settings → JavaScript.
                </li>
                <li style={{ "margin-bottom": "0.375rem" }}>
                  Safari: Settings → Security → Enable JavaScript.
                </li>
                <li>Firefox: Settings → Privacy &amp; Security → Permissions.</li>
              </ul>
              <p
                style={{
                  margin: "2rem 0 0",
                  "border-top": "1px solid light-dark(#e8e8e8,#2a2a2a)",
                  padding: "1.25rem 0 0",
                  color: "light-dark(#646464,#b4b4b4)",
                  "font-size": "0.8125rem",
                }}
              >
                You can still read the{" "}
                <a href="/docs/" style={{ color: "light-dark(#202020,#fafafa)" }}>
                  documentation
                </a>{" "}
                or visit the{" "}
                <a href="/" style={{ color: "light-dark(#202020,#fafafa)" }}>
                  product site
                </a>
                . Support is{" "}
                <a href="mailto:hello@mattrax.app" style={{ color: "light-dark(#202020,#fafafa)" }}>
                  hello@mattrax.app
                </a>
                .
              </p>
            </div>
          </div>
        )}
        {props.children}
        {/* A sibling of the hydration root: passing the session through a node
            inside the app tree makes Solid treat it as part of the render and
            shifts the hydration keys. This carries the server's `me`/tenant
            snapshot (the signed-in user's own personal data) into private HTML
            that the Worker serves `private, no-store; vary: cookie`. */}
        {serialized !== undefined && (
          <script>{`window.__MATTRAX_SESSION__=${serialized.replaceAll("<", String.raw`\u003c`)};`}</script>
        )}
      </body>
    </html>
  );
}
