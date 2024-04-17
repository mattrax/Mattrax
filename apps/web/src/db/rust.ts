import path from "node:path";
import { defineOperation, exportQueries } from "@mattrax/drizzle-to-rs";
import dotenv from "dotenv";
import { and, desc, eq, exists, isNotNull, isNull, sql } from "drizzle-orm";
import { union, unionAll } from "drizzle-orm/mysql-core";
import {
  certificates,
  db,
  deviceActions,
  devices,
  groupMembers,
  policies,
  policyAssignments,
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
      name: "get_device_directly_scoped_policies",
      args: {
        device_pk: "u64",
      },
      // TODO: Maybe just get the policy deploys now???
      query: (args) =>
        db
          .select({
            pk: policies.pk,
            id: policies.id,
            name: policies.name,
          })
          .from(policies)
          .innerJoin(
            policyAssignments,
            eq(policies.pk, policyAssignments.policyPk),
          )
          .where(
            and(
              eq(policyAssignments.variant, "device"),
              eq(policyAssignments.pk, args.device_pk),
            ),
          ),
    }),
    defineOperation({
      name: "get_device_groups",
      args: {
        device_pk: "u64",
      },
      query: (args) =>
        db
          .select({
            pk: policies.pk,
            id: policies.id,
            name: policies.name,
          })
          .from(policies)
          .innerJoin(
            policyAssignments,
            eq(policies.pk, policyAssignments.policyPk),
          )
          .innerJoin(
            groupMembers,
            and(
              eq(groupMembers.groupPk, policyAssignments.pk),
              eq(policyAssignments.variant, "group"),
            ),
          )
          .where(
            and(
              eq(groupMembers.variant, "device"),
              eq(groupMembers.pk, args.device_pk),
            ),
          ),
    }),
    defineOperation({
      name: "get_group_policy_deploys",
      args: {
        group_pk: "u64",
      },
      query: (args) =>
        db
          .select({
            pk: policyDeploy.pk,
            data: policyDeploy.data,
            priority: policies.priority,
          })
          .from(policyDeploy)
          .innerJoin(
            policyAssignments,
            eq(policyDeploy.policyPk, policyAssignments.policyPk),
          )
          .innerJoin(policies, eq(policies.pk, policyAssignments.policyPk))
          .where(
            and(
              eq(policyAssignments.variant, "group"),
              eq(policyAssignments.pk, args.group_pk),
              eq(
                policyDeploy.doneAt,
                // TODO: Can we do this without manual SQL
                sql`(SELECT MAX(${policyDeploy.doneAt}) FROM ${policyDeploy} WHERE ${policyDeploy.policyPk} = ${policyAssignments.policyPk})`,
              ),
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
