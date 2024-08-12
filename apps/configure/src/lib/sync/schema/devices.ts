import { z } from "zod";
import { defineSyncEntity, merge } from "../entity";

// TODO: Also sourcing extra data from "/deviceManagement/managedDevices"???
export const devices = defineSyncEntity("devices", {
	endpoint:
		"/devices/delta?$select=id,deviceId,displayName,deviceOwnership,profileType,trustType,enrollmentProfileName,enrollmentType,isCompliant,isManaged,isRooted,managementType,manufacturer,model,operatingSystem,operatingSystemVersion,approximateLastSignInDateTime,registrationDateTime,deviceCategory",
	countEndpoint: "/devices/$count",
	schema: z.object({
		id: z.string(),
		deviceId: z.string(),
		displayName: z.string(),
		deviceOwnership: castLowerCase(
			z.enum(["company", "personal", "unknown"]),
		).default("unknown"),
		profileType: z
			.enum(["RegisteredDevice", "SecureVM", "Printer", "Shared", "IoT"])
			.optional(),
		trustType: z.enum(["Workplace", "AzureAd", "ServerAd"]).optional(),
		enrollmentProfileName: z.string().optional(),
		enrollmentType: z
			.enum([
				"unknown",
				"userEnrollment",
				"deviceEnrollmentManager",
				"appleBulkWithUser",
				"appleBulkWithoutUser",
				"windowsAzureADJoin",
				"windowsBulkUserless",
				"windowsAutoEnrollment",
				"windowsBulkAzureDomainJoin",
				"windowsCoManagement",

				// This isn't in the docs but it is in the data so...
				// TODO: Maybe check OpenAPI docs if we can discover more values they aren't telling us about?
				"AzureDomainJoined",
				"DeviceEnrollment",
			])
			.default("unknown"),
		isCompliant: z.boolean().optional(),
		isManaged: z.boolean().default(false),
		isRooted: z.boolean().default(false),
		managementType: castLowerCase(
			z.enum([
				"eas",
				"mdm",
				"easMdm",
				"intuneClient",
				"easIntuneClient",
				"configurationManagerClient",
				"configurationManagerClientMdm",
				"configurationManagerClientMdmEas",
				"unknown",
				"jamf",
				"googleCloudDevicePolicyController",
			]),
		).default("unknown"),
		manufacturer: z.string().optional(),
		model: z.string().optional(),
		operatingSystem: z.string().optional(),
		operatingSystemVersion: z.string().optional(),
		approximateLastSignInDateTime: z.string().datetime().optional(),
		registrationDateTime: z.string().datetime().optional(),
		deviceCategory: z.string().optional(),
	}),
	upsert: async (db, data, _syncId) => {
		const tx = db.transaction("devices", "readwrite");
		await tx.store.put(
			merge(await tx.store.get(data.id), {
				_syncId,
				id: data.id,
				deviceId: data.deviceId,
				name: data.displayName,
				deviceOwnership: data.deviceOwnership,
				type: data.profileType,
				trustType: data.trustType || "unknown",
				enrollment: {
					profileName: data.enrollmentProfileName,
					type: data.enrollmentType,
				},
				isCompliant: data.isCompliant,
				isManaged: data.isManaged,
				isRooted: data.isRooted,
				managementType: data.managementType,
				manufacturer: data.manufacturer,
				model: data.model,
				operatingSystem: data.operatingSystem,
				operatingSystemVersion: data.operatingSystemVersion,
				lastSignInDate: data.approximateLastSignInDateTime,
				registrationDateTime: data.registrationDateTime,
				deviceCategory: data.deviceCategory,
			}),
		);
		await tx.done;
	},
	delete: async (db, id) => await db.delete("devices", id),
	cleanup: async (db, syncId) => {
		// const tx = db.transaction("devices", "readwrite");
		// const devices = tx.store.getAll();
		// for (const device of await devices) {
		// 	if (device._syncId !== syncId) tx.store.delete(device.id);
		// }
		// await tx.done;
	},
});

function castLowerCase<T extends z.ZodTypeAny>(schema: T) {
	return z.preprocess(
		(s) => (typeof s === "string" ? s.toLowerCase() : s),
		schema,
	);
}
