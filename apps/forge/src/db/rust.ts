import path from "node:path";
import { defineOperation, exportQueries } from "@mattrax/drizzle-to-rs";
import dotenv from "dotenv";
import { and, eq } from "drizzle-orm";
import { union } from "drizzle-orm/mysql-core";
import {
	certificates,
	db,
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
				operating_system: "String",
				serial_number: "String",
				tenant_pk: "i32",
				owner_pk: "i32",
			},
			query: (args) =>
				db
					.insert(devices)
					.values([
						{
							id: args.id,
							name: args.name,
							operatingSystem: args.operating_system,
							serialNumber: args.serial_number,
							tenantPk: args.tenant_pk,
							owner: args.owner_pk,
						},
					])
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
				device_id: "i32",
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
	],
	path.join(__dirname, "../../../../apps/mattrax/src/db.rs"),
);
