import { Hono } from "hono";

import { microsoftGraphRouter } from "./microsoft-graph";

export const webhookRouter = new Hono().route(
	"/microsoft-graph",
	microsoftGraphRouter,
);
