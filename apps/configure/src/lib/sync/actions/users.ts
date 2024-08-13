import { defineAction } from "../action";

// TODO: Some inference of fields on Zod/sync schema?

export const createUser = defineAction<{
	id: string;
	displayName: string;
	accountEnabled: boolean;
	mailNickname: string;
	passwordProfile: any; // TODO
	userPrincipalName: string;
}>("createUser", {
	commit: async (data, accessToken) => {
		// TODO: Use Microsoft batching API
		const response = await fetch("https://graph.microsoft.com/beta/users", {
			method: "PATCH",
			headers: {
				"Content-Type": "application/json",
				Authorization: accessToken,
			},
			body: JSON.stringify({
				// displayName: data.name,
			}),
		});
		// TODO: Handle Microsoft unauthorised error
		// TODO: Ensure response is reported as valid
	},
	apply: async (db, data) => {
		// db.put("users", {}); // TODO: Da hell is the `id` gonna be?
	},
	rollback: async (db, data) => {
		// TODO: We really need a rollback if this fails to commit to Microsoft
	},
});

export const updateUser = defineAction<{
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
					Authorization: accessToken,
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
	rollback: async (db, data) => {
		// TODO: We really need a rollback if this fails to commit to Microsoft
	},
});

export const deleteUser = defineAction<{
	id: string;
}>("deleteUser", {
	commit: async (data, accessToken) => {
		// TODO: Use Microsoft batching API
		const response = await fetch(
			`https://graph.microsoft.com/beta/users/${data.id}`,
			{
				method: "DELETE",
				headers: {
					Authorization: accessToken,
				},
			},
		);
		// TODO: Handle Microsoft unauthorised error
		// TODO: Ensure response is reported as valid
	},
	apply: async (db, data) => {
		// TODO
	},
	rollback: async (db, data) => {
		// TODO: We really need a rollback if this fails to commit to Microsoft
	},
});
