import path from "node:path";
import {
	asString,
	defineOperation,
	exportQueries,
	leftJoinHint,
} from "@mattrax/drizzle-to-rs";
import dotenv from "dotenv";
import { and, asc, desc, eq, isNull, sql } from "drizzle-orm";
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

// export function scopedPoliciesForDeviceSubquery(device_pk: number) {
// 	const policiesScopedDirectly = db
// 		.select({
// 			pk: policies.pk,
// 			scope: sql`"direct"`.mapWith(asString).as("scope"),
// 		})
// 		.from(policies)
// 		.innerJoin(policyAssignments, eq(policies.pk, policyAssignments.policyPk))
// 		.where(
// 			and(
// 				eq(policyAssignments.variant, "device"),
// 				eq(policyAssignments.pk, device_pk),
// 			),
// 		);

// 	const policiesScopedViaGroup = db
// 		.select({
// 			pk: policies.pk,
// 			scope: sql`"group"`.as("scope"),
// 		})
// 		.from(policies)
// 		.innerJoin(
// 			policyAssignments,
// 			and(
// 				eq(policies.pk, policyAssignments.policyPk),
// 				eq(policyAssignments.variant, "group"),
// 			),
// 		)
// 		.innerJoin(groupMembers, eq(groupMembers.groupPk, policyAssignments.pk))
// 		.where(
// 			and(eq(groupMembers.variant, "device"), eq(groupMembers.pk, device_pk)),
// 		);

// 	const allEntries = unionAll(
// 		policiesScopedDirectly,
// 		policiesScopedViaGroup,
// 	).as("scoped");

// 	// Being device scoped takes precedence over group scoped so we sort them first
// 	const sorted = db
// 		.select()
// 		.from(allEntries)
// 		.orderBy(asc(allEntries.scope))
// 		.as("sorted");

// 	// and remove duplicates
// 	return db
// 		.selectDistinctOn(sorted.scope, {
// 			pk: sorted.pk,
// 			scope: sorted.scope,
// 		})
// 		.from(sorted)
// 		.as("sp");
// }

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
		// defineOperation({
		// 	name: "get_policy_data_for_checkin",
		// 	args: {
		// 		device_pk: "u64",
		// 	},
		// 	query: (args) => {
		// 		const scopedPolicies = scopedPoliciesForDeviceSubquery(args.device_pk);

		// 		// If we sort all deploys by `doneAt` we can do a `SELECT DISTINCT ON (policyPk)` we can get the latest.
		// 		// We use this for `allPolicyDeploys` to get the latest deploy for each policy.
		// 		// We do this again for `allPolicyDeploysForThisDevice` to get the last deploy applied to the device for each policy.

		// 		const allPolicyDeploys = db
		// 			.select({
		// 				deployPk: policyDeploy.pk,
		// 				policyPk: policyDeploy.policyPk,
		// 				data: policyDeploy.data,
		// 				scope: scopedPolicies.scope,
		// 			})
		// 			.from(scopedPolicies)
		// 			.innerJoin(policyDeploy, eq(scopedPolicies.pk, policyDeploy.policyPk))
		// 			.orderBy(desc(policyDeploy.doneAt))
		// 			.as("i");

		// 		const latestDeployForPolicy = db
		// 			.selectDistinctOn([allPolicyDeploys.policyPk], {
		// 				deployPk: allPolicyDeploys.deployPk,
		// 				policyPk: allPolicyDeploys.policyPk,
		// 				data: allPolicyDeploys.data,
		// 				scope: allPolicyDeploys.scope,
		// 			})
		// 			.from(allPolicyDeploys)
		// 			.as("l");

		// 		const allPolicyDeploysForThisDevice = db
		// 			.select({
		// 				deployPk: policyDeploy.pk,
		// 				policyPk: policyDeploy.policyPk,
		// 				result: policyDeployStatus.result,
		// 				data: policyDeploy.data,
		// 			})
		// 			.from(scopedPolicies)
		// 			.innerJoin(policyDeploy, eq(scopedPolicies.pk, policyDeploy.policyPk))
		// 			.innerJoin(
		// 				policyDeployStatus,
		// 				and(
		// 					eq(policyDeploy.pk, policyDeployStatus.deployPk),
		// 					eq(policyDeployStatus.devicePk, args.device_pk),
		// 				),
		// 			)
		// 			.orderBy(desc(policyDeploy.doneAt))
		// 			.as("j");

		// 		const lastDeployedVersionForDevice = db
		// 			.selectDistinctOn([allPolicyDeploysForThisDevice.policyPk], {
		// 				deployPk: allPolicyDeploysForThisDevice.deployPk,
		// 				policyPk: allPolicyDeploysForThisDevice.policyPk,
		// 				result: allPolicyDeploysForThisDevice.result,
		// 				data: allPolicyDeploysForThisDevice.data,
		// 			})
		// 			.from(allPolicyDeploysForThisDevice)
		// 			.as("k");

		// 		return db
		// 			.select({
		// 				scope: latestDeployForPolicy.scope,
		// 				latestDeploy: {
		// 					pk: latestDeployForPolicy.deployPk,
		// 					data: latestDeployForPolicy.data,
		// 				},
		// 				lastDeploy: leftJoinHint({
		// 					pk: lastDeployedVersionForDevice.deployPk,
		// 					data: lastDeployedVersionForDevice.data,
		// 					result: lastDeployedVersionForDevice.result,
		// 				}),
		// 			})
		// 			.from(latestDeployForPolicy)
		// 			.leftJoin(
		// 				lastDeployedVersionForDevice,
		// 				eq(
		// 					lastDeployedVersionForDevice.policyPk,
		// 					latestDeployForPolicy.policyPk,
		// 				),
		// 			);
		// 	},
		// }),
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
