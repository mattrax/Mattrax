// Server-side exports (we don't want these shipped to the client)

import { Hono } from "hono";

import { enrollmentRouter } from "./routes/enrollment";
import { msRouter } from "./routes/ms";
import { webhookRouter } from "./routes/webhook";
import type { HonoEnv } from "./types";
import { waitlistRouter } from "./routes/waitlist";

export const app = new Hono<HonoEnv>()
	.basePath("/api")
	.get("/", (c) => c.json({ message: "Mattrax Forge!" }))
	.route("/enrollment", enrollmentRouter)
	.route("/webhook", webhookRouter)
	.route("/ms", msRouter)
	.route("/waitlist", waitlistRouter)
	.all("*", (c) => {
		c.status(404);
		if (c.req.raw.headers.get("Accept")?.includes("application/json")) {
			return c.json({ error: "Not Found" });
		}
		return c.text("404: Not Found");
	});
