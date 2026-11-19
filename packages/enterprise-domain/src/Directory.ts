import { Schema } from "effect";
import { NullableString } from "./Errors.js";
import { BULK_MEMBER_LIMIT } from "./Common.js";
import { ApplicationSearchRow } from "./Application.js";
import { DeviceRow, SoftwareSearchRow } from "./Device.js";
import { GroupRow } from "./Group.js";
import { PolicyRow } from "./Policy.js";

/** A person from the tenant's directory; never a dashboard account. */
export const DirectoryUser = Schema.Struct({
  id: Schema.String,
  name: Schema.String,
  email: Schema.String,
  externalId: Schema.optional(NullableString),
  disabled: Schema.Boolean,
  source: Schema.Literals(["entra", "scim", "manual"]),
  /** True when this Entra identity is already linked to a Mattrax account. */
  linked: Schema.Boolean,
});

export type DirectoryUser = typeof DirectoryUser.Type;

export const DirectoryGroup = Schema.Struct({
  id: Schema.String,
  name: Schema.String,
  source: Schema.Literals(["graph", "scim", "manual"]),
  memberCount: Schema.Number,
});

export type DirectoryGroup = typeof DirectoryGroup.Type;

export const DirectoryResponse = Schema.Struct({
  users: Schema.Array(DirectoryUser),
  groups: Schema.Array(DirectoryGroup),
});

export type DirectoryResponse = typeof DirectoryResponse.Type;

export const DeviceUser = Schema.Struct({
  id: Schema.String,
  name: Schema.String,
  email: Schema.String,
});

export type DeviceUser = typeof DeviceUser.Type;

export const DeviceUsersResponse = Schema.Struct({
  users: Schema.Array(DeviceUser),
});

export type DeviceUsersResponse = typeof DeviceUsersResponse.Type;

export const SetDeviceUsersRequest = Schema.Struct({
  userIds: Schema.Array(Schema.String),
});

/** Add directory users to one directory (user) group. */
export const AddUserGroupMembersRequest = Schema.Struct({
  userIds: Schema.Array(Schema.String).check(
    Schema.isMinLength(1),
    Schema.isMaxLength(BULK_MEMBER_LIMIT),
  ),
});

/** Scope of an assignment that contributed to the effective policy. */

export const UserSearchRow = Schema.Struct({
  id: Schema.String,
  name: Schema.String,
  email: Schema.String,
});

/** An administrator account, searchable next to directory people. */
export const AccountSearchRow = Schema.Struct({
  id: Schema.String,
  name: Schema.String,
  email: Schema.String,
  role: Schema.String,
});

export type UserSearchRow = typeof UserSearchRow.Type;

/**
 * Command-palette results.
 *
 * Search is tenant-scoped by design: every result belongs to the tenant in the
 * URL, and permissions are resolved for that one membership. Searching across
 * tenants would need a separate cross-tenant permission and a label on every
 * row, so the endpoint deliberately does not aggregate other memberships.
 *
 * Rows that depend on a narrower permission (`members.read`,
 * `applications.read`) are omitted rather than returned empty-handed, so a
 * caller without that permission cannot infer the tenant's data.
 */
export const SearchResult = Schema.Struct({
  rows: Schema.Array(
    Schema.Union([
      DeviceRow,
      GroupRow,
      PolicyRow,
      // Account rows carry a role, so they must be tested before the plain
      // directory-user row (whose schema would otherwise strip the role).
      AccountSearchRow,
      UserSearchRow,
      ApplicationSearchRow,
      SoftwareSearchRow,
    ]),
  ),
});

export type SearchResult = typeof SearchResult.Type;
