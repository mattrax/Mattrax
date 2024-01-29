import { newUnauthenticatedApp, newApp } from "../utils";
import { app as authRouter } from "./auth";
import { createTenantRoute, tenantApp as tenantRouter } from "./tenants";
import { app as devicesRouter } from "./devices";
import { app as policiesRouter } from "./policies";
import { app as internalRouter } from "./internal";
import { app as webhookRouter } from "./webhook";
import { app as usersRouter } from "./users";

export const mountRoutes = () =>
  newUnauthenticatedApp()
    .route("/auth", authRouter)
    // TODO: Apply auth here so it can't be forgotten
    .route(
      "/tenant/:tenantId",
      newApp()
        .use("*", async (c, next) => {
          // TODO: Decode ID properly
          c.env.tenantId = c.req.path.split("/")[3];

          await next();
        })
        .get("/", async (c) => {
          return c.text(`Hello ${c.env.tenantId}`);
        })
        // TODO: Deal with tenantId authorisation here
        .route("/users", usersRouter)
        .route("/devices", devicesRouter)
        .route("/policies", policiesRouter)
        .route("/apps", newUnauthenticatedApp())
        .route("/scripts", newUnauthenticatedApp())
        .route("/groups", newUnauthenticatedApp())
        .route("/", tenantRouter)
    )

    .route("/tenant", createTenantRoute)
    .route("/internal", internalRouter)
    .route("/webhook", webhookRouter)
    // TODO: remove the following
    .route("/users", usersRouter)
    .route("/devices", devicesRouter)
    .route("/policies", policiesRouter);
