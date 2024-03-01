import { and, eq, sql } from "drizzle-orm";
import { TRPCError } from "@trpc/server";
import { z } from "zod";
import { createId } from "@paralleldrive/cuid2";
import * as MSGraph from "@microsoft/microsoft-graph-types";

import { db, domains, identityProviders, users } from "~/db";
import { createTRPCRouter, tenantProcedure } from "../../helpers";
import { msGraphClient } from "~/api/microsoft";
import { env } from "~/env";

export const identityProviderRouter = createTRPCRouter({
  get: tenantProcedure.query(async ({ ctx }) => {
    return (
      (await db.query.identityProviders.findFirst({
        where: eq(identityProviders.tenantPk, ctx.tenant.pk),
      })) ?? null
    );
  }),

  linkEntra: tenantProcedure.mutation(async ({ ctx }) => {
    // This will cause all in-progress linking to hit the CSRF error.
    // Due to this being an infrequent operation, I think this is fine.
    const state = createId();
    await ctx.env.session.update({
      ...ctx.env.session.data,
      oauthData: {
        tenantPk: ctx.tenant.pk,
        tenantSlug: ctx.tenant.slug,
        state,
      },
    });
    const params = new URLSearchParams({
      client_id: env.ENTRA_CLIENT_ID,
      scope: "https://graph.microsoft.com/.default",
      redirect_uri: `${env.PROD_URL}/api/ms/link`,
      response_type: "code",
      response_mode: "query",
      state: state,
    });
    return `https://login.microsoftonline.com/organizations/oauth2/v2.0/authorize?${params.toString()}`;
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
      const subscriptions = await msGraphClient(provider.remoteId)
        .api("/subscriptions")
        .get();

      const results = await Promise.allSettled(
        subscriptions.value.map((sub: { id: string }) => {
          return msGraphClient(provider.remoteId)
            .api(`/subscriptions/${sub.id}`)
            .delete();
        })
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
    const provider = await ensureIdentityProvider(ctx.tenant.pk);

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
        input.domain
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
      await syncAllUsersWithEntra(
        ctx.tenant.pk,
        provider.pk,
        provider.remoteId
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
            domain.domain
          ),
        })
        .where(
          and(
            eq(domains.domain, domain.domain),
            eq(domains.tenantPk, ctx.tenant.pk)
          )
        );
    }
  }),

  removeDomain: tenantProcedure
    .input(
      z.object({
        domain: z.string(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const provider = await ensureIdentityProvider(ctx.tenant.pk);

      await db
        .delete(domains)
        .where(
          and(
            eq(domains.identityProviderPk, provider.pk),
            eq(domains.domain, input.domain)
          )
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
        `Tenant '${ctx.tenant.pk}' not found or has no providers`
      ); // TODO: make an error the frontend can handle

    await syncAllUsersWithEntra(
      ctx.tenant.pk,
      tenantProvider.pk,
      tenantProvider.remoteId
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
  resourceId: string
): IdentityProvider {
  const client = msGraphClient(resourceId);

  return {
    async getDomains() {
      const { value }: { value: Array<{ id: string; isVerified: boolean }> } =
        await client.api("/domains").get();
      return value.filter((v) => v.isVerified).map((v) => v.id);
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
    })
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

export async function syncAllUsersWithEntra(
  mttxTenantId: number,
  mttxTenantProviderId: number,
  msftProviderId: string
) {
  const client = msGraphClient(msftProviderId);
  // TODO: Typescript with the client????
  // TODO: Pagination

  const result = await client.api("/users").get();
  // TODO: This will cause users to build up. Really we want to upsert on `resourceId` but idk how to do that with a bulk-insert using Drizzle ORM.
  // TODO: Ensure `values` contains more than one value or skip the insert so it doesn't error out.

  // Make sure Drizzle doesn't get unhappy
  if (result.value.length === 0) return;

  // TODO: Filter users to only ones with a connected domain.
  await db
    .insert(users)
    .values(
      result.value.map((u: any) =>
        mapUser(u, mttxTenantId, mttxTenantProviderId)
      )
    )
    .onDuplicateKeyUpdate(onDuplicateKeyUpdateUser());
}

export const mapUser = (
  u: Pick<MSGraph.User, "displayName" | "userPrincipalName" | "id">,
  tenantPk: number,
  identityProviderPk: number
) => ({
  name: u.displayName!,
  email: u.userPrincipalName!,
  tenantPk: tenantPk,
  providerPk: identityProviderPk,
  providerResourceId: u.id!,
});

export const onDuplicateKeyUpdateUser = () => ({
  set: {
    name: sql`VALUES(${users.name})`,
    // TODO: Update `email` if the `providerResourceId` matches.
  },
});
