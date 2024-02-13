import { z } from "zod";
import { createTRPCRouter, tenantProcedure } from "../trpc";
import { db, devices, policies, tenantAccounts } from "../db";
import { and, eq } from "drizzle-orm";
import { decodeId, encodeId } from "../utils";
import { getMdm } from "../mdm";
import { buildApplePolicy } from "@mattrax/policy";

export const policyRouter = createTRPCRouter({
  // TODO: Copy after `devicesRouter`.

  list: tenantProcedure.query(async ({ ctx }) => {
    return (
      await db
        .select({
          id: policies.id,
          name: policies.name,
        })
        .from(policies)
        .where(eq(policies.tenantId, ctx.tenantId))
    ).map((d) => ({
      ...d,
      id: encodeId("policy", d.id),
    }));
  }),

  get: tenantProcedure
    .input(z.object({ policyId: z.string() }))
    .query(async ({ ctx, input }) => {
      // TODO: Check user is authorised to access tenant which owns the device

      // const id = decodeId("policy", policyId);

      // const policy = (
      //   await db.select().from(policies).where(eq(policies.id, id))
      // )?.[0];
      // if (!policy) {
      //   throw new Error("todo: error handling"); // TODO: Error handling on the frontend too
      // }

      // return c.json({
      //   name: policy.name,
      //   hasSyncedWithIntune: policy.intuneId !== null,
      // });

      // TODO
      return {
        name: "todo",
        hasSyncedWithIntune: false,
      };
    }),

  duplicate: tenantProcedure
    .input(z.object({ policyId: z.string() }))
    .mutation(async ({ ctx, input }) => {
      const id = decodeId("policy", input.policyId);
      let row = (
        await db.select().from(policies).where(eq(policies.id, id))
      )?.[0];
      if (!row) throw new Error("todo: error handling");

      // @ts-expect-error
      delete row.id;
      // @ts-expect-error
      delete row.intuneId;
      // @ts-expect-error
      delete row.policyHash;

      const result = await db.insert(policies).values(row);
      return encodeId("policy", parseInt(result.insertId));
    }),

  update: tenantProcedure
    .input(
      z.object({
        policyId: z.string(),
        // TODO: Proper Zod type here
        policy: z.any(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      // TODO: Check user is authorised to access tenant which owns the device

      // TODO: Validate incoming `policy`

      const id = decodeId("policy", input.policyId);

      // TODO: Error if id is not found by catching error
      await db
        .update(policies)
        .set({
          policy: input,
        })
        .where(eq(policies.id, id));

      return {};
    }),

  create: tenantProcedure
    .input(
      z.object({
        name: z.string().min(1).max(100),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const result = await db.insert(policies).values({
        name: input.name,
        tenantId: ctx.tenantId,
      });
      const insertId = parseInt(result.insertId);

      return encodeId("policy", insertId);
    }),

  delete: tenantProcedure
    .input(z.object({ policyId: z.string() }))
    .mutation(async ({ ctx, input }) => {
      const id = decodeId("policy", input.policyId);
      await db.delete(policies).where(eq(policies.id, id));
    }),

  push: tenantProcedure
    .input(
      z.object({
        policyId: z.string(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      // TODO: Check user is authorised to access tenant which owns the device

      const id = decodeId("policy", input.policyId);

      const policy = (
        await db.select().from(policies).where(eq(policies.id, id))
      )?.[0];
      if (!policy) {
        console.error("policy not found");
        return;
      }

      // TODO: Support Window's & Android policies
      let policyBody: string;
      try {
        // @ts-expect-error // TODO
        policyBody = buildApplePolicy([policy.policy]);
      } catch (err) {
        console.error("ERROR BUILDING POLICY", err);
        return;
      }

      await getMdm().pushPolicy(policyBody);

      // if (!policy.intuneId) {
      //   console.log("CREATE ON INTUNE");

      //   // TODO: We probs need to create a Intune policy for each platform we wanna target

      //   try {
      //     const result = await createDeviceConfiguration({
      //       // @ts-expect-error // TODO: Fix types
      //       "@odata.context":
      //         "https://graph.microsoft.com/v1.0/$metadata#deviceManagement/deviceConfigurations/$entity",
      //       "@odata.type": "#microsoft.graph.iosCustomConfiguration",
      //       displayName: policy.id.toString(),
      //       version: 1,
      //       payload: btoa(policyBody),
      //       payloadName: "todo",
      //     });
      //     console.log(result);

      //     await db
      //       .update(policies)
      //       .set({
      //         // @ts-expect-error // TODO: Fix types
      //         intuneId: result.id,
      //         intunePolicyHash: policy.policyHash,
      //       })
      //       .where(eq(policies.id, id));
      //   } catch (err) {
      //     console.error(err);
      //   }

      //   // TODO: Assign this back into the DB
      // } else {
      //   console.log("UPDATE POLICY");

      //   const intunePolicy = await getDeviceConfiguration(policy.intuneId);

      //   // TODO: Check if the policy has actually changed

      //   try {
      //     const result = await updateDeviceConfiguration(policy.intuneId, {
      //       // @ts-expect-error // TODO: Fix types
      //       "@odata.context":
      //         "https://graph.microsoft.com/v1.0/$metadata#deviceManagement/deviceConfigurations/$entity",
      //       "@odata.type": "#microsoft.graph.iosCustomConfiguration",
      //       displayName: policy.id.toString(),
      //       // version: intunePolicy.version! + 1,
      //       payload: btoa(policyBody),
      //       payloadName: "todo",
      //     });

      //     // TODO: If policy actually doesn't exist then just create it

      //     // console.log(result);
      //   } catch (err) {
      //     console.error(err);
      //   }
      // }

      return {};
    }),

  assign: tenantProcedure
    .input(
      z.object({
        policyId: z.string(),
        assignOrUnassign: z.boolean(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      // const policyId = c.req.param("policyId");
      // const input = c.req.valid("json");
      // // TODO: Check user is authorised to access tenant which owns the device

      // const id = decodeId("policy", policyId);
      // const policy = (
      //   await db.select().from(policies).where(eq(policies.id, id))
      // )?.[0];
      // if (!policy) throw new Error("Policy not found");

      // if (!policy.intuneId) throw new Error("Policy not synced with Intune"); // TODO: Do this automatically in this case

      // try {
      //   const assignments = input.assignOrUnassign
      //     ? [
      //         {
      //           target: {
      //             "@odata.type": "#microsoft.graph.allDevicesAssignmentTarget",
      //           },
      //         },
      //       ]
      //     : [];

      //   await assignDeviceConfiguration(policy.intuneId, {
      //     assignments,
      //   });
      // } catch (err) {
      //   console.error(err);
      // }

      // return c.json({});
      return {};
    }),
});
