import * as MSGraph from "@microsoft/microsoft-graph-types";
import { MINUTE } from "@solid-primitives/date";
import { TRPCError } from "@trpc/server";
import { and, eq } from "drizzle-orm";
import { z } from "zod";
import * as jose from "jose";

import { msGraphClient } from "~/api/microsoft";
import { getEmailDomain } from "~/api/utils";
import { db, domains, identityProviders, users } from "~/db";
import { env } from "~/env";
import { createTRPCRouter, tenantProcedure } from "../../helpers";
import { encryptJWT } from "~/api/jwt";

export const identityProviderRouter = createTRPCRouter({
	get: tenantProcedure.query(async ({ ctx }) => {
		await new Promise((res) => setTimeout(res, 1000));
		return (
			(await db.query.identityProviders.findFirst({
				where: eq(identityProviders.tenantPk, ctx.tenant.pk),
			})) ?? null
		);
	}),

	linkEntra: tenantProcedure.mutation(async ({ ctx }) => {
		const params = new URLSearchParams({
			client_id: env.ENTRA_CLIENT_ID,
			prompt: "login",
			redirect_uri: `${env.PROD_URL}/api/ms/link`,
			resource: "https://graph.microsoft.com",
			response_type: "code",
			state: await encryptJWT({ tenantPk: ctx.tenant.pk }),
		});

		// We use OAuth v1 (not v2) so that can be do admin consent, while also verifying the user is a tenant owner.
		// From what we can tell the OAuth v2 endpoint doesn't support this flow.
		return `https://login.microsoftonline.com/organizations/oauth2/authorize?${params.toString()}`;
	}),

	remove: tenantProcedure.mutation(async ({ ctx }) => {
		const [provider] = await db
			.select({
				pk: identityProviders.pk,
				remoteId: identityProviders.remoteId,
			})
			.from(identityProviders)
			.where(eq(identityProviders.tenantPk, ctx.tenant.pk));
		if (!provider) throw new Error("No identity provider found");

		// We ignore any errors cleaning up the subscriptions cause it's a non vital error.
		try {
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

		await db.transaction(async (db) => {
			await db
				.delete(domains)
				.where(eq(domains.identityProviderPk, provider.pk));
			await db.delete(users).where(eq(users.providerPk, provider.pk));
			await db
				.delete(identityProviders)
				.where(eq(identityProviders.tenantPk, ctx.tenant.pk));
		});
	}),

	domains: tenantProcedure.query(async ({ ctx }) => {
		const provider = await ensureIdentityProvider(ctx.tenant.pk).catch(
			() => null,
		);
		if (provider === null) return { remoteDomains: [], connectedDomains: [] };

		let identityProvider!: IdentityProvider;

		if (provider.variant === "entraId")
			identityProvider = createEntraIDUserProvider(provider.remoteId);

		const [remoteDomains, connectedDomains] = await Promise.all([
			identityProvider.getDomains(),
			db.query.domains.findMany({
				where: eq(domains.identityProviderPk, provider.pk),
			}),
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

			if (provider.variant === "entraId")
				identityProvider = createEntraIDUserProvider(provider.remoteId);

			const remoteDomains = await identityProvider.getDomains();
			if (!remoteDomains.includes(input.domain))
				throw new TRPCError({
					code: "PRECONDITION_FAILED",
					message: "Domain not found",
				});

			await db.insert(domains).values({
				tenantPk: ctx.tenant.pk,
				identityProviderPk: provider.pk,
				domain: input.domain,
				enterpriseEnrollmentAvailable: await enterpriseEnrollmentAvailable,
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

		const knownDomains = await db.query.domains.findMany({
			where: eq(domains.identityProviderPk, provider.pk),
		});

		for (const domain of knownDomains) {
			await db
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
		.input(
			z.object({
				domain: z.string(),
			}),
		)
		.mutation(async ({ ctx, input }) => {
			const provider = await ensureIdentityProvider(ctx.tenant.pk);

			await db
				.delete(domains)
				.where(
					and(
						eq(domains.identityProviderPk, provider.pk),
						eq(domains.domain, input.domain),
					),
				);

			return true;
		}),

	sync: tenantProcedure.mutation(async ({ ctx }) => {
		const [tenantProvider] = await db
			.select()
			.from(identityProviders)
			.where(eq(identityProviders.tenantPk, ctx.tenant.pk));
		if (!tenantProvider)
			throw new Error(
				`Tenant '${ctx.tenant.pk}' not found or has no providers`,
			); // TODO: make an error the frontend can handle

		const domainList = await db.query.domains.findMany({
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

export function createEntraIDUserProvider(
	resourceId: string,
): IdentityProvider {
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

export function upsertEntraIdUser(
	u: Pick<MSGraph.User, "displayName" | "userPrincipalName" | "id">,
	tenantPk: number,
	identityProviderPk: number,
) {
	return db
		.insert(users)
		.values({
			name: u.displayName!,
			email: u.userPrincipalName!,
			tenantPk: tenantPk,
			providerPk: identityProviderPk,
			providerResourceId: u.id!,
		})
		.onDuplicateKeyUpdate({
			set: {
				// TODO: Update `email` if the `providerResourceId` matches.
				name: u.displayName!,
				providerResourceId: u.id!,
			},
		});
}
