import { Hono } from "hono";
import { z } from "zod";
import {
	db,
	waitlist,
	waitlistDeploymentMethod,
	waitlistInterestReasons,
} from "~/db";
import { sendDiscordMessage } from "../trpc/routers/meta";
import type { HonoEnv } from ".";
import { env } from "~/env";

const waitlistRequest = z.object({
	email: z.string().email(),
	name: z.string().optional(),
	interest: z.enum(waitlistInterestReasons),
	deployment: z.enum(waitlistDeploymentMethod),
});

export const waitlistRouter = new Hono<HonoEnv>().post("/", async (c) => {
	const result = waitlistRequest.safeParse(await c.req.json());
	if (!result.success) {
		c.status(400);
		return c.text("Invalid request!");
	}

	// We do Discord first, incase the DB is down.
	try {
		await sendDiscordMessage(
			[
				`**name**: ${result.data.name}`,
				`**interest**: ${result.data.interest}`,
				`**deployment**: ${result.data.deployment}`,
				`\`${result.data.email}\``,
			].join("\n"),
			env.WAITLIST_DISCORD_WEBHOOK_URL,
		);
	} catch (err) {
		console.error("Failed to send discord message", err);
	}

	await db.insert(waitlist).values({
		email: result.data.email,
		name: result.data.name,
		interest: result.data.interest,
		deployment: result.data.deployment,
	});

	return c.text("ok");
});
