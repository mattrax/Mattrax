import { and, eq, inArray } from "drizzle-orm";
import { Context, DateTime, Effect, Layer, Option, Schema } from "effect";
import type { HttpServerRequest } from "effect/http";
import { HttpRouter, HttpServerResponse } from "effect/http";
import { Db, schema } from "@mattrax/enterprise-core";
import type { EnterpriseDb } from "@mattrax/enterprise-core";
import { syncDirectoryGroupsForTenant } from "@mattrax/mdm-apple";
import { catchCausePreservingInterrupts } from "./errorBoundary.js";

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
    catchCausePreservingInterrupts(() =>
      Effect.succeed({ valid: false as const, body: undefined }),
    ),
  );

const sha256 = (value: string) =>
  Effect.promise(async () => {
    const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));

    return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join(
      "",
    );
  });

const id = () => crypto.randomUUID().replaceAll("-", "").slice(0, 24);

const now = () => DateTime.now.pipe(Effect.map(DateTime.toDate));

const iso = (value: Date | null | undefined) =>
  (value instanceof Date ? value : new Date(value ?? 0)).toISOString();

type UserRow = typeof schema.user.$inferSelect;

type GroupRow = typeof schema.userGroup.$inferSelect;

type ScimDb = Pick<EnterpriseDb, "select" | "insert" | "update" | "delete" | "query">;

type ScimMutation<A> = {
  readonly response: A;
  readonly changedUserIds: ReadonlySet<string>;
  readonly changedDeviceIds: ReadonlySet<string>;
};

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
    const tokenHash = yield* sha256(match[1]);
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
    const timestamp = yield* now();

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
  try {
    const path = new URL(request.url, "http://localhost").pathname;
    const match = /^\/scim\/v2\/([^/]+)(?:\/(Users|Groups)(?:\/([^/]+))?)?$/.exec(path);

    if (!match) return { kind: "not_found" } as const;

    return {
      kind: "ok",
      tenantId: decodeURIComponent(match[1]),
      resource: match[2],
      id: match[3] === undefined ? undefined : decodeURIComponent(match[3]),
    } as const;
  } catch {
    return {
      kind: "invalid",
      response: scimError(400, "Malformed SCIM path", "invalidSyntax"),
    } as const;
  }
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

const mutation = <A>(
  response: A,
  changedUserIds: ReadonlySet<string> = new Set(),
  changedDeviceIds: ReadonlySet<string> = new Set(),
): ScimMutation<A> => ({ response, changedUserIds, changedDeviceIds });

const commitChanges = (ctx: ScimContext, result: ScimMutation<unknown>) =>
  Effect.sync(() => {
    for (const userId of result.changedUserIds) ctx.changedUserIds.add(userId);
    for (const deviceId of result.changedDeviceIds) ctx.changedDeviceIds.add(deviceId);
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

const findUser = (db: ScimDb, ctx: ScimContext, userId: string) =>
  db.query.user.findFirst({
    where: { id: userId, organizationId: ctx.organizationId },
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
      [body.name?.givenName, body.name?.familyName].filter(Boolean).join(" ").trim();

    const name = suppliedName || email;

    const result = yield* db.transaction((tx) =>
      Effect.gen(function* () {
        const timestamp = yield* now();

        // Reuse the tenant's existing row for this address (or provider object)
        // so a retried create cannot duplicate the directory person.
        let user = yield* tx.query.user.findFirst({
          where: { organizationId: ctx.organizationId, email },
        });

        if (!user && externalId)
          user = yield* tx.query.user.findFirst({
            where: { organizationId: ctx.organizationId, externalId },
          });

        if (user) {
          yield* tx
            .update(schema.user)
            .set({
              // Only overwrite what the IdP actually supplied.
              ...(suppliedName ? { name: suppliedName } : {}),
              ...(externalId ? { externalId } : {}),
              updatedAt: timestamp,
            })
            .where(eq(schema.user.id, user.id));

          const existing = yield* findUser(tx, ctx, user.id);

          return mutation(
            existing ? json(userResource(existing)) : scimError(500, "Could not resolve the user"),
          );
        }

        const userId = id();

        yield* tx.insert(schema.user).values({
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

        const created = yield* findUser(tx, ctx, userId);

        return mutation(
          created ? json(userResource(created), 201) : scimError(500, "Could not create the user"),
        );
      }),
    );

    return result.response;
  });

const patchUser = (ctx: ScimContext, userId: string, body: typeof ScimPatch.Type) =>
  Effect.gen(function* () {
    const db = yield* Db;

    const result = yield* db.transaction((tx) =>
      Effect.gen(function* () {
        const current = yield* findUser(tx, ctx, userId);

        if (!current) return mutation(scimError(404, "User not found"));

        const operations = Array.isArray(body.Operations) ? body.Operations : [];

        let name = current.name;
        let email = current.email;
        let disabled = current.disabled;

        // Validate every operation before the first write.
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

            const conflict = yield* tx.query.user.findFirst({
              where: { organizationId: ctx.organizationId, email: nextEmail },
            });

            if (conflict && conflict.id !== userId)
              return mutation(scimError(409, "userName is already in use", "uniqueness"));

            email = nextEmail;
          }
        }

        const timestamp = yield* now();
        const fieldsChanged =
          name !== current.name || email !== current.email || disabled !== current.disabled;
        const memberships = disabled
          ? yield* tx
              .select({ userId: schema.userGroupMember.userId })
              .from(schema.userGroupMember)
              .where(eq(schema.userGroupMember.userId, userId))
          : [];

        if (fieldsChanged)
          yield* tx
            .update(schema.user)
            .set({ name, email, disabled, updatedAt: timestamp })
            .where(
              and(eq(schema.user.id, userId), eq(schema.user.organizationId, ctx.organizationId)),
            );
        else if (memberships.length > 0)
          yield* tx
            .update(schema.user)
            .set({ updatedAt: timestamp })
            .where(
              and(eq(schema.user.id, userId), eq(schema.user.organizationId, ctx.organizationId)),
            );

        // A disabled directory person must not retain group-derived access.
        if (memberships.length > 0)
          yield* tx.delete(schema.userGroupMember).where(eq(schema.userGroupMember.userId, userId));

        const updated = yield* findUser(tx, ctx, userId);
        const changedUserIds = new Set<string>();

        if (fieldsChanged || memberships.length > 0) changedUserIds.add(userId);

        return mutation(
          updated ? json(userResource(updated)) : scimError(404, "User not found"),
          changedUserIds,
        );
      }),
    );

    yield* commitChanges(ctx, result);

    return result.response;
  });

const deleteUser = (ctx: ScimContext, userId: string) =>
  Effect.gen(function* () {
    const db = yield* Db;

    const result = yield* db.transaction((tx) =>
      Effect.gen(function* () {
        const current = yield* findUser(tx, ctx, userId);

        if (!current) return mutation(scimError(404, "User not found"));

        // Capture linked devices before the cascade removes device_user.
        const linkedDevices = yield* tx
          .select({ deviceId: schema.deviceUser.deviceId })
          .from(schema.deviceUser)
          .where(
            and(
              eq(schema.deviceUser.organizationId, ctx.organizationId),
              eq(schema.deviceUser.userId, userId),
            ),
          );

        yield* tx
          .delete(schema.user)
          .where(
            and(eq(schema.user.id, userId), eq(schema.user.organizationId, ctx.organizationId)),
          );

        return mutation(
          HttpServerResponse.empty({ status: 204 }),
          new Set([userId]),
          new Set(linkedDevices.map((device) => device.deviceId)),
        );
      }),
    );

    yield* commitChanges(ctx, result);

    return result.response;
  });

/**
 * Directory members resolved from tenant-scoped user rows. Membership rows
 * themselves carry no organisation, so the user join is the isolation boundary.
 */
const groupMemberRows = (db: ScimDb, organizationId: string, groupIds?: ReadonlyArray<string>) =>
  Effect.gen(function* () {
    if (groupIds && groupIds.length === 0) return [];

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
      db,
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

const findGroup = (db: ScimDb, ctx: ScimContext, groupId: string) =>
  Effect.gen(function* () {
    const group = yield* db.query.userGroup.findFirst({
      where: { id: groupId, organizationId: ctx.organizationId },
    });

    if (!group) return null;

    const members = yield* groupMemberRows(db, ctx.organizationId, [groupId]);

    return { group, members };
  });

const validMemberIds = (
  db: ScimDb,
  organizationId: string,
  members: ReadonlyArray<{ value: string }>,
) =>
  Effect.gen(function* () {
    const ids = [...new Set(members.map((member) => member.value))];

    if (ids.length === 0) return [];

    const valid = yield* db
      .select({ userId: schema.user.id })
      .from(schema.user)
      .where(and(eq(schema.user.organizationId, organizationId), inArray(schema.user.id, ids)));

    const allowed = new Set(valid.map((row) => row.userId));

    return ids.filter((userId) => allowed.has(userId));
  });

const createGroup = (ctx: ScimContext, body: typeof ScimGroupPayload.Type) =>
  Effect.gen(function* () {
    const db = yield* Db;
    const name = String(body.displayName ?? "").trim();

    if (!name) return scimError(400, "displayName is required");

    const members = Array.isArray(body.members) ? body.members : [];
    const groupId = id();

    const result = yield* db.transaction((tx) =>
      Effect.gen(function* () {
        const timestamp = yield* now();
        const memberIds = yield* validMemberIds(tx, ctx.organizationId, members);

        yield* tx.insert(schema.userGroup).values({
          id: groupId,
          organizationId: ctx.organizationId,
          name,
          createdAt: timestamp,
          updatedAt: timestamp,
        });

        if (memberIds.length > 0)
          yield* tx
            .insert(schema.userGroupMember)
            .ignore()
            .values(memberIds.map((userId) => ({ groupId, userId })));

        const created = yield* findGroup(tx, ctx, groupId);

        return mutation(
          created
            ? json(groupResource(created.group, created.members), 201)
            : scimError(500, "Could not create group"),
          new Set(memberIds),
        );
      }),
    );

    yield* commitChanges(ctx, result);

    return result.response;
  });

const replaceGroupMembersIn = (
  db: ScimDb,
  ctx: ScimContext,
  groupId: string,
  members: ReadonlyArray<{ value: string }>,
) =>
  Effect.gen(function* () {
    const group = yield* db.query.userGroup.findFirst({
      where: { id: groupId, organizationId: ctx.organizationId },
    });

    if (!group) return mutation(scimError(404, "Group not found"));

    const previous = yield* db
      .select({ userId: schema.userGroupMember.userId })
      .from(schema.userGroupMember)
      .where(eq(schema.userGroupMember.groupId, groupId));
    const memberIds = yield* validMemberIds(db, ctx.organizationId, members);

    // All member validation happens before the old collection is removed.
    yield* db.delete(schema.userGroupMember).where(eq(schema.userGroupMember.groupId, groupId));

    if (memberIds.length > 0)
      yield* db
        .insert(schema.userGroupMember)
        .ignore()
        .values(memberIds.map((userId) => ({ groupId, userId })));

    yield* db
      .update(schema.userGroup)
      .set({ updatedAt: yield* now() })
      .where(eq(schema.userGroup.id, groupId));

    const updated = yield* findGroup(db, ctx, groupId);

    return mutation(
      updated
        ? json(groupResource(updated.group, updated.members))
        : scimError(404, "Group not found"),
      new Set([...previous.map((row) => row.userId), ...memberIds]),
    );
  });

type DecodedGroupMembershipOperation = {
  readonly op: "add" | "remove" | "replace";
  readonly refs: ReadonlyArray<{ value: string }>;
};

const applyGroupMembershipOperationIn = (
  db: ScimDb,
  ctx: ScimContext,
  groupId: string,
  operation: DecodedGroupMembershipOperation,
) =>
  Effect.gen(function* () {
    if (operation.op === "replace")
      return yield* replaceGroupMembersIn(db, ctx, groupId, operation.refs);

    const group = yield* db.query.userGroup.findFirst({
      where: { id: groupId, organizationId: ctx.organizationId },
    });

    if (!group) return mutation(scimError(404, "Group not found"));

    const ids =
      operation.op === "remove"
        ? [...new Set(operation.refs.map((member) => member.value))]
        : yield* validMemberIds(db, ctx.organizationId, operation.refs);
    const changedUserIds = new Set<string>();

    if (operation.op === "add") {
      if (ids.length > 0) {
        yield* db
          .insert(schema.userGroupMember)
          .ignore()
          .values(ids.map((userId) => ({ groupId, userId })));

        for (const userId of ids) changedUserIds.add(userId);
      }
    } else if (ids.length > 0) {
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

        for (const row of removed) changedUserIds.add(row.userId);
      }
    }

    yield* db
      .update(schema.userGroup)
      .set({ updatedAt: yield* now() })
      .where(eq(schema.userGroup.id, groupId));

    const updated = yield* findGroup(db, ctx, groupId);

    return mutation(
      updated
        ? json(groupResource(updated.group, updated.members))
        : scimError(404, "Group not found"),
      changedUserIds,
    );
  });

const patchGroup = (ctx: ScimContext, groupId: string, body: typeof ScimPatch.Type) =>
  Effect.gen(function* () {
    const db = yield* Db;
    const operations = Array.isArray(body.Operations) ? body.Operations : [];
    const decoded: Array<DecodedGroupMembershipOperation> = [];

    // Decode every operation before opening the write transaction.
    for (const operation of operations) {
      const op = operation.op?.trim().toLowerCase() ?? "replace";

      if (op !== "add" && op !== "remove" && op !== "replace")
        return scimError(
          400,
          `Unsupported group patch operation "${operation.op}"`,
          "invalidValue",
        );

      const refs = Option.getOrUndefined(
        Schema.decodeUnknownOption(Schema.Array(ScimGroupMemberRef))(operation.value),
      );

      if (!refs) return scimError(400, "A members operation needs an array value", "invalidValue");

      decoded.push({ op, refs });
    }

    const result = yield* db.transaction((tx) =>
      Effect.gen(function* () {
        const group = yield* tx.query.userGroup.findFirst({
          where: { id: groupId, organizationId: ctx.organizationId },
        });

        if (!group) return mutation(scimError(404, "Group not found"));

        const changedUserIds = new Set<string>();

        for (const operation of decoded) {
          const applied = yield* applyGroupMembershipOperationIn(tx, ctx, groupId, operation);

          for (const userId of applied.changedUserIds) changedUserIds.add(userId);
        }

        const updated = yield* findGroup(tx, ctx, groupId);

        return mutation(
          updated
            ? json(groupResource(updated.group, updated.members))
            : scimError(404, "Group not found"),
          changedUserIds,
        );
      }),
    );

    yield* commitChanges(ctx, result);

    return result.response;
  });

const deleteGroup = (ctx: ScimContext, groupId: string) =>
  Effect.gen(function* () {
    const db = yield* Db;

    const result = yield* db.transaction((tx) =>
      Effect.gen(function* () {
        const group = yield* tx.query.userGroup.findFirst({
          where: { id: groupId, organizationId: ctx.organizationId },
        });

        if (!group) return mutation(HttpServerResponse.empty({ status: 204 }));

        const members = yield* tx
          .select({ userId: schema.userGroupMember.userId })
          .from(schema.userGroupMember)
          .where(eq(schema.userGroupMember.groupId, groupId));

        yield* tx
          .delete(schema.userGroup)
          .where(
            and(
              eq(schema.userGroup.id, groupId),
              eq(schema.userGroup.organizationId, ctx.organizationId),
            ),
          );

        return mutation(
          HttpServerResponse.empty({ status: 204 }),
          new Set(members.map((row) => row.userId)),
        );
      }),
    );

    yield* commitChanges(ctx, result);

    return result.response;
  });

const handler = (request: HttpServerRequest.HttpServerRequest) =>
  Effect.gen(function* () {
    const parsed = parsePath(request);

    if (parsed.kind === "invalid") return parsed.response;
    if (parsed.kind === "not_found") return scimError(404, "Unknown SCIM endpoint");

    const ctx = yield* authenticate(request, parsed.tenantId).pipe(
      Effect.catch((error) =>
        // Authentication failures are pre-built SCIM responses; anything else
        // (such as a database outage) must reach the 500 handler instead of
        // being mistaken for a context object.
        HttpServerResponse.isHttpServerResponse(error) ? Effect.succeed(error) : Effect.fail(error),
      ),
    );

    if (HttpServerResponse.isHttpServerResponse(ctx)) return ctx;

    const db = yield* Db;
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
          const found = yield* findUser(db, ctx, parsed.id);

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
          const found = yield* findGroup(db, ctx, parsed.id);

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

          if (!patch) return scimError(400, "Invalid SCIM patch", "invalidValue");

          const operations = (patch.Operations ?? []).filter((operation) => {
            if (operation.path?.toLowerCase() === "members") return true;

            // Some IdPs omit `path` for a members update.
            if (operation.path !== undefined && operation.path !== null) return false;

            return Option.isSome(
              Schema.decodeUnknownOption(Schema.Array(ScimGroupMemberRef))(operation.value),
            );
          });

          return yield* patchGroup(ctx, parsed.id, { Operations: operations });
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
      yield* syncDirectoryGroupsForTenant(db, ctx.organizationId).pipe(
        Effect.catch((error) => Effect.logWarning("SCIM directory group refresh failed", error)),
      );

      const notifier = yield* Effect.serviceOption(ScimMembershipNotifier);

      if (Option.isSome(notifier)) {
        yield* notifier
          .value(db, ctx.organizationId, [...ctx.changedUserIds], [...ctx.changedDeviceIds])
          .pipe(
            Effect.catch((error) => Effect.logWarning("SCIM membership refresh failed", error)),
          );
      }
    }

    return response;
  }).pipe(
    catchCausePreservingInterrupts((cause) =>
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
