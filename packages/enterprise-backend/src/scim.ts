import { and, eq } from "drizzle-orm";
import { Context, Effect, Layer, Option, Schema } from "effect";
import { HttpRouter, HttpServerRequest, HttpServerResponse } from "effect/http";
import { Db, schema } from "@mattrax/enterprise-core";
import { isBuiltInOwnerMember } from "./rbac.ts";
import { settlePendingInvitations } from "./invitations.ts";

const json = (body: Schema.Json, status = 200) => HttpServerResponse.jsonUnsafe(body, { status });

/**
 * Optional hook invoked after a SCIM mutation that changes which users belong
 * to the tenant or its directory groups. Delivery implementations push the
 * linked devices so policy converges without waiting for a poll.
 */
export type ScimMembershipNotifierHandler = (
  db: import("@mattrax/enterprise-core").EnterpriseDb,
  organizationId: string,
  userIds: ReadonlyArray<string>,
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

const ScimGroupMemberRef = Schema.Struct({ value: Schema.String });

const ScimGroupPatch = Schema.Struct({
  Operations: Schema.optional(
    Schema.Array(
      Schema.Struct({
        path: Schema.optional(Schema.String),
        value: Schema.optional(Schema.Json),
      }),
    ),
  ),
});

type ScimContext = {
  readonly tenantId: string;
  readonly organizationId: string;
  /** Users whose tenant membership or group membership changed in this request. */
  readonly changedUserIds: Set<string>;
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
    } satisfies ScimContext;
  });

const parsePath = (request: HttpServerRequest.HttpServerRequest) => {
  const path = new URL(request.url, "http://localhost").pathname;
  const match = /^\/scim\/v2\/([^/]+)(?:\/(Users|Groups)(?:\/([^/]+))?)?$/.exec(path);

  return match
    ? { tenantId: decodeURIComponent(match[1]!), resource: match[2], id: match[3] }
    : null;
};

const userResource = (user: any, member: any) => ({
  schemas: ["urn:ietf:params:scim:schemas:core:2.0:User"],
  id: user.id,
  userName: user.email,
  name: { formatted: user.name, givenName: user.name },
  emails: [{ value: user.email, primary: true }],
  active: !user.disabled,
  roles: [{ value: member.role }],
  meta: {
    resourceType: "User",
    created: iso(member.createdAt),
    lastModified: iso(user.updatedAt),
  },
});

const groupResource = (group: any, members: Array<{ userId: string; email: string }>) => ({
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
      .select({
        member: schema.member,
        user: schema.user,
      })
      .from(schema.member)
      .innerJoin(schema.user, eq(schema.user.id, schema.member.userId))
      .where(eq(schema.member.organizationId, ctx.organizationId));

    return json({
      schemas: ["urn:ietf:params:scim:api:messages:2.0:ListResponse"],
      totalResults: rows.length,
      Resources: rows.map((row: any) => userResource(row.user, row.member)),
    });
  });

const findUser = (ctx: ScimContext, userId: string) =>
  Effect.gen(function* () {
    const db = yield* Db;

    const [row] = yield* db
      .select({ member: schema.member, user: schema.user })
      .from(schema.member)
      .innerJoin(schema.user, eq(schema.user.id, schema.member.userId))
      .where(
        and(eq(schema.member.organizationId, ctx.organizationId), eq(schema.member.userId, userId)),
      )
      .limit(1);

    return row ?? null;
  });

const ownerCount = (ctx: ScimContext) =>
  Effect.gen(function* () {
    const db = yield* Db;

    const rows = yield* db
      .select({
        id: schema.member.id,
        role: schema.member.role,
        customRoleId: schema.member.customRoleId,
      })
      .from(schema.member)
      .where(eq(schema.member.organizationId, ctx.organizationId));

    return rows.filter((row: { role: string; customRoleId?: string | null }) =>
      isBuiltInOwnerMember(row),
    ).length;
  });

/**
 * SCIM tokens carry no actor or creator context, so provisioning is pinned to
 * the least-privileged built-in role. Owners and administrators must use the
 * dashboard/API to grant anything above `member`.
 */
const scimMemberRole = "member";

/** Role labels IdPs commonly emit for an ordinary employee account. */
const SCIM_NON_PRIVILEGED_ROLES = new Set([
  "member",
  "user",
  "employee",
  "staff",
  "contractor",
  "guest",
  "everyone",
  "basic",
  "default",
]);

const SCIM_PRIVILEGED_ROLES = new Set(["owner", "admin", "administrator", "global admin"]);

const ScimRole = Schema.Struct({ value: Schema.optional(Schema.String) });

const createUser = (ctx: ScimContext, body: any) =>
  Effect.gen(function* () {
    const db = yield* Db;

    const email = String(body.userName ?? "")
      .trim()
      .toLowerCase();

    if (!email.includes("@")) return scimError(400, "userName must be an email address");

    const name =
      body.name?.formatted ??
      [body.name?.givenName, body.name?.familyName].filter(Boolean).join(" ") ??
      email;

    const requestedRole =
      Option.getOrUndefined(Schema.decodeUnknownOption(ScimRole)(body.roles?.[0]))
        ?.value?.trim()
        .toLowerCase() ?? "";

    if (SCIM_PRIVILEGED_ROLES.has(requestedRole))
      return scimError(
        400,
        "SCIM can only provision members. Assign administrator or owner roles in Mattrax.",
        "invalidValue",
      );

    if (requestedRole && !SCIM_NON_PRIVILEGED_ROLES.has(requestedRole))
      return scimError(
        400,
        "SCIM can only provision members. Assign administrator or owner roles in Mattrax.",
        "invalidValue",
      );

    const role = scimMemberRole;

    const timestamp = now();
    let user = yield* db.query.user.findFirst({ where: { email } });

    if (!user) {
      const userId = id();
      yield* db.insert(schema.user).values({
        id: userId,
        name: name || email,
        email,
        emailVerified: true,
        image: null,
        stripeCustomerId: null,
        disabled: false,
        source: "scim",
        authRevision: id(),
        createdAt: timestamp,
        updatedAt: timestamp,
      });
      user = yield* db.query.user.findFirst({ where: { id: userId } });
    }

    if (!user) return scimError(500, "Could not create the user");

    const member = yield* db.query.member.findFirst({
      where: { organizationId: ctx.organizationId, userId: user.id },
    });

    if (!member) {
      yield* db.insert(schema.member).values({
        id: id(),
        organizationId: ctx.organizationId,
        userId: user.id,
        role,
        createdAt: timestamp,
        updatedAt: timestamp,
      });
    }

    // Directory provisioning settles a matching invitation; the provisioned
    // member keeps the least-privileged role assigned above.
    yield* settlePendingInvitations(db, ctx.organizationId, email, timestamp);

    const created = yield* findUser(ctx, user.id);

    return created
      ? json(userResource(created.user, created.member), 201)
      : scimError(500, "Could not create the membership");
  });

const patchUser = (ctx: ScimContext, userId: string, body: any) =>
  Effect.gen(function* () {
    const current = yield* findUser(ctx, userId);

    if (!current) return scimError(404, "User not found");
    const db = yield* Db;
    const operations = Array.isArray(body.Operations) ? body.Operations : [];
    let active = !current.user.disabled;
    let name = current.user.name;

    for (const operation of operations) {
      const path = String(operation.path ?? "").toLowerCase();
      const value = operation.value;

      if (path === "active") active = Boolean(value);

      if (path === "name.givenname" || path === "displayname") name = String(value ?? name);

      if (path === "username") {
        const email = String(value ?? "")
          .trim()
          .toLowerCase();

        if (email.includes("@"))
          yield* db
            .update(schema.user)
            .set({ email, updatedAt: now() })
            .where(eq(schema.user.id, userId));
      }
    }

    if (!active) {
      if (isBuiltInOwnerMember(current.member) && (yield* ownerCount(ctx)) <= 1)
        return scimError(409, "Cannot deactivate the last owner");
      ctx.changedUserIds.add(userId);
      yield* db
        .delete(schema.member)
        .where(
          and(
            eq(schema.member.organizationId, ctx.organizationId),
            eq(schema.member.userId, userId),
          ),
        );

      const remaining = yield* db
        .select({ id: schema.member.id })
        .from(schema.member)
        .where(eq(schema.member.userId, userId))
        .limit(1);

      yield* db
        .update(schema.user)
        .set({ name, disabled: remaining.length === 0, updatedAt: now() })
        .where(eq(schema.user.id, userId));
    } else {
      yield* db
        .update(schema.user)
        .set({ name, disabled: false, updatedAt: now() })
        .where(eq(schema.user.id, userId));
      ctx.changedUserIds.add(userId);
    }

    const updated = yield* findUser(ctx, userId);

    return updated
      ? json(userResource(updated.user, updated.member))
      : scimError(404, "User not found");
  });

const deleteUser = (ctx: ScimContext, userId: string) =>
  Effect.gen(function* () {
    const current = yield* findUser(ctx, userId);

    if (!current) return scimError(404, "User not found");

    if (isBuiltInOwnerMember(current.member) && (yield* ownerCount(ctx)) <= 1)
      return scimError(409, "Cannot remove the last owner");
    ctx.changedUserIds.add(userId);
    const db = yield* Db;
    yield* db
      .delete(schema.member)
      .where(
        and(eq(schema.member.organizationId, ctx.organizationId), eq(schema.member.userId, userId)),
      );

    const remaining = yield* db
      .select({ id: schema.member.id })
      .from(schema.member)
      .where(eq(schema.member.userId, userId))
      .limit(1);

    if (remaining.length === 0)
      yield* db
        .update(schema.user)
        .set({ disabled: true, updatedAt: now() })
        .where(eq(schema.user.id, userId));

    return HttpServerResponse.empty({ status: 204 });
  });

const listGroups = (ctx: ScimContext) =>
  Effect.gen(function* () {
    const db = yield* Db;

    const groups = yield* db
      .select()
      .from(schema.userGroup)
      .where(eq(schema.userGroup.organizationId, ctx.organizationId));

    return json({
      schemas: ["urn:ietf:params:scim:api:messages:2.0:ListResponse"],
      totalResults: groups.length,
      Resources: groups.map((group: any) => groupResource(group, [])),
    });
  });

const findGroup = (ctx: ScimContext, groupId: string) =>
  Effect.gen(function* () {
    const db = yield* Db;

    const group = yield* db.query.userGroup.findFirst({
      where: { id: groupId, organizationId: ctx.organizationId },
    });

    if (!group) return null;

    const rows = yield* db
      .select({ userId: schema.user.id, email: schema.user.email })
      .from(schema.userGroupMember)
      .innerJoin(schema.user, eq(schema.user.id, schema.userGroupMember.userId))
      .where(eq(schema.userGroupMember.groupId, groupId))
      .limit(1000);

    return { group, members: rows };
  });

const createGroup = (ctx: ScimContext, body: any) =>
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

    const previous = yield* db
      .select({ userId: schema.userGroupMember.userId })
      .from(schema.userGroupMember)
      .where(eq(schema.userGroupMember.groupId, groupId));

    for (const row of previous) ctx.changedUserIds.add(row.userId);
    yield* db.delete(schema.userGroupMember).where(eq(schema.userGroupMember.groupId, groupId));
    const ids = [...new Set(members.map((member) => member.value))];

    if (ids.length > 0) {
      const valid = yield* db
        .select({ userId: schema.member.userId })
        .from(schema.member)
        .where(eq(schema.member.organizationId, ctx.organizationId))
        .limit(1000);

      const allowed = new Set(valid.map((row: any) => row.userId));
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

          return yield* createUser(ctx, body.body);
        }

        return scimError(405, "Method not allowed");
      }

      if (parsed.resource === "Users" && parsed.id) {
        if (method === "GET") {
          const found = yield* findUser(ctx, parsed.id);

          return found
            ? json(userResource(found.user, found.member))
            : scimError(404, "User not found");
        }

        if (method === "PATCH") {
          const body = yield* readJson(request);

          if (!body.valid)
            return scimError(400, "Request body must be valid JSON", "invalidSyntax");

          return yield* patchUser(ctx, parsed.id, body.body);
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

          return yield* createGroup(ctx, body.body);
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
            Schema.decodeUnknownOption(ScimGroupPatch)(parsedBody.body),
          );

          const members = Option.getOrUndefined(
            Schema.decodeUnknownOption(Schema.Array(ScimGroupMemberRef))(
              patch?.Operations?.find((operation) => operation.path === "members")?.value,
            ),
          );

          if (members) return yield* replaceGroupMembers(ctx, parsed.id, members);

          const found = yield* findGroup(ctx, parsed.id);

          if (!found) return scimError(404, "Group not found");

          return json(groupResource(found.group, []));
        }

        if (method === "DELETE") return yield* deleteGroup(ctx, parsed.id);

        return scimError(405, "Method not allowed");
      }

      return scimError(404, "Unknown SCIM endpoint");
    });

    if (ctx.changedUserIds.size > 0) {
      const notifier = yield* Effect.serviceOption(ScimMembershipNotifier);

      if (Option.isSome(notifier)) {
        const db = yield* Db;
        yield* notifier
          .value(db, ctx.organizationId, [...ctx.changedUserIds])
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
