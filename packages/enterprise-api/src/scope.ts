import { newId } from "@mattrax/crypto";
import { and, eq, inArray, or } from "drizzle-orm";
import type { SQL, SQLWrapper } from "drizzle-orm";
import { Effect } from "effect";
import { schema } from "@mattrax/enterprise-core";
import type { EnterpriseDb } from "@mattrax/enterprise-core";
import { EnterprisePermissionDenied, SCOPE_TAG_RESOURCE_TYPES } from "@mattrax/enterprise-domain";
import type { Permission, ScopeTagResourceType } from "@mattrax/enterprise-domain";

/**
 * The slice of a resolved tenant request that scope enforcement needs.
 *
 * Handlers pass their whole `ctx`; this keeps the helpers independent of the
 * closure that builds it and makes a missing scope check obvious in review.
 */
export type ScopeContext = {
  readonly account: { readonly id: string; readonly email: string };
  readonly organization: { readonly id: string };
  readonly role: {
    readonly roleName: string;
    readonly roleKind: "built-in" | "custom";
  };
  readonly scopeTagIds: ReadonlySet<string>;
  readonly scopeUnrestricted: boolean;
  readonly ip?: string | null;
  readonly userAgent?: string | null;
};


/**
 * Refuse a surface that can only be computed tenant-wide.
 *
 * Fleet aggregates (health, push, OS and credential summaries) and device
 * pre-registration rows have no per-resource tag yet. Exposing their totals to
 * a scoped role would leak another region, so they fail closed with a clear
 * message until the underlying query accepts a tag filter.
 */
export const assertTenantWideRead = (
  ctx: ScopeContext,
  permission: Permission,
  surface: string,
) => {
  if (ctx.scopeUnrestricted) return Effect.void;

  return Effect.fail(
    new EnterprisePermissionDenied({
      message: `${surface} covers the whole tenant and is not available to a scope-tagged role yet.`,
      permission,
      roleName: ctx.role.roleName,
      roleKind: ctx.role.roleKind,
    }),
  );
};

/**
 * The allowed tags for a scoped request, or `undefined` when the membership is
 * tenant-wide. Callers must treat `undefined` as "no filter", never as "empty".
 */
export const scopeAllowlist = (ctx: ScopeContext): ReadonlyArray<string> | undefined =>
  ctx.scopeUnrestricted ? undefined : [...ctx.scopeTagIds];

/**
 * A Drizzle subquery of resource ids carrying any of the allowed tags.
 *
 * It is deliberately a subquery rather than a join: the list endpoints already
 * select the resource table and a join would duplicate rows for a resource
 * with several matching tags.
 */
export const scopedResourceIds = (
  db: EnterpriseDb,
  ctx: ScopeContext,
  resourceType: ScopeTagResourceType,
) => {
  const allowlist = scopeAllowlist(ctx);

  if (!allowlist) return undefined;

  return db
    .select({ id: schema.scopeTagAssignment.resourceId })
    .from(schema.scopeTagAssignment)
    .where(
      and(
        eq(schema.scopeTagAssignment.organizationId, ctx.organization.id),
        eq(schema.scopeTagAssignment.resourceType, resourceType),
        inArray(schema.scopeTagAssignment.tagId, [...allowlist]),
      ),
    );
};

/**
 * A filter for a resource list/read query, or `undefined` for an unscoped
 * membership. Passing the id column keeps the condition attached to the table
 * the caller is already querying.
 */
export const scopeCondition = (
  db: EnterpriseDb,
  ctx: ScopeContext,
  resourceType: ScopeTagResourceType,
  idColumn: SQLWrapper,
): SQL | undefined => {
  const ids = scopedResourceIds(db, ctx, resourceType);

  return ids ? inArray(idColumn, ids) : undefined;
};

export const resourceInScope = (
  db: EnterpriseDb,
  ctx: ScopeContext,
  resourceType: ScopeTagResourceType,
  resourceId: string,
) => {
  const allowlist = scopeAllowlist(ctx);

  if (!allowlist) return Effect.succeed(true);

  return Effect.gen(function* () {
    const rows = yield* db
      .select({ tagId: schema.scopeTagAssignment.tagId })
      .from(schema.scopeTagAssignment)
      .where(
        and(
          eq(schema.scopeTagAssignment.organizationId, ctx.organization.id),
          eq(schema.scopeTagAssignment.resourceType, resourceType),
          eq(schema.scopeTagAssignment.resourceId, resourceId),
          inArray(schema.scopeTagAssignment.tagId, [...allowlist]),
        ),
      )
      .limit(1);

    return rows.length > 0;
  });
};

/**
 * Refuse a read or mutation of a resource outside the caller's scope.
 *
 * The response names the scope rather than the resource's owner, and the audit
 * entry preserves the attempted id for the tenant's security review. Callers
 * that list rows hide out-of-scope ids entirely; callers that resolve one id
 * either fail here or report it as not found.
 */
export const assertResourceScope = (
  ctx: ScopeContext,
  db: EnterpriseDb,
  resourceType: ScopeTagResourceType,
  resourceId: string,
  message: string,
) =>
  Effect.gen(function* () {
    if (yield* resourceInScope(db, ctx, resourceType, resourceId)) return;

    yield* Effect.gen(function* () {
      const { auditLog } = schema;

      yield* db.insert(auditLog).values({
        id: newId(),
        organizationId: ctx.organization.id,
        actorAccountId: ctx.account.id,
        actorEmail: ctx.account.email,
        actorType: "account",
        category: "account",
        action: "scope_tag.access_denied",
        targetType: resourceType,
        targetId: resourceId,
        metadata: {
          reason: "outside_scope",
          scopeTagIds: [...ctx.scopeTagIds],
          roleName: ctx.role.roleName,
          roleKind: ctx.role.roleKind,
        },
        ip: ctx.ip ?? null,
        userAgent: ctx.userAgent ?? null,
        createdAt: new Date(),
      });
    }).pipe(Effect.catch(() => Effect.void));

    return yield* Effect.fail(
      new EnterprisePermissionDenied({
        message: `${message} is outside your scope tags.`,
        permission: scopeResourceReadPermission[resourceType],
        roleName: ctx.role.roleName,
        roleKind: ctx.role.roleKind,
      }),
    );
  });

/** Refuse a bulk action when any id falls outside the caller's scope. */
export const assertResourcesScope = (
  ctx: ScopeContext,
  db: EnterpriseDb,
  resourceType: ScopeTagResourceType,
  resourceIds: ReadonlyArray<string>,
  message: string,
) =>
  Effect.gen(function* () {
    if (ctx.scopeUnrestricted || resourceIds.length === 0) return;

    const allowlist = [...ctx.scopeTagIds];
    const ids = [...new Set(resourceIds)];

    // One query proves the whole batch; a bulk delete must not cost one round
    // trip per selected row.
    const rows = yield* db
      .select({ resourceId: schema.scopeTagAssignment.resourceId })
      .from(schema.scopeTagAssignment)
      .where(
        and(
          eq(schema.scopeTagAssignment.organizationId, ctx.organization.id),
          eq(schema.scopeTagAssignment.resourceType, resourceType),
          inArray(schema.scopeTagAssignment.resourceId, ids),
          inArray(schema.scopeTagAssignment.tagId, [...allowlist]),
        ),
      );

    const allowed = new Set(rows.map((row: { resourceId: string }) => row.resourceId));
    const missing = ids.find((resourceId) => !allowed.has(resourceId));

    // Report the first out-of-scope id through the same path as a single
    // resource read, so the denial is audited once and the response does not
    // reveal how many of the other ids exist.
    if (missing) yield* assertResourceScope(ctx, db, resourceType, missing, message);
  });

/**
 * Attach the creator's own tags to a newly created resource.
 *
 * An untagged resource is tenant-wide and invisible to a scoped membership, so
 * without this a regional administrator would create a group and immediately
 * lose it. The default is the creator's allowed tags, never a wider set; when
 * the creator is unscoped the resource stays untagged (tenant-wide), matching
 * the behaviour before scope tags existed.
 */
export const tagNewResource = (
  ctx: ScopeContext,
  db: EnterpriseDb,
  resourceType: ScopeTagResourceType,
  resourceId: string,
) => {
  const tags = scopeAllowlist(ctx);

  if (!tags || tags.length === 0) return Effect.void;

  const createdAt = new Date();

  return db
    .insert(schema.scopeTagAssignment)
    .ignore()
    .values(
      tags.map((tagId) => ({
        organizationId: ctx.organization.id,
        resourceType,
        resourceId,
        tagId,
        createdAt,
      })),
    );
};

/**
 * Restrict an audit query to entries about resources the caller can reach.
 *
 * Audit rows name a polymorphic target, so each tagged kind contributes its own
 * id subquery and device-linked activity adds the device channel. Tenant,
 * member and credential events are not tagged resources and are therefore
 * hidden from scoped roles: they describe the tenant as a whole, not a region.
 */
export const auditScopeCondition = (db: EnterpriseDb, ctx: ScopeContext): SQL | undefined => {
  const allowlist = scopeAllowlist(ctx);

  if (!allowlist) return undefined;

  const resourceIds = (resourceType: ScopeTagResourceType) =>
    db
      .select({ id: schema.scopeTagAssignment.resourceId })
      .from(schema.scopeTagAssignment)
      .where(
        and(
          eq(schema.scopeTagAssignment.organizationId, ctx.organization.id),
          eq(schema.scopeTagAssignment.resourceType, resourceType),
          inArray(schema.scopeTagAssignment.tagId, [...allowlist]),
        ),
      );

  const { auditLog } = schema;

  return or(
    ...SCOPE_TAG_RESOURCE_TYPES.map((resourceType) =>
      inArray(auditLog.targetId, resourceIds(resourceType)),
    ),
    inArray(auditLog.deviceId, resourceIds("device")),
  );
};

/**
 * Remove every tag from resources that are being deleted.
 *
 * The assignment table has no foreign key to the six resource tables, so the
 * delete path owns the cleanup. A tenant teardown still cascades by
 * organisation; this keeps tag counts accurate in normal operation.
 */
export const deleteResourceTags = (
  db: EnterpriseDb,
  organizationId: string,
  resourceType: ScopeTagResourceType,
  resourceIds: ReadonlyArray<string>,
) => {
  if (resourceIds.length === 0) return Effect.void;

  return db
    .delete(schema.scopeTagAssignment)
    .where(
      and(
        eq(schema.scopeTagAssignment.organizationId, organizationId),
        eq(schema.scopeTagAssignment.resourceType, resourceType),
        inArray(schema.scopeTagAssignment.resourceId, [...resourceIds]),
      ),
    );
};

/** Copy the tags from a source resource to a duplicate inside the same tenant. */
export const copyResourceTags = (
  ctx: ScopeContext,
  db: EnterpriseDb,
  resourceType: ScopeTagResourceType,
  sourceId: string,
  targetId: string,
) =>
  Effect.gen(function* () {
    const rows = yield* db
      .select({ tagId: schema.scopeTagAssignment.tagId })
      .from(schema.scopeTagAssignment)
      .where(
        and(
          eq(schema.scopeTagAssignment.organizationId, ctx.organization.id),
          eq(schema.scopeTagAssignment.resourceType, resourceType),
          eq(schema.scopeTagAssignment.resourceId, sourceId),
        ),
      );

    if (rows.length === 0) return;

    const createdAt = new Date();

    yield* db
      .insert(schema.scopeTagAssignment)
      .ignore()
      .values(
        rows.map((row: { tagId: string }) => ({
          organizationId: ctx.organization.id,
          resourceType,
          resourceId: targetId,
          tagId: row.tagId,
          createdAt,
        })),
      );
  });

/**
 * Refuse to attach tags the actor cannot reach, and refuse unknown tag ids.
 *
 * A scoped administrator must not be able to hand a resource to another region
 * (that would move it out of their own view) or invent a tag id from another
 * tenant. Both checks run inside the tenant boundary.
 */
export const assertTagsAssignable = (
  ctx: ScopeContext,
  db: EnterpriseDb,
  tagIds: ReadonlyArray<string>,
) =>
  Effect.gen(function* () {
    if (tagIds.length === 0) return;

    const rows = yield* db
      .select({ id: schema.scopeTag.id })
      .from(schema.scopeTag)
      .where(
        and(
          eq(schema.scopeTag.organizationId, ctx.organization.id),
          inArray(schema.scopeTag.id, [...tagIds]),
        ),
      );

    const known = new Set(rows.map((row: { id: string }) => row.id));

    if (tagIds.some((tagId) => !known.has(tagId)))
      return yield* Effect.fail(
        new EnterprisePermissionDenied({
          message: "One or more scope tags do not exist in this tenant.",
          permission: "scope_tags.write",
          roleName: ctx.role.roleName,
          roleKind: ctx.role.roleKind,
        }),
      );

    const allowlist = scopeAllowlist(ctx);

    if (allowlist && tagIds.some((tagId) => !allowlist.includes(tagId)))
      return yield* Effect.fail(
        new EnterprisePermissionDenied({
          message: "You cannot assign a scope tag outside your own scope.",
          permission: "scope_tags.write",
          roleName: ctx.role.roleName,
          roleKind: ctx.role.roleKind,
        }),
      );
  });

/**
 * The write permission a tagged resource kind requires. Used by the shared
 * assignment endpoint, which carries the ambient `scope_tags.write` permission
 * but must still prove the caller can edit the objects it is tagging.
 */
export const scopeResourceReadPermission = {
  device: "devices.read",
  group: "groups.read",
  policy: "policies.read",
  application: "applications.read",
  script: "scripts.read",
  dashboard: "dashboards.read",
} as const;

export const scopeResourceWritePermission = {
  device: "devices.write",
  group: "groups.write",
  policy: "policies.write",
  application: "applications.write",
  script: "scripts.write",
  dashboard: "dashboards.write",
} as const;
