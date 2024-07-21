import { createQuery } from "@tanstack/solid-query";
import type { StoreNames } from "idb";
import { useAccessToken } from "../routes/(dash)";
import { logout } from "./auth";
import {
	type Database,
	db,
	invalidateStore,
	subscribeToInvalidations,
} from "./db";

// TODO: If multiple tabs reload during a sync the `nextLink` will be picked up by multiple of them.
// TODO: This will drain network and potentially make Microsoft rate-limit us.
// TODO: We should probs mutex the whole sync process across tabs.

async function f(accessToken: string, url: string) {
	const resp = await fetch(url, {
		headers: {
			Authorization: accessToken,
		},
	});
	if (resp.status === 401) logout(); // TODO: Automatic relogin
	if (!resp.ok) throw new Error("Failed to fetch data");
	return await resp.json();
}

// TODO: Handle https://learn.microsoft.com/en-us/graph/delta-query-overview#synchronization-reset
export async function syncEntityWithDelta(
	accessToken: string,
	storeName: StoreNames<Database>,
	map: (data: any) => any,
) {
	let url: string | null =
		(await await (await db).get("_meta", storeName)) ||
		`https://graph.microsoft.com/v1.0/${storeName}/delta`;

	while (url !== null) {
		const tx = (await db).transaction([storeName, "_meta"], "readwrite");
		const data = await f(accessToken, url);

		for (const item of data.value) {
			// TODO: Handle if a entity is deleted or updated
			// TODO: Do an upsert instead of just erroring on duplicate key
			tx.db.add(storeName, map(item));
		}

		if (data["@odata.nextLink"]) {
			console.log("More data to fetch...");
			url = data["@odata.nextLink"];
			tx.db.put("_meta", data["@odata.nextLink"], storeName);
		}
		if (data["@odata.deltaLink"]) {
			console.log("Got Delta link", data["@odata.deltaLink"]);
			tx.db.put("_meta", data["@odata.deltaLink"], storeName);
			url = null;
		}

		await tx.done;
		invalidateStore(["_meta", storeName]);
	}
}

// Microsoft is mega cringe and doesn't support delta queries for some endpoints
// TODO: I think this might be able to be merged with `syncEntityWithDelta` into one function???
export async function syncEntityWithoutDelta(
	accessToken: string,
	storeName: StoreNames<Database>,
	map: (data: any) => any,
	microsoftGraphEndpoint: string,
) {
	let url: string | null =
		`https://graph.microsoft.com/beta/${microsoftGraphEndpoint}?top=100`;

	while (url !== null) {
		const tx = (await db).transaction([storeName, "_meta"], "readwrite");
		const data = await f(accessToken, url);

		for (const item of data.value) {
			// TODO: Handle if a entity is deleted or updated
			// TODO: Do an upsert instead of just erroring on duplicate key
			tx.db.add(storeName, map(item));
		}

		if (data["@odata.nextLink"]) {
			console.log("More to fetch...");
			url = data["@odata.nextLink"];
			tx.db.put("_meta", data["@odata.nextLink"], storeName);
		} else {
			console.log("Done...");
			tx.db.delete("_meta", storeName);
			url = null;
		}

		await tx.done;
		invalidateStore(["_meta", storeName]);
	}
}

export async function syncAll(accessToken: string) {
	const result = await Promise.allSettled([
		syncEntityWithDelta(accessToken, "users", (user) => ({
			id: user.id,
			name: user.displayName,
			upn: user.userPrincipalName,
		})),
		syncEntityWithDelta(accessToken, "devices", (device) => {
			console.log(device);
			return {
				id: device.id,
				name: device.displayName,
			};
		}),
		syncEntityWithDelta(accessToken, "groups", (group) => {
			console.log(group);
			return {
				id: group.id,
				name: group.displayName,
			};
		}),
		syncEntityWithoutDelta(
			accessToken,
			"policies",
			(policy) => {
				console.log(policy);
				return {
					id: policy.id,
					name: policy.name,
				};
			},
			"deviceManagement/configurationPolicies",
		),
		syncEntityWithoutDelta(
			accessToken,
			"apps",
			(app) => {
				console.log(app);
				return {
					id: app.id,
					name: app.displayName,
				};
			},
			"deviceAppManagement/mobileApps",
		),
	]);

	// TODO: Handle errors with toast message or something
	console.log(result);
}

// TODO: Maybe move to another file?
export function useUser() {
	let initialData = undefined;
	try {
		const data = localStorage.getItem("user");
		if (data) initialData = JSON.parse(data);
	} catch (err) {
		console.error("Error parsing cached user", err);
	}

	// TODO: Maybe adding in `https://graph.microsoft.com/v1.0/me/photo`???

	const accessToken = useAccessToken();
	const query = createQuery(() => ({
		queryKey: ["me"],
		queryFn: async () => {
			const data = await f(accessToken, "https://graph.microsoft.com/v1.0/me");
			const result = {
				id: data.id,
				name: data.displayName,
				upn: data.userPrincipalName,
			};
			localStorage.setItem("user", JSON.stringify(result));
			return result;
		},
		// So Typescript infers from `queryFn`
		initialData: initialData as never,
	}));

	subscribeToInvalidations((store) => {
		if (store === "auth") query.refetch();
	});

	return query;
}
