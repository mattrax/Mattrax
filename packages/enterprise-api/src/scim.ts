import { and, eq, inArray } from "drizzle-orm";
import { Context, Effect, Layer, Option, Schema } from "effect";
import { HttpRouter, HttpServerRequest, HttpServerResponse } from "effect/http";
import { Db, schema } from "@mattrax/enterprise-core";
import { syncDirectoryGroupsForTenant } from "@mattrax/mdm-apple";

const json = (body: Schema.Json, status = 200) => HttpServerResponse.jsonUnsafe(body, { status });

/**
 * Optional hook invoked after a SCIM mutation that changes a directory user or
 * its group membership. Delivery implementations push the linked devices so
 * policy converges without waiting for a poll.
 */
export type ScimMembershipNotifierHandler = (
  db: import("@mattrax/enterprise-core").EnterpriseDb,
  organizationId: string,
  userIds: ReadonlyArray<string>,
  /** Devices linked to a user that was deleted before the notifier ran. */
  deviceIds?: ReadonlyArray<string>,
) => Effect.Effect<void, unknown, never>;

export class ScimMembershipNotifier extends Context.Service<
  ScimMembershipNotifier,
  ScimMembershipNotifierHandler
>()("@mattrax/enterprise-backend/ScimMembershipNotifier") {}

type ScimErrorBody = {
  schemas: ReadonlyArray<string>;
  status: string;
  scimType?: string;
  detail: string;
};

const scimError = (status: number, detail: string, scimType?: string) => {
  const body: ScimErrorBody = {
    schemas: ["urn:ietf:params:scim:api:messages:2.0:Error"],
    status: String(status),
    detail,
  };

  if (scimType) body.scimType = scimType;

  return json(body, status);
};

/** Malformed JSON is a client error, not an internal failure. */
const readJson = (request: HttpServerRequest.HttpServerRequest) =>
  request.json.pipe(
    Effect.map((body) => ({ valid: true as const, body })),
    Effect.catchCause(() => Effect.succeed({ valid: false as const, body: undefined })),
  );

const sha256 = (value: string) =>
  Effect.promise(async () => {
    const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));

    return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join(
      "",
    );
  });

const id = () => crypto.randomUUID().replaceAll("-", "").slice(0, 24);

const now = () => new Date();

const iso = (value: Date | null | undefined) =>
  (value instanceof Date ? value : new Date(value ?? 0)).toISOString();

type UserRow = typeof schema.user.$inferSelect;

type GroupRow = typeof schema.userGroup.$inferSelect;

const ScimGroupMemberRef = Schema.Struct({ value: Schema.String });

const ScimPatchOperation = Schema.Struct({
  /** SCIM operation verb: `add`, `remove` or `replace`. */
  op: Schema.optional(Schema.String),
  path: Schema.optional(Schema.String),
  value: Schema.optional(Schema.Json),
});

const ScimPatch = Schema.Struct({
  Operations: Schema.optional(Schema.Array(ScimPatchOperation)),
});

const ScimUserName = Schema.Struct({
  formatted: Schema.optional(Schema.String),
  givenName: Schema.optional(Schema.String),
  familyName: Schema.optional(Schema.String),
});

/**
 * The subset of the SCIM 2.0 User resource this server provisions. Directory
 * users carry no roles, so a IdP-supplied `roles` array is ignored rather than
 * rejected; `externalId` is stored so a later sync can match the IdP object.
 */
const ScimUserPayload = Schema.Struct({
  externalId: Schema.optional(Schema.String),
  userName: Schema.optional(Schema.String),
  name: Schema.optional(ScimUserName),
});

const ScimGroupPayload = Schema.Struct({
  displayName: Schema.optional(Schema.String),
  members: Schema.optional(Schema.Array(ScimGroupMemberRef)),
});

type ScimContext = {
  readonly tenantId: string;
  readonly organizationId: string;
  /** Directory users whose state or group membership changed in this request. */
  readonly changedUserIds: Set<string>;
  /** Devices captured before a directory-user delete removed their links. */
  readonly changedDeviceIds: Set<string>;
};

const authenticate = (request: HttpServerRequest.HttpServerRequest, tenantId: string) =>
  Effect.gen(function* () {
    const header = request.headers["authorization"] ?? "";
    const match = /^Bearer\s+(.+)$/i.exec(Array.isArray(header) ? header[0]! : header);

    if (!match) return yield* Effect.fail(scimError(401, "Missing SCIM bearer token"));
    const tokenHash = yield* sha256(match[1]!);
    const db = yield* Db;

    const [token] = yield* db
      .select()
      .from(schema.scimToken)
      .where(
        and(
          eq(schema.scimToken.organizationId, tenantId),
          eq(schema.scimToken.tokenHash, tokenHash),
        ),
      )
      .limit(1);

    if (!token || token.revokedAt) return yield* Effect.fail(scimError(401, "Invalid SCIM token"));

    // An expired token is reported exactly like an unknown or revoked one so a
    // caller cannot distinguish "expired" from "wrong token".
    const timestamp = now();

    if (token.expiresAt && new Date(token.expiresAt).getTime() <= timestamp.getTime())
      return yield* Effect.fail(scimError(401, "Invalid SCIM token"));

    yield* db
      .update(schema.scimToken)
      .set({ lastUsedAt: timestamp, updatedAt: timestamp })
      .where(eq(schema.scimToken.id, token.id));

    return {
      tenantId,
      organizationId: token.organizationId,
      changedUserIds: new Set<string>(),
      changedDeviceIds: new Set<string>(),
    } satisfies ScimContext;
  });

const parsePath = (request: HttpServerRequest.HttpServerRequest) => {
  const path = new URL(request.url, "http://localhost").pathname;
  const match = /^\/scim\/v2\/([^/]+)(?:\/(Users|Groups)(?:\/([^/]+))?)?$/.exec(path);

  return match
    ? { tenantId: decodeURIComponent(match[1]!), resource: match[2], id: match[3] }
    : null;
};

/**
 * SCIM renders a tenant directory person. There is no role, membership or
 * credential here: directory users never sign in.
 */
const userResource = (user: UserRow) => ({
  schemas: ["urn:ietf:params:scim:schemas:core:2.0:User"],
  id: user.id,
  userName: user.email,
  ...(user.externalId ? { externalId: user.externalId } : {}),
  name: { formatted: user.name, givenName: user.name },
  emails: [{ value: user.email, primary: true }],
  active: !user.disabled,
  meta: {
    resourceType: "User",
    created: iso(user.createdAt),
    lastModified: iso(user.updatedAt),
  },
});

const groupResource = (
  group: GroupRow,
  members: ReadonlyArray<{ userId: string; email: string }>,
) => ({
  schemas: ["urn:ietf:params:scim:schemas:core:2.0:Group"],
  id: group.id,
  displayName: group.name,
  members: members.map((member) => ({
    value: member.userId,
    display: member.email,
    type: "User",
  })),
  meta: {
    resourceType: "Group",
    created: iso(group.createdAt),
    lastModified: iso(group.updatedAt),
  },
});

const listUsers = (ctx: ScimContext) =>
  Effect.gen(function* () {
    const db = yield* Db;

    const rows = yield* db
      .select()
      .from(schema.user)
      .where(eq(schema.user.organizationId, ctx.organizationId));

    return json({
      schemas: ["urn:ietf:params:scim:api:messages:2.0:ListResponse"],
      totalResults: rows.length,
      Resources: rows.map(userResource),
    });
  });

const findUser = (ctx: ScimContext, userId: string) =>
  Effect.gen(function* () {
    const db = yield* Db;

    const user = yield* db.query.user.findFirst({
      where: { id: userId, organizationId: ctx.organizationId },
    });

    return user ?? null;
  });

const createUser = (ctx: ScimContext, body: typeof ScimUserPayload.Type) =>
  Effect.gen(function* () {
    const db = yield* Db;

    const email = String(body.userName ?? "")
      .trim()
      .toLowerCase();

    if (!email.includes("@")) return scimError(400, "userName must be an email address");

    const externalId = body.externalId?.trim() || undefined;

    const suppliedName =
      body.name?.formatted?.trim() ||
      [body.name?.givenName, body.name?.familyName]
        .filter(Boolean)
        .join(" ")
        .trim();

    const name = suppliedName || email;

    const timestamp = now();

    // Reuse the tenant's existing row for this address (or provider object) so
    // a retried create cannot duplicate the directory person. Both lookups are
    // scoped to this organization; accounts are never consulted.
    let user = yield* db.query.user.findFirst({
      where: { organizationId: ctx.organizationId, email },
    });

    if (!user && externalId)
      user = yield* db.query.user.findFirst({
        where: { organizationId: ctx.organizationId, externalId },
      });

    if (user) {
      yield* db
        .update(schema.user)
        .set({
          // Only overwrite what the IdP actually supplied; a retry that omits
          // the name must not discard the value stored earlier.
          ...(suppliedName ? { name: suppliedName } : {}),
          ...(externalId ? { externalId } : {}),
          updatedAt: timestamp,
        })
        .where(eq(schema.user.id, user.id));

      const existing = yield* findUser(ctx, user.id);

      return existing
        ? json(userResource(existing))
        : scimError(500, "Could not resolve the user");
    }

    const userId = id();

    yield* db.insert(schema.user).values({
      id: userId,
      organizationId: ctx.organizationId,
      name,
      email,
      externalId: externalId ?? null,
      source: "scim",
      disabled: false,
      createdAt: timestamp,
      updatedAt: timestamp,
    });

    const created = yield* findUser(ctx, userId);

    return created ? json(userResource(created), 201) : scimError(500, "Could not create the user");
  });

const patchUser = (ctx: ScimContext, userId: string, body: typeof ScimPatch.Type) =>
  Effect.gen(function* () {
    const db = yield* Db;
    const current = yield* findUser(ctx, userId);

    if (!current) return scimError(404, "User not found");

    const operations = Array.isArray(body.Operations) ? body.Operations : [];

    let name = current.name;
    let email = current.email;
    let disabled = current.disabled;

    for (const operation of operations) {
      const path = String(operation.path ?? "").toLowerCase();
      const value = operation.value;

      if (path === "active") disabled = !value;

      if (path === "name.givenname" || path === "name.formatted" || path === "displayname") {
        const next = String(value ?? "").trim();

        if (next) name = next;
      }

      if (path === "username") {
        const nextEmail = String(value ?? "")
          .trim()
          .toLowerCase();

        if (!nextEmail.includes("@") || nextEmail === current.email) continue;

        // Directory addresses are unique per tenant, not deployment-wide. An
        // account elsewhere may share the address without owning this person.
        const conflict = yield* db.query.user.findFirst({
          where: { organizationId: ctx.organizationId, email: nextEmail },
        });

        if (conflict && conflict.id !== userId)
          return scimError(409, "userName is already in use", "uniqueness");

        email = nextEmail;
      }
    }

    const changed =
      name !== current.name || email !== current.email || disabled !== current.disabled;

    if (changed) {
      yield* db
        .update(schema.user)
        .set({ name, email, disabled, updatedAt: now() })
        .where(
          and(eq(schema.user.id, userId), eq(schema.user.organizationId, ctx.organizationId)),
        );

      // Match Entra removal semantics: a disabled directory person must not
      // stay in directory groups, where a later re-enable would silently
      // restore old group-derived policies.
      if (disabled)
        yield* db.delete(schema.userGroupMember).where(eq(schema.userGroupMember.userId, userId));

      ctx.changedUserIds.add(userId);
    }

    const updated = yield* findUser(ctx, userId);

    return updated ? json(userResource(updated)) : scimError(404, "User not found");
  });

const deleteUser = (ctx: ScimContext, userId: string) =>
  Effect.gen(function* () {
    const db = yield* Db;
    const current = yield* findUser(ctx, userId);

    if (!current) return scimError(404, "User not found");

    // Capture linked devices before the cascade removes `device_user`, so the
    // post-request notifier can still wake them. Removing the directory person
    // cascades group memberships, device links and direct policy assignments.
    // Dashboard accounts, memberships and invitations are a different identity
    // and are untouched.
    const linkedDevices = yield* db
      .select({ deviceId: schema.deviceUser.deviceId })
      .from(schema.deviceUser)
      .where(
        and(
          eq(schema.deviceUser.organizationId, ctx.organizationId),
          eq(schema.deviceUser.userId, userId),
        ),
      );

    for (const device of linkedDevices) ctx.changedDeviceIds.add(device.deviceId);

    yield* db
      .delete(schema.user)
      .where(and(eq(schema.user.id, userId), eq(schema.user.organizationId, ctx.organizationId)));
    ctx.changedUserIds.add(userId);

    return HttpServerResponse.empty({ status: 204 });
  });

/**
 * Directory members of one or more tenant groups, resolved from `user` rows.
 * Group membership rows carry no organisation, so the user join pins the
 * tenant: a stale link to another tenant's person can never be rendered.
 */
const groupMemberRows = (organizationId: string, groupIds?: ReadonlyArray<string>) =>
  Effect.gen(function* () {
    // An empty set means no groups, so do not ask the database for `in ()`.
    if (groupIds && groupIds.length === 0) return [];

    const db = yield* Db;

    const scope = groupIds
      ? and(
          eq(schema.user.organizationId, organizationId),
          inArray(schema.userGroupMember.groupId, [...groupIds]),
        )
      : eq(schema.user.organizationId, organizationId);

    return yield* db
      .select({
        groupId: schema.userGroupMember.groupId,
        userId: schema.user.id,
        email: schema.user.email,
      })
      .from(schema.userGroupMember)
      .innerJoin(schema.user, eq(schema.user.id, schema.userGroupMember.userId))
      .where(scope);
  });

const listGroups = (ctx: ScimContext) =>
  Effect.gen(function* () {
    const db = yield* Db;

    const groups = yield* db
      .select()
      .from(schema.userGroup)
      .where(eq(schema.userGroup.organizationId, ctx.organizationId));

    const members = yield* groupMemberRows(
      ctx.organizationId,
      groups.map((group) => group.id),
    );

    return json({
      schemas: ["urn:ietf:params:scim:api:messages:2.0:ListResponse"],
      totalResults: groups.length,
      Resources: groups.map((group) =>
        groupResource(
          group,
          members.filter((member) => member.groupId === group.id),
        ),
      ),
    });
  });

const findGroup = (ctx: ScimContext, groupId: string) =>
  Effect.gen(function* () {
    const db = yield* Db;

    const group = yield* db.query.userGroup.findFirst({
      where: { id: groupId, organizationId: ctx.organizationId },
    });

    if (!group) return null;

    const members = yield* groupMemberRows(ctx.organizationId, [groupId]);

    return { group, members };
  });

const createGroup = (ctx: ScimContext, body: typeof ScimGroupPayload.Type) =>
  Effect.gen(function* () {
    const db = yield* Db;
    const name = String(body.displayName ?? "").trim();

    if (!name) return scimError(400, "displayName is required");
    const groupId = id();
    const timestamp = now();
    yield* db.insert(schema.userGroup).values({
      id: groupId,
      organizationId: ctx.organizationId,
      name,
      createdAt: timestamp,
      updatedAt: timestamp,
    });
    const members = Array.isArray(body.members) ? body.members : [];

    if (members.length > 0) yield* replaceGroupMembers(ctx, groupId, members);
    const created = yield* findGroup(ctx, groupId);

    return created
      ? json(groupResource(created.group, created.members), 201)
      : scimError(500, "Could not create group");
  });

const replaceGroupMembers = (
  ctx: ScimContext,
  groupId: string,
  members: ReadonlyArray<{ value: string }>,
) =>
  Effect.gen(function* () {
    const db = yield* Db;

    // Resolve the group inside this tenant before touching membership: the
    // group id is caller-supplied, and membership rows carry no organisation.
    const group = yield* db.query.userGroup.findFirst({
      where: { id: groupId, organizationId: ctx.organizationId },
    });

    if (!group) return scimError(404, "Group not found");

    const previous = yield* db
      .select({ userId: schema.userGroupMember.userId })
      .from(schema.userGroupMember)
      .where(eq(schema.userGroupMember.groupId, groupId));

    for (const row of previous) ctx.changedUserIds.add(row.userId);
    yield* db.delete(schema.userGroupMember).where(eq(schema.userGroupMember.groupId, groupId));
    const ids = [...new Set(members.map((member) => member.value))];

    if (ids.length > 0) {
      const valid = yield* db
        .select({ userId: schema.user.id })
        .from(schema.user)
        .where(
          and(
            eq(schema.user.organizationId, ctx.organizationId),
            inArray(schema.user.id, ids),
          ),
        );

      const allowed = new Set(valid.map((row) => row.userId));
      const rows = ids.filter((userId) => allowed.has(userId));

      if (rows.length > 0) {
        yield* db
          .insert(schema.userGroupMember)
          .ignore()
          .values(rows.map((userId) => ({ groupId, userId })));

        for (const userId of rows) ctx.changedUserIds.add(userId);
      }
    }

    yield* db
      .update(schema.userGroup)
      .set({ updatedAt: now() })
      .where(eq(schema.userGroup.id, groupId));
    const updated = yield* findGroup(ctx, groupId);

    return updated
      ? json(groupResource(updated.group, updated.members))
      : scimError(404, "Group not found");
  });

/**
 * Apply one SCIM group membership operation.
 *
 * `add` and `remove` touch only the listed users; `replace` is the only verb
 * that rewrites the whole collection. Treating every operation as a replace is
 * what previously made a standard IdP `add` drop the rest of the group.
 */
const applyGroupMembershipOperation = (
  ctx: ScimContext,
  groupId: string,
  operation: { readonly op?: string; readonly value?: Schema.Json },
) =>
  Effect.gen(function* () {
    const db = yield* Db;
    const op = operation.op?.trim().toLowerCase() ?? "replace";

    const refs = Option.getOrUndefined(
      Schema.decodeUnknownOption(Schema.Array(ScimGroupMemberRef))(operation.value),
    );

    if (!refs) return scimError(400, "A members operation needs an array value", "invalidValue");

    if (op === "replace") return yield* replaceGroupMembers(ctx, groupId, refs);

    if (op !== "add" && op !== "remove")
      return scimError(400, `Unsupported group patch operation "${operation.op}"`, "invalidValue");

    // Resolve the group inside this tenant before touching membership.
    const group = yield* db.query.userGroup.findFirst({
      where: { id: groupId, organizationId: ctx.organizationId },
    });

    if (!group) return scimError(404, "Group not found");

    const ids = [...new Set(refs.map((member) => member.value))];

    if (ids.length === 0) {
      const unchanged = yield* findGroup(ctx, groupId);

      return unchanged
        ? json(groupResource(unchanged.group, unchanged.members))
        : scimError(404, "Group not found");
    }

    if (op === "add") {
      const valid = yield* db
        .select({ userId: schema.user.id })
        .from(schema.user)
        .where(
          and(eq(schema.user.organizationId, ctx.organizationId), inArray(schema.user.id, ids)),
        );

      const allowed = new Set(valid.map((row) => row.userId));
      const rows = ids.filter((userId) => allowed.has(userId));

      if (rows.length > 0) {
        yield* db
          .insert(schema.userGroupMember)
          .ignore()
          .values(rows.map((userId) => ({ groupId, userId })));

        for (const userId of rows) ctx.changedUserIds.add(userId);
      }
    } else {
      const removed = yield* db
        .select({ userId: schema.userGroupMember.userId })
        .from(schema.userGroupMember)
        .where(
          and(
            eq(schema.userGroupMember.groupId, groupId),
            inArray(schema.userGroupMember.userId, ids),
          ),
        );

      if (removed.length > 0) {
        yield* db.delete(schema.userGroupMember).where(
          and(
            eq(schema.userGroupMember.groupId, groupId),
            inArray(
              schema.userGroupMember.userId,
              removed.map((row) => row.userId),
            ),
          ),
        );

        for (const row of removed) ctx.changedUserIds.add(row.userId);
      }
    }

    yield* db
      .update(schema.userGroup)
      .set({ updatedAt: now() })
      .where(eq(schema.userGroup.id, groupId));

    const updated = yield* findGroup(ctx, groupId);

    return updated
      ? json(groupResource(updated.group, updated.members))
      : scimError(404, "Group not found");
  });

const deleteGroup = (ctx: ScimContext, groupId: string) =>
  Effect.gen(function* () {
    const db = yield* Db;

    const members = yield* db
      .select({ userId: schema.userGroupMember.userId })
      .from(schema.userGroupMember)
      .where(eq(schema.userGroupMember.groupId, groupId));

    for (const row of members) ctx.changedUserIds.add(row.userId);
    yield* db
      .delete(schema.userGroup)
      .where(
        and(
          eq(schema.userGroup.id, groupId),
          eq(schema.userGroup.organizationId, ctx.organizationId),
        ),
      );

    return HttpServerResponse.empty({ status: 204 });
  });

const handler = (request: HttpServerRequest.HttpServerRequest) =>
  Effect.gen(function* () {
    const parsed = parsePath(request);

    if (!parsed) return scimError(404, "Unknown SCIM endpoint");

    const ctx = yield* authenticate(request, parsed.tenantId).pipe(
      Effect.catch((error) =>
        // Authentication failures are pre-built SCIM responses; anything else
        // (such as a database outage) must reach the 500 handler instead of
        // being mistaken for a context object.
        HttpServerResponse.isHttpServerResponse(error) ? Effect.succeed(error) : Effect.fail(error),
      ),
    );

    if (HttpServerResponse.isHttpServerResponse(ctx)) return ctx;

    const response = yield* Effect.gen(function* () {
      if (!parsed.resource) {
        return json({
          schemas: ["urn:ietf:params:scim:schemas:core:2.0:ServiceProviderConfig"],
          patch: { supported: true },
          bulk: { supported: false, maxOperations: 0, maxPayloadSize: 0 },
          filter: { supported: false, maxResults: 200 },
          changePassword: { supported: false },
          sort: { supported: false },
          etag: { supported: false },
          authenticationSchemes: [
            { type: "oauthbearertoken", name: "Bearer token", primary: true },
          ],
        });
      }

      const method = request.method;

      if (parsed.resource === "Users" && !parsed.id) {
        if (method === "GET") return yield* listUsers(ctx);

        if (method === "POST") {
          const body = yield* readJson(request);

          if (!body.valid)
            return scimError(400, "Request body must be valid JSON", "invalidSyntax");

          const payload = Option.getOrUndefined(
            Schema.decodeUnknownOption(ScimUserPayload)(body.body),
          );

          if (!payload) return scimError(400, "Invalid SCIM user payload", "invalidValue");

          return yield* createUser(ctx, payload);
        }

        return scimError(405, "Method not allowed");
      }

      if (parsed.resource === "Users" && parsed.id) {
        if (method === "GET") {
          const found = yield* findUser(ctx, parsed.id);

          return found ? json(userResource(found)) : scimError(404, "User not found");
        }

        if (method === "PATCH") {
          const body = yield* readJson(request);

          if (!body.valid)
            return scimError(400, "Request body must be valid JSON", "invalidSyntax");

          const payload = Option.getOrUndefined(Schema.decodeUnknownOption(ScimPatch)(body.body));

          if (!payload) return scimError(400, "Invalid SCIM patch", "invalidValue");

          return yield* patchUser(ctx, parsed.id, payload);
        }

        if (method === "DELETE") return yield* deleteUser(ctx, parsed.id);

        return scimError(405, "Method not allowed");
      }

      if (parsed.resource === "Groups" && !parsed.id) {
        if (method === "GET") return yield* listGroups(ctx);

        if (method === "POST") {
          const body = yield* readJson(request);

          if (!body.valid)
            return scimError(400, "Request body must be valid JSON", "invalidSyntax");

          const payload = Option.getOrUndefined(
            Schema.decodeUnknownOption(ScimGroupPayload)(body.body),
          );

          if (!payload) return scimError(400, "Invalid SCIM group payload", "invalidValue");

          return yield* createGroup(ctx, payload);
        }

        return scimError(405, "Method not allowed");
      }

      if (parsed.resource === "Groups" && parsed.id) {
        if (method === "GET") {
          const found = yield* findGroup(ctx, parsed.id);

          return found
            ? json(groupResource(found.group, found.members))
            : scimError(404, "Group not found");
        }

        if (method === "PATCH") {
          const parsedBody = yield* readJson(request);

          if (!parsedBody.valid)
            return scimError(400, "Request body must be valid JSON", "invalidSyntax");

          const patch = Option.getOrUndefined(
            Schema.decodeUnknownOption(ScimPatch)(parsedBody.body),
          );

          const operations = (patch?.Operations ?? []).filter((operation) => {
            if (operation.path?.toLowerCase() === "members") return true;

            // Some IdPs omit `path` for a members update. Only treat a value
            // that actually decodes as a membership list that way, so an
            // unrelated valueless operation is not rejected.
            if (operation.path !== undefined && operation.path !== null) return false;

            return Option.isSome(
              Schema.decodeUnknownOption(Schema.Array(ScimGroupMemberRef))(operation.value),
            );
          });

          for (const operation of operations) {
            const result = yield* applyGroupMembershipOperation(ctx, parsed.id, operation);

            // Apply every operation, then answer with the final state.
            if (result instanceof Response && result.status >= 400) return result;
          }

          const found = yield* findGroup(ctx, parsed.id);

          if (!found) return scimError(404, "Group not found");

          return json(groupResource(found.group, found.members));
        }

        if (method === "DELETE") return yield* deleteGroup(ctx, parsed.id);

        return scimError(405, "Method not allowed");
      }

      return scimError(404, "Unknown SCIM endpoint");
    });

    if (ctx.changedUserIds.size > 0) {
      // Directory membership drives linked device groups. Re-materialise before
      // waking devices so group-targeted policies are already correct when they
      // check in; a failure is logged rather than failing the IdP's request.
      const db = yield* Db;

      yield* syncDirectoryGroupsForTenant(db, ctx.organizationId).pipe(
        Effect.catch((cause) =>
          Effect.logWarning("SCIM directory group refresh failed", cause),
        ),
      );

      const notifier = yield* Effect.serviceOption(ScimMembershipNotifier);

      if (Option.isSome(notifier)) {
        yield* notifier
          .value(db, ctx.organizationId, [...ctx.changedUserIds], [...ctx.changedDeviceIds])
          .pipe(
            Effect.catch((cause) => Effect.logWarning("SCIM membership refresh failed", cause)),
          );
      }
    }

    return response;
  }).pipe(
    Effect.catchCause((cause) =>
      Effect.logError("SCIM request failed", cause).pipe(
        Effect.as(scimError(500, "SCIM request failed")),
      ),
    ),
  );

/**
 * Exported for boundary tests, which drive the route with an injected `Db`
 * instead of standing up the HTTP router.
 */
export const scimHandler = handler;

export const scimRoutes = Layer.mergeAll(
  HttpRouter.add("GET", "/scim/v2/:tenantId", handler),
  HttpRouter.add("GET", "/scim/v2/:tenantId/Users", handler),
  HttpRouter.add("POST", "/scim/v2/:tenantId/Users", handler),
  HttpRouter.add("GET", "/scim/v2/:tenantId/Users/:id", handler),
  HttpRouter.add("PATCH", "/scim/v2/:tenantId/Users/:id", handler),
  HttpRouter.add("DELETE", "/scim/v2/:tenantId/Users/:id", handler),
  HttpRouter.add("GET", "/scim/v2/:tenantId/Groups", handler),
  HttpRouter.add("POST", "/scim/v2/:tenantId/Groups", handler),
  HttpRouter.add("GET", "/scim/v2/:tenantId/Groups/:id", handler),
  HttpRouter.add("PATCH", "/scim/v2/:tenantId/Groups/:id", handler),
  HttpRouter.add("DELETE", "/scim/v2/:tenantId/Groups/:id", handler),
);
