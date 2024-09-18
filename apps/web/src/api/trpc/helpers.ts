import { seroval } from "@mattrax/trpc-server-function";
import { flushResponse } from "@mattrax/trpc-server-function/server";
import { cache } from "@solidjs/router";
import { TRPCError, initTRPC } from "@trpc/server";
import { and, eq } from "drizzle-orm";
import type { H3Event } from "vinxi/server";
import { ZodError, z } from "zod";

import { db, tenantMembers, tenants } from "~/db";
import { withAccount } from "../account";
import { checkAuth } from "../auth";

export const createTRPCContext = (event: H3Event) => {
	return {
		db,
		event,
	};
};

const t = initTRPC.context<typeof createTRPCContext>().create({
	transformer: seroval,
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
export const publicProcedure = t.procedure.use(async ({ next }) => {
	try {
		const resp = await next();
		flushResponse();
		return resp;
	} catch (err) {
		flushResponse();
		throw err;
	}
});

const isTenantMember = cache(async (tenantPk: number, accountPk: number) => {
	const [org] = await db
		.select({})
		.from(tenants)
		.where(eq(tenants.pk, tenantPk))
		.innerJoin(
			tenantMembers,
			and(
				eq(tenants.pk, tenantMembers.tenantPk),
				eq(tenantMembers.accountPk, accountPk),
			),
		);

	return org !== undefined;
}, "isTenantMember");

// Authenticated procedure
export const authedProcedure = publicProcedure.use(async ({ next }) => {
	const data = await checkAuth().finally(flushResponse);

	if (!data) throw new TRPCError({ code: "UNAUTHORIZED" });

	return withAccount(data.account, () =>
		next({
			ctx: {
				...data,
				ensureTenantMember: async (tenantPk: number) => {
					if (!isTenantMember(tenantPk, data.account.pk))
						throw new TRPCError({ code: "FORBIDDEN", message: "tenant" });
				},
			},
		}),
	);
});

const getTenant = cache(async (tenantId: string, accountPk: number) => {
	const [tenant] = await db
		.select({
			id: tenants.id,
			pk: tenants.pk,
		})
		.from(tenants)
		.where(eq(tenants.id, tenantId))
		.innerJoin(
			tenantMembers,
			and(
				eq(tenants.pk, tenantMembers.tenantPk),
				eq(tenantMembers.accountPk, accountPk),
			),
		);

	return tenant;
}, "isTenantMemberById");

export const tenantProcedure = authedProcedure
	.input(z.object({ tenantId: z.string() }))
	.use(async (opts) => {
		const { ctx, input, type } = opts;

		const tenant = await getTenant(input.tenantId, ctx.account.pk);
		if (!tenant) throw new TRPCError({ code: "FORBIDDEN", message: "tenant" });

		return opts.next({ ctx: { ...ctx, tenant } });
	});
