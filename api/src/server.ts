// Side-side exports (we don't want these shipped to the client)

import { Hono } from "hono";
import { fetchRequestHandler } from "@trpc/server/adapters/fetch";

import { appRouter } from "./root";
import { createTRPCContext } from "./trpc";
import { HonoEnv } from "./types";
import { webhookRouter } from "./routes/webhook";
import { enrollmentRouter } from "./routes/enrollment";
import { msRouter } from "./routes/ms";

export const app = new Hono<HonoEnv>()
  .basePath("/api")
  .get("/", (c) => c.json({ message: "Mattrax Forge!" }))
  .all("/trpc/*", (c) => {
    console.log(c.req, c.req.raw); // TODO

    return fetchRequestHandler({
      endpoint: "/api/trpc",
      req: c.req.raw,
      router: appRouter,
      createContext: (opts) =>
        createTRPCContext({
          session: c.env.session,
          tenantId: c.req.header("x-tenant-id"),
        }),
    });
  })
  .route("/enrollment", enrollmentRouter)
  .route("/webhook", webhookRouter)
  .route("/ms", msRouter)
  .all("*", (c) => {
    c.status(404);
    if (c.req.raw.headers.get("Accept")?.includes("application/json")) {
      return c.json({ error: "Not Found" });
    }
    return c.text("404: Not Found");
  });

// TODO: Remove this and hook it up to the MDM
// import { slackImplementation } from "@mattrax/policy";
// import * as fs from "fs";
// import { fileURLToPath } from "url";
// import * as path from "path";

// fs.writeFileSync(
//   path.join(fileURLToPath(import.meta.url), `../../result.mobileconfig`),
//   slackImplementation.renderAppleProfile({
//     DefaultSignInTeam: "T01FU78A0UC",
//   })
// );
