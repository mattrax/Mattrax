import { z } from "zod";
import { createTRPCRouter, tenantProcedure } from "../trpc";
import { db, users } from "../db";
import { eq } from "drizzle-orm";
import { encodeId } from "../utils";

export const userRouter = createTRPCRouter({
  // TODO: Copy after `devicesRouter`.

  list: tenantProcedure
    // .input(
    //   z.object({
    //     // TODO: Constrain offset and limit to specific max/min values
    //     offset: z.number().default(0),
    //     limit: z.number().default(50),
    //     // query: z.string().optional(),
    //   })
    // )
    .query(async ({ ctx, input }) => {
      // TODO: Full-text search???
      // TODO: Pagination abstraction
      // TODO: Can a cursor make this more efficent???
      // TODO: Switch to DB

      return await db
        .select({
          id: users.id,
          name: users.name,
          email: users.email,
        })
        .from(users)
        // TODO: Is user authorised to tenant
        .where(eq(users.tenantId, ctx.tenantId));
    }),
});
