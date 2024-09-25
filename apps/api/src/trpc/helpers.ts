import { seroval } from "@mattrax/trpc-server-function";
import { flushResponse } from "@mattrax/trpc-server-function/server";
import { cache } from "@solidjs/router";
import { TRPCError, initTRPC } from "@trpc/server";
import { and, eq } from "drizzle-orm";
import { ZodError, z } from "zod";

import { trace } from "@opentelemetry/api";
import { getRequestEvent } from "solid-js/web";
import { db, tenantMembers, tenants } from "~/db";
import { checkAuth } from "../auth";

export const createTRPCContext = () => {
	return {
		db,
		event: getRequestEvent(),
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
	const [tenant] = await db
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

	return tenant !== undefined;
}, "isTenantMember");

// Authenticated procedure
export const authedProcedure = publicProcedure.use(async ({ next }) => {
	const data = await checkAuth().finally(flushResponse);

	if (!data) throw new TRPCError({ code: "UNAUTHORIZED" });

	trace.getActiveSpan()?.setAttribute("account.pk", data.account.pk);

	return next({
		ctx: {
			...data,
			ensureTenantMember: async (tenantPk: number) => {
				if (!isTenantMember(tenantPk, data.account.pk))
					throw new TRPCError({ code: "FORBIDDEN", message: "tenant" });
			},
		},
	});
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

		// Technically the user could make a request for multiple tenants in a batch but the UI doesn't allow this so gonna ignore it for now.
		trace.getActiveSpan()?.setAttribute("tenant.pk", tenant.pk);

		return opts.next({ ctx: { ...ctx, tenant } });
	});
