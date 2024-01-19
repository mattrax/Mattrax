"use server";

import { maxLength, minLength, object, string } from "valibot";
import { validatedAction } from "~/server/action";
import { db, tenants, encodeId } from "@mattrax/api";

const createTenantSchema = object({
  name: string([minLength(1), maxLength(100)]),
});

// TODO: Require authentication
export const createTenant = validatedAction(
  createTenantSchema,
  async (session, input) => {
    const result = await db.insert(tenants).values({
      name: input.name,
      owner_id: session.data.id,
    });

    // TODO: Invalidate `tenants`

    return encodeId("tenant", parseInt(result.insertId));
  }
);
