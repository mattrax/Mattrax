import { Hono } from "hono";
import type { HonoEnv } from "../types";
import { z } from "zod";
import {
	db,
	waitlist,
	waitlistDeploymentMethod,
	waitlistInterestReasons,
} from "~/db";

const waitlistRequest = z.object({
	email: z.string().email(),
	name: z.string().optional(),
	interest: z.enum(waitlistInterestReasons),
	deployment: z.enum(waitlistDeploymentMethod),
});

export const waitlistRouter = new Hono<HonoEnv>().post(
	"/register",
	async (c) => {
		const result = waitlistRequest.safeParse(await c.req.json());
		if (!result.success) {
			c.status(400);
			return c.text("Invalid request!");
		}

		await db.insert(waitlist).values({
			email: result.data.email,
			name: result.data.name,
			interest: result.data.interest,
			deployment: result.data.deployment,
		});

		return c.text("ok");
	},
);
