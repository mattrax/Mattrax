import {
	AnyRouter,
	DataTransformer,
	ProcedureType,
	callProcedure,
} from "@trpc/server";
import { Operation, TRPCClientError, TRPCLink } from "@trpc/client";
import { type TRPCResponse } from "@trpc/server/rpc";
import { observable } from "@trpc/server/observable";

import { dataLoader } from "./dataLoader";

export type TrpcServerFunctionOpts = {
	operations: Array<Pick<Operation, "path" | "input">>;
	type: ProcedureType;
};
export type TrpcServerFunction<TRouter extends AnyRouter = AnyRouter> = (
	opts: TrpcServerFunctionOpts,
) => TrpcServerFunctionResult<TRouter>;

export type TrpcServerFunctionResult<TRouter extends AnyRouter> = Promise<
	Array<Promise<TRPCResponse>> & { _router: TRouter }
>;

export async function trpcServerFunction<TRouter extends AnyRouter>(args: {
	router: TRouter;
	createContext: () => any;
	opts: TrpcServerFunctionOpts;
}): TrpcServerFunctionResult<TRouter> {
	const ctx = args.createContext();

	return args.opts.operations.map(async (o) => ({
		result: {
			data: callProcedure({
				procedures: args.router._def.procedures,
				path: o.path,
				rawInput: o.input,
				ctx,
				type: args.opts.type,
			}),
		},
	})) as unknown as TrpcServerFunctionResult<TRouter>;
}

export const createServerFunctionLink = <TRouter extends AnyRouter>(
	requester: TrpcServerFunction<TRouter>,
): TRPCLink<TRouter> => {
	return () => {
		const batchLoader = (type: ProcedureType) => {
			const fetch = (batchOps: Operation[]) => ({
				promise: requester({
					operations: batchOps.map((o) => ({
						path: o.path,
						input: o.input,
					})),
					type: type,
				}),
				cancel: () => {},
			});

			return { fetch, validate: () => true };
		};

		const query = dataLoader(batchLoader("query"));
		const mutation = dataLoader(batchLoader("mutation"));
		const subscription = dataLoader(batchLoader("subscription"));

		const loaders = { query, subscription, mutation };

		return ({ op }) => {
			return observable((observer) => {
				const loader = loaders[op.type];
				const { promise, cancel } = loader.load(op);

				promise
					.then((r) => r)
					.then((response) => {
						if ("error" in response) {
							observer.error(
								TRPCClientError.from(
									response,
									// 	, {
									// 	meta: response.meta,
									// }
								),
							);
							return;
						} else {
							observer.next({
								// context: res.meta,
								result: response.result,
							});
							observer.complete();
						}
					})
					.catch((err) => {
						observer.error(
							TRPCClientError.from(
								err,
								// 	{
								// 	meta: _res?.meta,
								// }
							),
						);
					});

				return cancel;
			});
		};
	};
};

export const seroval: DataTransformer = {
	serialize: (d) => d,
	deserialize: (d) => d,
};
