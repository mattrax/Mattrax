import type { APIEvent } from "@solidjs/start/server";
import { eq } from "drizzle-orm";

import { verifyJWT } from "~/api/jwt";
import { accounts, apiKeys, cliAuthCodes, db } from "~/db";

export async function POST({ params }: APIEvent) {
	const { code } = await verifyJWT<{ code: string }>(params.codeJwt!);

	const [codeRecord] = await db
		.select({
			code: cliAuthCodes.code,
			apiKey: apiKeys.value,
			email: accounts.email,
		})
		.from(cliAuthCodes)
		.where(eq(cliAuthCodes.code, code))
		.leftJoin(apiKeys, eq(cliAuthCodes.apiKeyPk, apiKeys.pk))
		.leftJoin(accounts, eq(apiKeys.accountPk, accounts.pk));
	if (!codeRecord) return { status: 404, body: "Code not found" };

	if (codeRecord.apiKey)
		await db.delete(cliAuthCodes).where(eq(cliAuthCodes.code, code));

	return Response.json(codeRecord);
}
