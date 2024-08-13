import { z } from "zod";
import { UnauthorizedError } from ".";

export type Operation = {
	id: string;
	method: "GET" | "POST" | "PATCH" | "DELETE";
	url: string;
	headers?: Record<string, string>;
};

export type OperationResponse = {
	id: string;
	body: unknown;
	headers: Record<string, string>;
	status: number;
};

type OperationGroup = {
	ops: Operation[];
	resolve: (data: OperationResponse[]) => void;
};

const operations: OperationGroup[] = [];

// TODO: Maybe build Zod support directly into this
export async function registerBatchedOperationAsync(
	op: Operation | Operation[],
	accessToken: string,
): Promise<OperationResponse[]> {
	return await new Promise((resolve, reject) => {
		if (Array.isArray(op) && op.length === 0) return; // TODO: `resolve` never called so stalls!!!!
		operations.push({
			ops: Array.isArray(op) ? op : [op],
			resolve,
		});

		// Batching using a timer is technically slower but it allows us to fully separate the logic into layer which is worth it.
		setTimeout(async () => {
			if (operations.length === 0) return; // TODO: This could request in the promise never resolving?
			const ops = operations.splice(0, operations.length);

			const requests = ops.flatMap((s) => s.ops);
			if (requests.length === 0) return; // TODO: This could request in the promise never resolving?

			const resp = await fetch("https://graph.microsoft.com/beta/$batch", {
				method: "POST",
				headers: new Headers({
					"Content-Type": "application/json",
					Authorization: accessToken,
				}),
				body: JSON.stringify({
					requests,
				}),
			});
			if (resp.status === 401) return reject(new UnauthorizedError());
			if (!resp.ok) throw new Error("Failed to fetch data");

			const data = await resp.json();

			await Promise.all(
				ops.map(async (group) => {
					const args = [];
					for (const op of group.ops) {
						const r = data.responses.find((r: any) => r.id === op.id);
						if (!r)
							throw new Error(
								`Expected to find response with id "${r.id}" but it was not found!`,
							);
						args.push(r);
					}
					await group.resolve(args);
				}),
			);
		}, 20);
	});
}

export function odataResponseSchema<S extends z.ZodTypeAny>(schema: S) {
	return z.object({
		"@odata.deltaLink": z.string().optional(),
		"@odata.nextLink": z.string().optional(),
		"@odata.count": z.number().optional(),
		value: z.array(
			z.union([
				schema,
				z.object({ "@removed": z.object({}).passthrough(), id: z.any() }),
			]),
		),
	});
}
