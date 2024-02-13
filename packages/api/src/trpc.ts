import { initTRPC, TRPCError } from "@trpc/server";
import superjson from "superjson";
import { ZodError } from "zod";
import { db, tenantAccounts } from "./db";
import type {
  GetSessionResultWithData,
  GetSessionResult,
  SessionData,
} from "./types";
import { decodeId } from "./utils";
import { and, eq } from "drizzle-orm";

export const createTRPCContext = async (opts: {
  session: GetSessionResult;
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

// Authenticated procedure
export const authedProcedure = t.procedure.use(async (opts) => {
  const { ctx } = opts;
  if (ctx.session.data?.id === undefined)
    throw new TRPCError({ code: "UNAUTHORIZED" });

  return opts.next({
    ctx: {
      ...ctx,
      session: ctx.session as GetSessionResultWithData,
    },
  });
});

export const isSuperAdmin = (session: SessionData) =>
  // TODO: Make sure this check is only run if the email is verified
  session.email.endsWith("@otbeaumont.me") ||
  session.email.endsWith("@mattrax.app");

// Authenticated procedure requiring a superadmin (Mattrax employee)
export const superAdminProcedure = authedProcedure.use((opts) => {
  const { ctx } = opts;
  if (!isSuperAdmin(ctx.session.data))
    throw new TRPCError({ code: "FORBIDDEN" });

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
      eq(tenantAccounts.accountId, ctx.session.data.id)
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
