import { Hono } from "hono";

import { microsoftGraphRouter } from "./microsoft-graph";
// import { stripeRouter } from "./stripe";

export const webhookRouter = new Hono().route(
	"/microsoft-graph",
	microsoftGraphRouter,
);
// .route("/stripe", stripeRouter);
