import { Effect } from "effect";
import { serializePlist } from "@mattrax/plist";

/** Short name of the administrator Mattrax creates during macOS ADE setup. */
export const APPLE_MANAGED_LOCAL_ADMIN_USERNAME = "mattrax-admin";

const base64EncodeBytes = (bytes: Uint8Array): string => {
  let binary = "";

  for (const byte of bytes) binary += String.fromCharCode(byte);

  return btoa(binary);
};

/** A random password that satisfies macOS' default password policy. */
export const generateLocalAdminPassword = (): string => {
  const random = base64EncodeBytes(crypto.getRandomValues(new Uint8Array(24)))
    .replaceAll("+", "")
    .replaceAll("/", "")
    .replaceAll("=", "")
    .slice(0, 24);

  return `${random}aA1!`;
};

/**
 * Apple's `passwordHash` value: an XML plist containing the PBKDF2-SHA512
 * entropy, salt and iteration count, itself base64 encoded so the command queue
 * can store it as JSON. The device-facing plist builder decodes it back into a
 * `<data>` value.
 *
 * `SetAutoAdminPassword` needs the same shape as `AccountConfiguration`, so
 * both the initial setup and a later rotation use this one implementation.
 */
export const applePasswordHash = (password: string): Effect.Effect<string, Error> =>
  Effect.gen(function* () {
    const salt = crypto.getRandomValues(new Uint8Array(32));
    const iterations = 35_000;

    const key = yield* Effect.tryPromise({
      try: () =>
        crypto.subtle.importKey("raw", new TextEncoder().encode(password), "PBKDF2", false, [
          "deriveBits",
        ]),
      catch: () => new Error("Failed to import the local admin password"),
    });

    const entropy = yield* Effect.tryPromise({
      try: () =>
        crypto.subtle.deriveBits(
          { name: "PBKDF2", salt, iterations, hash: "SHA-512" },
          key,
          128 * 8,
        ),
      catch: () => new Error("Failed to hash the local admin password"),
    });

    const plist = yield* serializePlist({
      "SALTED-SHA512-PBKDF2": {
        entropy: new Uint8Array(entropy),
        iterations,
        salt,
      },
    });

    return base64EncodeBytes(new TextEncoder().encode(plist));
  });

/**
 * The documented `SetAutoAdminPassword` payload. Apple rejects the command
 * when the GUID does not match an administrator account the server created
 * during ADE, so callers must only pass a GUID the device reported.
 */
export const setAutoAdminPasswordPayload = (input: {
  readonly guid: string;
  readonly passwordHash: string;
}) => ({ GUID: input.guid, passwordHash: input.passwordHash });

/**
 * Whether the managed local administrator password is due for rotation.
 * Pure so the tenant policy can be unit tested without a database.
 */
export const localAdminRotationDue = (input: {
  readonly rotationDays: number | null | undefined;
  readonly rotatedAt: Date | null | undefined;
  readonly now: Date;
  readonly hasGuid: boolean;
}): boolean => {
  if (!input.hasGuid) return false;
  const days = input.rotationDays;

  if (days === null || days === undefined || days <= 0) return false;
  if (!input.rotatedAt) return false;

  return input.now.getTime() - input.rotatedAt.getTime() >= days * 24 * 60 * 60 * 1000;
};
