import { and, eq } from "drizzle-orm";
import { z } from "zod";
import { TRPCError } from "@trpc/server";

import { db, domains } from "../../db";
import { createTRPCRouter, tenantProcedure } from "../../trpc";

export const domainsRouter = createTRPCRouter({
  list: tenantProcedure.query(({ ctx }) =>
    db.query.domains.findMany({
      where: eq(domains.tenantId, ctx.tenantId),
    })
  ),
  create: tenantProcedure
    .input(z.object({ domain: z.string() }))
    .mutation(async ({ input, ctx }) => {
      const secret = `mattrax:${crypto.randomUUID()}`;

      await db.insert(domains).values({
        tenantId: ctx.tenantId,
        domain: input.domain,
        secret,
      });
    }),
  verify: tenantProcedure
    .input(z.object({ domain: z.string() }))
    .mutation(async ({ input, ctx }) => {
      const domain = await db.query.domains.findFirst({
        where: and(
          eq(domains.domain, input.domain),
          eq(domains.tenantId, ctx.tenantId)
        ),
      });

      if (!domain)
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Domain not found",
        });

      // TODO: rate limit w/ lastVerificationTime
      const [verified, enterpriseEnrollmentAvailable] = await Promise.all([
        isDomainVerified(domain.domain, domain.secret),
        isEnterpriseEnrollmentAvailable(domain.domain),
      ]);

      await db
        .update(domains)
        .set({
          verified,
          enterpriseEnrollmentAvailable,
          lastVerificationTime: new Date(),
        })
        .where(eq(domains.domain, domain.domain));

      return {
        verified,
        enterpriseEnrollmentAvailable,
      };
    }),
});

async function isDomainVerified(domain: string, secret: string) {
  const txtRecords = await cloudflareDnsQuery({
    name: domain,
    type: "TXT",
  }).catch(() => ({ Answer: [] }));

  return txtRecords.Answer.some((r) => JSON.parse(r.data) === secret);
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
