import { and, eq } from "drizzle-orm";
import { z } from "zod";
import { TRPCError } from "@trpc/server";

import { certificates, db, domains } from "../../db";
import { createTRPCRouter, tenantProcedure } from "../../trpc";
import { env } from "../../env";

const validDomainRegex = /^[a-zA-Z0-9-\.]+$/;

export const domainsRouter = createTRPCRouter({
  // TODO: Blocked on: https://github.com/drizzle-team/drizzle-orm/issues/1066
  // list: tenantProcedure.query(({ ctx }) =>
  //   db.query.domains.findMany({
  //     where: eq(domains.tenantId, ctx.tenantId),
  //     with: {
  //       certificate: {
  //         columns: {
  //           lastModified: true,
  //         },
  //       },
  //     },
  //   })
  // ),
  list: tenantProcedure.query(async ({ ctx }) => {
    const results = await db
      .select()
      .from(domains)
      .leftJoin(certificates, eq(domains.domain, certificates.key))
      .where(eq(domains.tenantId, ctx.tenantId));

    return results.map(({ certificates, domains }) => ({
      ...domains,
      certificateLastModified: certificates?.lastModified,
    }));
  }),

  create: tenantProcedure
    .input(z.object({ domain: z.string().regex(validDomainRegex) }))
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
        // TODO: be aware this is not typesafe.
        // TODO: It will return `null`'s and Typescript won't save you.
        with: {
          certificate: {
            columns: {
              lastModified: true,
            },
          },
        },
      });

      if (!domain)
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Domain not found",
        });

      const [verified, enterpriseEnrollmentAvailable] = await Promise.all([
        isDomainVerified(domain.domain, domain.secret),
        isEnterpriseEnrollmentAvailable(domain.domain),
      ]);

      if (
        domain.verified !== verified ||
        domain.enterpriseEnrollmentAvailable !== enterpriseEnrollmentAvailable
      )
        await db
          .update(domains)
          .set({
            verified,
            enterpriseEnrollmentAvailable,
            lastVerificationTime: new Date(),
          })
          .where(eq(domains.domain, domain.domain));

      // If domain just become verified or if it has no certificate, trigger certificate order
      if ((verified && !domain.verified) || !domain.certificate?.lastModified) {
        try {
          const result = await fetch(
            `${env.MDM_URL}/internal/issue-cert?domain=${encodeURIComponent(
              domain.domain
            )}`,
            {
              method: "POST",
              headers: {
                Authorization: `Bearer ${env.INTERNAL_SECRET}`,
              },
            }
          );
          if (!result.ok)
            throw new Error(`request failed with status: ${result.status}`);
        } catch (err) {
          console.error(
            "Failed to contact MDM, to trigger certificate order: ",
            err
          );
        }
      }
    }),
  delete: tenantProcedure
    .input(z.object({ domain: z.string() }))
    .mutation(async ({ input, ctx }) => {
      await db
        .delete(domains)
        .where(
          and(
            eq(domains.domain, input.domain),
            eq(domains.tenantId, ctx.tenantId)
          )
        );
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
