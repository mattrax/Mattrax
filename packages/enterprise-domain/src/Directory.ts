import { Schema } from "effect";
import { ApplicationSearchRow } from "./Application.js";
import { DeviceRow, SoftwareSearchRow } from "./Device.js";
import { GroupRow } from "./Group.js";
import { PolicyRow } from "./Policy.js";

export const DirectoryUser = Schema.Struct({
  id: Schema.String,
  name: Schema.String,
  email: Schema.String,
  emailVerified: Schema.Boolean,
  disabled: Schema.Boolean,
  role: Schema.String,
  source: Schema.Literals(["entra", "scim", "manual"]),
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

/** Scope of an assignment that contributed to the effective policy. */

export const UserSearchRow = Schema.Struct({
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
      UserSearchRow,
      ApplicationSearchRow,
      SoftwareSearchRow,
    ]),
  ),
});

export type SearchResult = typeof SearchResult.Type;
