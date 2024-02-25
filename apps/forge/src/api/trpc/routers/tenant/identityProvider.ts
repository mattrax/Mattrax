import { db, domains, identityProviders } from "~/db";
import { createTRPCRouter, tenantProcedure } from "../../helpers";
import { and, eq } from "drizzle-orm";
import { msGraphClient } from "~/api/microsoft";
import { TRPCError } from "@trpc/server";
import { z } from "zod";

export const identityProviderRouter = createTRPCRouter({
  get: tenantProcedure.query(async ({ ctx }) => {
    return (
      (await db.query.identityProviders.findFirst({
        where: eq(identityProviders.tenantPk, ctx.tenant.pk),
      })) ?? null
    );
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
    .input(
      z.object({
        domain: z.string(),
      })
    )
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
