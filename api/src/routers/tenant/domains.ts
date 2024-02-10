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
      return await verifyDomain(input.domain);
    }),
});

const CLOUDFLARE_DNS_API = "https://cloudflare-dns.com/dns-query";

async function verifyDomain(domain: string) {
  const resp = await fetch(CLOUDFLARE_DNS_API, {
    method: "GET",
    body: new URLSearchParams({
      name: domain,
      type: "TXT",
    }),
    headers: {
      Accept: "application/dns-json",
    },
  }).then((r) => r.json());

  console.log({ resp });

  return false;
}
