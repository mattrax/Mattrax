import { newApp } from "../utils";
import { app as authRouter } from "./auth";
import { app as tenantsRouter } from "./tenants";
import { app as devicesRouter } from "./devices";
import { app as policiesRouter } from "./policies";
import { app as internalRouter } from "./internal";
import { app as webhookRouter } from "./webhook";
import { app as usersRouter } from "./users";

export const mountRoutes = () =>
  newApp()
    .route("/auth", authRouter)
    .route("/policies", policiesRouter)
    .route("/tenants", tenantsRouter)
    .route("/devices", devicesRouter)
    .route("/users", usersRouter)
    .route("/internal", internalRouter)
    .route("/webhook", webhookRouter);
