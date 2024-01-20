// TODO: Remove this file once the move away from Server Actions is done.

import { db, tenants } from "./db";
import { encodeId } from "./utils";
import { eq } from "drizzle-orm";

export async function tempTenantLoader(session_id: number) {
  return (
    await db
      .select({
        id: tenants.id,
        name: tenants.name,
      })
      .from(tenants)
      .where(eq(tenants.owner_id, session_id))
  ).map((tenant) => ({
    ...tenant,
    id: encodeId("tenant", tenant.id),
  }));
}
