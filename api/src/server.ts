// Side-side exports (we don't want these shipped to the client)

import { Hono } from "hono";
import { fetchRequestHandler } from "@trpc/server/adapters/fetch";

import { appRouter } from "./root";
import { createTRPCContext } from "./trpc";
import { HonoEnv } from "./types";
import { webhookRouter } from "./routes/webhook";
import { enrollmentRouter } from "./routes/enrollment";
import { internalRouter } from "./routes/internal";

export const app = new Hono<HonoEnv>()
  .basePath("/api")
  .get("/", (c) => c.json({ message: "Mattrax Forge!" }))
  .all("/trpc/*", (c) =>
    fetchRequestHandler({
      endpoint: "/api/trpc",
      req: c.req as any,
      router: appRouter,
      createContext: (opts) =>
        createTRPCContext({
          session: c.env.session,
          tenantId: c.req.header("x-tenant-id"),
        }),
    })
  )
  .route("/enrollment", enrollmentRouter)
  .route("/webhook", webhookRouter)
  .route("/internal", internalRouter)
  .all("*", (c) => {
    c.status(404);
    if (c.req.raw.headers.get("Accept")?.includes("application/json")) {
      return c.json({ error: "Not Found" });
    }
    return c.text("404: Not Found");
  });
