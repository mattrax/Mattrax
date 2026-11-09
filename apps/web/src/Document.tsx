import { HydrationScript } from "@solidjs/web";
import type { JSX } from "@solidjs/web";

/** The HTML shell for the app, rendered once on the server. */
export default function Document(props: { children?: JSX.Element }) {
  return (
    <html lang="en">
      <head>
        <meta charset="utf-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        <link rel="icon" href="/favicon.ico" />
        {/* Must run before the async client entry injected into this head. */}
        <HydrationScript />
      </head>

      <body>{props.children}</body>
    </html>
  );
}
