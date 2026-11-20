import { Data, Effect, Schema } from "effect";

/**
 * A rejected Workspace configuration.
 *
 * Messages are deliberately generic and never echo the submitted JSON: a
 * service-account document contains a private key, and a validation error is
 * one of the easiest places to leak it (logs, API responses, dashboards).
 */
export class GoogleWorkspaceConfigError extends Data.TaggedError("GoogleWorkspaceConfigError")<{
  message: string;
}> {}

export type GoogleServiceAccount = {
  readonly clientEmail: string;
  readonly privateKeyPem: string;
  readonly projectId?: string;
};

export type GoogleWorkspaceCredentials = {
  readonly serviceAccount: GoogleServiceAccount;
  /** Workspace super-admin the service account impersonates. */
  readonly adminEmail: string;
  /** `my_customer` or the primary domain. */
  readonly customer: string;
};

const ServiceAccountWire = Schema.Struct({
  type: Schema.optional(Schema.String),
  client_email: Schema.String,
  private_key: Schema.String,
  project_id: Schema.optional(Schema.String),
});

const emailPattern = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export const isEmailAddress = (value: string): boolean => emailPattern.test(value.trim());

export const normaliseAdminEmail = (value: string): string => value.trim().toLowerCase();

export const normaliseCustomer = (value: string | null | undefined): string => {
  const trimmed = value?.trim();

  return trimmed ? trimmed.toLowerCase() : "my_customer";
};

/**
 * Decode a downloaded service-account key. Only the two fields Workspace needs
 * are kept; the rest of the document (keys, tokens) is not retained.
 */
export const decodeServiceAccountJson = (
  json: string,
): Effect.Effect<GoogleServiceAccount, GoogleWorkspaceConfigError> =>
  Effect.gen(function* () {
    const text = json.trim();

    if (!text)
      return yield* Effect.fail(
        new GoogleWorkspaceConfigError({
          message: "Paste the service-account JSON downloaded from Google Cloud.",
        }),
      );

    // Parsing is separate from schema decoding so a malformed document cannot
    // put its raw text into an error message.
    const decoded = yield* Effect.try({
      try: () => JSON.parse(text),
      catch: () =>
        new GoogleWorkspaceConfigError({
          message: "The service-account JSON is not valid JSON.",
        }),
    });

    const serviceAccount = yield* Schema.decodeUnknownEffect(ServiceAccountWire)(decoded).pipe(
      Effect.mapError(
        () =>
          new GoogleWorkspaceConfigError({
            message:
              "The service-account JSON is missing client_email or private_key. Download a JSON key for a service account.",
          }),
      ),
    );

    if (serviceAccount.type !== undefined && serviceAccount.type !== "service_account")
      return yield* Effect.fail(
        new GoogleWorkspaceConfigError({
          message: "The JSON is not a service-account key.",
        }),
      );

    if (!isEmailAddress(serviceAccount.client_email))
      return yield* Effect.fail(
        new GoogleWorkspaceConfigError({
          message: "The service account's client_email is not a valid email address.",
        }),
      );

    if (!/-----BEGIN PRIVATE KEY-----/.test(serviceAccount.private_key))
      return yield* Effect.fail(
        new GoogleWorkspaceConfigError({
          message: "The service account's private_key is not a PKCS#8 PEM private key.",
        }),
      );

    return {
      clientEmail: serviceAccount.client_email.trim().toLowerCase(),
      privateKeyPem: serviceAccount.private_key,
      ...(serviceAccount.project_id ? { projectId: serviceAccount.project_id } : {}),
    };
  });

/** Decode a configuration assembled from deployment environment variables. */
export const decodeDeploymentCredentials = (input: {
  readonly serviceAccountJson?: string | null;
  readonly adminEmail?: string | null;
  readonly customer?: string | null;
}): Effect.Effect<GoogleWorkspaceCredentials, GoogleWorkspaceConfigError> =>
  Effect.gen(function* () {
    const serviceAccount = yield* decodeServiceAccountJson(input.serviceAccountJson ?? "");
    const adminEmail = normaliseAdminEmail(input.adminEmail ?? "");

    if (!isEmailAddress(adminEmail))
      return yield* Effect.fail(
        new GoogleWorkspaceConfigError({
          message:
            "GOOGLE_WORKSPACE_ADMIN_EMAIL must be the Workspace super-admin the service account impersonates.",
        }),
      );

    return {
      serviceAccount,
      adminEmail,
      customer: normaliseCustomer(input.customer),
    };
  });

/** Safe summary for status endpoints and logs. Never includes the key. */
export const googleCredentialsSummary = (credentials: GoogleWorkspaceCredentials) => ({
  serviceAccountEmail: credentials.serviceAccount.clientEmail,
  adminEmail: credentials.adminEmail,
  customer: credentials.customer,
});

/**
 * Last line of defence for error text: if a provider/HTTP error somehow ever
 * embeds the private key, strip it before it is stored or returned.
 */
export const redactGoogleCredentials = (
  message: string,
  credentials: GoogleWorkspaceCredentials | undefined,
): string => {
  if (!credentials) return message;
  const key = credentials.serviceAccount.privateKeyPem;

  return key ? message.split(key).join("[redacted]") : message;
};
