import { createHandler } from "@solidjs/start/entry";
import { StartServer } from "@solidjs/start/server";

const handler: unknown = createHandler(() => (
  <StartServer
    document={({ assets, children, scripts }) => (
      <html lang="en" class="h-full">
        <head>
          <meta charset="utf-8" />
          <meta name="viewport" content="width=device-width, initial-scale=1" />
          <link rel="icon" href="/favicon.ico" />
          {assets}
        </head>
        <body class="h-full overflow-hidden">
          <div id="app" class="h-full flex">
            {children}
          </div>
          {scripts}
        </body>
      </html>
    )}
  />
));

export default handler;
