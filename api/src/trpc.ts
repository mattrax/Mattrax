import { initTRPC, TRPCError } from "@trpc/server";
import superjson from "superjson";
import { ZodError } from "zod";
import { db } from "./db";
import type {
  GetSessionResultWithData,
  GetSessionResult,
  SessionData,
} from "./types";
import { decodeId } from "./utils";

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
export const superAdminProcedure = authedProcedure.use(async (opts) => {
  const { ctx } = opts;
  if (!isSuperAdmin(ctx.session.data))
    throw new TRPCError({ code: "FORBIDDEN" });

  return opts.next({ ctx });
});

// Authenticated procedure w/ a tenant
export const tenantProcedure = authedProcedure.use(async (opts) => {
  const { ctx } = opts;
  const tenantId = ctx.tenantId;
  if (!tenantId)
    throw new TRPCError({
      code: "BAD_REQUEST",
      message: "'x-tenant-id' required",
    });

  return opts.next({
    ctx: {
      ...ctx,
      tenantId: decodeId("tenant", tenantId),
    },
  });
});
