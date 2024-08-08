import type { APIEvent } from "@solidjs/start/server";
import { sql } from "drizzle-orm";
import { db } from "../../../db";
import { env } from "../../../env";

export async function GET({ request }: APIEvent) {
	const url = new URL(request.url);
	if (url.searchParams.get("auth") !== env.INTERNAL_SECRET)
		return new Response("Unauthorized", { status: 401 });

	let result = "ok";
	let resultStack = "ok";
	try {
		await db.execute(sql`SELECT 1`);
	} catch (e) {
		result = e.toString();
		resultStack = JSON.stringify(e.stack);
	}

	const test = await fetch(
		"https://mdm.mattrax.app/psdb.v1alpha1.Database/Execute",
	);

	return new Response(
		JSON.stringify({
			DATABASE_URL: env.DATABASE_URL,
			result,
			resultStack,
			testStatus: test.status,
			testBody: await test.text(),
		}),
	);
}