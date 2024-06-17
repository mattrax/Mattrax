import type * as MSGraph from "@microsoft/microsoft-graph-types";
import { TRPCError } from "@trpc/server";
import { and, count, eq, sql } from "drizzle-orm";
import { z } from "zod";

import { createAuditLog } from "~/api/auditLog";
import type { OAUTH_STATE } from "~/api/rest/ms";
import { getEmailDomain } from "~/api/utils";
import { encryptJWT } from "~/api/utils/jwt";
import { createTransaction } from "~/api/utils/transaction";
import { db, domains, identityProviders, users } from "~/db";
import { createTRPCRouter, tenantProcedure } from "../../helpers";

export const identityProviderRouter = createTRPCRouter({
	get: tenantProcedure.query(async ({ ctx }) => {
		return (
			(await ctx.db.query.identityProviders.findFirst({
				columns: {
					pk: true,
					name: true,
					provider: true,
					linkerUpn: true,
					remoteId: true,
					lastSynced: true,
				},
				where: eq(identityProviders.tenantPk, ctx.tenant.pk),
			})) ?? null
		);
	}),

	linkEntraState: tenantProcedure.mutation(({ ctx: { tenant } }) =>
		encryptJWT<OAUTH_STATE>({ tenant: { pk: tenant.pk, id: tenant.id } }),
	),

	remove: tenantProcedure.mutation(async ({ ctx }) => {
		const [provider] = await ctx.db
			.select({
				pk: identityProviders.pk,
				remoteId: identityProviders.remoteId,
			})
			.from(identityProviders)
			.where(eq(identityProviders.tenantPk, ctx.tenant.pk));
		if (!provider) throw new Error("No identity provider found");

		const [result] = await ctx.db
			.select({
				count: count(domains.domain),
			})
			.from(domains)
			.where(
				and(
					eq(domains.tenantPk, ctx.tenant.pk),
					eq(domains.identityProviderPk, provider.pk),
				),
			);
		if (!result || result.count !== 0) {
			throw new TRPCError({
				code: "PRECONDITION_FAILED",
				message:
					"All domains must be unlinked before removing the identity provider",
			});
		}

		// We ignore any errors cleaning up the subscriptions cause it's a non vital error.
		try {
			const { msGraphClient } = await import("~/api/microsoft");

			const subscriptions: { value: Array<MSGraph.Subscription> } =
				await msGraphClient(provider.remoteId).api("/subscriptions").get();

			const results = await Promise.allSettled(
				subscriptions.value.map((sub) => {
					return msGraphClient(provider.remoteId)
						.api(`/subscriptions/${sub.id}`)
						.delete();
				}),
			);

			for (const result of results) {
				if (result.status === "rejected") console.error(result.reason);
			}
		} catch (err) {
			console.error(err);
		}

		await createTransaction(async (db) => {
			await db
				.delete(domains)
				.where(eq(domains.identityProviderPk, provider.pk));
			await ctx.db.delete(users).where(eq(users.providerPk, provider.pk));
			await db
				.delete(identityProviders)
				.where(eq(identityProviders.tenantPk, ctx.tenant.pk));
			await createAuditLog("removeIdp", { variant: "entraId" });
		});
	}),

	domains: tenantProcedure.query(async ({ ctx }) => {
		const provider = await ensureIdentityProvider(ctx.tenant.pk).catch(
			() => null,
		);
		if (provider === null) return { remoteDomains: [], connectedDomains: [] };

		let identityProvider!: IdentityProvider;

		if (provider.provider === "entraId")
			identityProvider = await createEntraIDUserProvider(provider.remoteId);

		const [remoteDomains, connectedDomains] = await Promise.all([
			identityProvider.getDomains(),
			ctx.db
				.select({
					domain: domains.domain,
					createdAt: domains.createdAt,
					enterpriseEnrollmentAvailable: domains.enterpriseEnrollmentAvailable,
					identityProviderPk: domains.identityProviderPk,
					// TODO: https://github.com/drizzle-team/drizzle-orm/pull/1674
					userCount: sql<number>`(SELECT count(*) FROM ${users} WHERE ${users.providerPk} = ${domains.identityProviderPk} AND ${users.upn} LIKE CONCAT('%@', ${domains.domain}))`,
				})
				.from(domains)
				.where(eq(domains.identityProviderPk, provider.pk)),
		]);

		return { remoteDomains, connectedDomains };
	}),

	connectDomain: tenantProcedure
		.input(z.object({ domain: z.string() }))
		.mutation(async ({ ctx, input }) => {
			const enterpriseEnrollmentAvailable = isEnterpriseEnrollmentAvailable(
				input.domain,
			);

			const provider = await ensureIdentityProvider(ctx.tenant.pk);

			let identityProvider!: IdentityProvider;

			if (provider.provider === "entraId")
				identityProvider = await createEntraIDUserProvider(provider.remoteId);

			const remoteDomains = await identityProvider.getDomains();
			if (!remoteDomains.includes(input.domain))
				throw new TRPCError({
					code: "PRECONDITION_FAILED",
					message: "Domain not found",
				});

			await createTransaction(async (db) => {
				await db.insert(domains).values({
					tenantPk: ctx.tenant.pk,
					identityProviderPk: provider.pk,
					domain: input.domain,
					enterpriseEnrollmentAvailable: await enterpriseEnrollmentAvailable,
				});
				await createAuditLog("connectDomain", { domain: input.domain });
			});

			// TODO: `event.waitUntil`???
			await syncEntraUsersWithDomains(
				ctx.tenant.pk,
				provider.pk,
				provider.remoteId,
				[input.domain],
			);

			return true;
		}),

	refreshDomains: tenantProcedure.mutation(async ({ ctx }) => {
		const provider = await ensureIdentityProvider(ctx.tenant.pk);

		const knownDomains = await ctx.db.query.domains.findMany({
			where: eq(domains.identityProviderPk, provider.pk),
		});

		for (const domain of knownDomains) {
			await ctx.db
				.update(domains)
				.set({
					enterpriseEnrollmentAvailable: await isEnterpriseEnrollmentAvailable(
						domain.domain,
					),
				})
				.where(
					and(
						eq(domains.domain, domain.domain),
						eq(domains.tenantPk, ctx.tenant.pk),
					),
				);
		}
	}),

	removeDomain: tenantProcedure
		.input(z.object({ domain: z.string() }))
		.mutation(async ({ ctx, input }) => {
			const provider = await ensureIdentityProvider(ctx.tenant.pk);

			await createTransaction(async (db) => {
				Promise.all([
					db.delete(users).where(eq(users.providerPk, provider.pk)),
					db
						.delete(domains)
						.where(
							and(
								eq(domains.identityProviderPk, provider.pk),
								eq(domains.domain, input.domain),
							),
						),
					createAuditLog("disconnectDomain", { domain: input.domain }),
				]);
			});
		}),

	sync: tenantProcedure.mutation(async ({ ctx }) => {
		const [tenantProvider] = await ctx.db
			.select({
				pk: identityProviders.pk,
				remoteId: identityProviders.remoteId,
			})
			.from(identityProviders)
			.where(eq(identityProviders.tenantPk, ctx.tenant.pk));
		if (!tenantProvider)
			throw new Error(
				`Tenant '${ctx.tenant.pk}' not found or has no providers`,
			); // TODO: make an error the frontend can handle

		const domainList = await ctx.db.query.domains.findMany({
			where: eq(domains.identityProviderPk, tenantProvider.pk),
		});

		await syncEntraUsersWithDomains(
			ctx.tenant.pk,
			tenantProvider.pk,
			tenantProvider.remoteId,
			domainList.map((d) => d.domain),
		);
	}),
});

interface IdentityProvider {
	getDomains(): Promise<Array<string>>;
}

async function ensureIdentityProvider(tenantPk: number) {
	const provider = await db.query.identityProviders.findFirst({
		where: eq(identityProviders.tenantPk, tenantPk),
	});
	if (!provider)
		throw new TRPCError({
			code: "NOT_FOUND",
			message: "Tenant has no identity provider",
		});
	return provider;
}

export async function createEntraIDUserProvider(
	resourceId: string,
): Promise<IdentityProvider> {
	const { msGraphClient } = await import("~/api/microsoft");
	const client = msGraphClient(resourceId);

	return {
		async getDomains() {
			const { value }: { value: Array<MSGraph.Domain> } = await client
				.api("/domains")
				.get();
			return value.filter((v) => v.isVerified).map((v) => v.id!);
		},
	};
}

async function isEnterpriseEnrollmentAvailable(domain: string) {
	const cnameRecords = await cloudflareDnsQuery({
		name: `enterpriseenrollment.${domain}`,
		type: "CNAME",
	}).catch(() => ({ Answer: [] }));

	return cnameRecords.Answer.some((r) => r.data === "mdm.mattrax.app.");
}

const CF_DNS_API = "https://cloudflare-dns.com/dns-query";

const CF_DNS_RESPONSE_SCHEMA = z.object({
	Answer: z.array(
		z.object({
			name: z.string(),
			type: z.number(),
			TTL: z.number(),
			data: z.string(),
		}),
	),
});

async function cloudflareDnsQuery(args: {
	name: string;
	type: "TXT" | "A" | "AAAA" | "CNAME";
}) {
	const params = new URLSearchParams(args);

	const resp = await fetch(new URL(`${CF_DNS_API}?${params}`), {
		headers: { Accept: "application/dns-json" },
	});

	const json = await resp.json();

	return CF_DNS_RESPONSE_SCHEMA.parse(json);
}

export async function syncEntraUsersWithDomains(
	tenantPk: number,
	identityProviderPk: number,
	entraTenantId: string,
	domains: string[],
) {
	const { msGraphClient } = await import("~/api/microsoft");
	const graphClient = msGraphClient(entraTenantId);

	let response: {
		value: Array<
			Pick<MSGraph.User, "id" | "displayName" | "userPrincipalName">
		>;
		"@odata.nextLink"?: string;
	} = await graphClient
		.api("/users")
		.select("id")
		.select("displayName")
		.select("userPrincipalName")
		.top(500)
		.get();

	while (response.value.length > 0) {
		await Promise.all(
			response.value
				.filter((v) => domains.includes(getEmailDomain(v.userPrincipalName!)))
				.map((u) => upsertEntraIdUser(u, tenantPk, identityProviderPk)),
		);

		if (response["@odata.nextLink"]) {
			response = await graphClient.api(response["@odata.nextLink"]).get();
		} else {
			break;
		}
	}
}

export async function upsertEntraIdUser(
	u: Pick<MSGraph.User, "displayName" | "userPrincipalName" | "id">,
	tenantPk: number,
	identityProviderPk: number,
) {
	const result = await db
		.insert(users)
		.values({
			name: u.displayName!,
			upn: u.userPrincipalName!,
			tenantPk: tenantPk,
			providerPk: identityProviderPk,
			resourceId: u.id!,
		})
		.onDuplicateKeyUpdate({
			set: {
				// TODO: Update `email` if the `providerResourceId` matches.
				name: u.displayName!,
				resourceId: u.id!,
			},
		});

	let pk = Number.parseInt(result.insertId);

	// We did not upsert so we need to get the user id
	if (pk === 0) {
		const [user] = await db
			.select({
				pk: users.pk,
			})
			.from(users)
			.where(
				and(
					eq(users.tenantPk, tenantPk),
					eq(users.providerPk, identityProviderPk),
					eq(users.resourceId, u.id!),
				),
			);
		if (!user) return undefined;

		pk = user?.pk;
	}

	return {
		pk,
	};
}
