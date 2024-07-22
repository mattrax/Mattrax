/// Coped from `@mattrax/web` we should probs break out and share?

import { Input } from "@mattrax/ui";
import { useSearchParams } from "@solidjs/router";
import type { CreateQueryResult } from "@tanstack/solid-query";
import type { ComponentProps } from "solid-js";

export function TableSearchParamsInput(
	props: Omit<
		ComponentProps<typeof Input>,
		"placeholder" | "value" | "onInput"
	> & {
		query: CreateQueryResult<any, any>;
		// defaults to "search"
		searchParam?: string;
	},
) {
	const [searchParams, setSearchParams] = useSearchParams();

	const searchParam = () => props.searchParam ?? "search";

	return (
		<Input
			{...props}
			placeholder={props.query.isLoading ? "Loading..." : "Search..."}
			disabled={props.query.isLoading || props.disabled}
			value={searchParams[searchParam()] ?? ""}
			onInput={(event) =>
				setSearchParams({ [searchParam()]: event.target.value })
			}
		/>
	);
}
