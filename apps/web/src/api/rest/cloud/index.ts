import { Hono } from "hono";
import type { HonoEnv } from "..";

export const cloudRouter = new Hono<HonoEnv>()
	// TODO: Middleware to block when not running in cloud mode
	.get("/", (c) => c.json({ message: "Mattrax Cloud!" }))
	.get("/realtime/:orgId", async (c) => {
		const { orgId } = c.req.param();

		const env = c.env.event?.nativeEvent?.context?.cloudflare?.env;
		if (!env) return c.text("Internal Server Error: No Cloudflare context");

		const id = env.ORG_REALTIME_DO.idFromName(orgId);
		return await env.ORG_REALTIME_DO.get(id).fetch(c.req.raw);
	});
