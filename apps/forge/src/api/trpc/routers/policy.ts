import { z } from "zod";
import { and, eq } from "drizzle-orm";
import { buildApplePolicy } from "@mattrax/policy";

import { createTRPCRouter, tenantProcedure } from "../helpers";
import { db, devices, policies, policyVersions } from "~/db";
import { createId } from "@paralleldrive/cuid2";

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
      const policy = await db
        .select({
          id: policies.pk,
          name: policies.name,
          activeVersion: {
            id: policyVersions.pk,
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
        )
        .then((v) => v?.[0]);

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
          data: policyVersions.data,
          createdAt: policyVersions.createdAt,
        })
        .from(policyVersions)
        .innerJoin(policies, eq(policyVersions.policyPk, policies.pk))
        .where(
          and(
            eq(policies.id, input.policyId),
            eq(policies.tenantPk, ctx.tenant.pk)
          )
        );

      return versions;
    }),

  createVersion: tenantProcedure
    .input(z.object({ policyId: z.string() }))
    .mutation(async ({ ctx, input }) => {
      throw new Error("TODO");

      // const policy = await db
      //   .select({
      //     id: policies.pk,
      //     activeVersion: policies.activeVersion,
      //   })
      //   .from(policies)
      //   .where(
      //     and(
      //       eq(policies.id, input.policyId),
      //       eq(policies.tenantPk, ctx.tenant.pk)
      //     )
      //   )
      //   .then((v) => v?.[0]);
      // if (!policy) throw new Error("todo: error handling");
      // const newVersionId = createId();
      // const newVersion = await db.insert(policyVersions).values({
      //   id: newVersionId,
      //   policyPk: policy.id,
      //   data: policy.activeVersion,
      // });
      // await db
      //   .update(policies)
      //   .set({ activeVersion: newVersion.insertId })
      //   .where(eq(policies.pk, policy.id));
      // return newVersionId;
    }),

  // duplicate: tenantProcedure
  //   .input(z.object({ policyId: z.string() }))
  //   .mutation(async ({ ctx, input }) => {
  //     throw new Error("TODO: Bring this back!");
  //     // const id = input.policyId;
  //     // let row = (
  //     //   await db.select().from(policies).where(eq(policies.id, id))
  //     // )?.[0];
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
