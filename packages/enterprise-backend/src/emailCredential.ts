import { and, eq } from "drizzle-orm";
import { Effect } from "effect";
import { authCredentials, authEmailCredentials, schema } from "@mattrax/enterprise-core";

/**
 * Passwordless sign-in needs an active email credential in the auth authority
 * vector. Password registration does not create one, so provision it lazily:
 * once at registration/sign-in, and again after an email address is verified.
 */
export const provisionEmailCredential = (
  db: any,
  moduleId: string,
  subjectId: string,
): Effect.Effect<void, never, never> =>
  Effect.gen(function* () {
    const user = yield* db.query.user
      .findFirst({ where: { id: subjectId } })
      .pipe(Effect.catch(() => Effect.succeed(undefined)));
    if (!user) return;
    const [existing] = yield* db
      .select({ credentialId: authCredentials.credentialId })
      .from(authCredentials)
      .innerJoin(
        authEmailCredentials,
        eq(authEmailCredentials.credentialId, authCredentials.credentialId),
      )
      .where(
        and(eq(authCredentials.subjectId, subjectId), eq(authEmailCredentials.moduleId, moduleId)),
      )
      .limit(1);
    if (existing) return;

    const credentialId = crypto.randomUUID().replaceAll("-", "").slice(0, 24);
    const revision = crypto.randomUUID().replaceAll("-", "").slice(0, 24);
    yield* db
      .insert(authCredentials)
      .ignore()
      .values({ credentialId, subjectId, revision, active: true });
    yield* db.insert(schema.authEmailCredentials).ignore().values({
      moduleId,
      subjectId,
      credentialId,
      identifierNamespace: "email",
      identifierValue: user.email,
      credentialRevision: revision,
      active: true,
    });
  }).pipe(Effect.catch(() => Effect.void)) as Effect.Effect<void, never, never>;
