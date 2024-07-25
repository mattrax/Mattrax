import { createContextProvider } from "@solid-primitives/context";
import { createQuery } from "@tanstack/solid-query";
import type { IDBPTransaction, StoreNames } from "idb";
import { createSignal } from "solid-js";
import { toast } from "solid-sonner";
import { fetchAndCacheUserData, logout } from "./auth";
import {
	type Database,
	type TableName,
	db,
	invalidateStore,
	subscribeToInvalidations,
} from "./db";

export type SyncEngine = ReturnType<typeof initSyncEngine>;

export const [SyncEngineProvider, useSyncEngine] = createContextProvider(
	(props: { engine: SyncEngine }) => props.engine,
	undefined!,
);

export function initSyncEngine() {
	// TODO: Can this be a shared Atomic so we can solve:
	// TODO:  - If multiple tabs reload during a sync the `nextLink` will be picked up by multiple of them.
	// TODO:  - This will drain network and potentially make Microsoft rate-limit us.
	// TODO:  - We should probs mutex the whole sync process across tabs.
	const [isSyncing, setIsSyncing] = createSignal(false);
	const [totalEntities, setTotalEntities] = createSignal(0);
	const [syncedEntities, setSyncedEntities] = createSignal(0);

	// TODO: Make this update if changed in other tabs (but not reactive cause we don't want to rerun network requests)
	let accessToken: string | undefined;
	const getAccessToken = async () => {
		if (!accessToken)
			accessToken = await (await db).get("_meta", "accessToken");
		return accessToken;
	};

	// TODO: Syncing these signals between tabs

	// TODO: Scope the IndexedDB to the user's tenant??? / deal with tenant switching

	// TODO: Tracking sync progress

	return {
		isSyncing: isSyncing,
		progress: () => {
			const percent = totalEntities() / syncedEntities();
			if (Number.isNaN(percent)) return 0;
			return percent;
		},
		getAccessToken,
		fetch: async (url: string) => {
			const resp = await fetch(url, {
				headers: {
					Authorization: getAccessToken(),
				},
			});
			if (resp.status === 401) logout(); // TODO: Automatic relogin
			if (!resp.ok) throw new Error("Failed to fetch data");
			return await resp.json();
		},
		async syncAll() {
			if (isSyncing()) return;
			setIsSyncing(true);

			try {
				await internalSyncAll(this, await getAccessToken(), false); // TODO: `interactive`
			} catch (err) {
				console.error("Error syncing", err);
			}

			setIsSyncing(false);
		},
	};
}

// TODO: Remove all the following

async function f(
	accessToken: string,
	url: string,
	// TODO: Cleanup this
	decode = (resp: Response) => resp.json(),
	headers: Record<string, string> = {},
) {
	const resp = await fetch(url, {
		headers: {
			Authorization: accessToken,
			...headers,
		},
	});
	if (resp.status === 401) logout(); // TODO: Automatic relogin
	if (!resp.ok) throw new Error("Failed to fetch data");
	return await decode(resp);
}

// TODO: Handle https://learn.microsoft.com/en-us/graph/delta-query-overview#synchronization-reset
export async function syncEntity(
	sync: SyncEngine,
	storeName: StoreNames<Database> & TableName,
	endpoint: string,
	map: (data: any) => any,
	other?: (data: any, db: IDBPTransaction<Database>) => Promise<void>,
) {
	let url: string | null =
		(await await (await db).get("_meta", `${storeName}|delta`)) ||
		`https://graph.microsoft.com${endpoint}`;

	while (url !== null) {
		const accessToken = await sync.getAccessToken();
		const tx = (await db).transaction([storeName, "_meta"], "readwrite");
		const data = await f(accessToken, url);

		if (data["@odata.count"]) {
			console.log("Syncing", storeName, data["@odata.count"]);
		} else {
			console.log("Syncing", storeName, "no count");
		}

		for (const item of data.value) {
			if ("@removed" in item) {
				// TODO: Fail silently cause Microsft returns deleted entities on the initial sync (what crack are Microsoft devs smoking and how can I get some)
				tx.db.delete(storeName, item.id);
				continue;
			}

			// TODO: Handle if a entity is deleted or updated -> Some won't have that
			// TODO: Do an upsert instead of just erroring on duplicate key
			tx.db.add(storeName, map(item));

			// TODO: Can we put this into the existing transaction?? it requires saying which stores to list for???
			await other?.(item, await db);
		}

		if (data["@odata.nextLink"]) {
			url = data["@odata.nextLink"];
			tx.db.put("_meta", data["@odata.nextLink"], `${storeName}|delta`);
		} else if (data["@odata.deltaLink"]) {
			tx.db.put("_meta", data["@odata.deltaLink"], `${storeName}|delta`);
			tx.db.put("_meta", new Date().toString(), `${storeName}|syncedAt`);
			url = null;
		} else {
			tx.db.delete("_meta", `${storeName}|delta`);
			tx.db.put("_meta", new Date().toString(), `${storeName}|syncedAt`);
			url = null;
		}

		await tx.done;
		invalidateStore(["_meta", storeName]);
	}
}

// TODO: Break out into another file
async function internalSyncAll(sync: SyncEngine, interactive = false) {
	const start = performance.now();

	// f(
	// 	await sync.getAccessToken(),
	// 	"https://graph.microsoft.com/beta/users/$count",
	// 	async (resp) => Number.parseInt(await resp.text()),
	// 	{
	// 		ConsistencyLevel: "eventual",
	// 	},
	// ).then((count) => console.log("USERS COUNT", count));

	// TODO: Using batching???
	// fetch("https://graph.microsoft.com/v1.0/$batch", {
	// 	method: "POST",
	// 	headers: new Headers({
	// 		Authorization: await sync.getAccessToken(),
	// 		"Content-Type": "application/json",
	// 	}),
	// 	body: JSON.stringify({
	// 		requests: [
	// 			// TODO: User and user avatar
	// 			{
	// 				id: "1",
	// 				method: "GET",
	// 				url: "/users/$count",
	// 				headers: {
	// 					ConsistencyLevel: "eventual",
	// 				},
	// 			},
	// 			// TODO: Counts of everything
	// 			{
	// 				id: "2",
	// 				method: "GET",
	// 				url: "/users/delta",
	// 			},
	// 			{
	// 				id: "3",
	// 				method: "GET",
	// 				url: "/devices/delta",
	// 			},
	// 			{
	// 				id: "4",
	// 				method: "GET",
	// 				url: "/groups/delta",
	// 			},
	// 			{
	// 				id: "5",
	// 				method: "GET",
	// 				url: "/deviceManagement/configurationPolicies",
	// 			},
	// 			{
	// 				id: "6",
	// 				method: "GET",
	// 				url: "/deviceManagement/deviceConfigurations",
	// 			},
	// 			{
	// 				id: "7",
	// 				method: "GET",
	// 				url: "/deviceManagement/deviceManagementScripts",
	// 			},
	// 			{
	// 				id: "8",
	// 				method: "GET",
	// 				url: "/deviceManagement/deviceShellScripts",
	// 			},
	// 			{
	// 				id: "9",
	// 				method: "GET",
	// 				url: "/deviceAppManagement/mobileApps",
	// 			},
	// 		],
	// 	}),
	// }).then((resp) => {
	// 	console.log("BATCH", resp);
	// });

	// if (resp.status === 401) logout(); // TODO: Automatic relogin
	// if (!resp.ok) throw new Error("Failed to fetch data");
	// return await decode(resp);

	// f(
	// 	await sync.getAccessToken(),
	// 	"https://graph.microsoft.com/v1.0/$batch",
	// 	async (resp) => Number.parseInt(await resp.text()),
	// 	{
	// 		ConsistencyLevel: "eventual",
	// 	},
	// ).then((count) => console.log("USERS COUNT", count));

	const results = await Promise.allSettled([
		syncEntity(
			sync,
			"users",
			"/beta/users/delta?$select=id,userType,userPrincipalName,displayName,givenName,surname,accountEnabled,employeeId,officeLocation,businessPhones,mobilePhone,preferredLanguage,lastPasswordChangeDateTime,createdDateTime&$count=true",
			(user) =>
				({
					id: user.id,
					type: user.userType === "Guest" ? "guest" : "member",
					upn: user.userPrincipalName,
					name: user.displayName,
					nameParts: {
						givenName: user?.givenName,
						surname: user?.surname,
					},
					accountEnabled: user.accountEnabled,
					employeeId: user?.employeeId,
					officeLocation: user?.officeLocation,
					phones: [
						...(user?.businessPhones ?? []),
						...(user?.mobilePhone ? [user.mobilePhone] : []),
					],
					preferredLanguage: user?.preferredLanguage,
					lastPasswordChangeDateTime: user?.lastPasswordChangeDateTime,
					createdDateTime: user.createdDateTime,
				}) satisfies Database["users"]["value"],
		).catch((err) => console.error("Failed to sync users", err)),
		syncEntity(
			sync,
			"devices",
			"/v1.0/devices/delta?$select=id,deviceId,displayName,deviceOwnership,profileType,trustType,enrollmentProfileName,enrollmentType,isCompliant,isManaged,isRooted,managementType,manufacturer,model,operatingSystem,operatingSystemVersion,approximateLastSignInDateTime,registrationDateTime,deviceCategory",
			(device) =>
				({
					id: device.id,
					deviceId: device?.deviceId,
					name: device.displayName,
					deviceOwnership: device?.deviceOwnership || "unknown",
					type: device?.profileType || "unknown",
					trustType: device?.trustType || "unknown",
					enrollment: {
						profileName: device?.enrollmentProfileName,
						type: device?.enrollmentType || "unknown",
					},
					isCompliant: device?.isCompliant,
					isManaged: device?.isManaged || false,
					isRooted: device?.isRooted || false,
					managementType: device?.managementType || "unknown",
					manufacturer: device?.manufacturer,
					model: device?.model,
					operatingSystem: device?.operatingSystem,
					operatingSystemVersion: device?.operatingSystemVersion,
					lastSignInDate: device?.approximateLastSignInDateTime,
					registrationDateTime: device?.registrationDateTime,
					deviceCategory: device?.deviceCategory,
				}) satisfies Database["devices"]["value"],
		).catch((err) => console.error("Failed to sync devices", err)),

		// syncEntity(
		// 	sync,
		// 	"devices",
		// 	"/beta/deviceManagement/managedDevices",
		// 	(device) =>
		// 		({
		// 			// id: device.id,
		// 			// deviceId: device?.deviceId,
		// 			// name: device.displayName,
		// 			// deviceOwnership: device?.deviceOwnership || "unknown",
		// 			// type: device?.profileType || "unknown",
		// 			// trustType: device?.trustType || "unknown",
		// 			// enrollment: {
		// 			// 	profileName: device?.enrollmentProfileName,
		// 			// 	type: device?.enrollmentType || "unknown",
		// 			// },
		// 			// isCompliant: device?.isCompliant,
		// 			// isManaged: device?.isManaged || false,
		// 			// isRooted: device?.isRooted || false,
		// 			// managementType: device?.managementType || "unknown",
		// 			// manufacturer: device?.manufacturer,
		// 			// model: device?.model,
		// 			// operatingSystem: device?.operatingSystem,
		// 			// operatingSystemVersion: device?.operatingSystemVersion,
		// 			// lastSignInDate: device?.approximateLastSignInDateTime,
		// 			// registrationDateTime: device?.registrationDateTime,
		// 			// deviceCategory: device?.deviceCategory,
		// 		}) satisfies Database["devices"]["value"],
		// ).catch((err) => console.error("Failed to sync managed devices", err)),

		syncEntity(
			sync,
			"groups",
			"/v1.0/groups/delta?$select=id,displayName,description,securityEnabled,visibility,createdDateTime,members",
			(group) =>
				({
					id: group.id,
					name: group.displayName,
					description: group?.description,
					securityEnabled: group?.securityEnabled || false,
					visibility: group?.visibility,
					createdDateTime: group.createdDateTime,
				}) satisfies Database["groups"]["value"],
			async (group, db) => {
				// TODO: Await these unless they are correctly being put into the transaction???
				group?.["members@delta"]?.map((member: any) => {
					db.add("groupMembers", {
						groupId: group.id,
						type: member?.["@odata.type"],
						id: member?.["@odata.type"],
					});
				});
			},
		).catch((err) => console.error("Failed to sync groups", err)),
		// These are "Settings Catalog" in Intune
		syncEntity(
			sync,
			"policies",
			"/beta/deviceManagement/configurationPolicies?$select=id,name,description,platforms,technologies,createdDateTime,lastModifiedDateTime&$expand=assignments,settings",
			(policy) =>
				({
					id: policy.id,
					name: policy.name,
					description: policy?.description,
					createdDateTime: policy.createdDateTime,
					lastModifiedDateTime: policy.lastModifiedDateTime,
					platforms: policy.platforms,
					// creationSource: policy?.creationSource,
					// templateReference: policy?.templateReference,
					// priority: policy?.priorityMetaData,
					settings: policy?.settings,

					// TODO:
					assignments: policy?.assignments,
				}) satisfies Database["policies"]["value"],
			async (policy, db) => {
				// TODO: Await these unless they are correctly being put into the transaction???
				policy?.assignments?.map((assignment) => {
					db.add("policyAssignments", {
						policyId: policy.id,
						type: "todo",
						id: "todo",
					});
				});
			},
		).catch((err) => console.error("Failed to sync policies", err)),
		// These are everything else in Intune
		syncEntity(
			sync,
			"policies",
			"/beta/deviceManagement/deviceConfigurations?$select=id,displayName,description,createdDateTime,lastModifiedDateTime,version&$expand=assignments",
			(policy) =>
				({
					id: policy.id,
					name: policy.displayName,
					description: policy?.description,
					createdDateTime: policy.createdDateTime,
					lastModifiedDateTime: policy.lastModifiedDateTime,

					"@odata.type": policy["@odata.type"],
					version: policy.version,

					// TODO:
					assignments: policy?.assignments,
				}) satisfies Database["policies"]["value"],
		).catch((err) => console.error("Failed to sync policies", err)),
		syncEntity(
			sync,
			"scripts",
			"/beta/deviceManagement/deviceManagementScripts?$expand=assignments,groupAssignments",
			(script) =>
				({
					id: script.id,
					name: script.displayName,
					scriptContent: script.scriptContent,
					fileName: script.fileName,
					createdDateTime: script.createdDateTime,
					lastModifiedDateTime: script.lastModifiedDateTime,

					// TODO:
					assignments: script?.assignments,
					groupAssignments: script?.groupAssignments,
				}) satisfies Database["scripts"]["value"],
		).catch((err) => console.error("Failed to sync scripts", err)),
		syncEntity(
			sync,
			"scripts",
			"/beta/deviceManagement/deviceShellScripts?$expand=assignments,groupAssignments",
			(script) =>
				({
					id: script.id,
					name: script.displayName,
					scriptContent: script.scriptContent,
					fileName: script.fileName,
					createdDateTime: script.createdDateTime,
					lastModifiedDateTime: script.lastModifiedDateTime,

					// TODO:
					assignments: script?.assignments,
					groupAssignments: script?.groupAssignments,
				}) satisfies Database["scripts"]["value"],
		).catch((err) => console.error("Failed to sync scripts", err)),
		syncEntity(
			sync,
			"apps",
			"/beta/deviceAppManagement/mobileApps?$select=id,displayName,description,publisher,largeIcon,createdDateTime,lastModifiedDateTime,isFeatured,privacyInformationUrl,informationUrl,owner,developer,notes&$expand=assignments",
			(app) =>
				({
					id: app.id,
					type: app["@odata.type"],
					name: app.displayName,
					description: app?.description,
					publisher: app?.publisher,
					largeIcon: app?.largeIcon,
					createdDateTime: app.createdDateTime,
					lastModifiedDateTime: app.lastModifiedDateTime,
					isFeatured: app?.isFeatured || false,
					privacyInformationUrl: app?.privacyInformationUrl,
					informationUrl: app?.informationUrl,
					owner: app?.owner,
					developer: app?.developer,
					notes: app?.notes,

					// TODO:
					assignments: app.assignments,
				}) satisfies Database["apps"]["value"],
		).catch((err) => console.error("Failed to sync apps", err)),
	]);

	// const reusableSettings = await f(
	// 	accessToken,
	// 	"https://graph.microsoft.com/beta/deviceManagement/reusableSettings",
	// );
	// localStorage.setItem("reusableSettings", JSON.stringify(reusableSettings));

	// TODO: We might wanna filter cause this takes 14seconds
	// const configurationSettings = await f(
	// 	accessToken,
	// 	"https://graph.microsoft.com/beta/deviceManagement/configurationSettings",
	// );
	// localStorage.setItem(
	// 	"configurationSettings",
	// 	JSON.stringify(configurationSettings),
	// );

	// console.log(
	// 	await f(
	// 		accessToken,
	// 		"https://graph.microsoft.com/beta/deviceManagement/managedDevices",
	// 	),
	// );

	let hitError = false;
	for (const result of results) {
		if (result.status === "rejected") {
			toast.error("Failed to sync data", {
				id: "synced",
				description: result.reason,
			});
			hitError = true;
		}
	}

	const end = (performance.now() - start) / 1000;
	console.log("Synced all data in", end.toFixed(2), "s");
	if (!hitError && interactive)
		toast.success("Sync complete", {
			id: "synced",
			description: `Sync with Microsoft completed in ${Math.round(end)}s`,
		});
}

// TODO: Maybe move to another file?
export function useUser() {
	const sync = useSyncEngine();

	// TODO: move this into the sync engine instead of TSQ???

	let initialData = undefined;
	try {
		const data = localStorage.getItem("user");
		if (data) initialData = JSON.parse(data);
	} catch (err) {
		console.error("Error parsing cached user", err);
	}

	// TODO: Maybe adding in `https://graph.microsoft.com/v1.0/me/photo`???

	// const accessToken = useAccessToken();
	const query = createQuery(() => ({
		queryKey: ["me"],
		queryFn: async () =>
			await fetchAndCacheUserData(await sync.getAccessToken()),
		// So Typescript infers from `queryFn`
		initialData: initialData as never,
	}));

	subscribeToInvalidations((store) => {
		if (store === "auth") query.refetch();
	});

	return query;
}

export async function fetchUserData(accessToken: string) {
	return await f(accessToken, "https://graph.microsoft.com/v1.0/me");
}

export async function getConfigurationSettings(accessToken: string) {
	const existing = await (await db).get("_meta", "configurationSettings");
	if (existing) return existing;

	// TODO: We should filter cause this could 14 seconds
	const result = await f(
		accessToken,
		"https://graph.microsoft.com/beta/deviceManagement/configurationSettings",
	);
	await (await db).put("_meta", result, "configurationSettings");
	return result;
}

export async function getConfigurationCategories(accessToken: string) {
	const existing = await (await db).get("_meta", "configurationCategories");
	if (existing) return existing;

	const result = await f(
		accessToken,
		"https://graph.microsoft.com/beta/deviceManagement/configurationCategories",
	);
	await (await db).put("_meta", result, "configurationCategories");
	return result;
}
