import { z } from "zod";
import { and, eq } from "drizzle-orm";
import { buildApplePolicy } from "@mattrax/policy";

import { createTRPCRouter, tenantProcedure } from "../trpc";
import { db, devices, policies, policyVersions } from "../db";
import { getMdm } from "../mdm";
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

  duplicate: tenantProcedure
    .input(z.object({ policyId: z.string() }))
    .mutation(async ({ ctx, input }) => {
      throw new Error("TODO: Bring this back!");
      // const id = input.policyId;
      // let row = (
      //   await db.select().from(policies).where(eq(policies.id, id))
      // )?.[0];
      // if (!row) throw new Error("todo: error handling");

      // // @ts-expect-error
      // delete row.id;
      // // @ts-expect-error
      // delete row.intuneId;
      // // @ts-expect-error
      // delete row.policyHash;

      // const result = await db.insert(policies).values(row);
      // return parseInt(result.insertId);
    }),

  updateVersion: tenantProcedure
    .input(
      z.object({
        policyId: z.number(),
        versionId: z.number(),
        // TODO: Proper Zod type here
        data: z.any(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      await db
        .update(policyVersions)
        .set({
          data: input.data,
        })
        .where(
          and(
            eq(policyVersions.pk, input.versionId),
            eq(policyVersions.policyPk, input.policyId)
          )
        );

      return {};
    }),

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
    .mutation(async ({ input }) => {
      await db.delete(policies).where(eq(policies.id, input.policyId));
    }),

  // push: tenantProcedure
  //   .input(
  //     z.object({
  //       policyId: z.number(),
  //     })
  //   )
  //   .mutation(async ({ ctx, input }) => {
  //     // TODO: Check user is authorised to access tenant which owns the device

  //     const id = input.policyId;

  //     const policy = (
  //       await db.select().from(policies).where(eq(policies.id, id))
  //     )?.[0];
  //     if (!policy) {
  //       console.error("policy not found");
  //       return;
  //     }

  //     // TODO: Support Window's & Android policies
  //     let policyBody: string;
  //     try {
  //       // @ts-expect-error // TODO
  //       policyBody = buildApplePolicy([policy.policy]);
  //     } catch (err) {
  //       console.error("ERROR BUILDING POLICY", err);
  //       return;
  //     }

  //     await getMdm().pushPolicy(policyBody);

  //     // if (!policy.intuneId) {
  //     //   console.log("CREATE ON INTUNE");

  //     //   // TODO: We probs need to create a Intune policy for each platform we wanna target

  //     //   try {
  //     //     const result = await createDeviceConfiguration({
  //     //       // @ts-expect-error // TODO: Fix types
  //     //       "@odata.context":
  //     //         "https://graph.microsoft.com/v1.0/$metadata#deviceManagement/deviceConfigurations/$entity",
  //     //       "@odata.type": "#microsoft.graph.iosCustomConfiguration",
  //     //       displayName: policy.id.toString(),
  //     //       version: 1,
  //     //       payload: btoa(policyBody),
  //     //       payloadName: "todo",
  //     //     });
  //     //     console.log(result);

  //     //     await db
  //     //       .update(policies)
  //     //       .set({
  //     //         // @ts-expect-error // TODO: Fix types
  //     //         intuneId: result.id,
  //     //         intunePolicyHash: policy.policyHash,
  //     //       })
  //     //       .where(eq(policies.id, id));
  //     //   } catch (err) {
  //     //     console.error(err);
  //     //   }

  //     //   // TODO: Assign this back into the DB
  //     // } else {
  //     //   console.log("UPDATE POLICY");

  //     //   const intunePolicy = await getDeviceConfiguration(policy.intuneId);

  //     //   // TODO: Check if the policy has actually changed

  //     //   try {
  //     //     const result = await updateDeviceConfiguration(policy.intuneId, {
  //     //       // @ts-expect-error // TODO: Fix types
  //     //       "@odata.context":
  //     //         "https://graph.microsoft.com/v1.0/$metadata#deviceManagement/deviceConfigurations/$entity",
  //     //       "@odata.type": "#microsoft.graph.iosCustomConfiguration",
  //     //       displayName: policy.id.toString(),
  //     //       // version: intunePolicy.version! + 1,
  //     //       payload: btoa(policyBody),
  //     //       payloadName: "todo",
  //     //     });

  //     //     // TODO: If policy actually doesn't exist then just create it

  //     //     // console.log(result);
  //     //   } catch (err) {
  //     //     console.error(err);
  //     //   }
  //     // }

  //     return {};
  //   }),

  // assign: tenantProcedure
  //   .input(
  //     z.object({
  //       policyId: z.string(),
  //       assignOrUnassign: z.boolean(),
  //     })
  //   )
  //   .mutation(async ({ ctx, input }) => {
  //     // const policyId = c.req.param("policyId");
  //     // const input = c.req.valid("json");
  //     // // TODO: Check user is authorised to access tenant which owns the device

  //     // const id = parseInt(policyId);
  //     // const policy = (
  //     //   await db.select().from(policies).where(eq(policies.id, id))
  //     // )?.[0];
  //     // if (!policy) throw new Error("Policy not found");

  //     // if (!policy.intuneId) throw new Error("Policy not synced with Intune"); // TODO: Do this automatically in this case

  //     // try {
  //     //   const assignments = input.assignOrUnassign
  //     //     ? [
  //     //         {
  //     //           target: {
  //     //             "@odata.type": "#microsoft.graph.allDevicesAssignmentTarget",
  //     //           },
  //     //         },
  //     //       ]
  //     //     : [];

  //     //   await assignDeviceConfiguration(policy.intuneId, {
  //     //     assignments,
  //     //   });
  //     // } catch (err) {
  //     //   console.error(err);
  //     // }

  //     // return c.json({});
  //     return {};
  //   }),
});
