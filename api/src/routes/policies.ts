import { db, policies } from "../db";
import { eq } from "drizzle-orm";
import { decodeId, encodeId, newAuthedApp } from "../utils";
import { buildApplePolicy } from "@mattrax/policy";
import {
  assignDeviceConfiguration,
  createDeviceConfiguration,
  getDeviceConfiguration,
  updateDeviceConfiguration,
} from "../microsoft";
import { zValidator } from "@hono/zod-validator";
import { z } from "zod";

export const app = newAuthedApp()
  .get("/", async (c) => {
    // TODO: Is the user authorised to the current tenant???
    // TODO: Only return devices in the current tenant

    // TODO: Filter to only entities in current tenant
    const p = await db.select().from(policies);

    // TODO: Do filtering in DB + add helper for the ID encoding
    return c.json(
      p.map((d) => ({
        id: encodeId("policy", d.id),
        name: d.name,
      }))
    );
  })
  .post(
    "/",
    zValidator(
      "json",
      z.object({
        tenantId: z.string(), // TODO: Get this from the URL instead
        name: z.string().min(1).max(100),
      })
    ),
    async (c) => {
      const input = c.req.valid("json");
      const id = decodeId("tenant", input.tenantId);
      // TODO: Check user is authorised for this tenant

      const result = await db.insert(policies).values({
        name: input.name,
        tenantId: id,
      });

      return c.json(encodeId("policy", parseInt(result.insertId)));
    }
  )
  .get("/:policyId", async (c) => {
    const policyId = c.req.param("policyId");
    // TODO: Check user is authorised to access tenant which owns the device

    const id = decodeId("policy", policyId);

    const policy = (
      await db.select().from(policies).where(eq(policies.id, id))
    )?.[0];
    if (!policy) {
      throw new Error("todo: error handling"); // TODO: Error handling on the frontend too
    }

    return c.json({
      name: policy.name,
      hasSyncedWithIntune: policy.intuneId !== null,
    });
  })
  .patch("/:policyId", zValidator("json", z.any()), async (c) => {
    const input = c.req.valid("json");
    const policyId = c.req.param("policyId");
    // TODO: Check user is authorised to access tenant which owns the device

    // TODO: Validate incoming `policy`

    const id = decodeId("policy", policyId);

    // TODO: Error if id is not found by catching error
    await db
      .update(policies)
      .set({
        policy: input,
      })
      .where(eq(policies.id, id));

    return c.json({});
  })
  // TODO: Remove this route as it's an implementation detail
  .post("/:policyId/push", async (c) => {
    const policyId = c.req.param("policyId");
    // TODO: Check user is authorised to access tenant which owns the device

    const id = decodeId("policy", policyId);

    const policy = (
      await db.select().from(policies).where(eq(policies.id, id))
    )?.[0];
    if (!policy) {
      console.error("policy not found");
      return;
    }

    let policyBody: string;
    try {
      policyBody = buildApplePolicy(policy.policy);
    } catch (err) {
      console.error("ERROR BUILDING POLICY", err);
      return;
    }

    // TODO: Support Window's & Android policies

    if (!policy.intuneId) {
      console.log("CREATE ON INTUNE");

      // TODO: We probs need to create a Intune policy for each platform we wanna target

      try {
        const result = await createDeviceConfiguration({
          // @ts-expect-error // TODO: Fix types
          "@odata.context":
            "https://graph.microsoft.com/v1.0/$metadata#deviceManagement/deviceConfigurations/$entity",
          "@odata.type": "#microsoft.graph.iosCustomConfiguration",
          displayName: policy.id.toString(),
          version: 1,
          payload: btoa(policyBody),
          payloadName: "todo",
        });
        console.log(result);

        await db
          .update(policies)
          .set({
            // @ts-expect-error // TODO: Fix types
            intuneId: result.id,
            intunePolicyHash: policy.policyHash,
          })
          .where(eq(policies.id, id));
      } catch (err) {
        console.error(err);
      }

      // TODO: Assign this back into the DB
    } else {
      console.log("UPDATE POLICY");

      const intunePolicy = await getDeviceConfiguration(policy.intuneId);

      // TODO: Check if the policy has actually changed

      try {
        const result = await updateDeviceConfiguration(policy.intuneId, {
          // @ts-expect-error // TODO: Fix types
          "@odata.context":
            "https://graph.microsoft.com/v1.0/$metadata#deviceManagement/deviceConfigurations/$entity",
          "@odata.type": "#microsoft.graph.iosCustomConfiguration",
          displayName: policy.id.toString(),
          // version: intunePolicy.version! + 1,
          payload: btoa(policyBody),
          payloadName: "todo",
        });

        // TODO: If policy actually doesn't exist then just create it

        // console.log(result);
      } catch (err) {
        console.error(err);
      }
    }

    return c.json({});
  })
  .post(
    "/:policyId/assign",
    zValidator(
      "json",
      z.object({
        assignOrUnassign: z.boolean(),
      })
    ),
    async (c) => {
      const policyId = c.req.param("policyId");
      const input = c.req.valid("json");
      // TODO: Check user is authorised to access tenant which owns the device

      const id = decodeId("policy", policyId);
      const policy = (
        await db.select().from(policies).where(eq(policies.id, id))
      )?.[0];
      if (!policy) throw new Error("Policy not found");

      if (!policy.intuneId) throw new Error("Policy not synced with Intune"); // TODO: Do this automatically in this case

      try {
        const assignments = input.assignOrUnassign
          ? [
              {
                target: {
                  "@odata.type": "#microsoft.graph.allDevicesAssignmentTarget",
                },
              },
            ]
          : [];

        await assignDeviceConfiguration(policy.intuneId, {
          assignments,
        });
      } catch (err) {
        console.error(err);
      }

      return c.json({});
    }
  );
