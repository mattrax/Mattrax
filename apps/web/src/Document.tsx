import { HydrationScript, getRequestEvent, isServer } from "@solidjs/web";
import type { JSX } from "@solidjs/web";
import { requiresJavaScript } from "~/lib/public-routes";
import { getPreloadedSession } from "~/lib/session-store";
import { getPostHogConfig } from "~/lib/posthog-config-store";
import { SITE_DEFAULT_ORIGIN, organizationStructuredData } from "~/lib/site";

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
  const posthog = request ? getPostHogConfig(request) : undefined;
  const serializedPostHog = posthog === undefined ? undefined : JSON.stringify(posthog);

  return (
    <html lang="en" class="dark">
      <head>
        <meta charset="utf-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        <link rel="icon" href="/favicon.ico" />
        <link rel="ard" href="/.well-known/ard.json" />
        <meta name="theme-color" content="#08080a" />
        {/* The landing page is the only page that represents the whole
            organisation; docs pages carry their own BreadcrumbList. */}
        {pathname === "/" && (
          <script type="application/ld+json">
            {JSON.stringify(organizationStructuredData(origin)).replace(/</g, "\\u003c")}
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
        {/* Must run before the async client entry injected into this head. */}
        <HydrationScript />
        {serializedPostHog !== undefined && (
          <script>{`window.__MATTRAX_POSTHOG__=${serializedPostHog.replace(/</g, "\\u003c")};`}</script>
        )}
      </head>

      <body>
        {/* The dashboard fetches devices, policies and enrollment data in the
            browser, so without JavaScript it has nothing to show. The notice is
            only emitted for those routes: the landing page, legal pages, 404
            page and docs are server-rendered and deliberately readable without
            it. Inline styles keep it presentable even if a stylesheet fails. */}
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
              "background-color": "#08080a",
              color: "#fafafa",
              "font-family":
                "ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif",
              "line-height": "1.6",
            }}
          >
            <div style={{ width: "100%", "max-width": "26rem" }}>
              <img
                src="/assets/brand/mattrax-white-208.png"
                alt="Mattrax"
                width="208"
                height="32"
                decoding="async"
                style={{ height: "1rem", width: "auto" }}
              />
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
              <p style={{ margin: "0.75rem 0 0", color: "#a1a1aa", "font-size": "0.875rem" }}>
                The dashboard loads your devices, policies and enrollment data in the browser.
                Enable JavaScript for this site, then reload the page.
              </p>
              <ul
                style={{
                  margin: "1.5rem 0 0",
                  padding: "0 0 0 1rem",
                  color: "#a1a1aa",
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
                  "border-top": "1px solid #27272a",
                  padding: "1.25rem 0 0",
                  color: "#a1a1aa",
                  "font-size": "0.8125rem",
                }}
              >
                You can still read the{" "}
                <a href="/docs/" style={{ color: "#fafafa" }}>
                  documentation
                </a>{" "}
                or visit the{" "}
                <a href="/" style={{ color: "#fafafa" }}>
                  product site
                </a>
                . Support is{" "}
                <a href="mailto:hello@mattrax.app" style={{ color: "#fafafa" }}>
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
          <script>{`window.__MATTRAX_SESSION__=${serialized.replace(/</g, "\\u003c")};`}</script>
        )}
      </body>
    </html>
  );
}
