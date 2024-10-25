import type { APIEvent } from "@solidjs/start/server";
import { sql } from "drizzle-orm";
import { z } from "zod";
import { sendDiscordMessage } from "~/api/trpc/routers/meta";
import {
	db,
	waitlist,
	waitlistDeploymentMethod,
	waitlistInterestReasons,
} from "~/db";
import { env } from "~/env";

const waitlistRequest = z.object({
	email: z.string().email(),
	name: z.string().optional(),
	interest: z.enum(waitlistInterestReasons),
	deployment: z.enum(waitlistDeploymentMethod),
});

export async function POST({ request }: APIEvent) {
	const result = waitlistRequest.safeParse(await request.json());
	if (!result.success) return new Response("Invalid request", { status: 400 });

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

	try {
		await db
			.insert(waitlist)
			.values({
				email: result.data.email,
				name: result.data.name,
				interest: result.data.interest,
				deployment: result.data.deployment,
			})
			.onDuplicateKeyUpdate({
				set: {
					email: sql`email`,
				},
			});
	} catch (err) {
		console.error("Failed to insert into waitlist", err);
	}

	return new Response("ok");
}
