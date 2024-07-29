// This file defines all syncable entities.
// All exports are automatically registered.

import type { IDBPDatabase } from "idb";
import { z } from "zod";
import type { Database } from "../db";
import { mapUser } from "../sync";
import { defineSyncEntity } from "./entity";
import { registerBatchedOperation } from "./state";

export async function me(db: IDBPDatabase<Database>, i: number) {
	const me = await db.get("_kv", "user");

	if (i === 0)
		registerBatchedOperation(
			[
				{
					id: "me",
					method: "GET",
					url: "/me?$select=id,displayName,userPrincipalName",
				},
				{
					id: "mePhoto",
					method: "GET",
					url: "/me/photo/$value",
					headers: {
						"If-None-Match": me?.avatarEtag,
					},
				},
			],
			async ([me, mePhoto]) => {
				if (me.status !== 200)
					throw new Error(`Failed to fetch me. Got status ${me.status}`);

				const user = mapUser(me.body);

				// Will be `404` if the user has no photo.
				if (mePhoto.status === 200) {
					user.avatar = `data:image/*;base64,${mePhoto.body}`;
					user.avatarEtag = mePhoto.headers?.ETag;
				} else if (mePhoto.status !== 404 && mePhoto.status !== 304) {
					// We only log cause this is not a critical error.
					console.error(
						`Failed to fetch me photo. Got status ${mePhoto.status}`,
					);
				}

				// TODO: Fix types
				await db.put("_kv", user, "user");
			},
		);
}

export const users = defineSyncEntity("users", {
	endpoint:
		"/users/delta?$select=id,userType,userPrincipalName,displayName,givenName,surname,accountEnabled,employeeId,officeLocation,businessPhones,mobilePhone,preferredLanguage,lastPasswordChangeDateTime,createdDateTime",
	countEndpoint: "/users/$count",
	schema: z.object({
		id: z.string(),
	}),
	upsert: async (user) => {
		console.log("INSERT USER", user);
	},
	delete: async (id) => {
		console.log("DELETE USER", id);
	},

	// (user) =>
	// ({
	// 	id: user.id,
	// 	type: user.userType === "Guest" ? "guest" : "member",
	// 	upn: user.userPrincipalName,
	// 	name: user.displayName,
	// 	nameParts: {
	// 		givenName: user?.givenName,
	// 		surname: user?.surname,
	// 	},
	// 	accountEnabled: user.accountEnabled,
	// 	employeeId: user?.employeeId,
	// 	officeLocation: user?.officeLocation,
	// 	phones: [
	// 		...(user?.businessPhones ?? []),
	// 		...(user?.mobilePhone ? [user.mobilePhone] : []),
	// 	],
	// 	preferredLanguage: user?.preferredLanguage,
	// 	lastPasswordChangeDateTime: user?.lastPasswordChangeDateTime,
	// 	createdDateTime: user.createdDateTime,
	// }) satisfies Database["users"]["value"],
});

export const devices = defineSyncEntity("devices", {
	endpoint:
		"/devices/delta?$select=id,deviceId,displayName,deviceOwnership,profileType,trustType,enrollmentProfileName,enrollmentType,isCompliant,isManaged,isRooted,managementType,manufacturer,model,operatingSystem,operatingSystemVersion,approximateLastSignInDateTime,registrationDateTime,deviceCategory",
	countEndpoint: "/devices/$count",
	schema: z.object({
		id: z.string(),
	}),
	upsert: async (user) => {
		console.log("INSERT DEVICE", user);
	},
	delete: async (id) => {
		console.log("DELETE DEVICE", id);
	},

	// (device) =>
	// ({
	// 	id: device.id,
	// 	deviceId: device?.deviceId,
	// 	name: device.displayName,
	// 	deviceOwnership: device?.deviceOwnership || "unknown",
	// 	type: device?.profileType || "unknown",
	// 	trustType: device?.trustType || "unknown",
	// 	enrollment: {
	// 		profileName: device?.enrollmentProfileName,
	// 		type: device?.enrollmentType || "unknown",
	// 	},
	// 	isCompliant: device?.isCompliant,
	// 	isManaged: device?.isManaged || false,
	// 	isRooted: device?.isRooted || false,
	// 	managementType: device?.managementType || "unknown",
	// 	manufacturer: device?.manufacturer,
	// 	model: device?.model,
	// 	operatingSystem: device?.operatingSystem,
	// 	operatingSystemVersion: device?.operatingSystemVersion,
	// 	lastSignInDate: device?.approximateLastSignInDateTime,
	// 	registrationDateTime: device?.registrationDateTime,
	// 	deviceCategory: device?.deviceCategory,
	// }) satisfies Database["devices"]["value"],
});

// export const devices2 = defineSyncEntity("devices", {
// 	endpoint: "/deviceManagement/managedDevices",
// 	countEndpoint: "/devices/$count",
// 	schema: z.object({
// 		id: z.string(),
// 	}),
// 	upsert: async (user) => {
// 		console.log("INSERT DEVICE", user);
// 	},
// 	delete: async (id) => {
// 		console.log("DELETE DEVICE", id);
// 	},

// 	// (device) =>
// 	// ({
// 	// 	id: device.id,
// 	// 	deviceId: device?.deviceId,
// 	// 	name: device.displayName,
// 	// 	deviceOwnership: device?.deviceOwnership || "unknown",
// 	// 	type: device?.profileType || "unknown",
// 	// 	trustType: device?.trustType || "unknown",
// 	// 	enrollment: {
// 	// 		profileName: device?.enrollmentProfileName,
// 	// 		type: device?.enrollmentType || "unknown",
// 	// 	},
// 	// 	isCompliant: device?.isCompliant,
// 	// 	isManaged: device?.isManaged || false,
// 	// 	isRooted: device?.isRooted || false,
// 	// 	managementType: device?.managementType || "unknown",
// 	// 	manufacturer: device?.manufacturer,
// 	// 	model: device?.model,
// 	// 	operatingSystem: device?.operatingSystem,
// 	// 	operatingSystemVersion: device?.operatingSystemVersion,
// 	// 	lastSignInDate: device?.approximateLastSignInDateTime,
// 	// 	registrationDateTime: device?.registrationDateTime,
// 	// 	deviceCategory: device?.deviceCategory,
// 	// }) satisfies Database["devices"]["value"],
// });

export const groups = defineSyncEntity("groups", {
	endpoint:
		"/groups/delta?$select=id,displayName,description,securityEnabled,visibility,createdDateTime,members",
	countEndpoint: "/groups/$count",
	schema: z.object({
		id: z.string(),
	}),
	upsert: async (user) => {
		console.log("INSERT DEVICE", user);
	},
	delete: async (id) => {
		console.log("DELETE DEVICE", id);
	},

	// (group) =>
	// ({
	// 	id: group.id,
	// 	name: group.displayName,
	// 	description: group?.description,
	// 	securityEnabled: group?.securityEnabled || false,
	// 	visibility: group?.visibility,
	// 	createdDateTime: group.createdDateTime,
	// }) satisfies Database["groups"]["value"],

	// TODO: Await these unless they are correctly being put into the transaction???
	// group?.["members@delta"]?.map((member: any) => {
	// 	db.add("groupMembers", {
	// 		groupId: group.id,
	// 		type: member?.["@odata.type"],
	// 		id: member?.["@odata.type"],
	// 	});
	// });
});

// export const policiesSettingsCatalogs = defineSyncEntity("policies", {
// 	endpoint:
// 		"/deviceManagement/configurationPolicies?$select=id,name,description,platforms,technologies,createdDateTime,lastModifiedDateTime&$expand=assignments,settings",
// 	countEndpoint: "/deviceManagement/configurationPolicies/$count",
// 	schema: z.object({
// 		id: z.string(),
// 	}),
// 	upsert: async (user) => {
// 		console.log("INSERT POLICY", user);
// 	},
// 	delete: async (id) => {
// 		console.log("DELETE POLICY", id);
// 	},

// 	// (policy) =>
// 	// 	({
// 	// 		id: policy.id,
// 	// 		name: policy.name,
// 	// 		description: policy?.description,
// 	// 		createdDateTime: policy.createdDateTime,
// 	// 		lastModifiedDateTime: policy.lastModifiedDateTime,
// 	// 		platforms: policy.platforms,
// 	// 		// creationSource: policy?.creationSource,
// 	// 		// templateReference: policy?.templateReference,
// 	// 		// priority: policy?.priorityMetaData,
// 	// 		settings: policy?.settings,

// 	// 		// TODO:
// 	// 		assignments: policy?.assignments,
// 	// 	}) satisfies Database["policies"]["value"],
// 	// async (policy, db) => {
// 	// 	// TODO: Await these unless they are correctly being put into the transaction???
// 	// 	policy?.assignments?.map((assignment) => {
// 	// 		db.add("policyAssignments", {
// 	// 			policyId: policy.id,
// 	// 			type: "todo",
// 	// 			id: "todo",
// 	// 		});
// 	// 	});
// 	// },
// });

// export const policiesTemplates = defineSyncEntity("policies", {
// 	endpoint:
// 		"/deviceManagement/deviceConfigurations?$select=id,displayName,description,createdDateTime,lastModifiedDateTime,version&$expand=assignments",
// 	countEndpoint: "/deviceManagement/deviceConfigurations/$count",
// 	schema: z.object({
// 		id: z.string(),
// 	}),
// 	upsert: async (user) => {
// 		console.log("INSERT POLICY", user);
// 	},
// 	delete: async (id) => {
// 		console.log("DELETE POLICY", id);
// 	},

// 	// (policy) =>
// 	// ({
// 	// 	id: policy.id,
// 	// 	name: policy.displayName,
// 	// 	description: policy?.description,
// 	// 	createdDateTime: policy.createdDateTime,
// 	// 	lastModifiedDateTime: policy.lastModifiedDateTime,

// 	// 	"@odata.type": policy["@odata.type"],
// 	// 	version: policy.version,

// 	// 	// TODO:
// 	// 	assignments: policy?.assignments,
// 	// }) satisfies Database["policies"]["value"],
// });

// export const powershellScripts = defineSyncEntity("scripts", {
// 	endpoint:
// 		"/deviceManagement/deviceManagementScripts?$expand=assignments,groupAssignments&$count=true",
// 	countEndpoint: undefined,
// 	schema: z.object({
// 		id: z.string(),
// 	}),
// 	upsert: async (user) => {
// 		console.log("INSERT SCRIPT", user);
// 	},
// 	delete: async (id) => {
// 		console.log("DELETE SCRIPT", id);
// 	},

// 	// (script) =>
// 	// ({
// 	// 	id: script.id,
// 	// 	name: script.displayName,
// 	// 	scriptContent: script.scriptContent,
// 	// 	fileName: script.fileName,
// 	// 	createdDateTime: script.createdDateTime,
// 	// 	lastModifiedDateTime: script.lastModifiedDateTime,

// 	// 	// TODO:
// 	// 	assignments: script?.assignments,
// 	// 	groupAssignments: script?.groupAssignments,
// 	// }) satisfies Database["scripts"]["value"],
// });

// // export const shellScripts = defineSyncEntity("scripts", {
// // 	endpoint:
// // 		"/deviceManagement/deviceShellScripts?$expand=assignments,groupAssignments",
// // 	countEndpoint: "/deviceManagement/deviceShellScripts/$count",
// // 	schema: z.object({
// // 		id: z.string(),
// // 	}),
// // 	upsert: async (user) => {
// // 		console.log("INSERT SCRIPT", user);
// // 	},
// // 	delete: async (id) => {
// // 		console.log("DELETE SCRIPT", id);
// // 	},

// // 	// (script) =>
// // 	// ({
// // 	// 	id: script.id,
// // 	// 	name: script.displayName,
// // 	// 	scriptContent: script.scriptContent,
// // 	// 	fileName: script.fileName,
// // 	// 	createdDateTime: script.createdDateTime,
// // 	// 	lastModifiedDateTime: script.lastModifiedDateTime,

// // 	// 	// TODO:
// // 	// 	assignments: script?.assignments,
// // 	// 	groupAssignments: script?.groupAssignments,
// // 	// }) satisfies Database["scripts"]["value"],
// // });

// export const apps = defineSyncEntity("apps", {
// 	endpoint:
// 		"/deviceAppManagement/mobileApps?$select=id,displayName,description,publisher,largeIcon,createdDateTime,lastModifiedDateTime,isFeatured,privacyInformationUrl,informationUrl,owner,developer,notes&$expand=assignments",
// 	countEndpoint: undefined,
// 	schema: z.object({
// 		id: z.string(),
// 	}),
// 	upsert: async (user) => {
// 		console.log("INSERT SCRIPT", user);
// 	},
// 	delete: async (id) => {
// 		console.log("DELETE SCRIPT", id);
// 	},

// 	// (app) =>
// 	// ({
// 	// 	id: app.id,
// 	// 	type: app["@odata.type"],
// 	// 	name: app.displayName,
// 	// 	description: app?.description,
// 	// 	publisher: app?.publisher,
// 	// 	largeIcon: app?.largeIcon,
// 	// 	createdDateTime: app.createdDateTime,
// 	// 	lastModifiedDateTime: app.lastModifiedDateTime,
// 	// 	isFeatured: app?.isFeatured || false,
// 	// 	privacyInformationUrl: app?.privacyInformationUrl,
// 	// 	informationUrl: app?.informationUrl,
// 	// 	owner: app?.owner,
// 	// 	developer: app?.developer,
// 	// 	notes: app?.notes,

// 	// 	// TODO:
// 	// 	assignments: app.assignments,
// 	// }) satisfies Database["apps"]["value"],
// });

// TODO: https://graph.microsoft.com/beta/deviceManagement/reusableSettings
// TODO: https://graph.microsoft.com/beta/deviceManagement/configurationSettings
// TODO: https://graph.microsoft.com/beta/deviceManagement/configurationCategories
