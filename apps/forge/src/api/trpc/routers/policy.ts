import { z } from "zod";
import { and, count, eq, sql } from "drizzle-orm";

import { createTRPCRouter, tenantProcedure } from "../helpers";
import {
  accounts,
  db,
  devices,
  groups,
  policies,
  policyAssignableVariants,
  policyAssignables,
  policyVersions,
  users,
} from "~/db";
import { createId } from "@paralleldrive/cuid2";
import { promiseAllObject } from "~/api/utils";
import { TRPCError } from "@trpc/server";

function getPolicy(args: { policyId: string; tenantPk: number }) {
  return db.query.policies.findFirst({
    where: and(
      eq(policies.id, args.policyId),
      eq(policies.tenantPk, args.tenantPk)
    ),
  });
}

export const policyRouter = createTRPCRouter({
  list: tenantProcedure.query(async ({ ctx }) => {
    return await db
      .select({
        id: policies.id,
        name: policies.name,
        activeVersionId: policyVersions.id,
      })
      .from(policies)
      .leftJoin(policyVersions, eq(policies.activeVersion, policyVersions.pk))
      .where(eq(policies.tenantPk, ctx.tenant.pk));
  }),

  get: tenantProcedure
    .input(z.object({ policyId: z.string() }))
    .query(async ({ ctx, input }) => {
      const [policy] = await db
        .select({
          id: policies.id,
          name: policies.name,
          activeVersion: {
            id: policyVersions.pk,
            status: policyVersions.status,
            data: policyVersions.data,
            createdAt: policyVersions.createdAt,
          },
        })
        .from(policies)
        .leftJoin(policyVersions, eq(policies.activeVersion, policyVersions.pk))
        .where(
          and(
            eq(policies.id, input.policyId),
            eq(policies.tenantPk, ctx.tenant.pk)
          )
        );

      if (!policy) throw new Error("todo: error handling"); // TODO: Error and have frontend catch and handle it

      return policy;
    }),

  update: tenantProcedure
    .input(
      z.object({
        policyId: z.string(),
        name: z.string(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      await db
        .update(policies)
        .set({
          name: input.name,
        })
        .where(
          and(
            eq(policies.id, input.policyId),
            eq(policies.tenantPk, ctx.tenant.pk)
          )
        );

      return {};
    }),

  getVersions: tenantProcedure
    .input(z.object({ policyId: z.string() }))
    .query(async ({ ctx, input }) => {
      const versions = await db
        .select({
          id: policyVersions.id,
          status: policyVersions.status,
          data: policyVersions.data,
          deployedBy: accounts.name,
          deployedAt: policyVersions.deployedAt,
          deployComment: policyVersions.deployComment,
          createdAt: policyVersions.createdAt,
        })
        .from(policyVersions)
        .innerJoin(policies, eq(policyVersions.policyPk, policies.pk))
        .leftJoin(accounts, eq(policyVersions.deployedBy, accounts.pk))
        .where(
          and(
            eq(policies.id, input.policyId),
            eq(policies.tenantPk, ctx.tenant.pk)
          )
        );

      return versions;
    }),

  updateVersion: tenantProcedure
    .input(
      z.object({
        policyId: z.string(),
        versionId: z.string(),
        data: z.any(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      // TODO: Check no-one has edited this policy since we read it.

      await db
        .update(policyVersions)
        .set({
          data: input.data,
        })
        .where(
          and(
            eq(policyVersions.id, input.versionId),
            // TODO: tenant id  // eq(policyVersions.policyPk, input.policyId) // TODO
            // You can only update non-deployed versions
            eq(policyVersions.status, "open")
          )
        );

      return {};
    }),

  deployVersion: tenantProcedure
    .input(z.object({ policyId: z.string(), comment: z.string() }))
    .mutation(async ({ ctx, input }) => {
      // TODO: Maybe transaction for this?

      const [policy] = await db
        .select({
          id: policies.id,
          pk: policies.pk,
          activeVersion: policies.activeVersion,
        })
        .from(policies)
        .where(
          and(
            eq(policies.id, input.policyId),
            eq(policies.tenantPk, ctx.tenant.pk)
          )
        );
      if (!policy) throw new Error("todo: error handling"); // TODO: Error and have frontend catch and handle it

      const status = await db
        .update(policyVersions)
        .set({
          status: "deploying",
          deployComment: input.comment,
          deployedBy: ctx.account.pk,
          deployedAt: new Date(),
        })
        .where(
          and(
            eq(policyVersions.policyPk, policy.pk),
            eq(policyVersions.status, "open")
          )
        );
      const versionId = parseInt(status.insertId);

      await db
        .update(policies)
        .set({ activeVersion: versionId })
        .where(
          and(
            eq(policies.id, input.policyId),
            eq(policies.tenantPk, ctx.tenant.pk)
          )
        );

      if (status.rowsAffected !== 0) {
        // TODO: Send push notification to all devices
        // TODO: Push into device page
      }
    }),

  createVersion: tenantProcedure
    .input(z.object({ policyId: z.string() }))
    .mutation(async ({ ctx, input }) => {
      // TODO: Maybe transaction for this?

      const [policy] = await db
        .select({
          pk: policies.pk,
          activeVersion: policies.activeVersion,
        })
        .from(policies)
        .where(
          and(
            eq(policies.id, input.policyId),
            eq(policies.tenantPk, ctx.tenant.pk)
          )
        );
      if (!policy) throw new Error("todo: error handling"); // TODO: Error and have frontend catch and handle it

      const [result] = await db
        .select({
          count: count(),
        })
        .from(policyVersions)
        .where(
          and(
            eq(policyVersions.id, input.policyId),
            // eq(policyVersions.tenantPk, ctx.tenant.pk),
            eq(policyVersions.status, "open")
          )
        );
      const numOpenPolicies = result?.count;

      if (numOpenPolicies !== 0)
        throw new Error("There is already an open policy version");

      const [activeVersion] = await db
        .select({
          id: policyVersions.pk,
          data: policyVersions.data,
        })
        .from(policyVersions)
        .where(
          and(
            // @ts-expect-error
            eq(policyVersions.pk, policy.activeVersion) // TODO: This should probs not be this. It should be the latest version???
            // eq(policyVersions.policyPk, policy.id), // TODO
          )
        );

      const newVersionId = createId();
      const newVersion = await db.insert(policyVersions).values({
        id: newVersionId,
        policyPk: policy.pk,
        data: activeVersion?.data || {},
      });

      await db
        .update(policies)
        .set({ activeVersion: parseInt(newVersion.insertId) })
        .where(eq(policies.pk, policy.pk));

      return newVersionId;
    }),

  scope: tenantProcedure
    .input(z.object({ id: z.string() }))
    .query(({ ctx, input }) => {
      return getPolicy({ policyId: input.id, tenantPk: ctx.tenant.pk });
    }),

  members: tenantProcedure
    .input(z.object({ id: z.string() }))
    .query(async ({ ctx, input }) => {
      const policy = await getPolicy({
        policyId: input.id,
        tenantPk: ctx.tenant.pk,
      });
      if (!policy)
        throw new TRPCError({ code: "NOT_FOUND", message: "Policy not found" });

      return await db
        .select({
          pk: policyAssignables.groupablePk,
          variant: policyAssignables.groupableVariant,
          name: sql<string>`
            GROUP_CONCAT(
                CASE
                    WHEN ${policyAssignables.groupableVariant} = "device" THEN ${devices.name}
                    WHEN ${policyAssignables.groupableVariant} = "user" THEN ${users.name}
                    WHEN ${policyAssignables.groupableVariant} = "group" THEN ${groups.name}
                END
            )
          `.as("name"),
        })
        .from(policyAssignables)
        .where(eq(policyAssignables.policyPk, policy.pk))
        .leftJoin(
          devices,
          and(
            eq(devices.pk, policyAssignables.groupablePk),
            eq(policyAssignables.groupableVariant, "device")
          )
        )
        .leftJoin(
          users,
          and(
            eq(users.pk, policyAssignables.groupablePk),
            eq(policyAssignables.groupableVariant, "user")
          )
        )
        .leftJoin(
          groups,
          and(
            eq(groups.pk, policyAssignables.groupablePk),
            eq(policyAssignables.groupableVariant, "group")
          )
        )
        .groupBy(
          policyAssignables.groupableVariant,
          policyAssignables.groupablePk
        );
    }),

  possibleMembers: tenantProcedure
    .input(z.object({ id: z.string() }))
    .query(({ ctx }) =>
      promiseAllObject({
        users: db.query.users
          .findMany({
            where: eq(users.tenantPk, ctx.tenant.pk),
            columns: { name: true, id: true, pk: true },
          })
          .then((r) => r || []),
        devices: db.query.devices
          .findMany({
            where: eq(devices.tenantPk, ctx.tenant.pk),
            columns: { name: true, id: true, pk: true },
          })
          .then((r) => r || []),
        groups: db.query.groups
          .findMany({
            where: eq(groups.tenantPk, ctx.tenant.pk),
            columns: { name: true, id: true, pk: true },
          })
          .then((r) => r || []),
      })
    ),

  addMembers: tenantProcedure
    .input(
      z.object({
        id: z.string(),
        members: z.array(
          z.object({
            pk: z.number(),
            variant: z.enum(policyAssignableVariants),
          })
        ),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const policy = await getPolicy({
        policyId: input.id,
        tenantPk: ctx.tenant.pk,
      });
      if (!policy)
        throw new TRPCError({ code: "NOT_FOUND", message: "Policy not found" });

      await db.insert(policyAssignables).values(
        input.members.map((member) => ({
          policyPk: policy.pk,
          groupablePk: member.pk,
          groupableVariant: member.variant,
        }))
      );
    }),

  // duplicate: tenantProcedure
  //   .input(z.object({ policyId: z.string() }))
  //   .mutation(async ({ ctx, input }) => {
  //     throw new Error("TODO: Bring this back!");
  //     // const id = input.policyId;
  //     // let [row] = (
  //     //   await db.select().from(policies).where(eq(policies.id, id))
  //     // );
  //     // if (!row) throw new Error("todo: error handling");

  //     // // @ts-expect-error
  //     // delete row.id;
  //     // // @ts-expect-error
  //     // delete row.intuneId;
  //     // // @ts-expect-error
  //     // delete row.policyHash;

  //     // const result = await db.insert(policies).values(row);
  //     // return parseInt(result.insertId);
  //   }),

  // updateVersion: tenantProcedure
  //   .input(
  //     z.object({
  //       policyId: z.number(),
  //       versionId: z.number(),
  //       // TODO: Proper Zod type here
  //       data: z.any(),
  //     })
  //   )
  //   .mutation(async ({ ctx, input }) => {
  //     await db
  //       .update(policyVersions)
  //       .set({
  //         data: input.data,
  //       })
  //       .where(
  //         and(
  //           eq(policyVersions.pk, input.versionId),
  //           eq(policyVersions.policyPk, input.policyId)
  //         )
  //       );

  //     return {};
  //   }),

  create: tenantProcedure
    .input(z.object({ name: z.string().min(1).max(100) }))
    .mutation(({ ctx, input }) =>
      db.transaction(async (db) => {
        const policyId = createId();
        const policyInsert = await db.insert(policies).values({
          id: policyId,
          name: input.name,
          tenantPk: ctx.tenant.pk,
        });
        const policyPk = parseInt(policyInsert.insertId);

        const versionInsert = await db
          .insert(policyVersions)
          .values({ id: createId(), policyPk, data: {} });

        await db
          .update(policies)
          .set({ activeVersion: parseInt(versionInsert.insertId) })
          .where(eq(policies.pk, policyPk));

        return policyId;
      })
    ),

  delete: tenantProcedure
    .input(z.object({ policyId: z.string() }))
    .mutation(async ({ ctx, input }) => {
      await db
        .delete(policies)
        .where(
          and(
            eq(policies.id, input.policyId),
            eq(policies.tenantPk, ctx.tenant.pk)
          )
        );
    }),
});
