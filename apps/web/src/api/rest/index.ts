// Server-side exports (we don't want these shipped to the client)

import type { APIEvent } from "@solidjs/start/server";
import type { H3Event } from "h3";
import { Hono } from "hono";

import { enrollmentRouter } from "./enrollment";
import { waitlistRouter } from "./waitlist";
import { webhookRouter } from "./webhook";
import { msRouter } from "./ms";

export type HonoEnv = {
	Bindings: {
		h3Event: H3Event;
		event: APIEvent;
	};
};

export const app = new Hono<HonoEnv>()
	.basePath("/api")
	.get("/", (c) => c.json({ message: "Mattrax Forge!" }))
	.route("/enrollment", enrollmentRouter)
	.route("/waitlist", waitlistRouter)
	.route("/webhook", webhookRouter)
	.route("/ms", msRouter)
	.all("*", (c) => {
		c.status(404);
		if (c.req.raw.headers.get("Accept")?.includes("application/json")) {
			return c.json({ error: "Not Found" });
		}
		return c.text("404: Not Found");
	});
