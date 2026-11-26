import { Effect, Layer } from "effect";
import { describe, expect, it } from "vitest";
import {
  defaultErrorCode,
  EnterpriseErrorDiagnostics,
  makeEnterpriseErrorDiagnostics,
} from "./Errors.ts";
import { EnterpriseBadRequest } from "./Errors.js";

describe("enterprise error diagnostics", () => {
  it("keeps operational detail off the serialized message", () => {
    const error = Effect.runSync(
      Effect.gen(function* () {
        const diagnostics = yield* EnterpriseErrorDiagnostics;
        const failure = diagnostics.diagnose(
          new EnterpriseBadRequest({ message: "Invitation expired" }),
          {
            code: "invitation_expired",
            details: { invitationId: "inv-1", sql: "secret" },
          },
        );

        expect(diagnostics.read(failure)).toMatchObject({
          code: "invitation_expired",
          details: { invitationId: "inv-1" },
        });

        return failure;
      }).pipe(Effect.provide(EnterpriseErrorDiagnostics.layer)),
    );

    expect(JSON.stringify(error)).toBe(
      JSON.stringify(EnterpriseBadRequest.make({ message: "Invitation expired" })),
    );
  });

  it("does not share diagnostics between Layers", () => {
    const result = Effect.runSync(
      Effect.gen(function* () {
        const first = yield* EnterpriseErrorDiagnostics;
        const error = first.diagnose(new EnterpriseBadRequest({ message: "failure" }), {
          code: "validation",
        });
        const second = yield* Effect.service(EnterpriseErrorDiagnostics).pipe(
          Effect.provide(
            Layer.effect(EnterpriseErrorDiagnostics, Effect.sync(makeEnterpriseErrorDiagnostics)),
          ),
        );

        return { first: first.read(error), second: second.read(error) };
      }).pipe(Effect.provide(EnterpriseErrorDiagnostics.layer)),
    );

    expect(result.first).toMatchObject({ code: "validation" });
    expect(result.second).toBeUndefined();
  });

  it("provides stable defaults for modelled tags", () => {
    expect(defaultErrorCode("EnterpriseForbidden")).toBe("forbidden");
    expect(defaultErrorCode("EnterpriseInternal")).toBe("internal_error");
    expect(defaultErrorCode("Nope")).toBeUndefined();
  });
});
