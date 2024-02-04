import { z } from "zod";
import { eq } from "drizzle-orm";
import { authedProcedure, createTRPCRouter, publicProcedure } from "../trpc";
import { accounts, db, tenants } from "../db";
import { encodeId } from "../utils";

type UserResult = {
  id: string;
  name: string;
  email: string;
  tenants: Awaited<ReturnType<typeof fetchTenants>>;
};

const fetchTenants = async (session_id: number) =>
  (
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

export const authRouter = createTRPCRouter({
  login: publicProcedure
    .input(z.object({ email: z.string().email(), password: z.string() }))
    .mutation(async ({ ctx, input }) => {
      const name = input.email.split("@")[0] ?? "";

      // TODO: Validate email and don't just auto create new accounts

      const [result] = await db
        .insert(accounts)
        .values({ name, email: input.email })
        .onDuplicateKeyUpdate({ set: { email: input.email } });
      let userId = result.insertId;

      // The upsert didn't insert a value.
      // MySQL has no `RETURNING` so this is the best we are gonna get.
      if (userId === 0) {
        const user = (
          await db
            .select({ id: accounts.id })
            .from(accounts)
            .where(eq(accounts.email, input.email))
        )?.[0];
        if (!user) throw new Error("Error getting user we just inserted!");
        userId = user.id;
      }

      // TODO: Check credentials with DB
      // TODO: Create session in DB

      await ctx.session.update({ id: userId, name, email: input.email });
      return {};
    }),

  me: authedProcedure.query(async ({ ctx }) => {
    const session = ctx.session.data;
    return {
      id: encodeId("user", session.id),
      name: session.name,
      email: session.email,
      tenants: await fetchTenants(session.id),
    } satisfies UserResult;
  }),

  update: authedProcedure
    .input(
      z.object({
        name: z.string().optional(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const session = ctx.session.data;

      // Skip DB if we have nothing to update
      if (input.name !== undefined) {
        const result = await db
          .update(accounts)
          .set({
            name: input.name,
          })
          .where(eq(accounts.id, session.id));

        await ctx.session.update({
          ...session,
          name: input.name,
        });
      }

      return {
        id: encodeId("user", session.id),
        name: input.name || session.name,
        email: session.email,
        tenants: await fetchTenants(session.id),
      } satisfies UserResult;
    }),

  logout: authedProcedure.mutation(async ({ ctx }) => {
    // TODO: Delete session from the DB
    await ctx.session.clear();
    return {};
  }),

  //   delete: authedProcedure.mutation(async ({ ctx }) => {
  //     const session = ctx.session.data;

  //     // TODO: Require the user to leave/delete all tenant's first

  //     await db.delete(accounts).where(eq(accounts.id, session.id));
  //     await ctx.session.clear();
  //     return {};
  //   }),
});
