import { Hono } from "hono";
// import { waitlistRouter } from "./waitlist";

import "~/db"; // TODO

const app = new Hono()
	.get("/api/__version", (c) => c.json({ message: "Mattrax Forge!" })) // TODO
	// .route("/api/waitlist", waitlistRouter)
	// .route("/api/trpc", trpcRouter) // TODO
	// .route("/EnrollmentServer", trpcRouter) // TODO
	// .route("/ManagementServer", trpcRouter) // TODO
	.all("*", (c) => {
		c.status(404);
		if (c.req.raw.headers.get("Accept")?.includes("application/json")) {
			return c.json({ error: "Not Found" });
		}
		return c.text("404: Not Found");
	});

export default app;
