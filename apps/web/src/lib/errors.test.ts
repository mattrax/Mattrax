import { describe, expect, it } from "vitest";
import { errorPresentation } from "./errors";

describe("errorPresentation", () => {
  it("maps generic backend internals to a stable server message", () => {
    const presentation = errorPresentation({ _tag: "EnterpriseInternal", message: "SQL exploded" });
    expect(presentation).toMatchObject({ title: "Something went wrong", variant: "server" });
    expect(presentation.message).toContain("Something went wrong on our side");
    expect(presentation.message).not.toContain("SQL");
  });

  it("maps conflict and permission tags", () => {
    expect(
      errorPresentation({ _tag: "EnterpriseConflict", message: "Already exists" }).variant,
    ).toBe("validation");
    expect(errorPresentation({ _tag: "EnterpriseForbidden", message: "Nope" }).variant).toBe(
      "permission",
    );
    expect(
      errorPresentation({
        _tag: "EnterprisePermissionDenied",
        message: "Your role (Helpdesk) does not include devices.write.",
      }),
    ).toMatchObject({ variant: "permission", message: expect.stringContaining("Helpdesk") });
  });

  it("understands raw { error } route envelopes", () => {
    expect(errorPresentation({ error: "SSO is not available" }).message).toBe(
      "SSO is not available",
    );
  });

  it("uses a fixed message for server-only failures", () => {
    const presentation = errorPresentation({
      _tag: "EnterpriseDbError",
      message: "connection refused",
    });

    expect(presentation.message).not.toContain("connection refused");
    expect(presentation.variant).toBe("server");
  });
});
