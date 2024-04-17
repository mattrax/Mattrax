import { seroval } from "@mattrax/trpc-server-function";
import { flushResponse } from "@mattrax/trpc-server-function/server";
import { TRPCError, initTRPC } from "@trpc/server";
import { cache } from "@solidjs/router";
import { and, eq } from "drizzle-orm";
import type { User } from "lucia";
import type { H3Event } from "vinxi/server";
import { ZodError, z } from "zod";

import { db, organisationMembers, organisations, tenants } from "~/db";
import { checkAuth } from "../auth";

export const createTRPCContext = async (event: H3Event) => {
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
export const publicProcedure = t.procedure;

const isOrganisationMember = cache(async (orgPk: number, accountPk: number) => {
	const [org] = await db
		.select({})
		.from(organisations)
		.where(eq(organisations.pk, orgPk))
		.innerJoin(
			organisationMembers,
			and(
				eq(organisations.pk, organisationMembers.orgPk),
				eq(organisationMembers.accountPk, accountPk),
			),
		);

	return org !== undefined;
}, "isOrganisationMember");

const getTenantList = cache(
	(accountPk: number) =>
		db
			.select({ pk: tenants.pk, name: tenants.name })
			.from(tenants)
			.innerJoin(organisations, eq(tenants.orgPk, organisations.pk))
			.innerJoin(
				organisationMembers,
				eq(organisations.pk, organisationMembers.orgPk),
			)
			.where(eq(organisationMembers.accountPk, accountPk)),
	"getTenantList",
);

// Authenticated procedure
export const authedProcedure = t.procedure.use(async (opts) => {
	const data = await checkAuth();

	flushResponse();

	if (!data) throw new TRPCError({ code: "UNAUTHORIZED" });

	return opts.next({
		ctx: {
			...opts.ctx,
			...data,
			ensureOrganisationMember: async (orgPk: number) => {
				if (!isOrganisationMember(orgPk, data.account.pk))
					throw new TRPCError({ code: "FORBIDDEN", message: "organisation" });
			},
			ensureTenantMember: async (tenantPk: number) => {
				const tenantList = await getTenantList(data.account.pk);

				const tenant = tenantList.find((t) => t.pk === tenantPk);
				if (!tenant)
					throw new TRPCError({ code: "FORBIDDEN", message: "tenant" });

				return tenant;
			},
		},
	});
});

export const isSuperAdmin = (
	account:
		| {
				email: string;
		  }
		| User,
) =>
	account.email.endsWith("@otbeaumont.me") ||
	account.email.endsWith("@mattrax.app");

// Authenticated procedure requiring a superadmin (Mattrax employee)
export const superAdminProcedure = authedProcedure.use((opts) => {
	const { ctx } = opts;
	if (!isSuperAdmin(ctx.account)) throw new TRPCError({ code: "FORBIDDEN" });

	return opts.next({ ctx });
});

const getMemberOrg = cache(async (slug: string, accountPk: number) => {
	const [org] = await db
		.select({
			pk: organisations.pk,
			slug: organisations.slug,
			name: organisations.name,
			ownerPk: organisations.ownerPk,
		})
		.from(organisations)
		.where(
			and(
				eq(organisations.slug, slug),
				eq(organisationMembers.accountPk, accountPk),
			),
		)
		.innerJoin(
			organisationMembers,
			eq(organisations.pk, organisationMembers.orgPk),
		);

	return org;
}, "getMemberOrg");

export const orgProcedure = authedProcedure
	.input(z.object({ orgSlug: z.string() }))
	.use(async (opts) => {
		const { ctx, input } = opts;

		const org = await getMemberOrg(input.orgSlug, ctx.account.pk);

		if (!org)
			throw new TRPCError({ code: "FORBIDDEN", message: "organisation" });

		return opts.next({ ctx: { ...ctx, org } });
	});

const getMemberTenant = cache(async (slug: string, accountPk: number) => {
	const [tenant] = await db
		.select({ pk: tenants.pk, name: tenants.name })
		.from(tenants)
		.innerJoin(organisations, eq(tenants.orgPk, organisations.pk))
		.innerJoin(
			organisationMembers,
			eq(organisations.pk, organisationMembers.orgPk),
		)
		.where(
			and(eq(tenants.slug, slug), eq(organisationMembers.accountPk, accountPk)),
		);

	return tenant;
}, "getMemberTenant");

// Authenticated procedure w/ a tenant
export const tenantProcedure = authedProcedure
	.input(z.object({ tenantSlug: z.string() }))
	.use(async (opts) => {
		const { ctx, input } = opts;

		const tenant = await getMemberTenant(input.tenantSlug, ctx.account.pk);

		if (!tenant) throw new TRPCError({ code: "FORBIDDEN", message: "tenant" });

		return opts.next({ ctx: { ...ctx, tenant } });
	});
