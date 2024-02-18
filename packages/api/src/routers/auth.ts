import { z } from "zod";
import { eq } from "drizzle-orm";
import { TRPCError } from "@trpc/server";
import { alphabet, generateRandomString } from "oslo/crypto";
import { appendResponseHeader } from "vinxi/server";
import { generateId } from "lucia";

import { authedProcedure, createTRPCRouter, publicProcedure } from "../trpc";
import { accounts, db, accountLoginCodes, tenants } from "../db";
import { encodeId } from "../utils";
import { sendEmail } from "../emails";
import { lucia } from "../auth";

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
      .where(eq(tenants.ownerPk, session_id))
  ).map((tenant) => ({
    ...tenant,
    id: encodeId("tenant", tenant.id),
  }));

export const authRouter = createTRPCRouter({
  sendLoginCode: publicProcedure
    .input(z.object({ email: z.string().email() }))
    .mutation(async ({ input }) => {
      const name = input.email.split("@")[0] ?? "";
      const code = generateRandomString(8, alphabet("0-9"));

      const id = generateId(16);
      const result = await db
        .insert(accounts)
        .values({ name, email: input.email, id })
        .onDuplicateKeyUpdate({
          set: { email: input.email },
        });

      let accountPk = parseInt(result.insertId);
      let accountId = id;

      if (accountPk === 0) {
        const account = await db.query.accounts.findFirst({
          where: eq(accounts.email, input.email),
        });
        if (!account)
          throw new Error("Error getting account we just inserted!");
        accountPk = account.pk;
        accountId = account.id;
      }

      await db.insert(accountLoginCodes).values({ accountPk, code });

      await sendEmail({
        type: "loginCode",
        to: input.email,
        subject: "Mattrax Login Code",
        code,
      });

      return { accountId };
    }),
  verifyLoginCode: publicProcedure
    .input(z.object({ code: z.string() }))
    .mutation(async ({ input }) => {
      const code = await db.query.accountLoginCodes.findFirst({
        where: eq(accountLoginCodes.code, input.code),
      });

      if (!code)
        throw new TRPCError({ code: "NOT_FOUND", message: "Invalid code" });

      await db
        .delete(accountLoginCodes)
        .where(eq(accountLoginCodes.code, input.code));

      const account = await db.query.accounts.findFirst({
        where: eq(accounts.pk, code.accountPk),
      });

      if (!account)
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Account not found",
        });

      const session = await lucia.createSession(account.id, {});
      appendResponseHeader(
        "Set-Cookie",
        lucia.createSessionCookie(session.id).serialize()
      );

      return true;
    }),
  me: authedProcedure.query(async ({ ctx: { account } }) => {
    return {
      id: encodeId("user", account.pk),
      name: account.name,
      email: account.email,
      tenants: await fetchTenants(account.pk),
    };
  }),
  update: authedProcedure
    .input(
      z.object({
        name: z.string().optional(),
      })
    )
    .mutation(async ({ ctx: { account }, input }) => {
      // Skip DB if we have nothing to update
      if (input.name !== undefined) {
        await db
          .update(accounts)
          .set({ name: input.name })
          .where(eq(accounts.pk, account.pk));
      }

      return {
        id: encodeId("user", account.pk),
        name: input.name || account.name,
        email: account.email,
        tenants: await fetchTenants(account.pk),
      } satisfies UserResult;
    }),

  logout: authedProcedure.mutation(async ({ ctx: { session } }) => {
    // TODO: Delete session from the DB
    await lucia.invalidateSession(session.id);
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
