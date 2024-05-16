import type { APIEvent } from "@solidjs/start/server";
import { eq } from "drizzle-orm";

import { signJWT, verifyJWT } from "~/api/utils/jwt";
import { accounts, cliAuthCodes, db, sessions } from "~/db";

export async function POST({ params }: APIEvent) {
	const { code } = await verifyJWT<{ code: string }>(params.codeJwt!);

	const [result] = await db
		.select({
			code: cliAuthCodes.code,
			sessionId: sessions.id,
			email: accounts.email,
		})
		.from(cliAuthCodes)
		.where(eq(cliAuthCodes.code, code))
		.leftJoin(sessions, eq(cliAuthCodes.sessionId, sessions.id))
		.leftJoin(accounts, eq(sessions.userId, accounts.id));
	if (!result) return new Response("Code not found", { status: 404 });
	if (!result.sessionId)
		return new Response(
			"User has not completed the login flow, try again later!",
			{
				status: 202,
			},
		);
	if (!result.email) return new Response("User not found!", { status: 404 });

	await db.delete(cliAuthCodes).where(eq(cliAuthCodes.code, code));

	return Response.json({
		apiKey: await signJWT(
			{ id: result.sessionId },
			{
				audience: "cli",
			},
		),
		email: result.email,
	});
}
