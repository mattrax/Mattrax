// Server-side exports (we don't want these shipped to the client)

import type { APIEvent } from "@solidjs/start/server";
import type { H3Event } from "h3";
import { Hono } from "hono";

import { env } from "~/env";
import { msRouter } from "./ms";
import { waitlistRouter } from "./waitlist";
import { webhookRouter } from "./webhook";

export type HonoEnv = {
	Bindings: {
		h3Event: H3Event;
		event: APIEvent;
	};
};

export const app = new Hono<HonoEnv>()
	.basePath("/api")
	.get("/", (c) => c.json({ message: "Mattrax Forge!" }))
	.route("/waitlist", waitlistRouter)
	.route("/webhook", webhookRouter)
	.route("/ms", msRouter)
	.get("/where_da_rust", async (c) => {
		c.header("Cache-Control", "public,max-age=600,must-revalidate");
		return c.text(env.MDM_URL);
	})
	.all("*", (c) => {
		c.status(404);
		if (c.req.raw.headers.get("Accept")?.includes("application/json")) {
			return c.json({ error: "Not Found" });
		}
		return c.text("404: Not Found");
	});
