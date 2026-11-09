import { and, eq } from "drizzle-orm";
import { Effect, Layer } from "effect";
import { HttpRouter, HttpServerRequest, HttpServerResponse } from "effect/http";
import { Db, schema } from "@mattrax/enterprise-core";

const json = (body: unknown, status = 200) => HttpServerResponse.jsonUnsafe(body, { status });

const scimError = (status: number, detail: string) =>
  json(
    {
      schemas: ["urn:ietf:params:scim:api:messages:2.0:Error"],
      status: String(status),
      detail,
    },
    status,
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

type ScimContext = {
  readonly tenantId: string;
  readonly organizationId: string;
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
    yield* db
      .update(schema.scimToken)
      .set({ lastUsedAt: now(), updatedAt: now() })
      .where(eq(schema.scimToken.id, token.id));
    return { tenantId, organizationId: token.organizationId } satisfies ScimContext;
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
    const role = ["owner", "admin", "member"].includes(body.roles?.[0]?.value)
      ? body.roles[0].value
      : "member";
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
    yield* db
      .update(schema.user)
      .set({ name, disabled: !active, updatedAt: now() })
      .where(eq(schema.user.id, userId));
    const updated = yield* findUser(ctx, userId);
    return updated
      ? json(userResource(updated.user, updated.member))
      : scimError(404, "User not found");
  });

const deleteUser = (ctx: ScimContext, userId: string) =>
  Effect.gen(function* () {
    const current = yield* findUser(ctx, userId);
    if (!current) return scimError(404, "User not found");
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
      ? json(groupResource(created.group, created.members as any), 201)
      : scimError(500, "Could not create group");
  });

const replaceGroupMembers = (
  ctx: ScimContext,
  groupId: string,
  members: Array<{ value: string }>,
) =>
  Effect.gen(function* () {
    const db = yield* Db;
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
      if (rows.length > 0)
        yield* db
          .insert(schema.userGroupMember)
          .ignore()
          .values(rows.map((userId) => ({ groupId, userId })));
    }
    yield* db
      .update(schema.userGroup)
      .set({ updatedAt: now() })
      .where(eq(schema.userGroup.id, groupId));
    const updated = yield* findGroup(ctx, groupId);
    return updated
      ? json(groupResource(updated.group, updated.members as any))
      : scimError(404, "Group not found");
  });

const deleteGroup = (ctx: ScimContext, groupId: string) =>
  Effect.gen(function* () {
    const db = yield* Db;
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
      Effect.catch((response) => Effect.succeed(response as any)),
    );
    if (HttpServerResponse.isHttpServerResponse(ctx)) return ctx;

    if (!parsed.resource) {
      return json({
        schemas: ["urn:ietf:params:scim:schemas:core:2.0:ServiceProviderConfig"],
        patch: { supported: true },
        bulk: { supported: false, maxOperations: 0, maxPayloadSize: 0 },
        filter: { supported: false, maxResults: 200 },
        changePassword: { supported: false },
        sort: { supported: false },
        etag: { supported: false },
        authenticationSchemes: [{ type: "oauthbearertoken", name: "Bearer token", primary: true }],
      });
    }

    const method = request.method;
    if (parsed.resource === "Users" && !parsed.id) {
      if (method === "GET") return yield* listUsers(ctx);
      if (method === "POST") return yield* createUser(ctx, yield* request.json);
      return scimError(405, "Method not allowed");
    }
    if (parsed.resource === "Users" && parsed.id) {
      if (method === "GET") {
        const found = yield* findUser(ctx, parsed.id);
        return found
          ? json(userResource(found.user, found.member))
          : scimError(404, "User not found");
      }
      if (method === "PATCH") return yield* patchUser(ctx, parsed.id, yield* request.json);
      if (method === "DELETE") return yield* deleteUser(ctx, parsed.id);
      return scimError(405, "Method not allowed");
    }
    if (parsed.resource === "Groups" && !parsed.id) {
      if (method === "GET") return yield* listGroups(ctx);
      if (method === "POST") return yield* createGroup(ctx, yield* request.json);
      return scimError(405, "Method not allowed");
    }
    if (parsed.resource === "Groups" && parsed.id) {
      if (method === "GET") {
        const found = yield* findGroup(ctx, parsed.id);
        return found
          ? json(groupResource(found.group, found.members as any))
          : scimError(404, "Group not found");
      }
      if (method === "PATCH") {
        const body = (yield* request.json) as any;
        const members = body.Operations?.find((op: any) => op.path === "members")?.value;
        if (Array.isArray(members)) return yield* replaceGroupMembers(ctx, parsed.id, members);
        return json(groupResource((yield* findGroup(ctx, parsed.id))!.group, []));
      }
      if (method === "DELETE") return yield* deleteGroup(ctx, parsed.id);
      return scimError(405, "Method not allowed");
    }
    return scimError(404, "Unknown SCIM endpoint");
  }).pipe(
    Effect.catchCause((cause) =>
      Effect.succeed(scimError(500, "SCIM request failed")).pipe(
        Effect.tap(() => Effect.logError(cause)),
      ),
    ),
  );

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
