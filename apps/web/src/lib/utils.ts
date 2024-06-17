import { useNavigate } from "@solidjs/router";
import type { CreateQueryResult } from "@tanstack/solid-query";
import { createEffect, createMemo } from "solid-js";
import { toast } from "solid-sonner";
import { trpc } from "./trpc";

export function createNotFoundRedirect<T>(props: {
	query: CreateQueryResult<T | null, any>;
	toast: string;
	to: string;
}) {
	createEffect(() => {
		if (props.query.data === null) {
			toast.error(props.toast);
			useNavigate()(props.to);
		}
	});
}
export function useNameFromListQuery(
	getData: (
		trpcCtx: ReturnType<typeof trpc.useContext>,
	) => Array<{ name: string; id: string }> | undefined,
	getId: () => string,
) {
	const trpcCtx = trpc.useContext();

	return createMemo(
		() => getData(trpcCtx)?.find((data) => data.id === getId())?.name,
	);
}

export function toTitleCase(str: string) {
	return str.replace(/\w\S*/g, (txt) => {
		return txt.charAt(0).toUpperCase() + txt.substr(1).toLowerCase();
	});
}

export function parseJson(json: string | undefined) {
	if (!json) return undefined;
	try {
		return JSON.parse(json);
	} catch (e) {
		return undefined;
	}
}
