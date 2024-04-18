import { appendResponseHeader, deleteCookie, setCookie } from "vinxi/server";
import { flushResponse } from "@mattrax/trpc-server-function/server";
import { alphabet, generateRandomString } from "oslo/crypto";
import { createId } from "@paralleldrive/cuid2";
import { TRPCError } from "@trpc/server";
import { eq, sql } from "drizzle-orm";
import { generateId } from "lucia";
import { z } from "zod";

import { checkAuth, lucia } from "~/api/auth";
import { sendEmail } from "~/api/emails";
import {
	accountLoginCodes,
	accounts,
	db,
	organisationMembers,
	organisations,
	tenants,
} from "~/db";
import {
	authedProcedure,
	createTRPCRouter,
	isSuperAdmin,
	publicProcedure,
	superAdminProcedure,
} from "../helpers";
import { getObjectKeys, randomSlug } from "~/api/utils";
import { type Features, features } from "~/lib/featureFlags";

type UserResult = {
	id: number;
	name: string;
	email: string;
	tenants: Awaited<ReturnType<typeof fetchTenants>>;
};

const fetchTenants = (accountPk: number) =>
	db
		.select({
			id: tenants.id,
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
		.where(eq(organisationMembers.accountPk, accountPk));

const fetchOrgs = (accountPk: number) =>
	db
		.select({
			id: organisations.id,
			name: organisations.name,
			slug: organisations.slug,
			ownerId: accounts.id,
		})
		.from(organisations)
		.where(eq(organisationMembers.accountPk, accountPk))
		.innerJoin(
			organisationMembers,
			eq(organisations.pk, organisationMembers.orgPk),
		)
		.innerJoin(accounts, eq(organisations.ownerPk, accounts.pk));

export const authRouter = createTRPCRouter({
	sendLoginCode: publicProcedure
		.input(z.object({ email: z.string().email() }))
		.mutation(async ({ input }) => {
			flushResponse();

			const name = input.email.split("@")[0] ?? "";
			const code = generateRandomString(8, alphabet("0-9"));

			const [account] = await db
				.insert(accounts)
				.values({ name, email: input.email, id: generateId(16) })
				.returning({ pk: accounts.pk, id: accounts.id })
				.onConflictDoNothing();

			await db
				.insert(accountLoginCodes)
				.values({ accountPk: account!.pk, code });

			await sendEmail({
				type: "loginCode",
				to: input.email,
				subject: "Mattrax Login Code",
				code,
			});

			return { accountId: account!.id };
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

			const [[account], [orgConnection]] = await Promise.all([
				db
					.select({ pk: accounts.pk, id: accounts.id, email: accounts.email })
					.from(accounts)
					.where(eq(accounts.pk, code.accountPk)),
				db
					.select({ orgPk: organisationMembers.orgPk })
					.from(organisationMembers)
					.where(eq(organisationMembers.accountPk, code.accountPk)),
			]);

			if (!account)
				throw new TRPCError({
					code: "NOT_FOUND",
					message: "Account not found",
				});

			if (!orgConnection) {
				const id = createId();
				const slug = randomSlug(account.email.split("@")[0]!);

				await db.transaction(async (db) => {
					const [org] = await db
						.insert(organisations)
						.values({ id, slug, name: slug, ownerPk: account.pk })
						.returning({ pk: organisations.pk });
					await db.insert(organisationMembers).values({
						accountPk: account.pk,
						orgPk: org!.pk,
					});
				});
			}

			const session = await lucia.createSession(account.id, {
				userAgent: `w${"web"}`, // TODO
				location: "earth", // TODO
			});

			appendResponseHeader(
				"Set-Cookie",
				lucia.createSessionCookie(session.id).serialize(),
			);

			setCookie("isLoggedIn", "true", {
				httpOnly: false,
			});

			flushResponse();

			return true;
		}),

	me: authedProcedure.query(async ({ ctx: { account } }) => {
		return {
			id: account.id,
			name: account.name,
			email: account.email,
			orgs: await fetchOrgs(account.pk),
			tenants: await fetchTenants(account.pk),
			...(account.features?.length > 0 ? { features: account.features } : {}),
			...(isSuperAdmin(account) ? { superadmin: true } : {}),
		};
	}),

	update: authedProcedure
		.input(
			z.object({
				name: z.string().optional(),
			}),
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
				id: account.pk,
				name: input.name || account.name,
				email: account.email,
				tenants: await fetchTenants(account.pk),
			} satisfies UserResult;
		}),

	logout: publicProcedure.mutation(async () => {
		const data = await checkAuth();
		if (!data) throw new TRPCError({ code: "UNAUTHORIZED" });

		deleteCookie(lucia.sessionCookieName);
		deleteCookie("isLoggedIn");

		flushResponse();

		await lucia.invalidateSession(data.session.id);
	}),

	//   delete: authedProcedure.mutation(async ({ ctx }) => {
	//     const session = ctx.session.data;

	//     // TODO: Require the user to leave/delete all tenant's first

	//     await db.delete(accounts).where(eq(accounts.id, session.id));
	//     await ctx.session.clear();
	//     return {};
	//   }),

	admin: createTRPCRouter({
		getFeatures: superAdminProcedure
			.input(
				z.object({
					email: z.string(),
				}),
			)
			.query(async ({ input }) => {
				const [user] = await db
					.select({ features: accounts.features })
					.from(accounts)
					.where(eq(accounts.email, input.email));
				if (!user) throw new Error("User not found");
				return user.features || [];
			}),

		enableFeature: authedProcedure
			.input(
				z.object({
					feature: z.enum(getObjectKeys(features)),
					// Not providing an email will enable the feature for current user
					email: z.string().optional(),
				}),
			)
			.mutation(async ({ ctx, input }) => {
				let account: {
					pk: number;
					email: string;
					features: Features[] | null;
				} = ctx.account;

				// Only superadmins can enable features for other users
				if (input.email) {
					if (!isSuperAdmin(ctx.account))
						throw new TRPCError({ code: "FORBIDDEN" });

					const [actualAccount] = await db
						.select({
							pk: accounts.pk,
							email: accounts.email,
							features: accounts.features,
						})
						.from(accounts)
						.where(eq(accounts.email, input.email));
					if (!actualAccount) throw new Error("Account not found");
					account = actualAccount;
				}

				const existingFeatures = account?.features || [];

				const [features, change] = existingFeatures.includes(input.feature)
					? [existingFeatures.filter((f) => f !== input.feature), "delete"]
					: [[...existingFeatures, input.feature], "add"];

				// If not superadmins, you can only remove features
				if (!isSuperAdmin(ctx.account) && change !== "delete") {
					throw new TRPCError({ code: "FORBIDDEN" });
				}

				await db
					.update(accounts)
					.set({
						features: features.length === 0 ? sql`NULL` : features,
					})
					.where(eq(accounts.pk, account.pk));
			}),
	}),
});
