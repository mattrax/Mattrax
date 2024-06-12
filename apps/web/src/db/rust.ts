import path from "node:path";
import {
	asString,
	defineOperation,
	exportQueries,
	leftJoinHint,
} from "@mattrax/drizzle-to-rs";
import dotenv from "dotenv";
import { and, eq, max, min, sql } from "drizzle-orm";
import { unionAll } from "drizzle-orm/mysql-core";
import {
	accounts,
	db,
	deviceActions,
	devices,
	groupAssignables,
	kv,
	organisationMembers,
	organisations,
	policies,
	policyAssignments,
	policyDeploy,
	policyDeployStatus,
	sessions,
} from ".";

dotenv.config({
	path: "../../../../.env",
});

export function scopedPoliciesForDeviceSubquery(device_pk: number) {
	const policiesScopedDirectly = db
		.select({
			pk: policies.pk,
			scope: sql`'direct'`.mapWith(asString).as("scope"),
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
			scope: sql`'group'`.mapWith(asString).as("scope"),
		})
		.from(policies)
		.innerJoin(
			policyAssignments,
			and(
				eq(policies.pk, policyAssignments.policyPk),
				eq(policyAssignments.variant, "group"),
			),
		)
		.innerJoin(
			groupAssignables,
			eq(groupAssignables.groupPk, policyAssignments.pk),
		)
		.where(
			and(
				eq(groupAssignables.variant, "device"),
				eq(groupAssignables.pk, device_pk),
			),
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
			name: "get_config",
			args: {},
			query: (args) =>
				db
					.select({
						value: kv.value,
					})
					.from(kv)
					.where(eq(kv.key, "config")),
		}),
		defineOperation({
			name: "set_config",
			args: {
				config: "String",
			},
			query: (args) =>
				db
					.insert(kv)
					.values({
						key: "config",
						value: args.config,
					})
					.onDuplicateKeyUpdate({
						set: {
							value: args.config,
						},
					}),
		}),
		defineOperation({
			name: "get_node",
			args: {
				id: "String",
			},
			query: (args) =>
				db
					.select({
						value: kv.value,
					})
					.from(kv)
					.where(eq(kv.key, sql`CONCAT('server:', ${args.id})`)),
		}),
		defineOperation({
			name: "update_node",
			args: {
				id: "String",
				config: "String",
			},
			query: (args) =>
				db
					.insert(kv)
					.values({
						key: sql`CONCAT('server:', ${args.id})`,
						value: args.config,
					})
					.onDuplicateKeyUpdate({
						set: {
							value: args.config,
						},
					}),
		}),
		defineOperation({
			name: "get_certificate",
			args: {
				key: "String",
			},
			query: (args) =>
				db
					.select({
						value: kv.value,
					})
					.from(kv)
					.where(eq(kv.key, sql`CONCAT('cert:', ${args.key})`)),
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
					.insert(kv)
					.values({
						key: sql`CONCAT('cert:', ${args.key})`,
						value: args.certificate,
					})
					.onDuplicateKeyUpdate({
						set: {
							value: args.certificate,
							lastModified: sql`NOW()`,
						},
					}),
		}),
		defineOperation({
			name: "get_session_and_user",
			args: {
				session_id: "String",
			},
			query: (args) =>
				db
					.select({
						account: {
							pk: accounts.pk,
							id: accounts.id,
						},
						session: {
							id: sessions.id,
							expires_at: sessions.expiresAt,
						},
					})
					.from(sessions)
					.innerJoin(accounts, eq(sessions.userId, accounts.id))
					.where(eq(sessions.id, args.session_id)),
		}),
		defineOperation({
			name: "is_org_member",
			args: {
				org_slug: "String",
				account_pk: "u64",
			},
			query: (args) =>
				db
					.select({
						id: organisations.id,
					})
					.from(organisations)
					.where(eq(organisations.slug, args.org_slug))
					.innerJoin(
						organisationMembers,
						and(
							eq(organisations.pk, organisationMembers.orgPk),
							eq(organisationMembers.accountPk, args.account_pk),
						),
					),
		}),
		defineOperation({
			name: "create_device",
			args: {
				id: "String",
				mdm_id: "String",
				name: "String",
				enrollmentType: "String", // TODO: Enum
				os: "String", // TODO: Enum
				serial_number: "String",
				tenant_pk: "u64",
				owner_pk: "Option<u64>",
				enrolled_by_pk: "Option<u64>",
			},
			query: (args) =>
				db
					.insert(devices)
					.values({
						id: args.id,
						mdm_id: args.mdm_id,
						name: args.name,
						enrollmentType: args.enrollmentType as any,
						os: args.os as any,
						serialNumber: args.serial_number,
						tenantPk: args.tenant_pk,
						owner: args.owner_pk,
						enrolledBy: args.enrolled_by_pk,
					})
					.onDuplicateKeyUpdate({
						set: {
							mdm_id: args.mdm_id,
							name: args.name,
							enrollmentType: args.enrollmentType as any,
							os: args.os as any,
							serialNumber: args.serial_number,
							tenantPk: args.tenant_pk,
							owner: args.owner_pk,
							enrolledBy: args.enrolled_by_pk,
						},
					}),
		}),
		defineOperation({
			name: "get_device",
			args: {
				mdm_device_id: "String",
			},
			query: (args) =>
				db
					.select({
						pk: devices.pk,
						tenantPk: devices.tenantPk,
					})
					.from(devices)
					.where(eq(devices.mdm_id, args.mdm_device_id)),
		}),
		defineOperation({
			name: "get_device_by_serial",
			args: {
				serial_number: "String",
			},
			query: (args) =>
				db
					.select({
						id: devices.id,
						tenantPk: devices.tenantPk,
					})
					.from(devices)
					.where(eq(devices.serialNumber, args.serial_number)),
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
						conflicts: policyDeployStatus.conflicts,
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
						policyPk: latestDeploy.policyPk,
						latestDeploy: {
							pk: latestDeploy.deployPk,
							data: latestDeploy.data,
						},
						lastDeploy: leftJoinHint({
							pk: lastDeploy.deployPk,
							data: lastDeploy.data,
							conflicts: lastDeploy.conflicts,
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
					.where(eq(deviceActions.devicePk, args.device_id)),
		}),
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
		defineOperation({
			name: "create_policy_deploy_status",
			args: {
				device_pk: "u64",
				deploy_pk: "u64",
				status: "String", // TODO: Enum
				conflicts: "Option<String>",
				doneAt: "Now",
			},
			query: (args) =>
				db.insert(policyDeployStatus).values({
					devicePk: args.device_pk,
					deployPk: args.deploy_pk,
					status: args.status as any,
					conflicts: args.conflicts as any,
					doneAt: args.doneAt,
				}),
		}),
	],
	path.join(__dirname, "../../../../crates/mx-db/src/db.rs"),
);
