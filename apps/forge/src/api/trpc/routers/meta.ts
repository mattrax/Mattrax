import { z } from "zod";
import { getEnv } from "~/env";
import { authedProcedure, createTRPCRouter } from "../helpers";

export const metaRouter = createTRPCRouter({
	sendFeedback: authedProcedure
		.input(z.object({ content: z.string().max(1000) }))
		.mutation(async ({ ctx, input }) => {
			if (!getEnv().FEEDBACK_DISCORD_WEBHOOK_URL) {
				throw new Error("Feedback webhook not configured");
			}

			const content = [
				...input.content.split("\n").map((l) => `> ${l}`),
				`\`${ctx.account.email}\``,
			].join("\n");

			const body = new FormData();
			body.set("content", content);

			await fetch(getEnv().FEEDBACK_DISCORD_WEBHOOK_URL, {
				method: "POST",
				body,
			});
		}),
});
