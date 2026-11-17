import { Effect, Exit } from "effect";
import { and, eq, inArray } from "drizzle-orm";
import { schema as s, type EnterpriseDb } from "@mattrax/enterprise-core";
import type { ServerCertificateInfo } from "@mattrax/enterprise-domain";
import { ensureScepCa } from "@mattrax/scep";
import { ScepRepositoryLive } from "@mattrax/mdm-apple";
import { exportApnsKeyJwk, generateApnsKeyPair } from "@mattrax/apns";
import { sealSecret } from "@mattrax/crypto";
import { loadCredentialHealth } from "./credentialHealth.ts";

/**
 * Scheduled credential issuance.
 *
 * Credential health already classifies a missing certificate as `missing`, but
 * maintenance only used it for expiry alerts. This sweep closes the gap for the
 * credentials the server can prove and replace on its own:
 *
 * - A tenant with active devices but no SCEP CA cannot sign an enrolment
 *   profile or issue a device identity. The CA is lazily generated on first use
 *   by the protocol endpoints; doing it here means a tenant is ready before its
 *   first device arrives, and repairs a tenant whose row was never created.
 * - An APNs push certificate cannot be issued by the server because Apple
 *   requires the account owner to sign a CSR. The sweep still starts the flow
 *   by generating and sealing the pending CSR key (the same key
 *   `getApnsCsr` would create) so the administrator can download the signed
 *   request, and reports the certificate as missing until it is uploaded.
 * - The deployment origin is the only domain model in this schema. If the TLS
 *   probe observed no certificate, the host's issuance hook is invoked so a
 *   Cloudflare/ACME integration can act. Custom tenant hostnames do not exist
 *   yet (tracked separately), so there is nothing else to iterate.
 *
 * Only one active CA per tenant is ever created, so repeated daily runs are
 * idempotent; a failure is isolated per tenant and retried on the next run.
 */

/** Device states that mean a tenant still needs a usable identity pipeline. */
const ACTIVE_DEVICE_STATUSES = ["enrolling", "enrolled"] as const;

export type DomainCertificateRequest = {
  readonly origin: string;
  readonly hostname: string;
  /** `missing` means the probe returned no leaf; `probe_failed` is an outage. */
  readonly reason: "missing" | "probe_failed";
};

/**
 * Host hook for a missing origin certificate. The deployment platform owns TLS
 * issuance (Cloudflare for hosted, the operator's proxy for self-hosted), so
 * there is deliberately no built-in ACME client here.
 */
export type DomainCertificateRequester = (
  request: DomainCertificateRequest,
) => Effect.Effect<void, unknown>;

export type CredentialIssuanceResult = {
  /** Tenant SCEP CAs generated because the tenant had none. */
  readonly scepCasIssued: number;
  /** Tenants whose CA could not be generated; retried next run. */
  readonly scepCasFailed: number;
  /** Active Apple tenants with no APNs certificate (manual renewal). */
  readonly missingApnsCertificates: number;
  /** Pending APNs CSR keys generated so an administrator can sign them. */
  readonly apnsCsrsGenerated: number;
  /** 1 when the origin probe observed no usable certificate. */
  readonly missingDomainCertificates: number;
  /** Origin issuance hooks that completed successfully. */
  readonly domainCertificateRequests: number;
};

export type CredentialIssuanceOptions = {
  readonly now: Date;
  /** Required to seal a generated SCEP CA private key. */
  readonly authSecret?: string;
  /** Latest origin observation, when this deployment probes an origin. */
  readonly domain?: {
    readonly origin: string;
    readonly state: ServerCertificateInfo;
  };
  readonly requestDomainCertificate?: DomainCertificateRequester;
};

type TenantIssuance = {
  scepCasIssued: number;
  scepCasFailed: number;
  missingApnsCertificates: number;
  apnsCsrsGenerated: number;
};

const emptyTenantIssuance = (): TenantIssuance => ({
  scepCasIssued: 0,
  scepCasFailed: 0,
  missingApnsCertificates: 0,
  apnsCsrsGenerated: 0,
});

const hasActiveDevice = (
  db: EnterpriseDb,
  organizationId: string,
  protos?: ReadonlyArray<"apple" | "win" | "android">,
): Effect.Effect<boolean, unknown> =>
  Effect.gen(function* () {
    const [row] = yield* db
      .select({ id: s.device.id })
      .from(s.device)
      .where(
        and(
          eq(s.device.organizationId, organizationId),
          inArray(s.device.status, [...ACTIVE_DEVICE_STATUSES]),
          protos ? inArray(s.device.proto, [...protos]) : undefined,
        ),
      )
      .limit(1);

    return row !== undefined;
  });

/**
 * Start the APNs issuance flow for a tenant that has Apple devices but no push
 * certificate. Apple signs the certificate, so the server can only prepare the
 * pending key; generating it here means the CSR is ready when an administrator
 * opens the settings page. The unique organization row makes a repeated run
 * reuse the key rather than rotate a request someone may already be signing.
 */
const ensureApnsCsr = (
  db: EnterpriseDb,
  organizationId: string,
  authSecret: string,
  now: Date,
): Effect.Effect<"generated" | "exists" | "failed", unknown> =>
  Effect.gen(function* () {
    const [pending] = yield* db
      .select({ organizationId: s.applePushKey.organizationId })
      .from(s.applePushKey)
      .where(eq(s.applePushKey.organizationId, organizationId))
      .limit(1);

    if (pending) return "exists";

    const prepared = yield* Effect.exit(
      Effect.gen(function* () {
        const keyPair = yield* Effect.tryPromise({
          try: () => generateApnsKeyPair(),
          catch: (cause) => cause,
        });

        const privateKeyJwk = yield* Effect.tryPromise({
          try: () => exportApnsKeyJwk(keyPair.privateKey),
          catch: (cause) => cause,
        });

        const encryptedPrivateKeyJwk = yield* Effect.tryPromise({
          try: () => sealSecret(authSecret, JSON.stringify(privateKeyJwk)),
          catch: (cause) => cause,
        });

        yield* db
          .insert(s.applePushKey)
          .values({
            organizationId,
            encryptedPrivateKeyJwk,
            createdAt: now,
            updatedAt: now,
          })
          .onDuplicateKeyUpdate({
            set: { encryptedPrivateKeyJwk, updatedAt: now },
          });
      }),
    );

    if (Exit.isFailure(prepared)) {
      yield* Effect.logError(
        "APNs CSR key generation failed during maintenance",
        organizationId,
        prepared.cause,
      );

      return "failed";
    }

    return "generated";
  });

/**
 * Issue a tenant's missing SCEP CA when it has devices to serve. The CA is
 * sealed with `AUTH_SECRET`, so a deployment without one cannot issue and is
 * counted as a failure rather than silently generating an unreadable key.
 */
const issueMissingScepCa = (
  db: EnterpriseDb,
  organization: { readonly id: string; readonly name: string },
  options: CredentialIssuanceOptions,
): Effect.Effect<"issued" | "failed" | "skipped", unknown> =>
  Effect.gen(function* () {
    if (!(yield* hasActiveDevice(db, organization.id, ["apple", "win"]))) return "skipped";

    if (!options.authSecret) {
      yield* Effect.logError(
        "SCEP CA issuance skipped: AUTH_SECRET is not configured",
        organization.id,
      );

      return "failed";
    }

    const issued = yield* Effect.exit(
      ensureScepCa(ScepRepositoryLive.make(db, { authSecret: options.authSecret }), {
        organizationId: organization.id,
      }),
    );

    if (Exit.isSuccess(issued)) {
      yield* Effect.logInfo(
        "Generated missing tenant SCEP CA during maintenance",
        organization.id,
        organization.name,
      );

      return "issued";
    }

    yield* Effect.logError(
      "SCEP CA issuance failed during maintenance",
      organization.id,
      issued.cause,
    );

    return "failed";
  });

const inspectTenantCredentials = (
  db: EnterpriseDb,
  organization: { readonly id: string; readonly name: string },
  options: CredentialIssuanceOptions,
): Effect.Effect<TenantIssuance, unknown> =>
  Effect.gen(function* () {
    const healthExit = yield* Effect.exit(
      loadCredentialHealth(db, organization.id, options.now, {
        authSecret: options.authSecret,
      }),
    );

    if (Exit.isFailure(healthExit)) {
      yield* Effect.logError(
        "Credential health sweep failed for tenant",
        organization.id,
        healthExit.cause,
      );

      return emptyTenantIssuance();
    }

    const health = healthExit.value;
    const result = emptyTenantIssuance();

    if (!health.scepCa.configured) {
      const outcome = yield* issueMissingScepCa(db, organization, options);

      if (outcome === "issued") result.scepCasIssued = 1;
      else if (outcome === "failed") result.scepCasFailed = 1;
    }

    if (!health.apns.configured && (yield* hasActiveDevice(db, organization.id, ["apple"]))) {
      result.missingApnsCertificates = 1;

      yield* Effect.logWarning(
        "Apple tenant has devices but no APNs certificate",
        organization.id,
        organization.name,
      );

      if (!options.authSecret) {
        yield* Effect.logError(
          "APNs CSR generation skipped: AUTH_SECRET is not configured",
          organization.id,
        );
      } else {
        const csr = yield* ensureApnsCsr(db, organization.id, options.authSecret, options.now);

        if (csr === "generated") {
          result.apnsCsrsGenerated = 1;

          yield* Effect.logInfo(
            "Generated pending APNs CSR key for tenant without a certificate",
            organization.id,
            organization.name,
          );
        }
      }
    }

    return result;
  });

/**
 * The origin is deployment-wide, not tenant-scoped. A probe from this run can
 * leave `expiresAt` null when the handshake failed or presented no leaf
 * certificate; either way there is no usable certificate to renew.
 */
const requestMissingDomainCertificate = (
  options: CredentialIssuanceOptions,
): Effect.Effect<
  Pick<CredentialIssuanceResult, "missingDomainCertificates" | "domainCertificateRequests">,
  unknown
> =>
  Effect.gen(function* () {
    const domain = options.domain;

    if (!domain || domain.state.expiresAt !== null) {
      return { missingDomainCertificates: 0, domainCertificateRequests: 0 };
    }

    if (!options.requestDomainCertificate) {
      yield* Effect.logError(
        "The deployment origin has no observed TLS certificate and no issuance hook is configured",
        domain.origin,
        domain.state.error ?? "no leaf certificate",
      );

      return { missingDomainCertificates: 1, domainCertificateRequests: 0 };
    }

    const request: DomainCertificateRequest = {
      origin: domain.origin,
      hostname: domain.state.hostname ?? new URL(domain.origin).hostname,
      reason: domain.state.error ? "probe_failed" : "missing",
    };

    const requested = yield* Effect.exit(options.requestDomainCertificate(request));

    if (Exit.isFailure(requested)) {
      yield* Effect.logError(
        "Domain certificate issuance request failed",
        request.origin,
        requested.cause,
      );

      return { missingDomainCertificates: 1, domainCertificateRequests: 0 };
    }

    return { missingDomainCertificates: 1, domainCertificateRequests: 1 };
  });

/**
 * Detect missing certificates and issue what the server owns.
 *
 * SCEP CA generation is the only fully automatic issuance path; the result is
 * still returned per tenant so a partial failure does not hide the successful
 * ones or stop the rest of maintenance.
 */
export const sweepCredentialIssuance = (
  db: EnterpriseDb,
  options: CredentialIssuanceOptions,
): Effect.Effect<CredentialIssuanceResult, unknown> =>
  Effect.gen(function* () {
    const organizations = yield* db
      .select({ id: s.organization.id, name: s.organization.name })
      .from(s.organization);

    const tenants = yield* Effect.forEach(
      organizations,
      (organization) => inspectTenantCredentials(db, organization, options),
      { concurrency: 1 },
    );

    const domain = yield* requestMissingDomainCertificate(options);

    const totals = tenants.reduce<TenantIssuance>(
      (total, tenant) => ({
        scepCasIssued: total.scepCasIssued + tenant.scepCasIssued,
        scepCasFailed: total.scepCasFailed + tenant.scepCasFailed,
        missingApnsCertificates: total.missingApnsCertificates + tenant.missingApnsCertificates,
        apnsCsrsGenerated: total.apnsCsrsGenerated + tenant.apnsCsrsGenerated,
      }),
      {
        scepCasIssued: 0,
        scepCasFailed: 0,
        missingApnsCertificates: 0,
        apnsCsrsGenerated: 0,
      },
    );

    return { ...totals, ...domain };
  });
