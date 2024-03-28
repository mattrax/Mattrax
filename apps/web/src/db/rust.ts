import path from "node:path";
import { defineOperation, exportQueries } from "@mattrax/drizzle-to-rs";
import dotenv from "dotenv";
import { and, eq, isNull } from "drizzle-orm";
import { union } from "drizzle-orm/mysql-core";
import {
	certificates,
	db,
	deviceActions,
	devices,
	groupAssignables,
	policies,
	policyAssignables,
} from ".";

dotenv.config({
	path: "../../../../.env",
});

exportQueries(
	[
		defineOperation({
			name: "get_certificate",
			args: {
				key: "String",
			},
			query: (args) =>
				db
					.select({
						certificate: certificates.certificate,
					})
					.from(certificates)
					.where(eq(certificates.key, args.key)),
		}),
		defineOperation({
			name: "store_certificate",
			args: {
				key: "String",
				certificate: "Vec<u8>",
				last_modified: "NaiveDateTime",
			},
			query: (args) =>
				db
					.insert(certificates)
					.values({
						key: args.key,
						certificate: args.certificate,
						lastModified: args.last_modified, // TODO: A system for automatic `new Date()`
					})
					.onDuplicateKeyUpdate({
						set: {
							certificate: args.certificate,
							lastModified: args.last_modified,
						},
					}),
		}),
		defineOperation({
			name: "create_device",
			args: {
				id: "String",
				name: "String",
				enrollmentType: "String", // TODO: Enum
				os: "String", // TODO: Enum
				serial_number: "String",
				tenant_pk: "u64",
				owner_pk: "u64",
			},
			query: (args) =>
				db
					.insert(devices)
					.values({
						id: args.id,
						name: args.name,
						enrollmentType: args.enrollmentType as any,
						os: args.os as any,
						serialNumber: args.serial_number,
						tenantPk: args.tenant_pk,
						owner: args.owner_pk,
					})
					.onDuplicateKeyUpdate({
						// TODO: When we do this update what if policies from the old-tenant refer to it. We kinda break shit.
						set: {
							name: args.name,
							tenantPk: args.tenant_pk,
							owner: args.owner_pk,
						},
					}),
		}),
		defineOperation({
			name: "get_policies_for_device",
			args: {
				device_id: "u64",
			},
			query: (args) => {
				// Any policy scoped directly to device
				const a = db
					.select({
						pk: policies.pk,
						id: policies.id,
						name: policies.name,
					})
					.from(policies)
					.innerJoin(
						policyAssignables,
						eq(policies.pk, policyAssignables.policyPk),
					)
					.where(
						and(
							eq(policyAssignables.variant, "device"),
							eq(policyAssignables.pk, args.device_id),
						),
					);

				// Any policy scoped to a group containing the device.
				const b = db
					.select({
						pk: policies.pk,
						id: policies.id,
						name: policies.name,
					})
					.from(policies)
					.innerJoin(
						policyAssignables,
						eq(policies.pk, policyAssignables.policyPk),
					)
					.innerJoin(
						groupAssignables,
						and(
							eq(groupAssignables.groupPk, policyAssignables.pk),
							eq(policyAssignables.variant, "group"),
						),
					)
					.where(
						and(
							eq(groupAssignables.variant, "device"),
							eq(groupAssignables.pk, args.device_id),
						),
					);

				return union(a, b);
			},
		}),
		defineOperation({
			name: "get_device",
			args: {
				device_id: "String",
			},
			query: (args) =>
				db
					.select({
						pk: devices.pk,
						tenantPk: devices.tenantPk,
					})
					.from(devices)
					.where(eq(devices.id, args.device_id)),
		}),
		defineOperation({
			name: "update_device_lastseen",
			args: {
				device_id: "u64",
				last_synced: "NaiveDateTime",
			},
			query: (args) =>
				db
					.update(devices)
					.set({
						lastSynced: args.last_synced,
					})
					.where(eq(devices.pk, args.device_id)),
		}),
		defineOperation({
			name: "queued_device_actions",
			args: {
				device_id: "u64",
			},
			// TODO: Enum on `action` field of the result
			query: (args) =>
				db
					.select()
					.from(deviceActions)
					.where(
						and(
							eq(deviceActions.devicePk, args.device_id),
							isNull(deviceActions.deployedAt),
						),
					),
		}),
	],
	path.join(__dirname, "../../../../apps/mattrax/src/db.rs"),
);
