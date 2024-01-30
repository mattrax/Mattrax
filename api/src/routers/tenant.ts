import { z } from "zod";
import { authedProcedure, createTRPCRouter } from "../trpc";
import { encodeId } from "../utils";
import { db, tenantAccounts, tenants } from "../db";

export const tenantRouter = createTRPCRouter({
  //   get: procedure.input(z.object({ text: z.string() })).query(({ input }) => {
  //     return {
  //       greeting: `Hello ${input.text}`,
  //     };
  //   }),

  create: authedProcedure
    .input(z.object({ name: z.string().min(1) }))
    .mutation(async ({ ctx, input }) => {
      const lastInsertId = await db.transaction(async (tx) => {
        const result = await db.insert(tenants).values({
          name: input.name,
          owner_id: ctx.session.data.id,
        });
        const lastInsertId = parseInt(result.insertId);

        await db.insert(tenantAccounts).values({
          tenantId: lastInsertId,
          accountId: ctx.session.data.id,
        });

        return lastInsertId;
      });

      // TODO: Invalidate `tenants`

      return {
        id: encodeId("tenant", lastInsertId),
      };
    }),
});
