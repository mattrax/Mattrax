import { TRPCError, initTRPC } from "@trpc/server";
import { and, eq } from "drizzle-orm";
import { User } from "lucia";
import {
	appendResponseHeader,
	getCookie,
	getEvent,
	setCookie,
} from "vinxi/server";
import { ZodError, z } from "zod";

import { db, tenantAccounts, tenants } from "~/db";
import { lucia } from "../auth";
import { seroval } from "@mattrax/trpc-solid-start";

export const createContext = () => {
	return {
		db,
		event: getEvent(),
	};
};

const t = initTRPC.context<typeof createContext>().create({
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

// Authenticated procedure
export const authedProcedure = t.procedure.use(async (opts) => {
	const sessionId = getCookie(opts.ctx.event, lucia.sessionCookieName) ?? null;

	const data = await (async () => {
		if (sessionId === null) return;

		const { session, user: account } = await lucia.validateSession(sessionId);

		if (session) {
			if (session.fresh)
				appendResponseHeader(
					opts.ctx.event,
					"Set-Cookie",
					lucia.createSessionCookie(session.id).serialize(),
				);

			if (getCookie(opts.ctx.event, "isLoggedIn") === undefined) {
				setCookie(opts.ctx.event, "isLoggedIn", "true", {
					httpOnly: false,
				});
			}
		}
		if (!session) {
			appendResponseHeader(
				opts.ctx.event,
				"Set-Cookie",
				lucia.createBlankSessionCookie().serialize(),
			);
		}

		if (session && account) return { session, account };
	})();

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
