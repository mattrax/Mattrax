import {
  EnterpriseConflict,
  EnterpriseDbError,
  EnterpriseForbidden,
  EnterpriseInternal,
  EnterprisePermissionDenied,
} from "@mattrax/enterprise-domain/client";
import { describe, expect, it } from "vitest";
import { errorPresentation } from "./errors";

describe("errorPresentation", () => {
  it("maps generic backend internals to a stable server message", () => {
    const presentation = errorPresentation(new EnterpriseInternal({ message: "SQL exploded" }));

    expect(presentation).toMatchObject({ title: "Something went wrong", variant: "server" });
    expect(presentation.message).toContain("Something went wrong on our side");
    expect(presentation.message).not.toContain("SQL");
  });

  it("maps conflict and permission tags", () => {
    expect(errorPresentation(new EnterpriseConflict({ message: "Already exists" })).variant).toBe(
      "validation",
    );
    expect(errorPresentation(new EnterpriseForbidden({ message: "Nope" })).variant).toBe(
      "permission",
    );
    expect(
      errorPresentation(
        new EnterprisePermissionDenied({
          message: "Your role (Helpdesk) does not include devices.write.",
          permission: "devices.write",
          roleName: "Helpdesk",
          roleKind: "built-in",
        }),
      ),
    ).toMatchObject({ variant: "permission", message: expect.stringContaining("Helpdesk") });
  });

  it("understands raw { error } route envelopes", () => {
    expect(errorPresentation({ error: "SSO is not available" }).message).toBe(
      "SSO is not available",
    );
  });

  it("uses a fixed message for server-only failures", () => {
    const presentation = errorPresentation(
      new EnterpriseDbError({ message: "connection refused" }),
    );

    expect(presentation.message).not.toContain("connection refused");
    expect(presentation.variant).toBe("server");
  });
});
