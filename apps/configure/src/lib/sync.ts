import { createQuery } from "@tanstack/solid-query";
import type { StoreNames } from "idb";
import { toast } from "solid-sonner";
import { fetchAndCacheUserData, logout, useAccessToken } from "./auth";
import {
	type Database,
	type TableName,
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
export async function syncEntity(
	accessToken: string,
	storeName: StoreNames<Database> & TableName,
	endpoint: string,
	map: (data: any) => any,
) {
	let url: string | null =
		(await await (await db).get("_meta", `${storeName}|delta`)) ||
		`https://graph.microsoft.com${endpoint}`;

	while (url !== null) {
		const tx = (await db).transaction([storeName, "_meta"], "readwrite");
		const data = await f(accessToken, url);

		for (const item of data.value) {
			if ("@removed" in item) {
				// TODO: Fail silently cause Microsft returns deleted entities on the initial sync (what crack are Microsoft devs smoking and how can I get some)
				tx.db.delete(storeName, item.id);
				continue;
			}

			// TODO: Handle if a entity is deleted or updated -> Some won't have that
			// TODO: Do an upsert instead of just erroring on duplicate key
			tx.db.add(storeName, map(item));
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

export async function syncAll(accessToken: string, interactive = false) {
	const start = performance.now();
	const results = await Promise.allSettled([
		syncEntity(
			accessToken,
			"users",
			"/v1.0/users/delta?$select=id,userType,userPrincipalName,displayName,givenName,surname,accountEnabled,employeeId,officeLocation,businessPhones,mobilePhone,preferredLanguage,lastPasswordChangeDateTime,createdDateTime",
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
			accessToken,
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
		syncEntity(
			accessToken,
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
					// TODO: Move into dedicated table
					// @ts-expect-error
					members:
						group?.["members@delta"]?.map((member) => [
							// TODO: Filter unknown typed like enterprise apps
							member?.["@odata.type"],
							member.id,
						]) || [],
				}) satisfies Database["groups"]["value"],
		).catch((err) => console.error("Failed to sync groups", err)),
		// These are "Settings Catalog" in Intune
		syncEntity(
			accessToken,
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
		).catch((err) => console.error("Failed to sync policies", err)),
		// These are everything else in Intune
		syncEntity(
			accessToken,
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
			accessToken,
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
			accessToken,
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
			accessToken,
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
		queryFn: () => fetchAndCacheUserData(accessToken()),
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
