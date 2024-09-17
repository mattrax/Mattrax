import { useParams } from "@solidjs/router";
import { createEffect } from "solid-js";
import { createStore, reconcile } from "solid-js/store";
import { z } from "zod";

export function useZodParams<S extends z.ZodRawShape>(schema: S) {
	const zodSchema = z.object(schema);
	const params = useParams();

	const [parsedParams, setParsedParams] = createStore(zodSchema.parse(params));

	createEffect(
		() => {
			setParsedParams(reconcile(zodSchema.parse(params)));
		},
		{ defer: true },
	);

	return parsedParams;
}
