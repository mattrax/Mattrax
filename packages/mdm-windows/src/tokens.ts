import { Context, Effect, Layer, Option, Schema } from "effect";
import { Mac, SecureRandom } from "effect/crypto";
import { Base64Url } from "effect/encoding";

const encoder = new TextEncoder();
const decoder = new TextDecoder("utf-8", { fatal: true });

export class WindowsTokenError extends Schema.TaggedError<WindowsTokenError>()(
  "WindowsTokenError",
  {
    reason: Schema.Literals(["configuration", "crypto"]),
    message: Schema.String,
    cause: Schema.optional(Schema.Unknown),
  },
) {}

export type WindowsEnrollmentTokenOptions = {
  /** Lifetime in seconds. Defaults to one hour. */
  readonly ttlSeconds?: number;
  /** Injectable clock in milliseconds, for tests. */
  readonly now?: number;
};

export type WindowsEnrollmentTokenVerification = {
  readonly subject: string;
  readonly issuedAt: number;
};

export const DEFAULT_ENROLLMENT_TOKEN_TTL_SECONDS = 60 * 60;

export type WindowsEnrollmentTokenEvaluation = {
  /** Non-null only when the signature is valid and the token has not expired. */
  readonly verification: WindowsEnrollmentTokenVerification | null;
  /** True when the signature is valid but the token's lifetime has elapsed. */
  readonly expired: boolean;
};

/** Prefix that marks a tenant-scoped Windows enrollment token. */
const TENANT_TOKEN_PREFIX = "mttxw1";

/** Prefix for a tenant token whose discovery chose the Federated auth policy. */
const FEDERATED_TENANT_TOKEN_PREFIX = "mttxw2";

const TENANT_TOKEN_CONTEXT = "mattrax:windows-tenant:v1";

const FEDERATED_TENANT_TOKEN_CONTEXT = "mattrax:windows-tenant:v2:federated";

/** Prefix that binds the organization into a WSTEP enrollment token subject. */
const ENROLLMENT_SUBJECT_PREFIX = "mttxw1:";

/**
 * Tenant enrollment links are shared by administrators (settings, QR code,
 * email), so the token lifetime is measured in days rather than minutes. The
 * enrollment page mints a fresh token on every load.
 */
export const DEFAULT_WINDOWS_TENANT_TOKEN_TTL_SECONDS = 7 * 24 * 60 * 60;

export type WindowsTenantTokenOptions = {
  /** Lifetime in seconds. Defaults to seven days. */
  readonly ttlSeconds?: number;
  /** Injectable clock in milliseconds, for tests. */
  readonly now?: number;
  /**
   * Mint a token for a discovery flow that chose `AuthPolicy: Federated`.
   * Policy/enroll then require a verifiable Entra JWT for this tenant.
   */
  readonly federated?: boolean;
};

export type WindowsTenantTokenVerification = {
  readonly organizationId: string;
  readonly issuedAt: number;
  readonly expiresAt: number;
  /** True when discovery selected the Federated auth policy. */
  readonly federated: boolean;
};

export type WindowsTenantTokenEvaluation = {
  /** Non-null only when the signature is valid and the token has not expired. */
  readonly verification: WindowsTenantTokenVerification | null;
  /** True when the signature is valid but the token's lifetime has elapsed. */
  readonly expired: boolean;
};

const tenantTokenMessage = (
  organizationId: string,
  issuedAt: number,
  expiresAt: number,
  federated: boolean,
) =>
  `${federated ? FEDERATED_TENANT_TOKEN_CONTEXT : TENANT_TOKEN_CONTEXT}.${organizationId}.${issuedAt}.${expiresAt}`;

const decodeBase64Url = (value: string): Uint8Array | null => {
  const decoded = Schema.decodeUnknownOption(Schema.Uint8ArrayFromBase64Url)(value);

  return Option.isSome(decoded) ? decoded.value : null;
};

const fromBase64Url = (value: string): string | null => {
  const bytes = decodeBase64Url(value);

  if (!bytes) return null;

  try {
    return decoder.decode(bytes);
  } catch {
    return null;
  }
};

const configurationError = (message: string) =>
  new WindowsTokenError({ reason: "configuration", message });

const cryptoError = (message: string, cause: unknown) =>
  new WindowsTokenError({ reason: "crypto", message, cause });

/** Whether a value has the shape of our `<subject>.<issuedAt>.<hmac>` token. */
export const isWindowsEnrollmentToken = (token: string): boolean => {
  const parts = token.split(".");

  if (parts.length !== 3) return false;

  const [, issuedAt, signature] = parts;

  return Boolean(/^\d+$/.test(issuedAt ?? "") && /^[A-Za-z0-9_-]+$/.test(signature ?? ""));
};

export interface WindowsTokenServiceContract {
  readonly createEnrollmentToken: (
    subject: string,
    authSecret: string,
    options?: WindowsEnrollmentTokenOptions,
  ) => Effect.Effect<string, WindowsTokenError>;
  readonly verifyEnrollmentTokenDetailed: (
    token: string | undefined,
    authSecret: string,
    options?: WindowsEnrollmentTokenOptions,
  ) => Effect.Effect<WindowsEnrollmentTokenEvaluation, WindowsTokenError>;
  readonly createTenantToken: (
    organizationId: string,
    authSecret: string,
    options?: WindowsTenantTokenOptions,
  ) => Effect.Effect<string, WindowsTokenError>;
  readonly verifyTenantTokenDetailed: (
    token: string | undefined,
    authSecret: string,
    options?: WindowsTenantTokenOptions,
  ) => Effect.Effect<WindowsTenantTokenEvaluation, WindowsTokenError>;
}

export class WindowsTokenService extends Context.Service<
  WindowsTokenService,
  WindowsTokenServiceContract
>()("@mattrax/mdm-windows/WindowsTokenService") {}

export declare namespace WindowsTokenService {
  export type Service = WindowsTokenServiceContract;
}

export const WindowsTokenServiceLayer = Layer.effect(
  WindowsTokenService,
  Effect.gen(function* () {
    const mac = yield* Mac.Mac;

    const sign = Effect.fnUntraced(
      function* (secret: string, message: string) {
        const key = yield* Mac.key(Mac.hmacSha256, encoder.encode(secret));
        const signature = yield* mac.sign(key, encoder.encode(message));

        return Base64Url.encode(signature);
      },
      Effect.mapError((cause) => cryptoError("The Windows token could not be signed", cause)),
    );

    const verify = Effect.fnUntraced(
      function* (secret: string, signature: string, message: string) {
        const tag = decodeBase64Url(signature);

        if (!tag) return false;

        const key = yield* Mac.key(Mac.hmacSha256, encoder.encode(secret));

        return yield* mac.verify(key, tag, encoder.encode(message));
      },
      Effect.mapError((cause) =>
        cryptoError("The Windows token signature could not be verified", cause),
      ),
    );

    const createEnrollmentToken = Effect.fnUntraced(function* (
      subject: string,
      authSecret: string,
      options: WindowsEnrollmentTokenOptions = {},
    ) {
      if (!subject)
        return yield* configurationError("Windows enrollment token subject is required");
      if (!authSecret)
        return yield* configurationError("Windows enrollment token requires a secret");

      const issuedAt = Math.floor((options.now ?? Date.now()) / 1000);
      const signature = yield* sign(authSecret, `${subject}.${issuedAt}`);

      return `${subject}.${issuedAt}.${signature}`;
    });

    const verifyEnrollmentTokenDetailed = Effect.fnUntraced(function* (
      token: string | undefined,
      authSecret: string,
      options: WindowsEnrollmentTokenOptions = {},
    ): Effect.fn.Return<WindowsEnrollmentTokenEvaluation, WindowsTokenError> {
      const invalid = { verification: null, expired: false } as const;

      if (!token || !authSecret) return invalid;

      const parts = token.split(".");

      if (parts.length !== 3) return invalid;

      const [subject, issuedAtRaw, signature] = parts;

      if (!subject || !issuedAtRaw || !signature) return invalid;

      const issuedAt = Number(issuedAtRaw);

      if (!Number.isFinite(issuedAt)) return invalid;

      const valid = yield* verify(authSecret, signature, `${subject}.${issuedAtRaw}`);

      if (!valid) return invalid;

      const nowSeconds = Math.floor((options.now ?? Date.now()) / 1000);
      const ttlSeconds = options.ttlSeconds ?? DEFAULT_ENROLLMENT_TOKEN_TTL_SECONDS;

      if (nowSeconds > issuedAt + ttlSeconds) return { verification: null, expired: true };
      if (issuedAt > nowSeconds + 60) return invalid;

      return { verification: { subject, issuedAt }, expired: false };
    });

    const createTenantToken = Effect.fnUntraced(function* (
      organizationId: string,
      authSecret: string,
      options: WindowsTenantTokenOptions = {},
    ) {
      if (!organizationId)
        return yield* configurationError("Windows tenant token organization is required");
      if (!authSecret) return yield* configurationError("Windows tenant token requires a secret");

      const issuedAt = Math.floor((options.now ?? Date.now()) / 1000);
      const expiresAt = issuedAt + (options.ttlSeconds ?? DEFAULT_WINDOWS_TENANT_TOKEN_TTL_SECONDS);
      const federated = options.federated === true;
      const signature = yield* sign(
        authSecret,
        tenantTokenMessage(organizationId, issuedAt, expiresAt, federated),
      );

      return [
        federated ? FEDERATED_TENANT_TOKEN_PREFIX : TENANT_TOKEN_PREFIX,
        Base64Url.encode(encoder.encode(organizationId)),
        issuedAt,
        expiresAt,
        signature,
      ].join(".");
    });

    const verifyTenantTokenDetailed = Effect.fnUntraced(function* (
      token: string | undefined,
      authSecret: string,
      options: WindowsTenantTokenOptions = {},
    ): Effect.fn.Return<WindowsTenantTokenEvaluation, WindowsTokenError> {
      const invalid = { verification: null, expired: false } as const;

      if (!token || !authSecret) return invalid;

      const parts = token.split(".");

      if (parts.length !== 5) return invalid;

      const [prefix, encodedOrganization, issuedAtRaw, expiresAtRaw, signature] = parts;
      const federated = prefix === FEDERATED_TENANT_TOKEN_PREFIX;

      if (
        (!federated && prefix !== TENANT_TOKEN_PREFIX) ||
        !encodedOrganization ||
        !issuedAtRaw ||
        !expiresAtRaw ||
        !signature
      )
        return invalid;

      const organizationId = fromBase64Url(encodedOrganization);
      const issuedAt = Number(issuedAtRaw);
      const expiresAt = Number(expiresAtRaw);

      if (!organizationId || !Number.isFinite(issuedAt) || !Number.isFinite(expiresAt))
        return invalid;
      if (expiresAt <= issuedAt) return invalid;

      const valid = yield* verify(
        authSecret,
        signature,
        tenantTokenMessage(organizationId, issuedAt, expiresAt, federated),
      );

      if (!valid) return invalid;

      const nowSeconds = Math.floor((options.now ?? Date.now()) / 1000);

      if (nowSeconds > expiresAt) return { verification: null, expired: true };
      if (issuedAt > nowSeconds + 300) return invalid;

      return { verification: { organizationId, issuedAt, expiresAt, federated }, expired: false };
    });

    return WindowsTokenService.of({
      createEnrollmentToken,
      verifyEnrollmentTokenDetailed,
      createTenantToken,
      verifyTenantTokenDetailed,
    });
  }),
);

export const WindowsTokenServiceLive = WindowsTokenServiceLayer.pipe(
  Layer.provide(Mac.layerWebCrypto),
  Layer.provide(SecureRandom.layerWebCrypto),
);

const runToken = <A, E>(effect: Effect.Effect<A, E, WindowsTokenService>) =>
  Effect.runPromise(effect.pipe(Effect.provide(WindowsTokenServiceLive)));

/** Stateless WSTEP enrollment token compatibility API. */
export const createWindowsEnrollmentToken = (
  subject: string,
  authSecret: string,
  options: WindowsEnrollmentTokenOptions = {},
): Promise<string> =>
  runToken(
    WindowsTokenService.pipe(
      Effect.flatMap((service) => service.createEnrollmentToken(subject, authSecret, options)),
    ),
  );

export const verifyWindowsEnrollmentToken = (
  token: string | undefined,
  authSecret: string,
  options: WindowsEnrollmentTokenOptions = {},
): Promise<WindowsEnrollmentTokenVerification | null> =>
  verifyWindowsEnrollmentTokenDetailed(token, authSecret, options).then(
    (result) => result.verification,
  );

export const verifyWindowsEnrollmentTokenDetailed = (
  token: string | undefined,
  authSecret: string,
  options: WindowsEnrollmentTokenOptions = {},
): Promise<WindowsEnrollmentTokenEvaluation> =>
  runToken(
    WindowsTokenService.pipe(
      Effect.flatMap((service) =>
        service.verifyEnrollmentTokenDetailed(token, authSecret, options),
      ),
    ),
  );

/** Stateless tenant enrollment token compatibility API. */
export const createWindowsTenantToken = (
  organizationId: string,
  authSecret: string,
  options: WindowsTenantTokenOptions = {},
): Promise<string> =>
  runToken(
    WindowsTokenService.pipe(
      Effect.flatMap((service) => service.createTenantToken(organizationId, authSecret, options)),
    ),
  );

export const verifyWindowsTenantTokenDetailed = (
  token: string | undefined,
  authSecret: string,
  options: WindowsTenantTokenOptions = {},
): Promise<WindowsTenantTokenEvaluation> =>
  runToken(
    WindowsTokenService.pipe(
      Effect.flatMap((service) => service.verifyTenantTokenDetailed(token, authSecret, options)),
    ),
  );

export const verifyWindowsTenantToken = (
  token: string | undefined,
  authSecret: string,
  options: WindowsTenantTokenOptions = {},
): Promise<WindowsTenantTokenVerification | null> =>
  verifyWindowsTenantTokenDetailed(token, authSecret, options).then(
    (result) => result.verification,
  );

/** Expiry encoded in a tenant token, for display in the enrollment UI. */
export const windowsTenantTokenExpiresAt = (token: string): Date | null => {
  const parts = token.split(".");

  if (parts.length !== 5) return null;

  const seconds = Number(parts[3]);

  return Number.isFinite(seconds) ? new Date(seconds * 1000) : null;
};

/** Bind the organization into a WSTEP token so enrollment cannot switch tenants. */
export const windowsEnrollmentSubject = (organizationId: string): string =>
  `${ENROLLMENT_SUBJECT_PREFIX}${Base64Url.encode(encoder.encode(organizationId))}:${crypto.randomUUID()}`;

/** Recover the organization previously bound into a WSTEP token subject. */
export const organizationFromWindowsEnrollmentSubject = (
  subject: string | undefined,
): string | null => {
  if (!subject?.startsWith(ENROLLMENT_SUBJECT_PREFIX)) return null;

  const rest = subject.slice(ENROLLMENT_SUBJECT_PREFIX.length);
  const separator = rest.indexOf(":");

  if (separator <= 0) return null;

  return fromBase64Url(rest.slice(0, separator));
};
