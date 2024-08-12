import { z } from "zod";
import { defineSyncEntity, merge } from "../entity";
import { assignmentTarget } from "./_util";

export const policies = defineSyncEntity("policies", {
	endpoint: [
		// Settings Catalogs
		"/deviceManagement/configurationPolicies?$select=id,name,description,platforms,technologies,createdDateTime,lastModifiedDateTime&$expand=assignments,settings",
		// Templates
		"/deviceManagement/deviceConfigurations?$select=id,displayName,description,createdDateTime,lastModifiedDateTime,version&$expand=assignments&$count=true",
	],
	countEndpoint: undefined,
	schema: z.preprocess(
		(val) =>
			typeof val !== "object" || val === null
				? val
				: "@odata.type" in val
					? val
					: { ...val, "@odata.type": "__NO_ODATA_TYPE__" },

		z.intersection(
			z.object({
				id: z.string(),
				description: z
					.string()
					.nullable()
					// Microsoft's endpoints are inconsistent.
					.transform((v) => (v === "" ? null : v)),
				createdDateTime: z.string().datetime(),
				lastModifiedDateTime: z.string().datetime(),
				assignments: z.array(
					z.object({
						id: z.string(),
						source: z.enum(["direct", "policySets"]),
						sourceId: z.string(),
						target: assignmentTarget,
					}),
				),
			}),
			z.discriminatedUnion("@odata.type", [
				z.object({
					"@odata.type": z.literal("__NO_ODATA_TYPE__"),
					name: z.string(),
					platforms: z.any(), // TODO: Type
					// creationSource: z.any(),
					// templateReference: z.any(),
					// priority: z.any(),
					settings: z.array(z.any()), // TODO: Type
				}),
				z.object({
					"@odata.type": z.enum([
						"#microsoft.graph.iosCustomConfiguration",
						"#microsoft.graph.windows10CustomConfiguration",
						"#microsoft.graph.windows10GeneralConfiguration",
						"#microsoft.graph.windowsWifiConfiguration",
						// TODO: Find all of them
					]),
					displayName: z.string(),
					version: z.number(),
				}),
			]),
		),
	),
	upsert: async (db, data, _syncId) => {
		const tx = db.transaction(["policies", "policiesAssignments"], "readwrite");
		const policies = tx.objectStore("policies");
		await policies.put(
			merge(await policies.get(data.id), {
				_syncId,
				id: data.id,
				description: data.description ?? undefined,
				createdDateTime: data.createdDateTime,
				lastModifiedDateTime: data.lastModifiedDateTime,
				...(data["@odata.type"] === "__NO_ODATA_TYPE__"
					? {
							name: data.name,
							platforms: data.platforms,
							settings: data.settings,
						}
					: {
							name: data.displayName,
							"@odata.type": data["@odata.type"],
							version: data.version,
						}),
			}),
		);

		// const assignments = tx.objectStore("policiesAssignments");
		// for (const member of data["members@delta"]) {
		// 	if (member["@removed"]) {
		// 		await members.delete(data.id);
		// 	} else {
		// 		members.put({
		// 			_syncId,
		// 			groupId: data.id,
		// 			type: member["@odata.type"],
		// 			id: member.id,
		// 		});
		// 	}
		// }

		await tx.done;
	},
	delete: async (db, id) => await db.delete("policies", id),
	cleanup: async (db, syncId) => {
		const tx = db.transaction(["policies", "policiesAssignments"], "readwrite");
		const policies = tx.objectStore("policies");
		for (const e of await policies.getAll()) {
			if (e._syncId !== syncId) policies.delete(e.id);
		}

		const policiesAssignments = tx.objectStore("policiesAssignments");
		for (const e of await policiesAssignments.getAll()) {
			if (e._syncId !== syncId) policiesAssignments.delete(e.id);
		}
		await tx.done;
	},
});
