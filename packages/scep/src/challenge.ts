/**
 * Per-enrollment SCEP challenge passwords.
 *
 * A challenge is derived from the enrollment id and the application secret rather
 * than stored in the database, so resetting an enrollment (which allocates a new
 * id) automatically invalidates every previously issued challenge.
 *
 * This helper is intentionally stateless: it can prove that a value was minted
 * for an enrollment, but not that it was used. Replay protection needs shared
 * state, so hosts that hand a challenge to a device also persist its digest and
 * consume it once (see the enterprise management backend).
 *
 * Encodings accepted by {@link verifyScepChallenge}:
 *   - `<enrollmentId>.<signature>`
 *   - `<enrollmentId>.<expiresAtEpochSeconds>.<signature>` (signed payload includes
 *     the expiry, so a stale challenge fails closed)
 *   - `<enrollmentId>.<expiresAtEpochSeconds>.<nonce>.<signature>` (one-time
 *     challenges; the nonce makes every issued value unique)
 */

const encoder = new TextEncoder();

/** Expiry (Unix epoch seconds) of a challenge created with the given lifetime. */
export const scepChallengeExpiresAt = (ttlSeconds: number, now = Date.now()): number =>
  Math.floor(now / 1000) + ttlSeconds;

const toBase64Url = (bytes: Uint8Array): string => {
  let binary = "";

  for (const byte of bytes) binary += String.fromCharCode(byte);

  return btoa(binary).replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/, "");
};

const hmac = async (secret: string, message: string): Promise<string> => {
  const key = await crypto.subtle.importKey(
    "raw",
    encoder.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );

  const signature = await crypto.subtle.sign("HMAC", key, encoder.encode(message));

  return toBase64Url(new Uint8Array(signature));
};

const timingSafeEqual = (left: string, right: string): boolean => {
  const a = encoder.encode(left);
  const b = encoder.encode(right);

  if (a.length !== b.length) return false;
  let difference = 0;

  for (let index = 0; index < a.length; index++) difference |= a[index]! ^ b[index]!;

  return difference === 0;
};

export type ScepChallengeVerification = {
  readonly enrollmentId: string;
  /** Unix epoch seconds when the challenge expires, if it carries an expiry. */
  readonly expiresAt?: number;
  /** One-time nonce carried by the challenge, when present. */
  readonly nonce?: string;
};

export type ScepChallengeOptions = {
  /** Optional lifetime. When omitted the challenge does not expire. */
  readonly ttlSeconds?: number;
  /** Optional one-time nonce. Requires `ttlSeconds` so the encoding stays unambiguous. */
  readonly nonce?: string;
  /** Injectable clock for tests. */
  readonly now?: number;
};

export const createScepChallenge = async (
  enrollmentId: string,
  authSecret: string,
  options: ScepChallengeOptions = {},
): Promise<string> => {
  if (!enrollmentId) throw new Error("Enrollment id is required");

  if (options.ttlSeconds === undefined) {
    if (options.nonce !== undefined) throw new Error("A challenge nonce requires ttlSeconds");

    return `${enrollmentId}.${await hmac(authSecret, enrollmentId)}`;
  }

  const expiresAt = scepChallengeExpiresAt(options.ttlSeconds, options.now);

  const payload =
    options.nonce === undefined
      ? `${enrollmentId}.${expiresAt}`
      : `${enrollmentId}.${expiresAt}.${options.nonce}`;

  return `${payload}.${await hmac(authSecret, payload)}`;
};

export const verifyScepChallenge = async (
  challenge: string | undefined,
  authSecret: string,
  options: { readonly now?: number } = {},
): Promise<ScepChallengeVerification | null> => {
  if (!challenge) return null;
  const parts = challenge.split(".");
  const [enrollmentId, middle, third, fourth] = parts;

  if (!enrollmentId) return null;

  if (parts.length === 2) {
    const expected = await hmac(authSecret, enrollmentId);

    return timingSafeEqual(expected, middle ?? "") ? { enrollmentId } : null;
  }

  if (parts.length === 3) {
    const expiresAt = Number(middle);

    if (!Number.isFinite(expiresAt)) return null;
    const expected = await hmac(authSecret, `${enrollmentId}.${middle}`);

    if (!timingSafeEqual(expected, third ?? "")) return null;
    const nowSeconds = Math.floor((options.now ?? Date.now()) / 1000);

    if (nowSeconds > expiresAt) return null;

    return { enrollmentId, expiresAt };
  }

  if (parts.length === 4) {
    const expiresAt = Number(middle);
    const nonce = third;

    if (!Number.isFinite(expiresAt) || !nonce) return null;

    const expected = await hmac(authSecret, `${enrollmentId}.${middle}.${nonce}`);

    if (!timingSafeEqual(expected, fourth ?? "")) return null;
    const nowSeconds = Math.floor((options.now ?? Date.now()) / 1000);

    if (nowSeconds > expiresAt) return null;

    return { enrollmentId, expiresAt, nonce };
  }

  return null;
};
