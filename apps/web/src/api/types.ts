import type { APIEvent } from "@solidjs/start/server";
import type { H3Event } from "h3";

export type HonoEnv = {
	Bindings: {
		h3Event: H3Event;
		event: APIEvent;
	};
};
