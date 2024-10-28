// TODO: Remove this file

import type { APIEvent } from "@solidjs/start/server";
import { accounts, db } from "~/db";

export const GET = async ({ request, nativeEvent }: APIEvent) => {
	try {
		const users = await db.select().from(accounts);

		return new Response(`ok ${users.length}`);
	} catch (err) {
		console.error(err);
		return new Response("error", { status: 500 });
	}
};
