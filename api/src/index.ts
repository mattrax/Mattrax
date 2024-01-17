import { Hono } from "hono";
import { router as authRouter } from "./routers/auth";
import { router as tenantsRouter } from "./routers/tenants";

const app = new Hono()
  .basePath("/api") // TODO: Remove this
  .get("/", (c) =>
    c.json({
      message: "Mattrax API!",
    })
  )
  .route("/auth", authRouter)
  // TODO: Authentication
  .route("/tenants", tenantsRouter)
  .all("*", (c) => c.text("404: Not Found"));

// TODO: Proper authentication
// export type SessionData = {
//   id: number;
//   name: string;
//   email: string;
// };

export default app;
