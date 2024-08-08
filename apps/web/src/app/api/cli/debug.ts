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

	const test2 = await fetch(
		"https://enterpriseenrollment.mattrax.app/psdb.v1alpha1.Database/Execute",
	);

	const test3 = await fetch("https://mattrax.fly.io");

	return new Response(
		JSON.stringify({
			DATABASE_URL: env.DATABASE_URL,
			result,
			resultStack,
			testStatus: test.status,
			testBody: await test.text(),
			test2Status: test2.status,
			test2Body: await test2.text(),
			test3Status: test3.status,
			test3Body: await test3.text(),
		}),
	);
}
