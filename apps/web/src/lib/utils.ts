import { twMerge } from "tailwind-merge";
import type { ClassValue } from "clsx";
import { clsx } from "clsx";
import { CreateQueryResult } from "@tanstack/solid-query";
import { createEffect, createMemo, onMount } from "solid-js";
import { toast } from "solid-sonner";
import { useNavigate } from "@solidjs/router";
import { trpc } from "./trpc";

export function cn(...inputs: ClassValue[]) {
	return twMerge(clsx(inputs));
}

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
