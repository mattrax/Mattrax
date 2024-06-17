import type { UseTRPCQueryResult } from "@solid-mediakit/trpc";

type Opts = {
	onSuccess?: () => void;
	blockOn?: boolean;
};

export function withDependantQueries(
	queries: UseTRPCQueryResult<any, any> | UseTRPCQueryResult<any, any>[],
	opts?: Opts,
): object {
	return {
		trpc: {
			context: {
				paths: Array.isArray(queries)
					? queries.map((query) => query.trpc.queryKey)
					: [queries.trpc.queryKey],
				...opts,
			},
		},
	} as const;
}
