import type { Schema } from "effect";
import { Effect, Exit } from "effect";
import { and, eq, gte, inArray } from "drizzle-orm";
import { schema as s } from "@mattrax/enterprise-core";
import type { EnterpriseDb } from "@mattrax/enterprise-core";
import type { ServerCertificateInfo } from "@mattrax/enterprise-domain";
import { ensureScepCa } from "@mattrax/scep";
import { ScepRepositoryLive } from "@mattrax/mdm-core";
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
 *   first device arrives. It is only minted when the tenant has no SCEP
 *   history: a missing CA with issued identities could be a lost row or a bad
 *   restore, and minting another trust root would fork the fleet. Those tenants
 *   are told to restore or import their CA instead.
 * - An APNs push certificate cannot be issued by the server because Apple
 *   requires the account owner to sign a CSR. The sweep still starts the flow
 *   by generating and sealing the pending CSR key (the same key
 *   `getApnsCsr` would create) so the administrator can download the signed
 *   request, and reports the certificate as missing until it is uploaded.
 * - The deployment origin is the only domain model in this schema. If the TLS
 *   probe completed but observed no leaf certificate, the host's issuance hook
 *   is invoked so a Cloudflare/ACME integration can act. A failed probe is
 *   reported separately; an outage must not look like a missing certificate.
 *
 * Only one active CA per tenant is ever created, so repeated daily runs are
 * idempotent; a failure is isolated per tenant and retried on the next run.
 */

/** Device states that mean a tenant still needs a usable identity pipeline. */
const ACTIVE_DEVICE_STATUSES = ["enrolling", "enrolled"] as const;

export type DomainCertificateRequest = {
  readonly origin: string;
  readonly hostname: string;
  /** The probe completed and returned no leaf certificate. */
  readonly reason: "missing";
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
  /** 1 when the origin probe completed but returned no leaf certificate. */
  readonly missingDomainCertificates: number;
  /** 1 when the origin probe failed; this is an outage, not a missing certificate. */
  readonly domainCertificateProbeFailed: number;
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

/** Audit action for a CA minted by maintenance. */
export const SCEP_CA_AUTO_ISSUED_ACTION = "scep_ca.auto_issued";

/** Audit action for a CA maintenance refused or failed to mint. */
export const SCEP_CA_ISSUANCE_FAILED_ACTION = "scep_ca.issuance_failed";

const systemAuditId = () => `sys_${crypto.randomUUID().replaceAll("-", "").slice(0, 21)}`;

/** UTC day start used to dedupe failure audits, matching the rotation sweep. */
const utcDayStart = (now: Date): Date =>
  new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));

/**
 * Write a system audit entry. Audit failure must not turn a successful CA
 * issuance into a maintenance failure, so it is logged and swallowed.
 */
const recordSystemAudit = (
  db: EnterpriseDb,
  input: {
    readonly organizationId: string;
    readonly action: string;
    readonly now: Date;
    readonly metadata: Schema.Json;
  },
): Effect.Effect<void, never> =>
  Effect.gen(function* () {
    yield* db.insert(s.auditLog).values({
      id: systemAuditId(),
      organizationId: input.organizationId,
      actorAccountId: null,
      actorEmail: "system",
      actorType: "system",
      category: "system",
      action: input.action,
      targetType: "scep_ca",
      targetId: null,
      metadata: input.metadata,
      createdAt: input.now,
    });
  }).pipe(
    Effect.catch((error) =>
      Effect.logWarning("Failed to write maintenance audit entry", input.action, error),
    ),
    Effect.map(() => undefined),
  );

/**
 * Record a failed issuance once per tenant per UTC day. The audit trail is the
 * dedupe store, matching the SCEP rotation failure pattern; otherwise a
 * repeatedly failing tenant would add a row on every run.
 */
const recordIssuanceFailureOncePerDay = (
  db: EnterpriseDb,
  input: {
    readonly organizationId: string;
    readonly now: Date;
    readonly reason: string;
    readonly detail?: string;
  },
): Effect.Effect<void, never> =>
  Effect.gen(function* () {
    const dayStart = utcDayStart(input.now);

    const [recent] = yield* db
      .select({ id: s.auditLog.id })
      .from(s.auditLog)
      .where(
        and(
          eq(s.auditLog.organizationId, input.organizationId),
          eq(s.auditLog.action, SCEP_CA_ISSUANCE_FAILED_ACTION),
          gte(s.auditLog.createdAt, dayStart),
        ),
      )
      .limit(1);

    if (recent) return;

    yield* recordSystemAudit(db, {
      organizationId: input.organizationId,
      action: SCEP_CA_ISSUANCE_FAILED_ACTION,
      now: input.now,
      metadata: input.detail
        ? { reason: input.reason, detail: input.detail }
        : { reason: input.reason },
    });
  }).pipe(
    Effect.catch((error) =>
      Effect.logWarning("Failed to record SCEP CA issuance failure", input.organizationId, error),
    ),
  );

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
 * Issue a tenant's missing SCEP CA when it has devices to serve and no SCEP
 * history. A CA that disappeared while certificate rows or retired anchors
 * remain is a lost/restored row, not a first-use bootstrap: minting a new CA
 * would leave every existing identity chained to an untrusted root. Those
 * tenants get a daily audit telling them to restore or import instead.
 */
const issueMissingScepCa = (
  db: EnterpriseDb,
  organization: { readonly id: string; readonly name: string },
  options: CredentialIssuanceOptions,
  history: {
    readonly certificates: number;
    readonly retiring: number;
    readonly untrustedIdentities: number;
  },
): Effect.Effect<"issued" | "failed" | "skipped", unknown> =>
  Effect.gen(function* () {
    if (!(yield* hasActiveDevice(db, organization.id, ["apple", "win"]))) return "skipped";

    if (history.certificates > 0 || history.retiring > 0 || history.untrustedIdentities > 0) {
      yield* Effect.logError(
        "SCEP CA is missing but the tenant has SCEP history; restore or import the CA instead of minting a new trust root",
        organization.id,
        history,
      );

      yield* recordIssuanceFailureOncePerDay(db, {
        organizationId: organization.id,
        now: options.now,
        reason: "identity_history_present",
        detail: `${history.certificates} certificates, ${history.retiring} retiring CAs, ${history.untrustedIdentities} untrusted identities`,
      });

      return "failed";
    }

    if (!options.authSecret) {
      yield* Effect.logError(
        "SCEP CA issuance skipped: AUTH_SECRET is not configured",
        organization.id,
      );

      yield* recordIssuanceFailureOncePerDay(db, {
        organizationId: organization.id,
        now: options.now,
        reason: "auth_secret_missing",
      });

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

      yield* recordSystemAudit(db, {
        organizationId: organization.id,
        action: SCEP_CA_AUTO_ISSUED_ACTION,
        now: options.now,
        metadata: { reason: "missing_ca" },
      });

      return "issued";
    }

    yield* Effect.logError(
      "SCEP CA issuance failed during maintenance",
      organization.id,
      issued.cause,
    );

    yield* recordIssuanceFailureOncePerDay(db, {
      organizationId: organization.id,
      now: options.now,
      reason: "generation_failed",
    });

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
      const outcome = yield* issueMissingScepCa(db, organization, options, {
        certificates: health.deviceCertificates.total,
        retiring: health.scepCa.retiring.length,
        untrustedIdentities: health.scepCa.untrustedIdentities,
      });

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
 * The origin is deployment-wide, not tenant-scoped. `runServerCertificateCheck`
 * records `notAfter: null` both when the handshake failed and when it completed
 * without a leaf, so the `error` field is the discriminator: an outage is
 * reported as a probe failure and must never trigger certificate issuance.
 */
const requestMissingDomainCertificate = (
  options: CredentialIssuanceOptions,
): Effect.Effect<
  Pick<
    CredentialIssuanceResult,
    "missingDomainCertificates" | "domainCertificateProbeFailed" | "domainCertificateRequests"
  >,
  unknown
> =>
  Effect.gen(function* () {
    const domain = options.domain;

    if (!domain || domain.state.expiresAt !== null) {
      return {
        missingDomainCertificates: 0,
        domainCertificateProbeFailed: 0,
        domainCertificateRequests: 0,
      };
    }

    if (domain.state.error !== null) {
      yield* Effect.logWarning(
        "Origin TLS certificate probe failed; not treating it as a missing certificate",
        domain.origin,
        domain.state.error,
      );

      return {
        missingDomainCertificates: 0,
        domainCertificateProbeFailed: 1,
        domainCertificateRequests: 0,
      };
    }

    if (!options.requestDomainCertificate) {
      yield* Effect.logError(
        "The deployment origin has no observed TLS certificate and no issuance hook is configured",
        domain.origin,
      );

      return {
        missingDomainCertificates: 1,
        domainCertificateProbeFailed: 0,
        domainCertificateRequests: 0,
      };
    }

    const request: DomainCertificateRequest = {
      origin: domain.origin,
      hostname: domain.state.hostname ?? new URL(domain.origin).hostname,
      reason: "missing",
    };

    const requested = yield* Effect.exit(options.requestDomainCertificate(request));

    if (Exit.isFailure(requested)) {
      yield* Effect.logError(
        "Domain certificate issuance request failed",
        request.origin,
        requested.cause,
      );

      return {
        missingDomainCertificates: 1,
        domainCertificateProbeFailed: 0,
        domainCertificateRequests: 0,
      };
    }

    return {
      missingDomainCertificates: 1,
      domainCertificateProbeFailed: 0,
      domainCertificateRequests: 1,
    };
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
