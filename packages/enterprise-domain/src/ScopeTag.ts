import { Schema } from "effect";

/**
 * The resource kinds that can carry scope tags.
 *
 * Enrollment links are deliberately absent: they are tenant-level settings
 * signed from the tenant's SCEP CA rather than rows an administrator can tag,
 * so a scoped enrollment administrator is a tenant-wide role for now. Device
 * views, reports and other derived views inherit the visibility of the data
 * they query rather than carrying independent tags.
 */
export const SCOPE_TAG_RESOURCE_TYPES = [
  "device",
  "group",
  "policy",
  "application",
  "script",
  "dashboard",
] as const;

export type ScopeTagResourceType = (typeof SCOPE_TAG_RESOURCE_TYPES)[number];

export const ScopeTagResourceType = Schema.Literals(SCOPE_TAG_RESOURCE_TYPES);

export const SCOPE_TAG_RESOURCE_LABELS: Record<ScopeTagResourceType, string> = {
  device: "device",
  group: "group",
  policy: "policy",
  application: "application",
  script: "script",
  dashboard: "dashboard",
};

/** A tenant may define a bounded number of tags; each one costs an assignment row per resource. */
export const SCOPE_TAG_LIMIT = 100;

export const SCOPE_TAG_NAME_MAX = 64;

export const SCOPE_TAG_DESCRIPTION_MAX = 500;

/** One bulk tagging request is bounded so a paste cannot lock a tenant table. */
export const SCOPE_TAG_ASSIGNMENT_LIMIT = 200;

export const ScopeTag = Schema.Struct({
  id: Schema.String,
  name: Schema.String,
  description: Schema.optional(Schema.NullOr(Schema.String)),
  /** How many resources currently carry this tag. */
  resourceCount: Schema.Number,
  /** How many members may reach this tag. */
  memberCount: Schema.Number,
  createdAt: Schema.String,
  updatedAt: Schema.String,
});

export type ScopeTag = typeof ScopeTag.Type;

export const ScopeTagsResponse = Schema.Struct({ tags: Schema.Array(ScopeTag) });

export type ScopeTagsResponse = typeof ScopeTagsResponse.Type;

export const CreateScopeTagRequest = Schema.Struct({
  name: Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(SCOPE_TAG_NAME_MAX)),
  description: Schema.optional(Schema.NullOr(Schema.String)),
});

export type CreateScopeTagRequest = typeof CreateScopeTagRequest.Type;

export const PatchScopeTagRequest = Schema.Struct({
  name: Schema.optional(
    Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(SCOPE_TAG_NAME_MAX)),
  ),
  description: Schema.optional(Schema.NullOr(Schema.String)),
});

export type PatchScopeTagRequest = typeof PatchScopeTagRequest.Type;

/** The tag ids attached to one resource. */
export const ScopeTagAssignment = Schema.Struct({
  resourceType: ScopeTagResourceType,
  resourceId: Schema.String,
  tagIds: Schema.Array(Schema.String),
});

export type ScopeTagAssignment = typeof ScopeTagAssignment.Type;

export const ScopeTagAssignmentsResponse = Schema.Struct({
  assignments: Schema.Array(ScopeTagAssignment),
});

export type ScopeTagAssignmentsResponse = typeof ScopeTagAssignmentsResponse.Type;

/**
 * Query assignments for one resource kind. `resourceIds` is a comma-separated
 * list capped at the bulk limit; omitting it returns every assignment of that
 * kind, which the tags page uses for its counts and filters.
 */
export const ListScopeTagAssignmentsQuery = Schema.Struct({
  resourceType: ScopeTagResourceType,
  resourceIds: Schema.optional(Schema.String),
});

export type ListScopeTagAssignmentsQuery = typeof ListScopeTagAssignmentsQuery.Type;

/**
 * Replace the tags on a set of resources. One payload serves a resource form
 * (one id) and a bulk action (many ids) so the write path and its scope checks
 * cannot drift apart.
 */
export const SetScopeTagAssignmentsRequest = Schema.Struct({
  resourceType: ScopeTagResourceType,
  resourceIds: Schema.Array(Schema.String).check(
    Schema.isMinLength(1),
    Schema.isMaxLength(SCOPE_TAG_ASSIGNMENT_LIMIT),
  ),
  tagIds: Schema.Array(Schema.String),
});

export type SetScopeTagAssignmentsRequest = typeof SetScopeTagAssignmentsRequest.Type;

/** Set the tags a member may reach. An empty list makes the membership unscoped. */
export const SetMemberScopeTagsRequest = Schema.Struct({
  tagIds: Schema.Array(Schema.String),
});

export type SetMemberScopeTagsRequest = typeof SetMemberScopeTagsRequest.Type;

export const SetScopeTagAssignmentsResponse = Schema.Struct({
  status: Schema.Literal("ok"),
  /** Number of resources that were already tagged and are now updated. */
  updated: Schema.Number,
});

export type SetScopeTagAssignmentsResponse = typeof SetScopeTagAssignmentsResponse.Type;

export const isScopeTagResourceType = (value: string): value is ScopeTagResourceType =>
  (SCOPE_TAG_RESOURCE_TYPES as ReadonlyArray<string>).includes(value);

/** Parse the comma-separated query form, de-duplicating and bounding the list. */
export const parseScopeTagResourceIds = (
  value: string | undefined,
): ReadonlyArray<string> | undefined => {
  if (value === undefined) return undefined;

  const ids = [...new Set(value.split(",").map((id) => id.trim()).filter(Boolean))];

  return ids.slice(0, SCOPE_TAG_ASSIGNMENT_LIMIT);
};

/** Normalise a tag list: trim-free ids, de-duplicated and in stable input order. */
export const normalizeScopeTagIds = (values: ReadonlyArray<string>): ReadonlyArray<string> => [
  ...new Set(values.filter((value) => value.trim().length > 0)),
];
