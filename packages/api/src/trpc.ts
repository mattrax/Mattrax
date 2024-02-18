import { initTRPC, TRPCError } from "@trpc/server";
import superjson from "superjson";
import { ZodError } from "zod";
import { getCookie, appendResponseHeader } from "vinxi/server";
import { User } from "lucia";
import { and, eq } from "drizzle-orm";

import { db, tenantAccounts } from "./db";
import { decodeId } from "./utils";
import { lucia } from "./auth";
import { HonoEnv } from "./types";

export const createTRPCContext = async (opts: {
  env: HonoEnv["Bindings"];
  tenantId: string | undefined;
}) => {
  return {
    db,
    ...opts,
  };
};

const t = initTRPC.context<typeof createTRPCContext>().create({
  transformer: superjson,
  errorFormatter({ shape, error }) {
    return {
      ...shape,
      data: {
        ...shape.data,
        zodError:
          error.cause instanceof ZodError ? error.cause.flatten() : null,
      },
    };
  },
});

export const createTRPCRouter = t.router;

// Public (unauthenticated) procedure
export const publicProcedure = t.procedure;

export async function ensureAuthenticated() {}

// Authenticated procedure
export const authedProcedure = t.procedure.use(async (opts) => {
  const sessionId = getCookie(lucia.sessionCookieName) ?? null;

  const data = await (async () => {
    if (sessionId === null) return;

    const { session, user: account } = await lucia.validateSession(sessionId);

    if (session && session.fresh) {
      appendResponseHeader(
        "Set-Cookie",
        lucia.createSessionCookie(session.id).serialize()
      );
    }
    if (!session) {
      appendResponseHeader(
        "Set-Cookie",
        lucia.createBlankSessionCookie().serialize()
      );
    }

    if (session && account) return { session, account };
  })();

  if (!data) throw new TRPCError({ code: "UNAUTHORIZED" });

  return opts.next({
    ctx: {
      ...opts.ctx,
      ...data,
    },
  });
});

export const isSuperAdmin = (account: User) =>
  // TODO: Make sure this check is only run if the email is verified
  account.email.endsWith("@otbeaumont.me") ||
  account.email.endsWith("@mattrax.app");

// Authenticated procedure requiring a superadmin (Mattrax employee)
export const superAdminProcedure = authedProcedure.use((opts) => {
  const { ctx } = opts;
  if (!isSuperAdmin(ctx.account)) throw new TRPCError({ code: "FORBIDDEN" });

  return opts.next({ ctx });
});

// Authenticated procedure w/ a tenant
export const tenantProcedure = authedProcedure.use(async (opts) => {
  const { ctx } = opts;
  if (ctx.tenantId === undefined)
    throw new TRPCError({
      code: "BAD_REQUEST",
      message: "'x-tenant-id' required",
    });

  const tenantId = decodeId("tenant", ctx.tenantId);

  const tenantAccount = await db.query.tenantAccounts.findFirst({
    where: and(
      eq(tenantAccounts.tenantId, tenantId),
      eq(tenantAccounts.accountPk, ctx.account.pk)
    ),
  });

  if (tenantAccount === undefined)
    throw new TRPCError({
      code: "FORBIDDEN",
      message: "tenant",
    });

  return opts.next({
    ctx: {
      ...ctx,
      tenantId,
    },
  });
});
