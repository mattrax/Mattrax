import { z } from "zod";
import { defineSyncEntity, merge } from "../entity";

export const scripts = defineSyncEntity("scripts", {
	endpoint: [
		// Powershell
		"/deviceManagement/deviceManagementScripts?$expand=assignments,groupAssignments&$count=true",
		// Shell
		"/deviceManagement/deviceShellScripts?$expand=assignments,groupAssignments&$count=true",
	],
	countEndpoint: undefined,
	schema: z.intersection(
		z.object({
			id: z.string(),
			displayName: z.string(),
			description: z
				.string()
				.nullable()
				// Microsoft's endpoints are cringe.
				.transform((v) => (v === "" ? null : v)),
			createdDateTime: z.string().datetime(),
			lastModifiedDateTime: z.string().datetime(),
			runAsAccount: z.enum(["system", "user"]),
			fileName: z.string(),
			scriptContent: z.string().nullable(),
			assignments: z.array(
				z.object({
					id: z.string(),
					target: z.object({
						"@odata.type": z.enum([
							"#microsoft.graph.allDevicesAssignmentTarget",
							"#microsoft.graph.allLicensedUsersAssignmentTarget",
							"microsoft.graph.scopeTagGroupAssignmentTarget",
							// TODO: Any other ones?
						]),
						deviceAndAppManagementAssignmentFilterId: z.string().nullable(),
						deviceAndAppManagementAssignmentFilterType: z.string(),
						targetType: z.string().optional(),
						entraObjectId: z.string().optional(),
					}),
				}),
			),
			groupAssignments: z.array(
				z.object({
					id: z.string(),
					targetGroupId: z.string(),
				}),
			),
		}),
		z.union([
			z.object({
				executionFrequency: z.string().duration(),
				retryCount: z.number(),
				blockExecutionNotifications: z.boolean(),
			}),
			z.object({
				enforceSignatureCheck: z.boolean(),
				runAs32Bit: z.boolean(),
			}),
		]),
	),
	upsert: async (db, data, _syncId) => {
		const tx = db.transaction(["scripts", "scriptAssignments"], "readwrite");
		const scripts = tx.objectStore("scripts");
		await scripts.put(
			merge(await scripts.get(data.id), {
				_syncId,
				id: data.id,
				name: data.displayName,
				description: data.description ?? undefined,
				createdDateTime: data.createdDateTime,
				lastModifiedDateTime: data.lastModifiedDateTime,
				runAsAccount: data.runAsAccount,
				fileName: data.fileName,
				scriptContent: data.scriptContent ?? undefined,
				...("executionFrequency" in data
					? {
							// Bash
							executionFrequency: data.executionFrequency,
							retryCount: data.retryCount,
							blockExecutionNotifications: data.blockExecutionNotifications,
						}
					: {
							// Powershell
							enforceSignatureCheck: data.enforceSignatureCheck,
							runAs32Bit: data.runAs32Bit,
						}),
			}),
		);

		// const assignments = tx.objectStore("scriptAssignments");
		// for (const member of data["members@delta"]) {
		// 	if (member["@removed"]) {
		// 		await members.delete(data.id);
		// 	} else {
		// 		members.put({
		//			_syncId,
		// 			groupId: data.id,
		// 			type: member["@odata.type"],
		// 			id: member.id,
		// 		});
		// 	}
		// }

		await tx.done;
	},
	delete: async (db, id) => await db.delete("scripts", id),
	cleanup: async (db, syncId) => {
		const tx = db.transaction(["scripts", "scriptAssignments"], "readwrite");
		const scripts = tx.objectStore("scripts");
		for (const e of await scripts.getAll()) {
			if (e._syncId !== syncId) scripts.delete(e.id);
		}

		const scriptAssignments = tx.objectStore("scriptAssignments");
		for (const e of await scriptAssignments.getAll()) {
			if (e._syncId !== syncId) scriptAssignments.delete(e.id);
		}
		await tx.done;
	},
});
