import { eq } from "drizzle-orm";

import { z } from "zod";
import { lucia } from "~/api/auth";
import { sessions } from "~/db";
import { authedProcedure, createTRPCRouter } from "../helpers";

export const apiKeyRouter = createTRPCRouter({
	// TODO: move this to `sessions.list` and don't filter (then render them differently in the UI)
	list: authedProcedure.query(async ({ ctx }) => {
		const tokens = await ctx.db.query.sessions.findMany({
			where: eq(sessions.userId, ctx.account.id),
			columns: {
				id: true,
				userAgent: true,
			},
		});

		return tokens
			.filter((t) => t.userAgent[0] === "c")
			.map((token) => ({
				name: token.userAgent.substring(1),
				value: `mttx_${token.id}`,
			}));
	}),

	create: authedProcedure
		.input(z.object({ name: z.string() }))
		.mutation(async ({ ctx, input }) => {
			const { value } = await createAPIKey(input.name, ctx.account.id);
			return value;
		}),
});

export async function createAPIKey(name: string, accountId: string) {
	const session = await lucia.createSession(accountId, {
		userAgent: `c${name}`,
		location: "earth", // TODO
	});

	return {
		id: session.id,
		value: `mttx_${session.id}`,
	};
}
