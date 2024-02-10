import { and, eq } from "drizzle-orm";
import { db, domains } from "../../db";
import { createTRPCRouter, tenantProcedure } from "../../trpc";
import { z } from "zod";
import { TRPCError } from "@trpc/server";

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
      const verified = await verifyDomain(domain.domain, domain.secret);

      await db
        .update(domains)
        .set({
          verified,
          lastVerificationTime: new Date(),
        })
        .where(eq(domains.domain, domain.domain));

      return verified;
    }),
});

const CF_DNS_API = "https://cloudflare-dns.com/dns-query";

const CF_DNS_RESPONSE_SCHEMA = z.object({
  Answer: z.array(
    z.object({
      name: z.string(),
      type: z.number(),
      TTL: z.number(),
      data: z.string().transform((j) => JSON.parse(j)),
    })
  ),
});

const DNS_RECORD_TYPE_IDS = {
  TXT: 16,
};

async function verifyDomain(domain: string, secret: string) {
  const params = new URLSearchParams({
    name: domain,
    type: DNS_RECORD_TYPE_IDS.TXT.toString(),
  });

  const txtRecords = await fetch(new URL(`${CF_DNS_API}?${params}`), {
    headers: { Accept: "application/dns-json" },
  })
    .then((r) => r.json())
    .then((j) => CF_DNS_RESPONSE_SCHEMA.parse(j));

  return txtRecords.Answer.some((r) => r.data === secret);
}
