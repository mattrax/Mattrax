import { flushResponse, waitUntil } from "@mattrax/trpc-server-function/server";
import { revalidate } from "@solidjs/router";
import { TRPCError } from "@trpc/server";
import { eq } from "drizzle-orm";
import { generateId } from "lucia";
import { alphabet, generateRandomString } from "oslo/crypto";
import { z } from "zod";

import {
	type DatabaseUserAttributes,
	checkAuth,
	createSession,
	logout,
} from "~/auth";
import { sendEmail } from "~/aws/emails";
import { accountLoginCodes, accounts, db, tenants } from "~/db";
import { env } from "~/env";
import { authedProcedure, createTRPCRouter, publicProcedure } from "../helpers";
import { sendDiscordMessage } from "./meta";

async function mapAccount(account: DatabaseUserAttributes) {
	return {
		id: account.id,
		name: account.name,
		email: account.email,
	};
}

function formatDefaultName(name: string) {
	const firstChar = name[0];
	if (!firstChar) return "User";
	return `${firstChar.toUpperCase()}${name.slice(1).replaceAll("-", " ").replaceAll("_", " ")}`;
}

export const authRouter = createTRPCRouter({
	sendLoginCode: publicProcedure
		.input(
			z.object({
				email: z.string().email(),
				// addIfManaged: z.boolean().optional(),
			}),
		)
		.mutation(async ({ input }) => {
			const parts = input.email.split("@");
			// This should be impossible due to input validation but we guard just in case
			if (parts.length !== 2) throw new Error("Invalid email provided!");

			const account = await db.query.accounts.findFirst({
				where: eq(accounts.email, input.email),
			});

			let accountPk = account?.pk;
			if (!account) {
				// const [tenantWhichManagesThisDomain] = await db
				// 	.select({ tenantName: tenants.name })
				// 	.from(domains)
				// 	.where(eq(domains.domain, parts[1]!))
				// 	.innerJoin(tenants, eq(domains.tenantPk, tenants.pk));

				// if (tenantWhichManagesThisDomain && !input.addIfManaged)
				// 	throw new TRPCError({
				// 		code: "BAD_REQUEST",
				// 		message: JSON.stringify({
				// 			code: "USER_IS_IN_MANAGED_TENANT",
				// 			tenantName: tenantWhichManagesThisDomain.tenantName,
				// 		}),
				// 	});

				const result = await db
					.insert(accounts)
					.values({
						id: generateId(16),
						name: formatDefaultName(parts[0] || ""),
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
				throw new TRPCError({
					code: "NOT_FOUND",
					message: "Invalid login code",
				});

			const [_, [account]] = await Promise.all([
				ctx.db
					.delete(accountLoginCodes)
					.where(eq(accountLoginCodes.code, input.code)),
				ctx.db
					.select({
						pk: accounts.pk,
						id: accounts.id,
						email: accounts.email,
						name: accounts.name,
					})
					.from(accounts)
					.where(eq(accounts.pk, code.accountPk)),
				// ctx.db
				// 	.select({ orgPk: organisationMembers.orgPk })
				// 	.from(organisationMembers)
				// 	.where(eq(organisationMembers.accountPk, code.accountPk)),
			]);

			if (!account)
				throw new TRPCError({
					code: "NOT_FOUND",
					message: "Account not found",
				});

			// if (!orgConnection) {
			// 	const id = createId();
			// 	const slug = randomSlug(account.email.split("@")[0]!);

			// 	await ctx.db.transaction(async (db) => {
			// 		const org = await db
			// 			.insert(organisations)
			// 			.values({ id, slug, name: slug, ownerPk: account.pk });

			// 		await db.insert(organisationMembers).values({
			// 			accountPk: account.pk,
			// 			orgPk: Number.parseInt(org.insertId),
			// 		});
			// 	});
			// }

			await createSession(account.id);

			flushResponse();
			revalidate(checkAuth.key);

			return mapAccount(account);
		}),

	me: authedProcedure.query(async ({ ctx: { account } }) =>
		mapAccount(account),
	),

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

	// `authedProcedure` calls `flushResponse` before the handler so we can't use it here!
	logout: publicProcedure.mutation(async () => {
		const data = await checkAuth();
		if (!data) throw new TRPCError({ code: "UNAUTHORIZED" });
		await logout(data.session.id);
	}),

	// `authedProcedure` calls `flushResponse` before the handler so we can't use it here!
	delete: publicProcedure.mutation(async ({ ctx }) => {
		const data = await checkAuth();
		if (!data) throw new TRPCError({ code: "UNAUTHORIZED" });

		// TODO: Require the user to leave/delete all tenant's first

		// TODO: Implement this properly
		await sendDiscordMessage(
			`User \`${data.account.id}\` with email \`${data.account.email}\` requested account deletion!`,
			env.DO_THE_THING_WEBHOOK_URL,
		);

		await logout(data.session.id);
	}),
});
