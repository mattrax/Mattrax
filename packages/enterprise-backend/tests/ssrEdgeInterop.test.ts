import { Effect } from "effect";
import { BUILT_IN_ROLE_PERMISSIONS, ssrTenantPermissions } from "@mattrax/enterprise-domain";
import { describe, expect, it } from "vitest";
// The edge verifier is deliberately kept out of this package's production
// graph. Importing it here proves the real signer and the real verifier agree
// on the wire format instead of testing two hand-written fixtures.
import {
  verifySsrRevision as verifyRevisionAtEdge,
  verifySsrToken as verifyAtEdge,
} from "../../../apps/web/src/server/ssr-token.ts";
import { signSsrRevision, signSsrToken } from "../src/Account/ssrToken.ts";

const secret = "interop-secret-that-is-long-enough-for-hmac";

const sessionCookie = "opaque-session-cookie";

const run = <A>(effect: Effect.Effect<A, unknown, never>) => Effect.runPromise(effect);

const signed = () =>
  run(
    signSsrToken(secret, {
      subjectId: "user-1",
      sessionId: "session-1",
      sessionCookie,
      name: "Owner",
      email: "owner@example.com",
      emailVerified: true,
      authRevision: "revision-1",
      user: {
        id: "user-1",
        name: "Owner",
        email: "owner@example.com",
        emailVerified: true,
        image: null,
        mfaEnabled: false,
        totpEnabled: false,
        passkeyEnabled: false,
        mfaRequired: false,
      },
      tenants: [
        {
          id: "tenant-1",
          name: "Acme",
          slug: "acme",
          role: "owner",
          roleId: null,
          roleName: "Owner",
          roleKind: "built-in",
          permissions: ["tenant.read", "devices.read"],
          logo: null,
          displayName: null,
          brandColor: null,
        },
      ],
    }),
  );

describe("SSR signer/edge interop", () => {
  it("verifies the API-signed token with the web Worker verifier", async () => {
    const token = await signed();

    expect(token).toBeDefined();

    const payload = await verifyAtEdge(secret, token!.token, sessionCookie);

    expect(payload).toMatchObject({
      sub: "user-1",
      sid: "session-1",
      emailVerified: true,
      ver: "revision-1",
    });
    expect(payload?.tenants?.map((tenant) => tenant.id)).toEqual(["tenant-1"]);
    expect(payload?.tenants?.[0]?.permissions).toBeUndefined();
    expect([...ssrTenantPermissions(payload!.tenants![0]!)]).toEqual([
      ...BUILT_IN_ROLE_PERMISSIONS.owner,
    ]);
  });

  it("rejects the same token for a rotated session cookie", async () => {
    const token = await signed();

    expect(await verifyAtEdge(secret, token!.token, "rotated-cookie")).toBeUndefined();
  });

  it("signs a revision the edge verifier accepts for the same session and version", async () => {
    const token = await signed();

    const revision = await run(
      signSsrRevision(secret, { sessionId: "session-1", authRevision: "revision-1" }),
    );

    const payload = await verifyAtEdge(secret, token!.token, sessionCookie);
    const revisionPayload = await verifyRevisionAtEdge(secret, revision.token);

    expect(revisionPayload).toMatchObject({ sid: "session-1", ver: "revision-1" });
    expect(revisionPayload!.sid).toBe(payload!.sid);
    expect(revisionPayload!.ver).toBe(payload!.ver);
  });

  it("rejects an expired or foreign-secret revision at the edge", async () => {
    const expired = await run(
      signSsrRevision(secret, { sessionId: "session-1", authRevision: "revision-1", now: 0 }),
    );

    const foreign = await run(
      signSsrRevision("a-different-secret", {
        sessionId: "session-1",
        authRevision: "revision-1",
      }),
    );

    expect(await verifyRevisionAtEdge(secret, expired.token, Date.now())).toBeUndefined();
    expect(await verifyRevisionAtEdge(secret, foreign.token)).toBeUndefined();
  });
});
