import type { APIHandler } from "@solidjs/start/server";

import { app } from "~/api/rest";

const createHandler = (): APIHandler => async (event) => {
	return await app.fetch(event.request, {
		h3Event: event.nativeEvent,
	});
};

export const GET = createHandler();
export const POST = createHandler();
export const PUT = createHandler();
export const DELETE = createHandler();
export const PATCH = createHandler();
export const OPTIONS = createHandler();
