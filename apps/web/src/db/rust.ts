import path from "node:path";
import { defineOperation, exportQueries } from "@mattrax/drizzle-to-rs";
import dotenv from "dotenv";
import { and, desc, eq, isNotNull, isNull } from "drizzle-orm";
import { union, unionAll } from "drizzle-orm/mysql-core";
import {
	certificates,
	db,
	deviceActions,
	devices,
	groupAssignables,
	policies,
	policyAssignables,
	policyDeploy,
	policyDeployStatus,
	windowsEphemeralState,
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
			name: "get_device_policies",
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
			// TODO: Can we merge this whole thing with the query above to avoid N + 1
			name: "get_policy_deploy_info",
			args: {
				policy_pk: "u64",
				device_pk: "u64",
			},
			query: (args) => {
				// Get the latest deploy for the policy
				const latestDeploy = db
					.select({
						pk: policyDeploy.pk,
						data: policyDeploy.data,
					})
					.from(policyDeploy)
					.where(eq(policyDeploy.policyPk, args.policy_pk))
					.orderBy(desc(policyDeploy.doneAt))
					.limit(1);

				// Get the last deploy applied to this device for this policy
				const latestDeployForDevice = db
					.select({
						pk: policyDeploy.pk,
						data: policyDeploy.data,
					})
					.from(policyDeploy)
					.leftJoin(
						policyDeployStatus,
						and(
							// Is targeting this policy
							eq(policyDeployStatus.deployPk, policyDeploy.pk),
							// And it's targeting this device
							eq(policyDeployStatus.deviceId, args.device_pk),
						),
					)
					.where(
						and(
							// All policies that have been deployed (hence have a status) // TODO: Account for `sent` state
							isNotNull(policyDeployStatus.deployPk),
							// For the current policy
							eq(policyDeploy.policyPk, args.policy_pk),
						),
					)
					.orderBy(desc(policyDeploy.doneAt))
					.limit(1);

				return unionAll(latestDeploy, latestDeployForDevice);
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
			name: "update_policy_deploy_status",
			args: {
				deploy_pk: "u64",
				device_id: "u64",
				key: "String",
				status: "String", // TODO: Proper Rust enum
				data: "Serialized<serde_json::Value>",
			},
			query: (args) =>
				db
					.insert(policyDeployStatus)
					.values({
						deployPk: args.deploy_pk,
						deviceId: args.device_id,
						key: args.key,
						status: args.status as any,
						data: args.data,
					})
					.onDuplicateKeyUpdate({
						set: {
							status: args.status as any,
							data: args.data,
						},
					}),
		}),
		defineOperation({
			name: "set_windows_ephemeral_state",
			args: {
				session_id: "String",
				msg_id: "String",
				cmd_id: "String",
				deploy_pk: "u64",
				key: "String",
			},
			query: (args) =>
				db
					.insert(windowsEphemeralState)
					.values({
						sessionId: args.session_id,
						msgId: args.msg_id,
						cmdId: args.cmd_id,
						deployPk: args.deploy_pk,
						key: args.key,
					})
					.onDuplicateKeyUpdate({
						set: {
							deployPk: args.deploy_pk,
							key: args.key,
						},
					}),
		}),
		defineOperation({
			name: "get_windows_ephemeral_state",
			args: {
				session_id: "String",
				msg_id: "String",
				cmd_id: "String",
			},
			query: (args) =>
				db
					.select({
						deployPk: windowsEphemeralState.deployPk,
						key: windowsEphemeralState.key,
					})
					.from(windowsEphemeralState)
					.where(
						and(
							eq(windowsEphemeralState.sessionId, args.session_id),
							eq(windowsEphemeralState.msgId, args.msg_id),
							eq(windowsEphemeralState.cmdId, args.cmd_id),
						),
					),
		}),
		defineOperation({
			name: "delete_windows_ephemeral_state",
			args: {
				session_id: "String",
				msg_id: "String",
				cmd_id: "String",
			},
			query: (args) =>
				db
					.delete(windowsEphemeralState)
					.where(
						and(
							eq(windowsEphemeralState.sessionId, args.session_id),
							eq(windowsEphemeralState.msgId, args.msg_id),
							eq(windowsEphemeralState.cmdId, args.cmd_id),
						),
					),
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
