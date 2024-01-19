import { APIEvent } from "@solidjs/start/server";
import { mountRoutes } from "~/server/routes";
import { getServerSession } from "~/server/session";
import { newApp } from "~/server/utils";
import { logger } from "hono/logger";

const app = newApp()
  .basePath("/api")
  .get("/", (c) => c.json({ message: "Mattrax Forge!" }))
  .route("/", mountRoutes())
  .all("*", (c) => {
    c.status(404);
    if (c.req.raw.headers.get("Accept")?.includes("application/json")) {
      return c.json({ error: "Not Found" });
    }
    return c.text("404: Not Found");
  });

const handler = async (event: APIEvent) =>
  app.fetch(event.request, {
    session: await getServerSession(),
  });
export const GET = handler;
export const POST = handler;
export const PATCH = handler;
export const PUT = handler;
export const DELETE = handler;

export type AppType = typeof app;
