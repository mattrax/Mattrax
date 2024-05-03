import type { UseTRPCQueryResult } from "@solid-mediakit/trpc";

export function withDependantQueries(
	queries: UseTRPCQueryResult<any, any> | UseTRPCQueryResult<any, any>[],
) {
	return {
		trpc: {
			context: {
				paths: Array.isArray(queries)
					? queries.map((query) => query.trpc.queryKey)
					: [queries.trpc.queryKey],
			},
		},
	};
}
