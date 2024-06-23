import { flushResponse, waitUntil } from "@mattrax/trpc-server-function/server";
import { createId } from "@paralleldrive/cuid2";
import {
	generateAuthenticationOptions,
	generateRegistrationOptions,
	verifyAuthenticationResponse,
	verifyRegistrationResponse,
} from "@simplewebauthn/server";
import type {
	AuthenticationResponseJSON,
	AuthenticatorDevice,
	RegistrationResponseJSON,
} from "@simplewebauthn/types";
import { revalidate } from "@solidjs/router";
import { TRPCError } from "@trpc/server";
import { eq, sql } from "drizzle-orm";
import { generateId } from "lucia";
import { alphabet, generateRandomString } from "oslo/crypto";
import { appendResponseHeader, deleteCookie, useSession } from "vinxi/server";
import { z } from "zod";

import { checkAuth, lucia, setIsLoggedInCookie } from "~/api/auth";
import { sendEmail } from "~/api/emails";
import { getObjectKeys, randomSlug } from "~/api/utils";
import {
	accountLoginCodes,
	accounts,
	db,
	domains,
	organisationMembers,
	organisations,
	passkeys,
	tenants,
} from "~/db";
import { env } from "~/env";
import { type Features, features } from "~/lib/featureFlags";
import {
	authedProcedure,
	createTRPCRouter,
	getTenantList,
	isSuperAdmin,
	publicProcedure,
	superAdminProcedure,
} from "../helpers";

export const authRouter = createTRPCRouter({
	sendLoginCode: publicProcedure
		.input(
			z.object({
				email: z.string().email(),
				addIfManaged: z.boolean().optional(),
			}),
		)
		.mutation(async ({ input }) => {
			const parts = input.email.split("@");
			// This should be impossible due to input validation on the frontend but we guard just in case
			if (parts.length !== 2) throw new Error("Invalid email provided!");

			const account = await db.query.accounts.findFirst({
				where: eq(accounts.email, input.email),
			});

			let accountPk = account?.pk;
			if (!account) {
				const [tenantWhichManagesThisDomain] = await db
					.select({ tenantName: tenants.name })
					.from(domains)
					.where(eq(domains.domain, parts[1]!))
					.innerJoin(tenants, eq(domains.tenantPk, tenants.pk));

				if (tenantWhichManagesThisDomain && !input.addIfManaged)
					throw new TRPCError({
						code: "BAD_REQUEST",
						message: JSON.stringify({
							code: "USER_IS_IN_MANAGED_TENANT",
							tenantName: tenantWhichManagesThisDomain.tenantName,
						}),
					});

				const result = await db
					.insert(accounts)
					.values({
						id: generateId(16),
						name: parts[0] ?? "",
						email: input.email,
					})
					.onDuplicateKeyUpdate({
						set: { email: input.email },
					});

				accountPk = Number.parseInt(result.insertId);
			}

			const code = generateRandomString(8, alphabet("0-9"));

			await db
				.insert(accountLoginCodes)
				.values({ accountPk: accountPk!, code });

			waitUntil(
				sendEmail({
					type: "loginCode",
					to: input.email,
					subject: "Mattrax Login Code",
					code,
				}),
			);
		}),

	verifyLoginCode: publicProcedure
		.input(z.object({ code: z.string() }))
		.mutation(async ({ input, ctx }) => {
			const code = await ctx.db.query.accountLoginCodes.findFirst({
				where: eq(accountLoginCodes.code, input.code),
			});

			if (!code)
				throw new TRPCError({ code: "NOT_FOUND", message: "Invalid code" });

			const [_, [account], [orgConnection]] = await Promise.all([
				ctx.db
					.delete(accountLoginCodes)
					.where(eq(accountLoginCodes.code, input.code)),
				ctx.db
					.select({
						pk: accounts.pk,
						id: accounts.id,
						email: accounts.email,
					})
					.from(accounts)
					.where(eq(accounts.pk, code.accountPk)),
				ctx.db
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

				await ctx.db.transaction(async (db) => {
					const org = await db
						.insert(organisations)
						.values({ id, slug, name: slug, ownerPk: account.pk });

					await db.insert(organisationMembers).values({
						accountPk: account.pk,
						orgPk: Number.parseInt(org.insertId),
					});
				});
			}

			await handleLoginSuccess(account.id);

			flushResponse();
			revalidate([checkAuth.key, getTenantList.key]);

			return true;
		}),

	me: authedProcedure.query(async ({ ctx: { account } }) => {
		await new Promise((res) => setTimeout(res, 2000));
		return {
			id: account.id,
			name: account.name,
			email: account.email,
			...(account.features?.length > 0 ? { features: account.features } : {}),
			...(isSuperAdmin(account) ? { superadmin: true } : {}),
		};
	}),

	update: authedProcedure
		.input(z.object({ name: z.string().optional() }))
		.mutation(async ({ ctx: { account, db }, input }) => {
			// Skip DB if we have nothing to update
			if (input.name !== undefined) {
				await db
					.update(accounts)
					.set({ name: input.name })
					.where(eq(accounts.pk, account.pk));
			}
		}),

	logout: publicProcedure.mutation(async () => {
		const data = await checkAuth();
		if (!data) throw new TRPCError({ code: "UNAUTHORIZED" });

		deleteCookie(lucia.sessionCookieName);
		deleteCookie("isLoggedIn");

		await lucia.invalidateSession(data.session.id);

		flushResponse();
	}),

	//   delete: authedProcedure.mutation(async ({ ctx }) => {
	//     const session = ctx.session.data;

	//     // TODO: Require the user to leave/delete all tenant's first

	//     await ctx.db.delete(accounts).where(eq(accounts.id, session.id));
	//     await ctx.session.clear();
	//     return {};
	//   }),

	passkey: createTRPCRouter({
		register: createTRPCRouter({
			start: publicProcedure.mutation(async () => {
				const data = await checkAuth();

				if (!data) throw new TRPCError({ code: "UNAUTHORIZED" });

				const { account } = data;

				const options = await generateRegistrationOptions({
					rpID: new URL(env.VITE_PROD_ORIGIN).hostname,
					rpName: "Mattrax",
					userID: new TextEncoder().encode(account.id),
					userName: account.email,
					attestationType: "direct",
					excludeCredentials: [],
					authenticatorSelection: {
						residentKey: "preferred",
					},
					// Support for the two most common algorithms: ES256, and RS256
					supportedAlgorithmIDs: [-7, -257],
				});

				const session = await useSession<{
					passkeyChallenge?: string;
				}>({ password: env.INTERNAL_SECRET });
				await session.update({
					passkeyChallenge: options.challenge,
				});

				return options;
			}),
			finish: publicProcedure
				.input(
					z.object({
						response: z.custom<RegistrationResponseJSON>(),
					}),
				)
				.mutation(async ({ input }) => {
					const data = await checkAuth();

					if (!data) throw new TRPCError({ code: "UNAUTHORIZED" });

					const { account } = data;

					const session = await useSession<{
						passkeyChallenge?: string;
					}>({ password: env.INTERNAL_SECRET });
					if (!session.data.passkeyChallenge)
						throw new TRPCError({ code: "BAD_REQUEST" });

					const verification = await verifyRegistrationResponse({
						response: input.response,
						expectedChallenge: session.data.passkeyChallenge,
						expectedOrigin: env.VITE_PROD_ORIGIN,
						expectedRPID: new URL(env.VITE_PROD_ORIGIN).hostname,
						requireUserVerification: true,
					});

					if (verification.verified && verification.registrationInfo) {
						await session.update((data) => {
							data.passkeyChallenge = undefined;
							return data;
						});

						await db.insert(passkeys).values({
							accountPk: data.account.pk,
							credentialId: verification.registrationInfo.credentialID,
							publicKey: Buffer.from(
								verification.registrationInfo.credentialPublicKey,
							).toString("base64"),
							counter: verification.registrationInfo.counter,
							transports: input.response.response.transports,
						});

						return true;
					}

					return false;
				}),
		}),
		login: createTRPCRouter({
			start: publicProcedure.mutation(async () => {
				const options = await generateAuthenticationOptions({
					timeout: 60000,
					allowCredentials: [],
					userVerification: "required",
					rpID: new URL(env.VITE_PROD_ORIGIN).hostname,
				});

				const session = await useSession<{
					passkeyChallenge?: string;
				}>({ password: env.INTERNAL_SECRET });
				await session.update({
					passkeyChallenge: options.challenge,
				});

				return options;
			}),
			finish: publicProcedure
				.input(z.object({ response: z.custom<AuthenticationResponseJSON>() }))
				.mutation(async ({ input }) => {
					const session = await useSession<{
						passkeyChallenge?: string;
					}>({ password: env.INTERNAL_SECRET });
					if (!session.data.passkeyChallenge)
						throw new TRPCError({ code: "BAD_REQUEST" });

					const passkey = (
						await db
							.select({
								credentialId: passkeys.credentialId,
								publicKey: passkeys.publicKey,
								transports: passkeys.transports,
								account: accounts,
							})
							.from(passkeys)
							.where(eq(passkeys.credentialId, input.response.id))
							.innerJoin(accounts, eq(accounts.pk, passkeys.accountPk))
					)[0];

					if (!passkey) throw new TRPCError({ code: "NOT_FOUND" });
					const { account } = passkey;

					const authenticator: AuthenticatorDevice = {
						credentialID: input.response.id,
						credentialPublicKey: new Uint8Array(
							Buffer.from(passkey.publicKey, "base64"),
						),
						counter: 0,
						transports: passkey.transports ?? undefined,
					};

					const { verified, authenticationInfo } =
						await verifyAuthenticationResponse({
							response: input.response,
							expectedChallenge: session.data.passkeyChallenge,
							expectedOrigin: env.VITE_PROD_ORIGIN,
							expectedRPID: new URL(env.VITE_PROD_ORIGIN).hostname,
							authenticator,
						});

					if (verified) {
						await handleLoginSuccess(account.id);
						return authenticationInfo;
					}
				}),
		}),
		exists: authedProcedure.query(async ({ ctx }) => {
			const passkey = await db.query.passkeys.findFirst({
				where: eq(passkeys.accountPk, ctx.account.pk),
			});

			return !!passkey;
		}),
		remove: authedProcedure.mutation(async ({ ctx }) => {
			await db.delete(passkeys).where(eq(passkeys.accountPk, ctx.account.pk));
		}),
	}),

	admin: createTRPCRouter({
		getFeatures: superAdminProcedure
			.input(z.object({ email: z.string() }))
			.query(async ({ input, ctx }) => {
				const [user] = await ctx.db
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

					const [actualAccount] = await ctx.db
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

				await ctx.db
					.update(accounts)
					.set({ features: features.length === 0 ? sql`NULL` : features })
					.where(eq(accounts.pk, account.pk));
			}),
	}),
});

export async function handleLoginSuccess(accountId: string) {
	const session = await lucia.createSession(accountId, {
		userAgent: `w${"web"}`, // TODO
		location: "earth", // TODO
	});

	appendResponseHeader(
		"Set-Cookie",
		lucia.createSessionCookie(session.id).serialize(),
	);
	setIsLoggedInCookie();
}
