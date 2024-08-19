import { defineAction } from "../action";
import { registerBatchedOperationAsync } from "../microsoft";

export const createDomain = defineAction<{
	domain: string;
}>("createDomain", {
	async commit(data, accessToken) {
		// const responses = await registerBatchedOperationAsync(
		// 	{
		// 		id: crypto.randomUUID(),
		// 		method: "POST",
		// 		url: `/domains/${encodeURIComponent(data.domain)}/verify`,
		// 		headers: {
		// 			"Content-Type": "application/json",
		// 		},
		// 		body: {},
		// 	},
		// 	accessToken,
		// );
		// const resp = responses[0]!;
		// // TODO: Work out if error is dns error or not?
		// if (resp.status !== 200)
		// 	throw new Error(
		// 		`Failed to update organisation. Got status ${resp.status}`,
		// 	);
		// console.log(resp);
	},
});

export const verifyDomain = defineAction<{
	domain: string;
}>("verifyDomain", {
	async commit(data, accessToken) {
		const responses = await registerBatchedOperationAsync(
			{
				id: crypto.randomUUID(),
				method: "POST",
				url: `/domains/${encodeURIComponent(data.domain)}/verify`,
				headers: {
					"Content-Type": "application/json",
				},
				body: {},
			},
			accessToken,
		);

		const resp = responses[0]!;

		// TODO: Work out if error is dns error or not?

		if (resp.status !== 200)
			throw new Error(
				`Failed to update organisation. Got status ${resp.status}`,
			);

		console.log(resp);
	},
});

// export async function setPrimaryDomain() {}

// export async function deleteDomain() {}
