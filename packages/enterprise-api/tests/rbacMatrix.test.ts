import { Effect } from "effect";
import { describe, expect, it } from "vitest";
import { PERMISSION_SET } from "@mattrax/enterprise-domain";
import {
  isAccountMethod,
  isPublicMethod,
  permissionForMethod,
  UNMAPPED_METHOD_PERMISSION,
} from "@mattrax/enterprise-identity";
import { createEnterpriseService } from "@mattrax/enterprise-api";
import { makeDb, schema } from "./helpers.js";

/**
 * The permission map is the only place a service method becomes a tenant
 * permission. A method that is added to the service but not classified must
 * fail closed, and this test makes the omission visible before it ships.
 *
 * Object.keys on the wrapped service is deliberate: it enumerates the actual
 * methods rather than a hand-maintained list that can drift.
 */
const serviceMethods = () => {
  const db = makeDb();

  const auth = {
    requireUser: () => Effect.die("not used"),
    listApiTokens: () => Effect.succeed({ tokens: [] }),
    createApiToken: () => Effect.die("not used"),
    revokeApiToken: () => Effect.succeed({ status: "ok" }),
    requestEmailChange: () => Effect.succeed({ status: "ok" }),
    verifyEmailChange: () => Effect.succeed({ status: "ok" }),
    requireStepUp: () => Effect.void,
  };

  const service = createEnterpriseService({
    db,
    schema,
    origin: "https://enterprise.test",
    // SAFETY: permission classification never reaches storage or the database.
    storage: {} as never,
    auth: auth as never,
    authSecret: "rbac-matrix-test-secret",
  });

  return Object.keys(service);
};

describe("permission message matrix", () => {
  it("classifies every service method and never falls back to a tenant permission", () => {
    const methods = serviceMethods();

    expect(methods.length).toBeGreaterThan(300);

    for (const method of methods) {
      const permission = permissionForMethod(method);

      expect(permission, method).not.toBe(UNMAPPED_METHOD_PERMISSION);

      if (permission === undefined) {
        expect(
          isAccountMethod(method) || isPublicMethod(method),
          `${method} resolves no permission but is neither account-scoped nor public`,
        ).toBe(true);
      } else {
        expect(PERMISSION_SET.has(permission), `${method} -> ${permission}`).toBe(true);
        expect(isAccountMethod(method), method).toBe(false);
        expect(isPublicMethod(method), method).toBe(false);
      }
    }
  });

  it("fails closed for a method that was never classified", () => {
    expect(permissionForMethod("aMethodThatDoesNotExist")).toBe(UNMAPPED_METHOD_PERMISSION);
  });

  it("maps installer and BYOD methods to their resource permissions", () => {
    expect(permissionForMethod("downloadApplicationInstaller")).toBe("applications.read");
    expect(permissionForMethod("uploadApplicationInstaller")).toBe("applications.write");
    expect(permissionForMethod("getAppleByodConfig")).toBe("enrollment.read");
    expect(permissionForMethod("patchAppleByodConfig")).toBe("enrollment.write");
    expect(permissionForMethod("testAppleByodConfig")).toBe("enrollment.write");
    expect(permissionForMethod("confirmAppleByodHardware")).toBe("enrollment.write");
  });
});
