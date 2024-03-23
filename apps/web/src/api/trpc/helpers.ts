import { TRPCError, initTRPC } from "@trpc/server";
import { and, eq } from "drizzle-orm";
import { User } from "lucia";
import superjson from "superjson";
import {
	H3Event,
	appendResponseHeader,
	getCookie,
	setCookie,
} from "vinxi/server";
import { ZodError, z } from "zod";

import { db, tenantAccounts, tenants } from "~/db";
import { checkAuth, lucia } from "../auth";

export const createTRPCContext = async (event: H3Event) => {
	return {
		db,
		event,
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
	const data = await checkAuth(opts.ctx.event);
	if (!data) throw new TRPCError({ code: "UNAUTHORIZED" });

	let tenantList: Array<{ pk: number; name: string }> | undefined;

	const getTenantList = async () => {
		if (!tenantList)
			tenantList = await db
				.select({ pk: tenants.pk, name: tenants.name })
				.from(tenants)
				.where(eq(tenantAccounts.accountPk, data.account.pk))
				.innerJoin(tenantAccounts, eq(tenants.pk, tenantAccounts.tenantPk));

		return tenantList;
	};

	return opts.next({
		ctx: {
			...opts.ctx,
			...data,
			ensureTenantAccount: async (tenantPk: number) => {
				const tenantList = await getTenantList();

				const tenant = tenantList.find((t) => t.pk === tenantPk);
				if (!tenant)
					throw new TRPCError({ code: "FORBIDDEN", message: "tenant" });

				return tenant;
			},
		},
	});
});

export const isSuperAdmin = (account: User) =>
	account.email.endsWith("@otbeaumont.me") ||
	account.email.endsWith("@mattrax.app");

// Authenticated procedure requiring a superadmin (Mattrax employee)
export const superAdminProcedure = authedProcedure.use((opts) => {
	const { ctx } = opts;
	if (!isSuperAdmin(ctx.account)) throw new TRPCError({ code: "FORBIDDEN" });

	return opts.next({ ctx });
});

// Authenticated procedure w/ a tenant
export const tenantProcedure = authedProcedure
	.input(
		z.object({
			tenantSlug: z.string(),
		}),
	)
	.use(async (opts) => {
		const { ctx, input } = opts;

		const [tenant] = await db
			.select({ pk: tenants.pk, name: tenants.name, ownerPk: tenants.ownerPk })
			.from(tenants)
			.where(
				and(
					eq(tenantAccounts.accountPk, ctx.account.pk),
					eq(tenants.slug, input.tenantSlug),
				),
			)
			.innerJoin(tenantAccounts, eq(tenants.pk, tenantAccounts.tenantPk));

		if (!tenant) throw new TRPCError({ code: "FORBIDDEN", message: "tenant" });

		return opts.next({
			ctx: {
				...ctx,
				tenant,
			},
		});
	});
