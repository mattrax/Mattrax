import type { InferEnv, UnwrapConfig } from "cf/config";
/**
 * Shared with the web Worker's Vite config so that both Workers are built
 * together and can talk to each other over the service binding during dev.
 *
 * The API Worker owns only the request paths listed in `publicApiRoutes`; it
 * has no Custom Domain of its own and previews stay private (`previewUrls`).
 * Everything else reaches it over the website Worker's `API` service binding.
 */
export declare const apiWorker: {
  name: string;
  compatibilityDate: string;
  compatibilityFlags: string[];
  entrypoint: string;
  workersDev: boolean;
  previewUrls: boolean;
  observability: {
    enabled: boolean;
    issues: {
      enabled: boolean;
    };
  };
  placement: {
    mode: "targeted";
    region: string;
  };
  triggers: import("cf/config").ScheduledTrigger[];
  env: {
    ORIGIN: import("cf/config").TextBinding<string>;
    TRUSTED_ORIGINS: import("cf/config").SecretBinding;
    AUTH_SECRET: import("cf/config").SecretBinding;
    /**
     * Hosted services deployment for APNs, billing and entitlements. Empty
     * selects the built-in `https://services.mattrax.app`; only tests and
     * previews set it.
     */
    MATTRAX_SERVICES_URL: import("cf/config").TextBinding<string>;
    /** Shared services token: hosted billing bearer and APNs relay HMAC key. */
    SERVICES_TOKEN: import("cf/config").SecretBinding;
    /** Optional JSON plan catalogue; absent means unlimited plans. */
    MATTRAX_PLAN_LIMITS: import("cf/config").SecretBinding;
    /**
     * Comma-separated verified emails that always hold platform superadmin.
     * Not a secret: this is an operator allowlist, and an unset value simply
     * means no environment-granted superadmin exists yet.
     */
    MATTRAX_SUPERADMINS: import("cf/config").TextBinding<string>;
    /**
     * Lifetime of the bearer SCEP challenge in an Apple enrollment profile.
     * One hour by default; deployments can raise it up to one day.
     */
    MATTRAX_ENROLLMENT_PROFILE_TTL_SECONDS: import("cf/config").TextBinding<"3600">;
    CLOUD_APPLE_VENDOR_CERT: import("cf/config").SecretBinding;
    CLOUD_APPLE_VENDOR_KEY: import("cf/config").SecretBinding;
    AZURE_CLIENT_ID: import("cf/config").SecretBinding;
    AZURE_CLIENT_SECRET: import("cf/config").SecretBinding;
    GOOGLE_WORKSPACE_SERVICE_ACCOUNT_JSON?: import("cf/config").SecretBinding | undefined;
    GOOGLE_WORKSPACE_ADMIN_EMAIL?: import("cf/config").SecretBinding | undefined;
    GOOGLE_WORKSPACE_CUSTOMER?: import("cf/config").SecretBinding | undefined;
    /** Google Android Management API service account and Pub/Sub delivery. */
    ANDROID_MANAGEMENT_SERVICE_ACCOUNT_JSON: import("cf/config").SecretBinding;
    ANDROID_MANAGEMENT_PROJECT_ID: import("cf/config").SecretBinding;
    ANDROID_MANAGEMENT_PUBSUB_TOPIC: import("cf/config").SecretBinding;
    ANDROID_MANAGEMENT_PUBSUB_SUBSCRIPTION: import("cf/config").SecretBinding;
    ANDROID_MANAGEMENT_PUBSUB_AUDIENCE: import("cf/config").SecretBinding;
    ANDROID_MANAGEMENT_PUBSUB_JWKS_URI: import("cf/config").SecretBinding;
    DEV_MAILBOX?: import("cf/config").TextBinding<string> | undefined;
    DEV_MAILBOX_ALLOW_REMOTE?: import("cf/config").TextBinding<string> | undefined;
    DEV_MAILBOX_SECRET: import("cf/config").SecretBinding;
    /** Days without a check-in before the maintenance job marks a device unenrolled. */
    MAINTENANCE_STALE_DEVICE_DAYS: import("cf/config").TextBinding<"30">;
    /** Audit-log retention in days; `0` keeps audit entries indefinitely. */
    MAINTENANCE_AUDIT_RETENTION_DAYS: import("cf/config").TextBinding<"365">;
    /** Tenant backup retention in days; `0` keeps runs indefinitely. */
    MAINTENANCE_BACKUP_RETENTION_DAYS: import("cf/config").TextBinding<"30">;
    /** Tenants backed up concurrently by the daily job. */
    MAINTENANCE_BACKUP_CONCURRENCY: import("cf/config").TextBinding<"4">;
    /** Tenants synced concurrently by the scheduled Entra directory sync. */
    MAINTENANCE_ENTRA_SYNC_CONCURRENCY: import("cf/config").TextBinding<"2">;
    MAINTENANCE_GOOGLE_SYNC_CONCURRENCY: import("cf/config").TextBinding<"2">;
    /** Disable the scheduled one-week onboarding follow-up with `false`. */
    MAINTENANCE_ONBOARDING_EMAILS: import("cf/config").TextBinding<"true">;
    /** Days after tenant creation before the onboarding follow-up is eligible. */
    MAINTENANCE_ONBOARDING_FOLLOW_UP_DAYS: import("cf/config").TextBinding<"7">;
    /** Extra days after the threshold that remain eligible. */
    MAINTENANCE_ONBOARDING_WINDOW_DAYS: import("cf/config").TextBinding<"7">;
    /** Per-recipient cooldown across tenants; `0` disables it. */
    MAINTENANCE_ONBOARDING_COOLDOWN_DAYS: import("cf/config").TextBinding<"7">;
    /** ISO date floor so enabling the follow-up does not mail old tenants. */
    MATTRAX_ONBOARDING_SINCE: import("cf/config").SecretBinding;
    /** Reply-To for onboarding mail; defaults to `oscar@otbeaumont.me`. */
    MATTRAX_ONBOARDING_REPLY_TO: import("cf/config").SecretBinding;
    /** Support address in the onboarding footer; defaults to the sender. */
    MATTRAX_ONBOARDING_SUPPORT_EMAIL: import("cf/config").SecretBinding;
    /**
     * Set to `true` only on a deployment that intentionally has no outbound
     * email. Readiness then reports `mailer: skipped` (degraded) instead of
     * failing while the `EMAIL` binding is absent.
     */
    MATTRAX_EMAIL_DISABLED: import("cf/config").TextBinding<string>;
    /**
     * Outbound email without the Cloudflare `EMAIL` binding: `smtp` or
     * `disabled`. Empty leaves the hosted default (the `EMAIL` binding) in
     * place.
     */
    MAIL_TRANSPORT: import("cf/config").TextBinding<string>;
    /** Verified sender for every transactional email, e.g. `a@example.com`. */
    MAIL_FROM: import("cf/config").TextBinding<"">;
    /** Invitation-specific sender override; empty uses `MAIL_FROM`. */
    MATTRAX_INVITATION_FROM: import("cf/config").TextBinding<"">;
    /** Legacy Windows tenant pin and federated WSTEP app registration. */
    WINDOWS_ORGANIZATION_ID: import("cf/config").TextBinding<"">;
    WINDOWS_FEDERATED_AUDIENCE: import("cf/config").TextBinding<"">;
    /** Set to `1` only behind a proxy that terminates device mTLS. */
    TRUST_DEVICE_IDENTITY_HEADERS: import("cf/config").TextBinding<string>;
    /** SMTP server used by self-hosted deployments. */
    MAIL_SMTP_HOST: import("cf/config").TextBinding<"">;
    MAIL_SMTP_PORT: import("cf/config").TextBinding<"">;
    MAIL_SMTP_SECURE: import("cf/config").TextBinding<"">;
    MAIL_SMTP_USER: import("cf/config").TextBinding<"">;
    MAIL_SMTP_HELO: import("cf/config").TextBinding<"">;
    /** Outbox deliveries in flight per maintenance run. */
    MAINTENANCE_EMAIL_OUTBOX_CONCURRENCY: import("cf/config").TextBinding<"4">;
    /** Attempts before queued mail is permanently failed. */
    MAINTENANCE_EMAIL_OUTBOX_MAX_ATTEMPTS: import("cf/config").TextBinding<"5">;
    /** PostHog project API key, ingestion host and error sampling. */
    POSTHOG_KEY: import("cf/config").SecretBinding;
    POSTHOG_HOST: import("cf/config").TextBinding<"https://us.i.posthog.com">;
    POSTHOG_ENVIRONMENT: import("cf/config").SecretBinding;
    POSTHOG_ERROR_SAMPLE_RATE: import("cf/config").SecretBinding;
    POSTHOG_ERROR_MAX_EVENTS_PER_MINUTE: import("cf/config").SecretBinding;
    /** Deployed version id used by `/api/ready`. */
    CF_VERSION_METADATA: import("cf/config").VersionMetadataBinding;
    HYPERDRIVE: import("cf/config").HyperdriveBinding;
    STORAGE: import("cf/config").R2Binding;
    EMAIL: import("cf/config").SendEmailBinding;
  };
};
export type ApiConfig = UnwrapConfig<typeof apiWorker>;
export type ApiEnv = InferEnv<ApiConfig>;
declare const _default: ({ isPreview }: import("cf/config").ConfigContext) =>
  | {
      worker: {
        name: string;
        compatibilityDate: string;
        compatibilityFlags: string[];
        entrypoint: string;
        workersDev: boolean;
        observability: {
          enabled: boolean;
          issues: {
            enabled: boolean;
          };
        };
        placement: {
          mode: "targeted";
          region: string;
        };
        previewUrls: boolean;
        triggers: (import("cf/config").FetchTrigger | import("cf/config").ScheduledTrigger)[];
        env: {
          ORIGIN: import("cf/config").TextBinding<string>;
          TRUSTED_ORIGINS: import("cf/config").SecretBinding;
          AUTH_SECRET: import("cf/config").SecretBinding;
          /**
           * Hosted services deployment for APNs, billing and entitlements. Empty
           * selects the built-in `https://services.mattrax.app`; only tests and
           * previews set it.
           */
          MATTRAX_SERVICES_URL: import("cf/config").TextBinding<string>;
          /** Shared services token: hosted billing bearer and APNs relay HMAC key. */
          SERVICES_TOKEN: import("cf/config").SecretBinding;
          /** Optional JSON plan catalogue; absent means unlimited plans. */
          MATTRAX_PLAN_LIMITS: import("cf/config").SecretBinding;
          /**
           * Comma-separated verified emails that always hold platform superadmin.
           * Not a secret: this is an operator allowlist, and an unset value simply
           * means no environment-granted superadmin exists yet.
           */
          MATTRAX_SUPERADMINS: import("cf/config").TextBinding<string>;
          /**
           * Lifetime of the bearer SCEP challenge in an Apple enrollment profile.
           * One hour by default; deployments can raise it up to one day.
           */
          MATTRAX_ENROLLMENT_PROFILE_TTL_SECONDS: import("cf/config").TextBinding<"3600">;
          CLOUD_APPLE_VENDOR_CERT: import("cf/config").SecretBinding;
          CLOUD_APPLE_VENDOR_KEY: import("cf/config").SecretBinding;
          AZURE_CLIENT_ID: import("cf/config").SecretBinding;
          AZURE_CLIENT_SECRET: import("cf/config").SecretBinding;
          GOOGLE_WORKSPACE_SERVICE_ACCOUNT_JSON?: import("cf/config").SecretBinding | undefined;
          GOOGLE_WORKSPACE_ADMIN_EMAIL?: import("cf/config").SecretBinding | undefined;
          GOOGLE_WORKSPACE_CUSTOMER?: import("cf/config").SecretBinding | undefined;
          /** Google Android Management API service account and Pub/Sub delivery. */
          ANDROID_MANAGEMENT_SERVICE_ACCOUNT_JSON: import("cf/config").SecretBinding;
          ANDROID_MANAGEMENT_PROJECT_ID: import("cf/config").SecretBinding;
          ANDROID_MANAGEMENT_PUBSUB_TOPIC: import("cf/config").SecretBinding;
          ANDROID_MANAGEMENT_PUBSUB_SUBSCRIPTION: import("cf/config").SecretBinding;
          ANDROID_MANAGEMENT_PUBSUB_AUDIENCE: import("cf/config").SecretBinding;
          ANDROID_MANAGEMENT_PUBSUB_JWKS_URI: import("cf/config").SecretBinding;
          DEV_MAILBOX?: import("cf/config").TextBinding<string> | undefined;
          DEV_MAILBOX_ALLOW_REMOTE?: import("cf/config").TextBinding<string> | undefined;
          DEV_MAILBOX_SECRET: import("cf/config").SecretBinding;
          /** Days without a check-in before the maintenance job marks a device unenrolled. */
          MAINTENANCE_STALE_DEVICE_DAYS: import("cf/config").TextBinding<"30">;
          /** Audit-log retention in days; `0` keeps audit entries indefinitely. */
          MAINTENANCE_AUDIT_RETENTION_DAYS: import("cf/config").TextBinding<"365">;
          /** Tenant backup retention in days; `0` keeps runs indefinitely. */
          MAINTENANCE_BACKUP_RETENTION_DAYS: import("cf/config").TextBinding<"30">;
          /** Tenants backed up concurrently by the daily job. */
          MAINTENANCE_BACKUP_CONCURRENCY: import("cf/config").TextBinding<"4">;
          /** Tenants synced concurrently by the scheduled Entra directory sync. */
          MAINTENANCE_ENTRA_SYNC_CONCURRENCY: import("cf/config").TextBinding<"2">;
          MAINTENANCE_GOOGLE_SYNC_CONCURRENCY: import("cf/config").TextBinding<"2">;
          /** Disable the scheduled one-week onboarding follow-up with `false`. */
          MAINTENANCE_ONBOARDING_EMAILS: import("cf/config").TextBinding<"true">;
          /** Days after tenant creation before the onboarding follow-up is eligible. */
          MAINTENANCE_ONBOARDING_FOLLOW_UP_DAYS: import("cf/config").TextBinding<"7">;
          /** Extra days after the threshold that remain eligible. */
          MAINTENANCE_ONBOARDING_WINDOW_DAYS: import("cf/config").TextBinding<"7">;
          /** Per-recipient cooldown across tenants; `0` disables it. */
          MAINTENANCE_ONBOARDING_COOLDOWN_DAYS: import("cf/config").TextBinding<"7">;
          /** ISO date floor so enabling the follow-up does not mail old tenants. */
          MATTRAX_ONBOARDING_SINCE: import("cf/config").SecretBinding;
          /** Reply-To for onboarding mail; defaults to `oscar@otbeaumont.me`. */
          MATTRAX_ONBOARDING_REPLY_TO: import("cf/config").SecretBinding;
          /** Support address in the onboarding footer; defaults to the sender. */
          MATTRAX_ONBOARDING_SUPPORT_EMAIL: import("cf/config").SecretBinding;
          /**
           * Set to `true` only on a deployment that intentionally has no outbound
           * email. Readiness then reports `mailer: skipped` (degraded) instead of
           * failing while the `EMAIL` binding is absent.
           */
          MATTRAX_EMAIL_DISABLED: import("cf/config").TextBinding<string>;
          /**
           * Outbound email without the Cloudflare `EMAIL` binding: `smtp` or
           * `disabled`. Empty leaves the hosted default (the `EMAIL` binding) in
           * place.
           */
          MAIL_TRANSPORT: import("cf/config").TextBinding<string>;
          /** Verified sender for every transactional email, e.g. `a@example.com`. */
          MAIL_FROM: import("cf/config").TextBinding<"">;
          /** Invitation-specific sender override; empty uses `MAIL_FROM`. */
          MATTRAX_INVITATION_FROM: import("cf/config").TextBinding<"">;
          /** Legacy Windows tenant pin and federated WSTEP app registration. */
          WINDOWS_ORGANIZATION_ID: import("cf/config").TextBinding<"">;
          WINDOWS_FEDERATED_AUDIENCE: import("cf/config").TextBinding<"">;
          /** Set to `1` only behind a proxy that terminates device mTLS. */
          TRUST_DEVICE_IDENTITY_HEADERS: import("cf/config").TextBinding<string>;
          /** SMTP server used by self-hosted deployments. */
          MAIL_SMTP_HOST: import("cf/config").TextBinding<"">;
          MAIL_SMTP_PORT: import("cf/config").TextBinding<"">;
          MAIL_SMTP_SECURE: import("cf/config").TextBinding<"">;
          MAIL_SMTP_USER: import("cf/config").TextBinding<"">;
          MAIL_SMTP_HELO: import("cf/config").TextBinding<"">;
          /** Outbox deliveries in flight per maintenance run. */
          MAINTENANCE_EMAIL_OUTBOX_CONCURRENCY: import("cf/config").TextBinding<"4">;
          /** Attempts before queued mail is permanently failed. */
          MAINTENANCE_EMAIL_OUTBOX_MAX_ATTEMPTS: import("cf/config").TextBinding<"5">;
          /** PostHog project API key, ingestion host and error sampling. */
          POSTHOG_KEY: import("cf/config").SecretBinding;
          POSTHOG_HOST: import("cf/config").TextBinding<"https://us.i.posthog.com">;
          POSTHOG_ENVIRONMENT: import("cf/config").SecretBinding;
          POSTHOG_ERROR_SAMPLE_RATE: import("cf/config").SecretBinding;
          POSTHOG_ERROR_MAX_EVENTS_PER_MINUTE: import("cf/config").SecretBinding;
          /** Deployed version id used by `/api/ready`. */
          CF_VERSION_METADATA: import("cf/config").VersionMetadataBinding;
          HYPERDRIVE: import("cf/config").HyperdriveBinding;
          STORAGE: import("cf/config").R2Binding;
          EMAIL: import("cf/config").SendEmailBinding;
        };
      };
    }
  | {
      worker: {
        name: string;
        compatibilityDate: string;
        compatibilityFlags: string[];
        entrypoint: string;
        workersDev: boolean;
        observability: {
          enabled: boolean;
          issues: {
            enabled: boolean;
          };
        };
        placement: {
          mode: "targeted";
          region: string;
        };
        previewUrls: boolean;
        triggers: (import("cf/config").FetchTrigger | import("cf/config").ScheduledTrigger)[];
        env: {
          ORIGIN: import("cf/config").TextBinding<string>;
          TRUSTED_ORIGINS: import("cf/config").SecretBinding;
          AUTH_SECRET: import("cf/config").SecretBinding;
          /**
           * Hosted services deployment for APNs, billing and entitlements. Empty
           * selects the built-in `https://services.mattrax.app`; only tests and
           * previews set it.
           */
          MATTRAX_SERVICES_URL: import("cf/config").TextBinding<string>;
          /** Shared services token: hosted billing bearer and APNs relay HMAC key. */
          SERVICES_TOKEN: import("cf/config").SecretBinding;
          /** Optional JSON plan catalogue; absent means unlimited plans. */
          MATTRAX_PLAN_LIMITS: import("cf/config").SecretBinding;
          /**
           * Comma-separated verified emails that always hold platform superadmin.
           * Not a secret: this is an operator allowlist, and an unset value simply
           * means no environment-granted superadmin exists yet.
           */
          MATTRAX_SUPERADMINS: import("cf/config").TextBinding<string>;
          /**
           * Lifetime of the bearer SCEP challenge in an Apple enrollment profile.
           * One hour by default; deployments can raise it up to one day.
           */
          MATTRAX_ENROLLMENT_PROFILE_TTL_SECONDS: import("cf/config").TextBinding<"3600">;
          CLOUD_APPLE_VENDOR_CERT: import("cf/config").SecretBinding;
          CLOUD_APPLE_VENDOR_KEY: import("cf/config").SecretBinding;
          AZURE_CLIENT_ID: import("cf/config").SecretBinding;
          AZURE_CLIENT_SECRET: import("cf/config").SecretBinding;
          GOOGLE_WORKSPACE_SERVICE_ACCOUNT_JSON?: import("cf/config").SecretBinding | undefined;
          GOOGLE_WORKSPACE_ADMIN_EMAIL?: import("cf/config").SecretBinding | undefined;
          GOOGLE_WORKSPACE_CUSTOMER?: import("cf/config").SecretBinding | undefined;
          /** Google Android Management API service account and Pub/Sub delivery. */
          ANDROID_MANAGEMENT_SERVICE_ACCOUNT_JSON: import("cf/config").SecretBinding;
          ANDROID_MANAGEMENT_PROJECT_ID: import("cf/config").SecretBinding;
          ANDROID_MANAGEMENT_PUBSUB_TOPIC: import("cf/config").SecretBinding;
          ANDROID_MANAGEMENT_PUBSUB_SUBSCRIPTION: import("cf/config").SecretBinding;
          ANDROID_MANAGEMENT_PUBSUB_AUDIENCE: import("cf/config").SecretBinding;
          ANDROID_MANAGEMENT_PUBSUB_JWKS_URI: import("cf/config").SecretBinding;
          DEV_MAILBOX?: import("cf/config").TextBinding<string> | undefined;
          DEV_MAILBOX_ALLOW_REMOTE?: import("cf/config").TextBinding<string> | undefined;
          DEV_MAILBOX_SECRET: import("cf/config").SecretBinding;
          /** Days without a check-in before the maintenance job marks a device unenrolled. */
          MAINTENANCE_STALE_DEVICE_DAYS: import("cf/config").TextBinding<"30">;
          /** Audit-log retention in days; `0` keeps audit entries indefinitely. */
          MAINTENANCE_AUDIT_RETENTION_DAYS: import("cf/config").TextBinding<"365">;
          /** Tenant backup retention in days; `0` keeps runs indefinitely. */
          MAINTENANCE_BACKUP_RETENTION_DAYS: import("cf/config").TextBinding<"30">;
          /** Tenants backed up concurrently by the daily job. */
          MAINTENANCE_BACKUP_CONCURRENCY: import("cf/config").TextBinding<"4">;
          /** Tenants synced concurrently by the scheduled Entra directory sync. */
          MAINTENANCE_ENTRA_SYNC_CONCURRENCY: import("cf/config").TextBinding<"2">;
          MAINTENANCE_GOOGLE_SYNC_CONCURRENCY: import("cf/config").TextBinding<"2">;
          /** Disable the scheduled one-week onboarding follow-up with `false`. */
          MAINTENANCE_ONBOARDING_EMAILS: import("cf/config").TextBinding<"true">;
          /** Days after tenant creation before the onboarding follow-up is eligible. */
          MAINTENANCE_ONBOARDING_FOLLOW_UP_DAYS: import("cf/config").TextBinding<"7">;
          /** Extra days after the threshold that remain eligible. */
          MAINTENANCE_ONBOARDING_WINDOW_DAYS: import("cf/config").TextBinding<"7">;
          /** Per-recipient cooldown across tenants; `0` disables it. */
          MAINTENANCE_ONBOARDING_COOLDOWN_DAYS: import("cf/config").TextBinding<"7">;
          /** ISO date floor so enabling the follow-up does not mail old tenants. */
          MATTRAX_ONBOARDING_SINCE: import("cf/config").SecretBinding;
          /** Reply-To for onboarding mail; defaults to `oscar@otbeaumont.me`. */
          MATTRAX_ONBOARDING_REPLY_TO: import("cf/config").SecretBinding;
          /** Support address in the onboarding footer; defaults to the sender. */
          MATTRAX_ONBOARDING_SUPPORT_EMAIL: import("cf/config").SecretBinding;
          /**
           * Set to `true` only on a deployment that intentionally has no outbound
           * email. Readiness then reports `mailer: skipped` (degraded) instead of
           * failing while the `EMAIL` binding is absent.
           */
          MATTRAX_EMAIL_DISABLED: import("cf/config").TextBinding<string>;
          /**
           * Outbound email without the Cloudflare `EMAIL` binding: `smtp` or
           * `disabled`. Empty leaves the hosted default (the `EMAIL` binding) in
           * place.
           */
          MAIL_TRANSPORT: import("cf/config").TextBinding<string>;
          /** Verified sender for every transactional email, e.g. `a@example.com`. */
          MAIL_FROM: import("cf/config").TextBinding<"">;
          /** Invitation-specific sender override; empty uses `MAIL_FROM`. */
          MATTRAX_INVITATION_FROM: import("cf/config").TextBinding<"">;
          /** Legacy Windows tenant pin and federated WSTEP app registration. */
          WINDOWS_ORGANIZATION_ID: import("cf/config").TextBinding<"">;
          WINDOWS_FEDERATED_AUDIENCE: import("cf/config").TextBinding<"">;
          /** Set to `1` only behind a proxy that terminates device mTLS. */
          TRUST_DEVICE_IDENTITY_HEADERS: import("cf/config").TextBinding<string>;
          /** SMTP server used by self-hosted deployments. */
          MAIL_SMTP_HOST: import("cf/config").TextBinding<"">;
          MAIL_SMTP_PORT: import("cf/config").TextBinding<"">;
          MAIL_SMTP_SECURE: import("cf/config").TextBinding<"">;
          MAIL_SMTP_USER: import("cf/config").TextBinding<"">;
          MAIL_SMTP_HELO: import("cf/config").TextBinding<"">;
          /** Outbox deliveries in flight per maintenance run. */
          MAINTENANCE_EMAIL_OUTBOX_CONCURRENCY: import("cf/config").TextBinding<"4">;
          /** Attempts before queued mail is permanently failed. */
          MAINTENANCE_EMAIL_OUTBOX_MAX_ATTEMPTS: import("cf/config").TextBinding<"5">;
          /** PostHog project API key, ingestion host and error sampling. */
          POSTHOG_KEY: import("cf/config").SecretBinding;
          POSTHOG_HOST: import("cf/config").TextBinding<"https://us.i.posthog.com">;
          POSTHOG_ENVIRONMENT: import("cf/config").SecretBinding;
          POSTHOG_ERROR_SAMPLE_RATE: import("cf/config").SecretBinding;
          POSTHOG_ERROR_MAX_EVENTS_PER_MINUTE: import("cf/config").SecretBinding;
          /** Deployed version id used by `/api/ready`. */
          CF_VERSION_METADATA: import("cf/config").VersionMetadataBinding;
          HYPERDRIVE: import("cf/config").HyperdriveBinding;
          STORAGE: import("cf/config").R2Binding;
          EMAIL: import("cf/config").SendEmailBinding;
          APPLE_PROFILE_SIGNING_CERT: import("cf/config").SecretBinding;
          APPLE_PROFILE_SIGNING_KEY: import("cf/config").SecretBinding;
          APPLE_PROFILE_SIGNING_CHAIN: import("cf/config").SecretBinding;
        };
      };
    };
export default _default;
