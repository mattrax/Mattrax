/**
 * Platform-operator (superadmin) identity.
 *
 * A superadmin is not a tenant role: it grants access to the platform account
 * catalogue, independent of any membership. Two sources can grant it:
 *
 * - `account.superadmin`, changed through the platform API; and
 * - `MATTRAX_SUPERADMINS`, a deployment-owned allowlist of verified email
 *   addresses.
 *
 * The environment allowlist is the bootstrap path: a fresh deployment has no
 * stored superadmin, so the deployer names one before the first sign-in. It is
 * also a hard ceiling — an account listed there cannot be demoted through the
 * API or the dashboard.
 */

/** Normalise one allowlist entry. Addresses are compared case-insensitively. */
export const normalizeSuperadminEmail = (value: string): string => value.trim().toLowerCase();

/**
 * Parse the comma-separated allowlist.
 *
 * Blank entries and duplicates are dropped. Values are normalised but not
 * otherwise validated: an entry that is not an address simply never matches an
 * account, while rejecting the whole value at boot would lock the operator out
 * of their own deployment.
 */
export const parseSuperadminEmails = (raw: string | null | undefined): ReadonlyArray<string> => {
  if (!raw) return [];

  return [...new Set(raw.split(",").map(normalizeSuperadminEmail).filter(Boolean))];
};

/** The caller shape both sources read. Kept structural so tests can pass rows. */
export type SuperadminCandidate = {
  readonly email: string;
  readonly emailVerified?: boolean | null;
  readonly superadmin?: boolean | null;
};

export type SuperadminSource = "env" | "database";

/**
 * Whether the deployment allowlist grants this account superadmin.
 *
 * A listed address must be verified. The allowlist names an identity, so an
 * unverified account that happens to own the address must not inherit platform
 * authority from it.
 */
export const isEnvManagedSuperadmin = (
  account: SuperadminCandidate,
  allowlist: ReadonlySet<string>,
): boolean =>
  account.emailVerified === true && allowlist.has(normalizeSuperadminEmail(account.email));

/** Effective superadmin: the environment allowlist wins over the stored flag. */
export const superadminSource = (
  account: SuperadminCandidate,
  allowlist: ReadonlySet<string>,
): SuperadminSource | null => {
  if (isEnvManagedSuperadmin(account, allowlist)) return "env";

  return account.superadmin === true ? "database" : null;
};

export const isSuperadmin = (
  account: SuperadminCandidate,
  allowlist: ReadonlySet<string>,
): boolean => superadminSource(account, allowlist) !== null;
