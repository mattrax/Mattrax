import path from "node:path";
import {
	asString,
	defineOperation,
	exportQueries,
	leftJoinHint,
} from "@mattrax/drizzle-to-rs";
import dotenv from "dotenv";
import { and, asc, desc, eq, isNull, max, min, sql } from "drizzle-orm";
import { unionAll } from "drizzle-orm/mysql-core";
import {
	db,
	certificates,
	deviceActions,
	devices,
	groupMembers,
	policies,
	policyAssignments,
	policyDeploy,
	policyDeployStatus,
} from ".";

dotenv.config({
	path: "../../../../.env",
});

export function scopedPoliciesForDeviceSubquery(device_pk: number) {
	const policiesScopedDirectly = db
		.select({
			pk: policies.pk,
			scope: sql`"direct"`.mapWith(asString).as("scope"),
		})
		.from(policies)
		.innerJoin(policyAssignments, eq(policies.pk, policyAssignments.policyPk))
		.where(
			and(
				eq(policyAssignments.variant, "device"),
				eq(policyAssignments.pk, device_pk),
			),
		);
	const policiesScopedViaGroup = db
		.select({
			pk: policies.pk,
			scope: sql`"group"`.mapWith(asString).as("scope"),
		})
		.from(policies)
		.innerJoin(
			policyAssignments,
			and(
				eq(policies.pk, policyAssignments.policyPk),
				eq(policyAssignments.variant, "group"),
			),
		)
		.innerJoin(groupMembers, eq(groupMembers.groupPk, policyAssignments.pk))
		.where(
			and(eq(groupMembers.variant, "device"), eq(groupMembers.pk, device_pk)),
		);

	const allEntries = unionAll(
		policiesScopedDirectly,
		policiesScopedViaGroup,
	).as("scoped");

	// Basically `SELECT DISTINCT ON`. Device scope takes precedence over group scope.
	return db
		.select({
			pk: allEntries.pk,
			// We use `min` to prioritize 'direct' over 'group'
			scope: min(allEntries.scope).as("scope"),
		})
		.from(allEntries)
		.groupBy(allEntries.pk)
		.as("sorted");
}

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
				last_modified: "Now",
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
			name: "get_policy_data_for_checkin",
			args: {
				device_pk: "u64",
			},
			query: (args) => {
				const scopedPolicies = scopedPoliciesForDeviceSubquery(args.device_pk);

				// We get the latest deploy of each policy.
				const latestDeploy_inner = db
					.select({
						// We get the latest deploy of the policy (Eg. highest primary key)
						deployPk: max(policyDeploy.pk).as("deployPk"),
						policyPk: policyDeploy.policyPk,
						// `scopedPoliciesForDeviceSubquery` ensures each policy only shows up once so we know the `max` will be correct.
						scope: max(scopedPolicies.scope).mapWith(asString).as("scope_li"),
					})
					.from(scopedPolicies)
					.innerJoin(policyDeploy, eq(scopedPolicies.pk, policyDeploy.policyPk))
					.groupBy(policyDeploy.policyPk)
					.as("li");

				// We join back in the data into `latestDeploy_inner` as `groupBy` limits the columns we can select in the inner query.
				const latestDeploy = db
					.select({
						deployPk: policyDeploy.pk,
						policyPk: policyDeploy.policyPk,
						data: policyDeploy.data,
						scope: latestDeploy_inner.scope,
					})
					.from(policyDeploy)
					.innerJoin(
						latestDeploy_inner,
						eq(latestDeploy_inner.deployPk, policyDeploy.pk),
					)
					.as("l");

				// We get the last deployed version of each policy for this device.
				const lastDeploy_inner = db
					.select({
						// We get the last deploy of the policy (Eg. highest primary key)
						deployPk: max(policyDeploy.pk).as("deployPk"),
						policyPk: policyDeploy.policyPk,
						// `scopedPoliciesForDeviceSubquery` ensures each policy only shows up once so we know the `max` will be correct.
						scope: max(scopedPolicies.scope).mapWith(asString).as("ji_scope"),
					})
					.from(scopedPolicies)
					.innerJoin(policyDeploy, eq(scopedPolicies.pk, policyDeploy.policyPk))
					.innerJoin(
						policyDeployStatus,
						and(
							eq(policyDeploy.pk, policyDeployStatus.deployPk),
							eq(policyDeployStatus.devicePk, args.device_pk),
						),
					)
					.groupBy(policyDeploy.policyPk)
					.as("ji");

				// We join back in the data into `lastDeploy_inner` as `groupBy` limits the columns we can select in the inner query.
				const lastDeploy = db
					.select({
						deployPk: policyDeploy.pk,
						policyPk: policyDeploy.policyPk,
						data: policyDeploy.data,
						result: policyDeployStatus.result,
						scope: lastDeploy_inner.scope,
					})
					.from(policyDeploy)
					.innerJoin(
						lastDeploy_inner,
						eq(lastDeploy_inner.deployPk, policyDeploy.pk),
					)
					.innerJoin(
						policyDeployStatus,
						and(
							eq(policyDeploy.pk, policyDeployStatus.deployPk),
							eq(policyDeployStatus.devicePk, args.device_pk),
						),
					)
					.as("j");

				return db
					.select({
						scope: latestDeploy.scope,
						latestDeploy: {
							pk: latestDeploy.deployPk,
							data: latestDeploy.data,
						},
						lastDeploy: leftJoinHint({
							pk: lastDeploy.deployPk,
							data: lastDeploy.data,
							result: lastDeploy.result,
						}),
					})
					.from(latestDeploy)
					.leftJoin(lastDeploy, eq(lastDeploy.policyPk, latestDeploy.policyPk));
			},
		}),
		// defineOperation({
		// 	name: "get_policies_requiring_removal",
		// 	args: {
		// 		device_pk: "u64",
		// 	},
		// 	query: (args) => {
		// 		const scopedPolicies = scopedPoliciesForDeviceSubquery(args.device_pk);

		// 		// TODO: Avoid selecting policies we've already removed -> Maybe we add a marker to `result`

		// 		return db
		// 			.select({
		// 				pk: policyDeploy.pk,
		// 				policyPk: policyDeploy.policyPk,
		// 				data: policyDeploy.data,
		// 				result: policyDeployStatus.result,
		// 			})
		// 			.from(policyDeploy)
		// 			.innerJoin(
		// 				policyDeployStatus,
		// 				and(
		// 					eq(policyDeployStatus.deployPk, policyDeploy.pk),
		// 					eq(policyDeployStatus.devicePk, args.device_pk),
		// 				),
		// 			)
		// 			.leftJoin(
		// 				scopedPolicies,
		// 				eq(scopedPolicies.pk, policyDeploy.policyPk),
		// 			)
		// 			.where(isNull(scopedPolicies.pk));
		// 	},
		// }),
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
		// TODO: Queued applications
		defineOperation({
			name: "update_device_lastseen",
			args: {
				device_id: "u64",
				last_synced: "Now",
			},
			query: (args) =>
				db
					.update(devices)
					.set({
						lastSynced: args.last_synced,
					})
					.where(eq(devices.pk, args.device_id)),
		}),
	],
	path.join(__dirname, "../../../../crates/db/src/db.rs"),
);
