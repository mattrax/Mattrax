import { defineMutation } from "./mutation";

export const updateUser = defineMutation<{
	id: string;
	name: string;
}>("updateUser", {
	commit: async (data, accessToken) => {
		// TODO: Use Microsoft batching API
		const response = await fetch(
			`https://graph.microsoft.com/beta/users/${data.id}`,
			{
				method: "PATCH",
				headers: {
					"Content-Type": "application/json",
					Authorization: accessToken, // TODO: Get access token
				},
				body: JSON.stringify({
					displayName: data.name,
				}),
			},
		);

		// TODO: Handle Microsoft unauthorised error

		// TODO: Ensure response is reported as valid
	},
	apply: async (db, data) => {
		const tx = db.transaction("users", "readwrite");
		const d = await tx.store.get(data.id);
		if (!d)
			throw new Error(`User ${data.id} not found. Failed to apply update.`);
		await tx.store.put({
			...d,
			name: data.name,
		});
		await tx.done;
	},
});
