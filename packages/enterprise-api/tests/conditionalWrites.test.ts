import { Effect } from "effect";
import { describe, expect, it } from "vitest";
import type { EnterpriseNotFound, EnterprisePreconditionFailed } from "@mattrax/enterprise-domain";
import { EnterpriseUnauthorized } from "@mattrax/enterprise-domain";
import { createEnterpriseService } from "@mattrax/enterprise-api";
import { makeDb, request, runEffect, schema } from "./helpers.js";

const origin = "https://enterprise.test";

const headers = { cookie: "mattrax_session=test" };

const makeContext = () => {
  const db = makeDb();
  const now = new Date();

  const user = {
    id: "user-1",
    name: "Owner",
    email: "owner@example.com",
    emailVerified: true,
    image: null,
    createdAt: now,
    updatedAt: now,
  };

  db.store.account.push(user);

  const auth = {
    requireUser: (input: any) => {
      const inputHeaders =
        input instanceof Request ? Object.fromEntries(input.headers) : input.headers;

      return inputHeaders.cookie
        ? Effect.succeed({ user })
        : Effect.fail(new EnterpriseUnauthorized({ message: "Unauthenticated" }));
    },
    listApiTokens: () => Effect.succeed({ tokens: [] }),
    createApiToken: () => Effect.die("not used"),
    revokeApiToken: () => Effect.succeed({ status: "ok" }),
    requestEmailChange: () => Effect.succeed({ status: "ok" }),
    requireStepUp: () => Effect.void,
    verifyEmailChange: () => Effect.succeed({ status: "ok" }),
  };

  const service = createEnterpriseService({
    db,
    schema,
    origin,
    // SAFETY: these tests never reach R2.
    storage: {} as any,
    // SAFETY: the fake implements only the auth methods these tests exercise.
    auth: auth as any,
    authSecret: "conditional-writes-test-secret",
  });

  return { db, service };
};

type Context = ReturnType<typeof makeContext>;

const makeTenant = async (context: Context, slug = "acme") =>
  runEffect(context.service.createTenant(request(headers), { name: "Acme", slug }));

const otherTenant = async (context: Context) =>
  runEffect(context.service.createTenant(request(headers), { name: "Other", slug: "other" }));

const earlier = (iso: string) => new Date(Date.parse(iso) - 1).toISOString();

const preconditionFailure = <A, E>(effect: Effect.Effect<A, E, any>) =>
  runEffect(effect.pipe(Effect.catch((error) => Effect.succeed(error))));

const expectPreconditionFailure = async <A, E>(
  effect: Effect.Effect<A, E, any>,
  expected: { name: string; updatedAt: string },
) => {
  const failure = await preconditionFailure(effect);

  // SAFETY: catch returns this failure when the effect fails; the guarded
  // endpoints only succeed with `{ status: "ok" }`, which has no `current`.
  const precondition = failure as EnterprisePreconditionFailed;

  expect(precondition).toMatchObject({
    _tag: "EnterprisePreconditionFailed",
    current: { name: expected.name, updatedAt: expected.updatedAt },
  });
  expect(precondition.current.record).toBeDefined();

  return precondition;
};

const expectNotFound = async <A, E>(effect: Effect.Effect<A, E, any>) => {
  const failure = await runEffect(effect.pipe(Effect.catch((error) => Effect.succeed(error))));

  // SAFETY: catch returns this failure when the effect fails; a success is
  // an ok result, which the assertion below would reject as not tagged.
  const notFound = failure as EnterpriseNotFound;

  expect(notFound).toMatchObject({ _tag: "EnterpriseNotFound" });
};

describe("optimistic concurrency", () => {
  it("guards policies", async () => {
    const context = makeContext();
    const tenant = await makeTenant(context);

    const created = await runEffect(
      context.service.createPolicy(request(headers), tenant.id, {
        name: "Baseline",
        notes: "First",
      }),
    );

    const loaded = await runEffect(
      context.service.getPolicy(request(headers), tenant.id, created.id),
    );

    await runEffect(
      context.service.patchPolicy(request(headers), tenant.id, created.id, {
        name: "Saved",
        expectedUpdatedAt: loaded.updatedAt,
      }),
    );

    const saved = await runEffect(
      context.service.getPolicy(request(headers), tenant.id, created.id),
    );

    expect(saved.name).toBe("Saved");

    // A later edit based on the version before the first save is refused and
    // carries the row the editor should reload.
    await expectPreconditionFailure(
      context.service.patchPolicy(request(headers), tenant.id, created.id, {
        name: "Stale",
        expectedUpdatedAt: earlier(loaded.updatedAt),
      }),
      { name: "Saved", updatedAt: saved.updatedAt },
    );

    expect(
      (await runEffect(context.service.getPolicy(request(headers), tenant.id, created.id))).name,
    ).toBe("Saved");

    // Omitting the precondition keeps older clients working.
    await runEffect(
      context.service.patchPolicy(request(headers), tenant.id, created.id, { name: "Legacy" }),
    );

    expect(
      (await runEffect(context.service.getPolicy(request(headers), tenant.id, created.id))).name,
    ).toBe("Legacy");

    const other = await otherTenant(context);

    await expectNotFound(
      context.service.patchPolicy(request(headers), other.id, created.id, {
        name: "Cross tenant",
        expectedUpdatedAt: earlier(saved.updatedAt),
      }),
    );
  });

  it("accepts If-Unmodified-Since as the coarse fallback", async () => {
    const context = makeContext();
    const tenant = await makeTenant(context);

    const created = await runEffect(
      context.service.createPolicy(request(headers), tenant.id, { name: "Header" }),
    );

    const loaded = await runEffect(
      context.service.getPolicy(request(headers), tenant.id, created.id),
    );

    await runEffect(
      context.service.patchPolicy(
        request({
          ...headers,
          "if-unmodified-since": new Date(loaded.updatedAt).toUTCString(),
        }),
        tenant.id,
        created.id,
        { name: "By header" },
      ),
    );

    expect(
      (await runEffect(context.service.getPolicy(request(headers), tenant.id, created.id))).name,
    ).toBe("By header");

    await expectPreconditionFailure(
      context.service.patchPolicy(
        request({
          ...headers,
          "if-unmodified-since": new Date("2026-01-01T00:00:00.000Z").toUTCString(),
        }),
        tenant.id,
        created.id,
        { name: "Stale header" },
      ),
      {
        name: "By header",
        updatedAt: (
          await runEffect(context.service.getPolicy(request(headers), tenant.id, created.id))
        ).updatedAt,
      },
    );
  });

  it("guards groups", async () => {
    const context = makeContext();
    const tenant = await makeTenant(context);

    const created = await runEffect(
      context.service.createGroup(request(headers), tenant.id, { name: "Baseline" }),
    );

    const loaded = await runEffect(
      context.service.getGroup(request(headers), tenant.id, created.id),
    );

    await runEffect(
      context.service.patchGroup(request(headers), tenant.id, created.id, {
        name: "Saved",
        expectedUpdatedAt: loaded.updatedAt,
      }),
    );

    const saved = await runEffect(
      context.service.getGroup(request(headers), tenant.id, created.id),
    );

    expect(saved.name).toBe("Saved");

    await expectPreconditionFailure(
      context.service.patchGroup(request(headers), tenant.id, created.id, {
        name: "Stale",
        expectedUpdatedAt: earlier(loaded.updatedAt),
      }),
      { name: "Saved", updatedAt: saved.updatedAt },
    );

    await runEffect(
      context.service.patchGroup(request(headers), tenant.id, created.id, { name: "Legacy" }),
    );

    expect(
      (await runEffect(context.service.getGroup(request(headers), tenant.id, created.id))).name,
    ).toBe("Legacy");

    const other = await otherTenant(context);

    await expectNotFound(
      context.service.patchGroup(request(headers), other.id, created.id, {
        name: "Cross tenant",
        expectedUpdatedAt: earlier(saved.updatedAt),
      }),
    );
  });

  it("guards applications", async () => {
    const context = makeContext();
    const tenant = await makeTenant(context);

    const created = await runEffect(
      context.service.createApplication(request(headers), tenant.id, {
        name: "Baseline",
        installers: [
          {
            platform: "apple",
            source: "manifest",
            bundleId: "com.example.app",
            manifestUrl: "https://example.com/app.plist",
          },
        ],
      }),
    );

    const loaded = await runEffect(
      context.service.getApplication(request(headers), tenant.id, created.id),
    );

    await runEffect(
      context.service.patchApplication(request(headers), tenant.id, created.id, {
        name: "Saved",
        expectedUpdatedAt: loaded.updatedAt,
      }),
    );

    const saved = await runEffect(
      context.service.getApplication(request(headers), tenant.id, created.id),
    );

    expect(saved.name).toBe("Saved");

    await expectPreconditionFailure(
      context.service.patchApplication(request(headers), tenant.id, created.id, {
        name: "Stale",
        expectedUpdatedAt: earlier(loaded.updatedAt),
      }),
      { name: "Saved", updatedAt: saved.updatedAt },
    );

    await runEffect(
      context.service.patchApplication(request(headers), tenant.id, created.id, {
        name: "Legacy",
      }),
    );

    expect(
      (await runEffect(context.service.getApplication(request(headers), tenant.id, created.id)))
        .name,
    ).toBe("Legacy");

    const other = await otherTenant(context);

    await expectNotFound(
      context.service.patchApplication(request(headers), other.id, created.id, {
        name: "Cross tenant",
        expectedUpdatedAt: earlier(saved.updatedAt),
      }),
    );
  });

  it("guards scripts", async () => {
    const context = makeContext();
    const tenant = await makeTenant(context);
    const organization = context.db.store.organization.find((row) => row.id === tenant.id);

    organization!.scriptsEnabled = true;

    const created = await runEffect(
      context.service.createScript(request(headers), tenant.id, {
        name: "Baseline",
        language: "bash",
        body: "#!/bin/bash\necho baseline",
        runAs: "user",
        timeoutSeconds: 300,
        trigger: { type: "manual" },
      }),
    );

    const loaded = await runEffect(
      context.service.getScript(request(headers), tenant.id, created.id),
    );

    await runEffect(
      context.service.patchScript(request(headers), tenant.id, created.id, {
        name: "Saved",
        expectedUpdatedAt: loaded.script.updatedAt,
      }),
    );

    const saved = await runEffect(
      context.service.getScript(request(headers), tenant.id, created.id),
    );

    expect(saved.script.name).toBe("Saved");

    await expectPreconditionFailure(
      context.service.patchScript(request(headers), tenant.id, created.id, {
        name: "Stale",
        expectedUpdatedAt: earlier(loaded.script.updatedAt),
      }),
      { name: "Saved", updatedAt: saved.script.updatedAt },
    );

    await runEffect(
      context.service.patchScript(request(headers), tenant.id, created.id, { name: "Legacy" }),
    );

    expect(
      (await runEffect(context.service.getScript(request(headers), tenant.id, created.id))).script
        .name,
    ).toBe("Legacy");

    const other = await otherTenant(context);

    await expectNotFound(
      context.service.patchScript(request(headers), other.id, created.id, {
        name: "Cross tenant",
        expectedUpdatedAt: earlier(saved.script.updatedAt),
      }),
    );
  });

  it("rejects a malformed precondition instead of writing unconditionally", async () => {
    const context = makeContext();
    const tenant = await makeTenant(context);

    const created = await runEffect(
      context.service.createPolicy(request(headers), tenant.id, { name: "Baseline" }),
    );

    const failure = await runEffect(
      context.service
        .patchPolicy(request(headers), tenant.id, created.id, {
          name: "Should not save",
          expectedUpdatedAt: "yesterday",
        })
        .pipe(Effect.catch((error) => Effect.succeed(error))),
    );

    expect(failure).toMatchObject({ _tag: "EnterpriseBadRequest" });
    expect(
      (await runEffect(context.service.getPolicy(request(headers), tenant.id, created.id))).name,
    ).toBe("Baseline");
  });
});
