import { Operation, TRPCClientError, TRPCLink } from "@trpc/client";
import { AnyRouter, ProcedureType, callProcedure } from "@trpc/server";
import { type TRPCResponse } from "@trpc/server/rpc";
import { observable } from "@trpc/server/observable";
import { getEvent } from "vinxi/http";

import { appRouter, createTRPCContext } from "~/api";
import { dataLoader } from "./dataLoader";

async function serverFunctionHandler(opts: {
	operations: Array<Pick<Operation, "path" | "input">>;
	type: ProcedureType;
}): Promise<TRPCResponse[]> {
	"use server";

	const ctx = createTRPCContext(getEvent());

	return await Promise.all(
		opts.operations.map(async (o) => ({
			result: {
				data: await callProcedure({
					procedures: appRouter._def.procedures,
					path: o.path,
					rawInput: o.input,
					ctx,
					type: opts.type,
				}),
			},
		})),
	);
}

const serverFunctionRequester =
	(requesterOpts: { type: ProcedureType }) => (batchOps: Operation[]) => ({
		promise: serverFunctionHandler({
			operations: batchOps.map((o) => ({
				path: o.path,
				input: o.input,
			})),
			type: requesterOpts.type,
		}),
		cancel: () => {},
	});

export const createServerFunctionLink = <
	TRouter extends AnyRouter,
>(): TRPCLink<TRouter> => {
	return () => {
		const batchLoader = (type: ProcedureType) => {
			const fetch = serverFunctionRequester({ type });

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
