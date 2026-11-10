import { Effect } from "effect";
import { and, eq, inArray } from "drizzle-orm";
import type { AzureGraphService } from "@mattrax/azure-graph";
import { schema, type EnterpriseDb } from "./schema.ts";

const newId = () => crypto.randomUUID();
const now = () => new Date();

const normalizedDomain = (domain: string) => domain.trim().toLowerCase().replace(/\.$/, "");

/**
 * Pull verified domains and (optionally) users/groups from Microsoft Graph.
 * The sync is delta-based: the stored deltaLink is passed on the next run and
 * replaced with the fresh one. Removed/disabled users lose their tenant
 * membership; Graph-sourced groups are upserted by Entra object id.
 */
export const syncEntraDirectory = (options: {
  readonly db: EnterpriseDb;
  readonly graph: AzureGraphService;
  readonly organizationId: string;
  readonly azureTenantId: string;
  readonly autoProvision: boolean;
  readonly usersDeltaLink?: string | null;
  readonly groupsDeltaLink?: string | null;
  readonly syncUsersAndGroups?: boolean;
}) =>
  Effect.gen(function* () {
    const { db, graph, organizationId, azureTenantId, autoProvision } = options;
    const counts = { users: 0, groups: 0, domains: 0 };
    let usersDelta: string | undefined;
    let groupsDelta: string | undefined;

    const graphDomains = yield* graph.domains(azureTenantId);
    const verified = graphDomains
      .map((domain) => ({ ...domain, id: normalizedDomain(domain.id) }))
      .filter(
        (domain) =>
          domain.isVerified &&
          !domain.isInitial &&
          domain.id.length > 0 &&
          !domain.id.endsWith(".onmicrosoft.com"),
      );
    for (const domain of verified) {
      const existing = yield* db.query.ssoDomain.findFirst({
        where: { domain: domain.id },
      });
      if (existing && existing.organizationId !== organizationId) {
        // Never reassign a verified domain between tenants. The first owner
        // keeps it; a conflicting sync is skipped.
        continue;
      }
      if (existing) {
        yield* db
          .update(schema.ssoDomain)
          .set({
            organizationId,
            source: "entra",
            isVerified: true,
            verifiedAt: existing.verifiedAt ?? now(),
            updatedAt: now(),
          })
          .where(eq(schema.ssoDomain.domain, domain.id));
      } else {
        yield* db.insert(schema.ssoDomain).values({
          domain: domain.id,
          organizationId,
          source: "entra",
          isVerified: true,
          verifiedAt: now(),
          createdAt: now(),
          updatedAt: now(),
        });
      }
      counts.domains++;
    }
    const knownDomains = verified.map((domain) => domain.id);
    const staleDomains = yield* db
      .select()
      .from(schema.ssoDomain)
      .where(
        and(
          eq(schema.ssoDomain.organizationId, organizationId),
          eq(schema.ssoDomain.source, "entra"),
        ),
      );
    const stale = staleDomains
      .map((row: { domain: string }) => row.domain)
      .filter((domain: string) => !knownDomains.includes(domain));
    if (stale.length)
      yield* db.delete(schema.ssoDomain).where(inArray(schema.ssoDomain.domain, stale));

    if (!options.syncUsersAndGroups) return { ...counts, usersDelta, groupsDelta };

    const isOwnerRole = (role: string) => role.split(",").includes("owner");
    const ownerCount = () =>
      Effect.gen(function* () {
        const rows = yield* db
          .select({ role: schema.member.role })
          .from(schema.member)
          .where(eq(schema.member.organizationId, organizationId));
        return rows.filter((row: { role: string }) => isOwnerRole(row.role)).length;
      });

    const findIdentity = (objectId: string) =>
      db.query.ssoIdentity.findFirst({
        where: { organizationId, objectId },
      });

    const isExpiredDelta = (error: unknown) => {
      const value = error as { _tag?: string; status?: number; body?: string };
      return (
        value?._tag === "RequestFailed" &&
        (value.status === 410 || /syncStateNotFound|resyncRequired|resync/i.test(value.body ?? ""))
      );
    };
    const usersDeltaPage = (link?: string) =>
      graph
        .usersDelta(azureTenantId, link)
        .pipe(Effect.catchIf(isExpiredDelta, () => graph.usersDelta(azureTenantId, undefined)));
    const groupsDeltaPage = (link?: string) =>
      graph
        .groupsDelta(azureTenantId, link)
        .pipe(Effect.catchIf(isExpiredDelta, () => graph.groupsDelta(azureTenantId, undefined)));

    let usersLink = options.usersDeltaLink ?? undefined;
    let usersComplete = false;
    for (let page = 0; page < 1000; page++) {
      const result = yield* usersDeltaPage(usersLink);
      for (const user of result.items) {
        const email = (user.mail ?? user.userPrincipalName)?.trim().toLowerCase();
        const identity = user.id ? yield* findIdentity(user.id) : undefined;
        let existing = identity
          ? yield* db.query.user.findFirst({ where: { id: identity.userId } })
          : undefined;
        if (!existing && email) {
          const byEmail = yield* db.query.user.findFirst({ where: { email } });
          if (byEmail) {
            // Mirror the SSO guard: link an existing account by email only
            // when this is its sole tenant. Never pull another tenant's user
            // into this directory.
            const memberships = yield* db.query.member.findMany({
              where: { userId: byEmail.id },
            });
            if (
              (memberships.length === 1 && memberships[0]?.organizationId === organizationId) ||
              (memberships.length === 0 && autoProvision)
            )
              existing = byEmail;
            else continue;
          }
        }
        if (user.removed || user.accountEnabled === false) {
          if (existing) {
            const membership = yield* db.query.member.findFirst({
              where: { organizationId, userId: existing.id },
            });
            if (membership && isOwnerRole(membership.role) && (yield* ownerCount()) <= 1) continue;
            yield* db
              .delete(schema.member)
              .where(
                and(
                  eq(schema.member.organizationId, organizationId),
                  eq(schema.member.userId, existing.id),
                ),
              );
            const orgGroups = yield* db
              .select({ id: schema.userGroup.id })
              .from(schema.userGroup)
              .where(eq(schema.userGroup.organizationId, organizationId));
            if (orgGroups.length)
              yield* db.delete(schema.userGroupMember).where(
                and(
                  eq(schema.userGroupMember.userId, existing.id),
                  inArray(
                    schema.userGroupMember.groupId,
                    orgGroups.map((group: { id: string }) => group.id),
                  ),
                ),
              );
            const remaining = yield* db
              .select()
              .from(schema.member)
              .where(eq(schema.member.userId, existing.id));
            if (remaining.length === 0)
              yield* db
                .update(schema.user)
                .set({ disabled: true, updatedAt: now() })
                .where(eq(schema.user.id, existing.id));
          }
          if (user.id)
            yield* db
              .delete(schema.ssoIdentity)
              .where(
                and(
                  eq(schema.ssoIdentity.organizationId, organizationId),
                  eq(schema.ssoIdentity.objectId, user.id),
                ),
              );
          continue;
        }
        if (!email || !user.id) continue;
        let userId = existing?.id;
        if (!userId) {
          if (!autoProvision) continue;
          userId = newId();
          yield* db.insert(schema.user).values({
            id: userId,
            name: user.displayName?.trim() || email,
            email,
            emailVerified: true,
            disabled: false,
            authRevision: newId(),
            createdAt: now(),
            updatedAt: now(),
          });
        }
        const membership = yield* db.query.member.findFirst({
          where: { organizationId, userId },
        });
        if (!membership)
          yield* db.insert(schema.member).values({
            id: newId(),
            organizationId,
            userId,
            role: "member",
            createdAt: now(),
            updatedAt: now(),
          });
        if (existing?.disabled)
          yield* db
            .update(schema.user)
            .set({ disabled: false, updatedAt: now() })
            .where(eq(schema.user.id, userId));
        if (!identity)
          yield* db.insert(schema.ssoIdentity).values({
            organizationId,
            objectId: user.id,
            userId,
            createdAt: now(),
          });
        counts.users++;
      }
      if (!result.nextLink) {
        usersDelta = result.deltaLink ?? undefined;
        usersComplete = true;
        break;
      }
      usersLink = result.nextLink;
    }
    if (!usersComplete)
      return yield* Effect.fail(new Error("Directory sync exceeded 1000 user pages"));

    let groupsLink = options.groupsDeltaLink ?? undefined;
    let groupsComplete = false;
    for (let page = 0; page < 1000; page++) {
      const result = yield* groupsDeltaPage(groupsLink);
      for (const group of result.items) {
        const existing = yield* db.query.userGroup.findFirst({
          where: { organizationId, externalId: group.id },
        });
        if (group.removed) {
          if (existing)
            yield* db.delete(schema.userGroup).where(eq(schema.userGroup.id, existing.id));
          continue;
        }
        let groupId = existing?.id;
        if (!groupId) {
          groupId = newId();
          yield* db.insert(schema.userGroup).values({
            id: groupId,
            organizationId,
            name: group.displayName || group.id,
            externalId: group.id,
            description: group.description ?? null,
            source: "graph",
            createdAt: now(),
            updatedAt: now(),
          });
        } else {
          yield* db
            .update(schema.userGroup)
            .set({
              name: group.displayName || existing!.name,
              description: group.description ?? existing!.description,
              source: "graph",
              updatedAt: now(),
            })
            .where(eq(schema.userGroup.id, groupId));
        }
        for (const member of group.members ?? []) {
          if (member.type && member.type !== "user") continue;
          const identity = yield* findIdentity(member.id);
          if (!identity) continue;
          if (member.removed) {
            yield* db
              .delete(schema.userGroupMember)
              .where(
                and(
                  eq(schema.userGroupMember.groupId, groupId),
                  eq(schema.userGroupMember.userId, identity.userId),
                ),
              );
          } else {
            const membership = yield* db.query.member.findFirst({
              where: { organizationId, userId: identity.userId },
            });
            if (!membership) continue;
            yield* db
              .insert(schema.userGroupMember)
              .ignore()
              .values({ groupId, userId: identity.userId });
          }
        }
        counts.groups++;
      }
      if (!result.nextLink) {
        groupsDelta = result.deltaLink ?? undefined;
        groupsComplete = true;
        break;
      }
      groupsLink = result.nextLink;
    }
    if (!groupsComplete)
      return yield* Effect.fail(new Error("Directory sync exceeded 1000 group pages"));

    return { ...counts, usersDelta, groupsDelta };
  });
