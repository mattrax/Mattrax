import type { APIEvent } from "@solidjs/start/server";
import { sql } from "drizzle-orm";
import { db } from "../../db";
import { env } from "../../env";

export async function GET({ request }: APIEvent) {
	const url = new URL(request.url);
	if (url.searchParams.get("auth") !== env.INTERNAL_SECRET)
		return new Response("Unauthorized", { status: 401 });

	let result = "ok";
	try {
		await db.execute(sql`SELECT 1`);
	} catch (err) {
		console.error(err);
		result = err.toString();
	}

	return new Response(JSON.stringify({ ...env, _db_result: result }));
}
