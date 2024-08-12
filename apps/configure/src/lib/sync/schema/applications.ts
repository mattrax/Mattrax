import { z } from "zod";
import { defineSyncEntity, merge } from "../entity";
import { assignmentTarget } from "./_util";

export const apps = defineSyncEntity("apps", {
	endpoint:
		"/deviceAppManagement/mobileApps?$select=id,displayName,description,publisher,largeIcon,createdDateTime,lastModifiedDateTime,isFeatured,privacyInformationUrl,informationUrl,owner,developer,notes&$expand=assignments",
	countEndpoint: undefined,
	schema: z.object({
		id: z.string(),
		"@odata.type": z.union([
			z.literal("#microsoft.graph.iosStoreApp"),
			z.literal("#microsoft.graph.managedIOSStoreApp"),
			z.literal("#microsoft.graph.managedAndroidStoreApp"),
			z.literal("#microsoft.graph.managedAndroidStoreApp"),
			z.literal("#microsoft.graph.winGetApp"),
			// TODO: Work out all variants
		]),
		displayName: z.string(),
		description: z.string().optional(),
		publisher: z.string().optional(),
		largeIcon: z.any().optional(),
		createdDateTime: z.string().datetime(),
		lastModifiedDateTime: z.string().datetime(),
		isFeatured: z.boolean().default(false),
		privacyInformationUrl: z.string().nullable(),
		informationUrl: z.string().nullable(),
		owner: z.string().nullable(),
		developer: z.string().nullable(),
		notes: z.string().nullable(),
		assignments: z
			.array(
				z.object({
					id: z.string(),
					intent: z.enum([
						"available",
						"required",
						"uninstall",
						"availableWithoutEnrollment",
					]),
					source: z.enum(["direct", "policySets"]),
					sourceId: z.string().nullable(),
					target: assignmentTarget,
					settings: z.discriminatedUnion("@odata.type", [
						z.object({
							"@odata.type": z.literal(
								"#microsoft.graph.iosStoreAppAssignmentSettings",
							),
							vpnConfigurationId: z.unknown().optional(),
							uninstallOnDeviceRemoval: z.boolean(),
							isRemovable: z.boolean(),
							preventManagedAppBackup: z.boolean(),
						}),
						z.object({
							"@odata.type": z.literal(
								"#microsoft.graph.winGetAppAssignmentSettings",
							),
							notifications: z.enum([
								"showAll",
								"showReboot",
								"hideAll",
								"unknownFutureValue",
							]),
							restartSettings: z
								.object({
									gracePeriodInMinutes: z.number(),
									countdownDisplayBeforeRestartInMinutes: z.number(),
									restartNotificationSnoozeDurationInMinutes: z.number(),
								})
								.nullable(),
							installTimeSettings: z
								.object({
									useLocalTime: z.boolean(),
									deadlineDateTime: z.string(), // TODO: Date
								})
								.nullable(),
						}),
					]),
				}),
			)
			.default([]),
	}),
	upsert: async (db, data, _syncId) => {
		const tx = db.transaction(["apps", "appAssignments"], "readwrite");
		const apps = tx.objectStore("apps");
		await apps.put(
			merge(await apps.get(data.id), {
				_syncId,
				id: data.id,
				type: data["@odata.type"],
				name: data.displayName,
				description: data.description,
				publisher: data.publisher,
				largeIcon: data.largeIcon,
				createdDateTime: data.createdDateTime,
				lastModifiedDateTime: data.lastModifiedDateTime,
				isFeatured: data.isFeatured,
				privacyInformationUrl: data.privacyInformationUrl ?? undefined,
				informationUrl: data.informationUrl ?? undefined,
				owner: data.owner ?? undefined,
				developer: data.developer ?? undefined,
				notes: data.notes ?? undefined,
			}),
		);

		// const assignments = tx.objectStore("appAssignments");
		// for (const assignment of data.assignments) {
		// 	if (member["@removed"]) {
		// 		await members.delete(data.id);
		// 	} else {
		// 		members.put({
		// 			groupId: data.id,
		// 			type: member["@odata.type"],
		// 			id: member.id,
		// 		});
		// 	}
		// }

		await tx.done;
	},
	delete: async (db, id) => await db.delete("apps", id),
	cleanup: async (db, syncId) => {
		const tx = db.transaction(["apps", "appAssignments"], "readwrite");
		const apps = tx.objectStore("apps");
		for (const e of await apps.getAll()) {
			if (e._syncId !== syncId) apps.delete(e.id);
		}

		const appAssignments = tx.objectStore("appAssignments");
		for (const e of await appAssignments.getAll()) {
			if (e._syncId !== syncId) appAssignments.delete(e.id);
		}
		await tx.done;
	},
});
