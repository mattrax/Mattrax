import { Schema } from "effect";

/**
 * Platform-operator account catalogue.
 *
 * These schemas describe cross-tenant data: every account and its memberships.
 * They are only ever returned to a caller that the API proved is a superadmin
 * from the account row or the deployment allowlist — never from a tenant role.
 */

export const ADMIN_ACCOUNT_SEARCH_MAX_LENGTH = 200;

export const ADMIN_ACCOUNT_PAGE_DEFAULT = 25;

export const ADMIN_ACCOUNT_PAGE_MAX = 100;

export const ADMIN_ACCOUNT_OFFSET_MAX = 100_000;

export const AdminAccountsQuery = Schema.Struct({
  /** Matched against name and email. Bounded to keep the LIKE scan predictable. */
  q: Schema.optional(Schema.String.check(Schema.isMaxLength(ADMIN_ACCOUNT_SEARCH_MAX_LENGTH))),
  limit: Schema.optional(
    Schema.Int.check(Schema.isBetween({ minimum: 1, maximum: ADMIN_ACCOUNT_PAGE_MAX })),
  ),
  offset: Schema.optional(
    Schema.Int.check(Schema.isBetween({ minimum: 0, maximum: ADMIN_ACCOUNT_OFFSET_MAX })),
  ),
});

export type AdminAccountsQuery = typeof AdminAccountsQuery.Type;

export type NormalizedAdminAccountsQuery = {
  readonly q: string | undefined;
  readonly limit: number;
  readonly offset: number;
};

const wholeNumber = (
  value: number | undefined,
  fallback: number,
  minimum: number,
  maximum: number,
) =>
  value === undefined || !Number.isInteger(value)
    ? fallback
    : Math.min(Math.max(value, minimum), maximum);

/**
 * Apply the same bounds the HTTP decoder enforces. Internal callers (tests and
 * future service-to-service use) still get a bounded query rather than an
 * unbounded cross-tenant scan.
 */
export const normalizeAdminAccountsQuery = (
  query: AdminAccountsQuery = {},
): NormalizedAdminAccountsQuery => {
  const q = query.q?.trim();

  return {
    q: q ? q.slice(0, ADMIN_ACCOUNT_SEARCH_MAX_LENGTH) : undefined,
    limit: wholeNumber(query.limit, ADMIN_ACCOUNT_PAGE_DEFAULT, 1, ADMIN_ACCOUNT_PAGE_MAX),
    offset: wholeNumber(query.offset, 0, 0, ADMIN_ACCOUNT_OFFSET_MAX),
  };
};

export const AdminAccountMembership = Schema.Struct({
  tenantId: Schema.String,
  tenantName: Schema.String,
  tenantSlug: Schema.String,
  /** Stored built-in role key, retained for links and compatibility. */
  role: Schema.String,
  roleName: Schema.String,
  roleKind: Schema.Literals(["built-in", "custom"]),
  createdAt: Schema.String,
});

export type AdminAccountMembership = typeof AdminAccountMembership.Type;

export const AdminAccountInfo = Schema.Struct({
  id: Schema.String,
  name: Schema.String,
  email: Schema.String,
  emailVerified: Schema.Boolean,
  disabled: Schema.Boolean,
  createdAt: Schema.String,
  /** Effective flag; true when either the stored column or the allowlist grants it. */
  superadmin: Schema.Boolean,
  /** `env` entries cannot be demoted from the dashboard or the API. */
  superadminSource: Schema.NullOr(Schema.Literals(["env", "database"])),
  memberships: Schema.Array(AdminAccountMembership),
});

export type AdminAccountInfo = typeof AdminAccountInfo.Type;

export const AdminAccountsResponse = Schema.Struct({
  accounts: Schema.Array(AdminAccountInfo),
  total: Schema.Number,
  limit: Schema.Number,
  offset: Schema.Number,
});

export type AdminAccountsResponse = typeof AdminAccountsResponse.Type;

export const PatchAdminAccountSuperadminRequest = Schema.Struct({
  superadmin: Schema.Boolean,
});

export type PatchAdminAccountSuperadminRequest = typeof PatchAdminAccountSuperadminRequest.Type;

export const AdminAccountResponse = Schema.Struct({ status: Schema.Literal("ok") });

export type AdminAccountResponse = typeof AdminAccountResponse.Type;
