import { Effect } from "effect";
import { and, eq, inArray } from "drizzle-orm";
import { schema } from "@mattrax/enterprise-core";
import { openPolicyCertificateMaterial } from "./certificateProfiles.js";
import type { PolicyCertificateMaterial } from "./certificateProfiles.js";

/** Stable lookup key for one policy configuration's certificate material. */
export const certificateMaterialKey = (policyId: string, kind: string): string =>
  `${policyId}\u0000${kind}`;

export type CertificateMaterialEntry = {
  readonly policyId: string;
  readonly kind: string;
};

/**
 * Open the sealed PKCS#12 material for a set of policy configurations.
 *
 * Missing rows are absent from the map rather than an error: a policy can be
 * saved with a certificate configuration whose upload was rejected, and
 * delivery must report that honestly instead of failing the device check-in.
 * A database read or decryption failure is still an error, because retrying is
 * the correct response to a transient failure.
 */
export const loadCertificateMaterials = (
  db: import("@mattrax/enterprise-core").EnterpriseDb,
  authSecret: string,
  organizationId: string,
  entries: ReadonlyArray<CertificateMaterialEntry>,
): Effect.Effect<ReadonlyMap<string, PolicyCertificateMaterial>, unknown> =>
  Effect.gen(function* () {
    const policyIds = [...new Set(entries.map((entry) => entry.policyId))];
    const kinds = new Set(entries.map((entry) => entry.kind));

    if (policyIds.length === 0) return new Map();

    const rows = yield* db
      .select()
      .from(schema.policyCertificateMaterial)
      .where(
        and(
          eq(schema.policyCertificateMaterial.organizationId, organizationId),
          inArray(schema.policyCertificateMaterial.policyId, policyIds),
        ),
      );

    const materials = new Map<string, PolicyCertificateMaterial>();

    for (const row of rows) {
      if (!kinds.has(row.kind)) continue;

      materials.set(
        certificateMaterialKey(row.policyId, row.kind),
        yield* Effect.promise(() => openPolicyCertificateMaterial(authSecret, row)),
      );
    }

    return materials;
  });


