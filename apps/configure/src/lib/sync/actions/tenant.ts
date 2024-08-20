import { getKey, putKey } from "~/lib/kv";
import { defineAction } from "../action";
import { registerBatchedOperationAsync } from "../microsoft";
import { domainSchema } from "../schema/auth";

export const createDomain = defineAction<{
	domain: string;
}>("createDomain", {
	async commit(data, accessToken, db) {
		const responses = await registerBatchedOperationAsync(
			{
				id: crypto.randomUUID(),
				method: "POST",
				url: "/domains",
				headers: {
					"Content-Type": "application/json",
				},
				body: {
					id: data.domain,
				},
			},
			accessToken,
		);

		// TODO: Handle `ObjectConflict` error
		// "body": {
		//         "error": {
		//             "code": "Request_BadRequest",
		//             "message": "Another object with the same value for property id already exists.",
		//             "details": [
		//                 {
		//                     "code": "ObjectConflict",
		//                     "message": "Another object with the same value for property id already exists.",
		//                     "target": "id"
		//                 }
		//             ],
		//             "innerError": {
		//                 "date": "2024-08-20T04:25:57",
		//                 "request-id": "e87c1654-53e7-4a9f-a0ca-4eae330fedac",
		//                 "client-request-id": "e87c1654-53e7-4a9f-a0ca-4eae330fedac"
		//             }
		//         }
		//     }

		const resp = responses[0]!;
		// TODO: Work out if error is dns error or not?
		if (resp.status !== 200 && resp.status !== 201 && resp.status !== 204) {
			// TODO: Really the error would be nice if it didn't have the prefix for the toast. So we should handle errors differently?
			// @ts-expect-error
			if (resp.body?.error?.message)
				// @ts-expect-error
				// TODO: Failed to create domain prefix????
				throw new Error(resp.body.error.message);

			throw new Error(`Failed to create domain. Got status ${resp.status}`);
		}
		console.log(resp);

		const result = domainSchema.safeParse(resp.body);
		if (result.error)
			throw new Error(
				`Failed to parse domain create response. ${result.error.message}`,
			);

		// TODO: Can we hold a proper DB lock here cause this seems prone to race conditions
		const org = await getKey(db, "org");
		if (!org) return;
		await putKey(db, "org", {
			...org,
			domains: [
				...org.domains.filter((d) => d.id !== result.data.id),
				result.data,
			].sort((a, b) => a.id.localeCompare(b.id)),
		});
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

export const deleteDomain = defineAction<{
	domain: string;
}>("deleteDomain", {
	async commit(data, accessToken, db) {
		const responses = await registerBatchedOperationAsync(
			{
				id: crypto.randomUUID(),
				method: "DELETE",
				url: `/domains/${encodeURIComponent(data.domain)}`,
				headers: {
					"Content-Type": "application/json",
				},
				body: {},
			},
			accessToken,
		);

		const resp = responses[0]!;

		if (resp.status !== 200 && resp.status !== 204) {
			// TODO: Really the error would be nice if it didn't have the prefix for the toast. So we should handle errors differently?
			// @ts-expect-error
			if (resp.body?.error?.message)
				// @ts-expect-error
				// TODO: Failed to create domain prefix????
				throw new Error(resp.body.error.message);

			throw new Error(`Failed to delete domain. Got status ${resp.status}`);
		}

		// TODO: Can we hold a proper DB lock here cause this seems prone to race conditions
		const org = await getKey(db, "org");
		if (!org) return;
		await putKey(db, "org", {
			...org,
			domains: org.domains
				.filter((d) => d.id !== data.domain)
				.sort((a, b) => a.id.localeCompare(b.id)),
		});
	},
});

// TODO: Promote a domain to the primary domain
