import { z } from "zod";
import { defineSyncEntity, merge } from "../entity";

export const groups = defineSyncEntity("groups", {
	endpoint:
		"/groups/delta?$select=id,displayName,description,securityEnabled,visibility,createdDateTime,members",
	countEndpoint: "/groups/$count",
	schema: z.object({
		id: z.string(),
		displayName: z.string(),
		description: z.string().optional(),
		securityEnabled: z.boolean().default(false),
		visibility: z.enum(["Private", "Public", "HiddenMembership"]).nullable(),
		createdDateTime: z.string().datetime(),
		"members@delta": z
			.array(
				z.object({
					"@odata.type": z.union([
						z.literal("#microsoft.graph.user"),
						z.literal("#microsoft.graph.group"),
						z.literal("#microsoft.graph.device"),
						z.literal("#microsoft.graph.servicePrincipal"),
					]),
					id: z.string(),
					"@removed": z.object({}).passthrough().optional(),
				}),
			)
			.default([]),
	}),
	upsert: async (db, data, _syncId) => {
		const tx = db.transaction(["groups", "groupMembers"], "readwrite");
		const groups = tx.objectStore("groups");
		await groups.put(
			merge(await groups.get(data.id), {
				_syncId,
				id: data.id,
				name: data.displayName,
				description: data.description,
				securityEnabled: data.securityEnabled,
				visibility: data.visibility ?? undefined,
				createdDateTime: data.createdDateTime,
			}),
		);

		// TODO: This breaks the IndexedDB observers polyfill.
		// const members = tx.objectStore("groupMembers");
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
	delete: async (db, id) => await db.delete("groups", id),
	cleanup: async (db, syncId) => {
		// const tx = db.transaction(["groups", "groupMembers"], "readwrite");
		// const groups = tx.objectStore("groups").getAll();
		// for (const device of await groups) {
		// 	if (device._syncId !== syncId) tx.store.delete(device.id);
		// }
		// await tx.done;
	},
});
