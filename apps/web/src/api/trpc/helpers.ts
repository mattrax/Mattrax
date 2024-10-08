import { seroval } from "@mattrax/trpc-server-function";
import { flushResponse } from "@mattrax/trpc-server-function/server";
import { cache } from "@solidjs/router";
import { TRPCError, initTRPC } from "@trpc/server";
import { and, eq } from "drizzle-orm";
import type { User } from "lucia";
import type { H3Event } from "vinxi/server";
import { ZodError, z } from "zod";

import { db, organisationMembers, organisations, tenants } from "~/db";
import { withAccount } from "../account";
import { checkAuth } from "../auth";
import { withTenant } from "../tenant";

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

export const getTenantList = cache(
	(accountPk: number) =>
		db
			.select({
				id: tenants.id,
				pk: tenants.pk,
				name: tenants.name,
				slug: tenants.slug,
				orgSlug: organisations.slug,
			})
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
export const authedProcedure = publicProcedure.use(async ({ next }) => {
	const data = await checkAuth().finally(flushResponse);

	if (!data) throw new TRPCError({ code: "UNAUTHORIZED" });

	return withAccount(data.account, () =>
		next({
			ctx: {
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
		}),
	);
});

export const isSuperAdmin = (account: { email: string } | User) =>
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
		const { ctx, input, type } = opts;

		const org = await getMemberOrg(input.orgSlug, ctx.account.pk);

		if (!org)
			throw new TRPCError({ code: "FORBIDDEN", message: "organisation" });

		return opts.next({ ctx: { ...ctx, org } }).then((result) => {
			// TODO: Right now we invalidate everything but we will need to be more specific in the future
			// if (type === "mutation") invalidate(org.slug);
			return result;
		});
	});

const getMemberTenant = cache(async (slug: string, accountPk: number) => {
	const [tenant] = await db
		.select({
			pk: tenants.pk,
			id: tenants.id,
			name: tenants.name,
			orgSlug: organisations.slug,
		})
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
		const { ctx, input, type } = opts;

		const tenant = await getMemberTenant(input.tenantSlug, ctx.account.pk);

		if (!tenant) throw new TRPCError({ code: "FORBIDDEN", message: "tenant" });

		return withTenant(tenant, () =>
			opts.next({ ctx: { ...ctx, tenant } }).then((result) => {
				// TODO: Right now we invalidate everything but we will need to be more specific in the future
				// if (type === "mutation") invalidate(tenant.orgSlug, input.tenantSlug);
				return result;
			}),
		);
	});

export const restricted = new Set([
	// Misleading names
	"admin",
	"administrator",
	"help",
	"mod",
	"moderator",
	"staff",
	"mattrax",
	"root",
	"contact",
	"support",
	"home",
	"employee",
	// Reserved Mattrax routes
	"enroll",
	"profile",
	"account",
]);
