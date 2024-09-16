// Server-side exports (we don't want these shipped to the client)

import type { APIEvent } from "@solidjs/start/server";
import type { H3Event } from "h3";
import { Hono } from "hono";

import { waitlistRouter } from "./waitlist";

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
	.all("*", (c) => {
		c.status(404);
		if (c.req.raw.headers.get("Accept")?.includes("application/json")) {
			return c.json({ error: "Not Found" });
		}
		return c.text("404: Not Found");
	});
