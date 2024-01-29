import { defineEventHandler, toWebRequest } from "vinxi/server";
import { newUnauthenticatedApp, mountRoutes } from "@mattrax/api/server";
import { getServerSession } from "./getServerSession";

const app = newUnauthenticatedApp()
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

export default defineEventHandler(async (event) =>
  app.fetch(toWebRequest(event), {
    session: await getServerSession(event),
  })
);

export type AppType = typeof app;
