import { z } from "zod";
import { env } from "~/env";
import { authedProcedure, createTRPCRouter } from "../helpers";

export const metaRouter = createTRPCRouter({
	sendFeedback: authedProcedure
		.input(z.object({ content: z.string().max(1000) }))
		.mutation(async ({ ctx, input }) => {
			if (!env.FEEDBACK_DISCORD_WEBHOOK_URL) {
				throw new Error("Feedback webhook not configured");
			}

			await sendDiscordMessage(
				[
					...input.content.split("\n").map((l) => `> ${l}`),
					`\`${ctx.account.email}\``,
				].join("\n"),
				env.FEEDBACK_DISCORD_WEBHOOK_URL,
			);
		}),
});

export async function sendDiscordMessage(
	content: string,
	url: string | undefined,
) {
	if (!url) throw new Error("Discord webhook not configured");

	const body = new FormData();
	body.set("content", content);

	await fetch(url, {
		method: "POST",
		body,
	});
}
