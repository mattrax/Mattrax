import { describe, expect, it } from "vitest";
import { defaultErrorCode, diagnoseError, errorDiagnostic } from "./errors.ts";
import { EnterpriseBadRequest } from "./enterprise.ts";

describe("enterprise error diagnostics", () => {
  it("keeps operational detail off the serialized message", () => {
    const error = diagnoseError(new EnterpriseBadRequest({ message: "Invitation expired" }), {
      code: "invitation_expired",
      details: { invitationId: "inv-1", sql: "secret" },
    });
    expect(errorDiagnostic(error)).toMatchObject({
      code: "invitation_expired",
      details: { invitationId: "inv-1" },
    });
    expect(JSON.stringify(error)).toBe(
      JSON.stringify({ _tag: "EnterpriseBadRequest", message: "Invitation expired" }),
    );
  });

  it("provides stable defaults for modelled tags", () => {
    expect(defaultErrorCode("EnterpriseForbidden")).toBe("forbidden");
    expect(defaultErrorCode("EnterpriseInternal")).toBe("internal_error");
    expect(defaultErrorCode("Nope")).toBeUndefined();
  });
});
