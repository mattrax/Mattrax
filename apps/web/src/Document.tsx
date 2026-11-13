import { HydrationScript, getRequestEvent, isServer } from "@solidjs/web";
import type { JSX } from "@solidjs/web";
import { getPreloadedSession } from "~/lib/session-store";

/** The HTML shell for the app, rendered once on the server. */
export default function Document(props: { children?: JSX.Element }) {
  // Hand the server's preloaded session to the browser before hydration. Without
  // it the first client render starts signed out while the server rendered the
  // signed-in shell, which makes Solid detach and duplicate the layout.
  const preloaded = isServer ? getPreloadedSession(getRequestEvent()!.request) : undefined;
  const serialized = preloaded === undefined ? undefined : JSON.stringify(preloaded);

  return (
    <html lang="en">
      <head>
        <meta charset="utf-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        <link rel="icon" href="/favicon.ico" />
        <meta name="theme-color" content="#08080a" />
        {/* Must run before the async client entry injected into this head. */}
        <HydrationScript />
      </head>

      <body>
        {props.children}
        {/* A sibling of the hydration root: passing the session through a node
            inside the app tree makes Solid treat it as part of the render and
            shifts the hydration keys. */}
        {serialized !== undefined && (
          <script>{`window.__MATTRAX_SESSION__=${serialized.replace(/</g, "\\u003c")};`}</script>
        )}
      </body>
    </html>
  );
}
