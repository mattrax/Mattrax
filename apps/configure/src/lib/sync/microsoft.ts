import type { Operation, OperationGroup, OperationResponse } from "./state";

const operations: OperationGroup[] = [];

// TODO: Maybe build Zod support directly into this
export async function registerBatchedOperationAsync(
	op: Operation | Operation[],
	accessToken: string,
): Promise<OperationResponse[]> {
	return await new Promise((resolve) => {
		if (Array.isArray(op) && op.length === 0) return; // TODO: `resolve` never called so stalls!!!!
		operations.push({
			ops: Array.isArray(op) ? op : [op],
			callback: resolve,
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

			// TODO: Use the special `fetch` wrapper that handles unauthorised, refresh tokens, etc

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
					await group.callback(args);
				}),
			);
		}, 20);
	});
}
