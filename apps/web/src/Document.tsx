import { HydrationScript, getRequestEvent, isServer } from "@solidjs/web";
import type { JSX } from "@solidjs/web";
import { getPreloadedSession } from "~/lib/session-store";
import { getPostHogConfig } from "~/lib/posthog-config-store";

/** The HTML shell for the app, rendered once on the server. */
export default function Document(props: { children?: JSX.Element }) {
  // Hand the server's preloaded session to the browser before hydration. Without
  // it the first client render starts signed out while the server rendered the
  // signed-in shell, which makes Solid detach and duplicate the layout.
  const request = isServer ? getRequestEvent()!.request : undefined;
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
        {/* Must run before the async client entry injected into this head. */}
        <HydrationScript />
        {serializedPostHog !== undefined && (
          <script>{`window.__MATTRAX_POSTHOG__=${serializedPostHog.replace(/</g, "\\u003c")};`}</script>
        )}
      </head>

      <body>
        {/* Server-rendered pages stop at static markup without hydration; the
            dashboard needs the client to fetch device and policy data. */}
        <noscript>
          <div
            style={{
              "font-family": "ui-sans-serif, system-ui, sans-serif",
              margin: "0 auto",
              "max-width": "32rem",
              padding: "3rem 1.5rem",
              "line-height": "1.6",
            }}
          >
            <h1 style={{ "font-size": "1.125rem", "font-weight": "600", margin: "0 0 0.5rem" }}>
              Mattrax needs JavaScript
            </h1>
            <p style={{ margin: 0, "font-size": "0.875rem" }}>
              The dashboard loads your devices, policies and enrollment data in the browser. Enable
              JavaScript in this browser, then reload the page.
            </p>
          </div>
        </noscript>
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
